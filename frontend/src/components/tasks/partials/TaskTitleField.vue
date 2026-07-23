<template>
	<div class="task-title-field">
		<textarea
			ref="titleInput"
			v-model="localTitle"
			class="title input"
			:class="{disabled}"
			:disabled="disabled"
			rows="1"
			:aria-label="$t('task.attributes.title')"
			role="combobox"
			aria-autocomplete="list"
			:aria-expanded="autocomplete.isOpen.value"
			:aria-controls="listboxId"
			@input="onActivity"
			@click="onActivity"
			@keyup="onActivity"
			@keydown="onKeydown"
			@blur="onBlur"
		/>
		<div
			v-if="autocomplete.isOpen.value"
			ref="autocompleteWrapper"
			class="task-title-autocomplete-wrapper"
			:style="{left: `${autocompletePosition.x}px`, top: `${autocompletePosition.y}px`}"
			@pointerdown="onAutocompletePointerDown"
		>
			<QuickAddAutocompleteResults
				ref="autocompleteResults"
				:items="autocomplete.items.value"
				:listbox-id="listboxId"
				@select="onSelect"
				@close="autocomplete.close()"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch} from 'vue'
import {onClickOutside} from '@vueuse/core'
import {autoUpdate, computePosition, flip, offset, shift} from '@floating-ui/dom'

import type {IProject} from '@/modelTypes/IProject'
import type {ILabel} from '@/modelTypes/ILabel'
import type {IUser} from '@/modelTypes/IUser'
import type {PrefixMode} from '@/modules/quickAddMagic'

import QuickAddAutocompleteResults from '@/components/tasks/partials/QuickAddAutocompleteResults.vue'
import {useAutoHeightTextarea} from '@/composables/useAutoHeightTextarea'
import {useTaskTitleAutocomplete} from '@/composables/useTaskTitleAutocomplete'
import type {TitleAutocompleteItem} from '@/composables/useQuickAddAutocomplete'
import {useProjectStore} from '@/stores/projects'
import {useLabelStore} from '@/stores/labels'
import {useI18n} from 'vue-i18n'
import {error} from '@/message'

const props = defineProps<{
	modelValue: string,
	disabled: boolean,
	mode: PrefixMode,
	assigneeProjectId: number | null,
	// Every accept path (including the title's own literal-text save) reuses the
	// same save functions the property chips call - this component never talks
	// to the store directly.
	onSaveLiteralTitle: (title: string) => Promise<void>,
	// Project/priority setters already saveTask() the whole task - passing the
	// stripped title lets them persist it in that same PATCH instead of a
	// separate trailing literal-save (which would double-save and double-toast).
	onAcceptProject: (project: IProject, title: string) => Promise<void>,
	onAcceptLabel: (label: ILabel) => Promise<void>,
	onAcceptAssignee: (user: IUser) => Promise<void>,
	onAcceptPriority: (priority: number, title: string) => Promise<void>,
}>()

const emit = defineEmits<{
	'update:modelValue': [title: string],
}>()

const {t} = useI18n({useScope: 'global'})
const projectStore = useProjectStore()
const labelStore = useLabelStore()

const localTitle = ref('')
watch(() => props.modelValue, (value) => {
	if (value !== localTitle.value) {
		localTitle.value = value
	}
}, {immediate: true})

const {textarea: titleInput} = useAutoHeightTextarea(localTitle)

const listboxId = `task-title-listbox-${useId()}`

const mode = computed(() => props.mode)
const assigneeProjectId = computed(() => props.assigneeProjectId)

const autocomplete = useTaskTitleAutocomplete({
	title: localTitle,
	mode,
	assigneeProjectId,
	t,
})

const autocompleteWrapper = ref<HTMLElement | null>(null)
const autocompleteResults = ref<InstanceType<typeof QuickAddAutocompleteResults> | null>(null)
const autocompletePosition = ref({x: 0, y: 0})

async function updateAutocompletePosition() {
	if (!titleInput.value || !autocompleteWrapper.value) {
		return
	}
	const {x, y} = await computePosition(titleInput.value, autocompleteWrapper.value, {
		placement: 'bottom-start',
		strategy: 'absolute',
		middleware: [offset(4), flip(), shift({padding: 8})],
	})
	autocompletePosition.value = {x, y}
}

let stopAutoUpdate: (() => void) | null = null

watch(autocomplete.isOpen, async (isOpen) => {
	if (!isOpen) {
		stopAutoUpdate?.()
		stopAutoUpdate = null
		return
	}
	await nextTick()
	if (!titleInput.value || !autocompleteWrapper.value) {
		return
	}
	stopAutoUpdate = autoUpdate(titleInput.value, autocompleteWrapper.value, updateAutocompletePosition)
})

