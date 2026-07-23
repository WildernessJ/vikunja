import {computed, ref} from 'vue'
import type {ComputedRef, Ref} from 'vue'

import {PrefixMode} from '@/modules/quickAddMagic'
import {PRIORITIES} from '@/constants/priorities'
import {useQuickAddAutocomplete, type AutocompleteItem} from '@/composables/useQuickAddAutocomplete'

export interface PriorityAutocompleteItem {
	kind: 'priority',
	id: number,
	display: string,
	insertValue: string,
}

export type TitleAutocompleteItem = AutocompleteItem | PriorityAutocompleteItem

interface PriorityToken {
	prefix: string,
	query: string,
	start: number,
	end: number,
}

const PRIORITY_LABEL_KEYS: Record<number, string> = {
	[PRIORITIES.LOW]: 'task.priority.low',
	[PRIORITIES.MEDIUM]: 'task.priority.medium',
	[PRIORITIES.HIGH]: 'task.priority.high',
	[PRIORITIES.URGENT]: 'task.priority.urgent',
	[PRIORITIES.DO_NOW]: 'task.priority.doNow',
}

// Priority ('!') is deliberately excluded from the shared quickAddMagic tokenAtCaret
// module (a fixed 5-value enum, called out as out of scope there - see its own
// locked test asserting priority is never surfaced). This detail-title spec still
// requires a priority dropdown, so it's layered on as a small, self-contained
// addition instead of forking the shared project/label/assignee token logic.
function priorityTokenAtCaret(text: string, caretOffset: number): PriorityToken | null {
	const prefix = '!'
	let start = -1
	for (let i = 0; i < caretOffset; i++) {
		if (text[i] === prefix && (i === 0 || text[i - 1] === ' ')) {
			start = i
		}
	}
	if (start === -1) {
		return null
	}

	const contentStart = start + 1
	if (text[contentStart] === ' ') {
		return null
	}

	const space = text.indexOf(' ', contentStart)
	const end = space === -1 ? text.length : space
	if (caretOffset < contentStart || caretOffset > end) {
		return null
	}

	return {prefix, start, end, query: text.slice(contentStart, Math.min(caretOffset, end))}
}

// Unlike the composer (which formats the typed prefix into a complete token,
// e.g. "+Web" -> "+Website "), accepting a title token here removes it
// entirely - the property moves onto the task, the title text just loses the
// token. Collapsing to a single space and trimming handles the token sitting
// at either edge of the string or swallowing the separator space next to it.
function stripToken(text: string, token: {start: number, end: number}) {
	let end = token.end
	if (text[end] === ' ') {
		end += 1
	}
	const stripped = (text.slice(0, token.start) + text.slice(end))
		.replace(/ {2,}/g, ' ')
		.trim()

	return {text: stripped, caret: Math.min(token.start, stripped.length)}
}

function priorityItemsFor(query: string, t: (key: string) => string): PriorityAutocompleteItem[] {
	return Object.entries(PRIORITY_LABEL_KEYS)
		.filter(([value]) => query === '' || value.startsWith(query))
		.map(([value, labelKey]) => ({
			kind: 'priority' as const,
			id: Number(value),
			display: t(labelKey),
			insertValue: value,
		}))
}

export function useTaskTitleAutocomplete(options: {
	title: Ref<string>,
	mode: Ref<PrefixMode>,
	assigneeProjectId: ComputedRef<number | null>,
	t: (key: string) => string,
}) {
	const {title, mode, assigneeProjectId, t} = options
	const isMultiline = computed(() => false)

	const base = useQuickAddAutocomplete({title, mode, isMultiline, assigneeProjectId})

	const caretOffset = ref(0)
	const forceClosed = ref(false)

	const priorityToken = computed<PriorityToken | null>(() => {
		if (forceClosed.value || mode.value === PrefixMode.Disabled) {
			return null
		}
		return priorityTokenAtCaret(title.value, caretOffset.value)
	})

	// Mirrors tokenAtCaret's own tie-break: the token starting later in the text wins.
	const usesPriorityToken = computed(() => {
		if (priorityToken.value === null) {
			return false
		}
		if (base.activeToken.value === null) {
			return true
		}
		return priorityToken.value.start > base.activeToken.value.start
	})

	const isOpen = computed(() => usesPriorityToken.value || base.isOpen.value)

	const items = computed<TitleAutocompleteItem[]>(() => (
		usesPriorityToken.value ? priorityItemsFor(priorityToken.value?.query ?? '', t) : base.items.value
	))

	function setCaretOffset(offset: number) {
		if (offset !== caretOffset.value) {
			forceClosed.value = false
		}
		caretOffset.value = offset
		base.setCaretOffset(offset)
	}

	function close() {
		forceClosed.value = true
		base.close()
	}

	function insertItem(item: TitleAutocompleteItem) {
		const token = item.kind === 'priority' ? priorityToken.value : base.activeToken.value
		if (token === null) {
			return null
		}
		return stripToken(title.value, token)
	}

	return {
		items,
		isOpen,
		setCaretOffset,
		close,
		insertItem,
	}
}
