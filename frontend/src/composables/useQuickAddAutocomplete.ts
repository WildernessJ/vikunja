import {computed, ref, watch} from 'vue'
import type {ComputedRef, Ref} from 'vue'
import {useDebounceFn} from '@vueuse/core'

import {
	getLabelsFromPrefix,
	insertTokenAtCaret,
	PREFIXES,
	PrefixMode,
	tokenAtCaret,
	type TokenAtCaret,
	type TokenInsertResult,
} from '@/modules/quickAddMagic'
import {useLabelStore} from '@/stores/labels'
import {useProjectStore} from '@/stores/projects'
import ProjectUserService from '@/services/projectUsers'
import {getDisplayName} from '@/models/user'
import {getHexColor} from '@/models/task'
import type {IAbstract} from '@/modelTypes/IAbstract'
import type {IUser} from '@/modelTypes/IUser'

export type AutocompleteKind = 'project' | 'label' | 'assignee'

export interface AutocompleteItem {
	kind: AutocompleteKind,
	id: number | string,
	display: string,
	insertValue: string,
	color?: string,
	user?: IUser,
}

// Priority ('!') only exists in the task-detail title's dropdown (the composer
// never surfaces it), but the type lives here - not in the detail-only
// useTaskTitleAutocomplete - so QuickAddAutocompleteResults (shared by both
// surfaces) doesn't have to depend on a detail-specific composable.
export interface PriorityAutocompleteItem {
	kind: 'priority',
	id: number,
	display: string,
	insertValue: string,
}

export type TitleAutocompleteItem = AutocompleteItem | PriorityAutocompleteItem

const ASSIGNEE_DEBOUNCE_MS = 300

export function useQuickAddAutocomplete(options: {
	title: Ref<string>,
	mode: Ref<PrefixMode>,
	isMultiline: Ref<boolean>,
	assigneeProjectId: ComputedRef<number | null>,
}) {
	const {title, mode, isMultiline, assigneeProjectId} = options

	// Stores/service are constructed lazily, only once a token of their kind is
	// actually active - so mounting the composer never requires every consumer
	// (e.g. existing tests that only exercise the disabled-mode path) to mock them.
	let projectUserService: ProjectUserService | undefined

	const caretOffset = ref(0)
	const forceClosed = ref(false)
	const items = ref<AutocompleteItem[]>([])
	const requestId = ref(0)

	const activeToken = computed<TokenAtCaret | null>(() => {
		if (forceClosed.value || mode.value === PrefixMode.Disabled || isMultiline.value) {
			return null
		}
		return tokenAtCaret(title.value, caretOffset.value, PREFIXES[mode.value])
	})

	const isOpen = computed(() => activeToken.value !== null)

	async function fetchAssignees(query: string, projectId: number, myRequestId: number) {
		projectUserService ??= new ProjectUserService()
		const response = await projectUserService.getAll({projectId} as unknown as IAbstract, {s: query}) as IUser[]
		if (myRequestId !== requestId.value) {
			return
		}
		items.value = response.map(user => ({
			kind: 'assignee' as const,
			id: user.id,
			display: getDisplayName(user),
			insertValue: user.username,
			user,
		}))
	}

	const debouncedFetchAssignees = useDebounceFn(fetchAssignees, ASSIGNEE_DEBOUNCE_MS)

	// assigneeProjectId is in the source (not just read inside the callback) so a
	// project chip change while an assignee token is already active re-triggers the fetch.
	watch([activeToken, assigneeProjectId], ([token]) => {
		requestId.value++

		if (token === null) {
			items.value = []
			return
		}

		if (token.type === 'project') {
			items.value = useProjectStore().searchProject(token.query)
				.map(p => ({kind: 'project' as const, id: p.id, display: p.title, insertValue: p.title}))
			return
		}

		if (token.type === 'label') {
			const labelStore = useLabelStore()
			const alreadyTypedTitles = getLabelsFromPrefix(title.value, mode.value) ?? []
			const alreadyTypedLabels = labelStore.getLabelsByExactTitles(alreadyTypedTitles)
			items.value = labelStore.filterLabelsByQuery(alreadyTypedLabels, token.query)
				.map(l => ({kind: 'label' as const, id: l.id, display: l.title, insertValue: l.title, color: getHexColor(l.hexColor)}))
			return
		}

		// Assignee suggestions need a resolvable project id. When none is available
		// (no chip override, no route/default project) we just show nothing instead
		// of guessing or throwing - other token types stay unaffected.
		const projectId = assigneeProjectId.value
		items.value = []
		if (projectId !== null) {
			debouncedFetchAssignees(token.query, projectId, requestId.value)
		}
	}, {immediate: true})

	function setCaretOffset(offset: number) {
		// Only a real caret move (or the text change that comes with typing, which
		// also shifts the offset) reopens after an Escape dismiss. Without this guard
		// the keyup from the Escape press itself re-runs with an unchanged offset and
		// reopens the dropdown we just closed.
		if (offset !== caretOffset.value) {
			forceClosed.value = false
		}
		caretOffset.value = offset
	}

	function close() {
		forceClosed.value = true
	}

	function insertItem(item: AutocompleteItem): TokenInsertResult | null {
		const token = activeToken.value
		if (token === null) {
			return null
		}
		return insertTokenAtCaret(title.value, token, item.insertValue)
	}

	return {
		items,
		isOpen,
		activeToken,
		setCaretOffset,
		close,
		insertItem,
	}
}