onBeforeUnmount(() => {
	stopAutoUpdate?.()
	stopAutoUpdate = null
})

function handleBeforeUnload(e: BeforeUnloadEvent) {
	if (localTitle.value.trim() !== props.modelValue) {
		e.preventDefault()
		e.returnValue = ''
	}
}

onMounted(() => {
	window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
	window.removeEventListener('beforeunload', handleBeforeUnload)
})

onClickOutside(autocompleteWrapper, () => {
	autocomplete.close()
}, {ignore: [titleInput]})

function onActivity() {
	if (titleInput.value) {
		autocomplete.setCaretOffset(titleInput.value.selectionStart ?? 0)
	}
}

// Picking a dropdown item is a pointerdown on a <button> inside the wrapper,
// which steals focus (firing blur on the textarea) before the click that
// actually runs onSelect. Blur must not literal-save in that window - it
// would race the strip-and-save onSelect is about to do. The timeout is a
// fallback for a pointerdown that doesn't land on an item (e.g. released
// outside it), so the flag can't get wedged true forever.
const selectingItem = ref(false)

function onAutocompletePointerDown() {
	selectingItem.value = true
	window.setTimeout(() => {
		selectingItem.value = false
	}, 0)
}

async function onSelect(item: TitleAutocompleteItem) {
	// Resolve the store item before stripping the token - if the project/label
	// can't be found (a store miss), abort the whole accept so the token isn't
	// silently consumed with the property lost.
	let project: IProject | undefined
	let label: ILabel | undefined

	if (item.kind === 'project') {
		project = projectStore.projects[item.id as IProject['id']]
		if (!project) {
			selectingItem.value = false
			return
		}
	} else if (item.kind === 'label') {
		label = labelStore.labels[item.id as ILabel['id']]
		if (!label) {
			selectingItem.value = false
			return
		}
	}

	const result = autocomplete.insertItem(item)
	if (result === null) {
		selectingItem.value = false
		return
	}

	localTitle.value = result.text
	autocomplete.setCaretOffset(result.caret)

	nextTick(() => {
		titleInput.value?.setSelectionRange(result.caret, result.caret)
		titleInput.value?.focus()
	})

	emit('update:modelValue', result.text)

	if (item.kind === 'project' && project) {
		await props.onAcceptProject(project, result.text)
		selectingItem.value = false
		return
	} else if (item.kind === 'priority') {
		await props.onAcceptPriority(Number(item.insertValue), result.text)
		selectingItem.value = false
		return
	} else if (item.kind === 'label' && label) {
		await props.onAcceptLabel(label)
	} else if (item.kind === 'assignee' && item.user) {
		await props.onAcceptAssignee(item.user)
	}

	await props.onSaveLiteralTitle(result.text)
	selectingItem.value = false
}

function onKeydown(e: KeyboardEvent) {
	if (autocomplete.isOpen.value && autocompleteResults.value?.onKeyDown(e)) {
		return
	}

	if (e.code === 'Enter' || e.code === 'NumpadEnter') {
		if (e.isComposing) {
			return
		}
		e.preventDefault()
		titleInput.value?.blur()
	} else if (e.code === 'Escape') {
		localTitle.value = props.modelValue
		autocomplete.close()
		titleInput.value?.blur()
	}
}

// Blur/Enter save the literal text verbatim - never parsed. The dropdown
// being open (even on an unmatched token) is not by itself a reason to skip
// the save - only a pointerdown on the dropdown itself is, because that's the
// mousedown-before-click of picking an option; onSelect() owns the save there.
async function onBlur() {
	if (selectingItem.value) {
		return
	}

	const title = localTitle.value.trim()

	if (title === '') {
		localTitle.value = props.modelValue
		error({message: t('task.detail.titleRequired')})
	} else if (title !== props.modelValue) {
		emit('update:modelValue', title)
		await props.onSaveLiteralTitle(title)
	}

	autocomplete.close()
}
</script>

<style lang="scss" scoped>
.task-title-field {
	position: relative;
}

.title.input {
	inline-size: 100%;
	font-size: 1.8rem;
	font-weight: 600;
	border: none;
	box-shadow: none;
	padding-inline: 0;
	resize: none;
	background: transparent;

	&:focus {
		box-shadow: none;
	}

	&.disabled {
		cursor: default;
	}
}

.task-title-autocomplete-wrapper {
	position: absolute;
	z-index: 20;
}
</style>
