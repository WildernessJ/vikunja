<template>
	<div
		ref="taskAdd"
		class="task-add quick-add-composer"
	>
		<div class="qac-card">
			<div class="add-task__field field">
				<div class="control task-input-wrapper">
					<label
						class="is-sr-only"
						:for="textareaId"
					>
						{{ $t('project.list.addPlaceholder') }}
					</label>
					<span class="icon is-small task-icon">
						<Icon icon="tasks" />
					</span>
					<textarea
						:id="textareaId"
						ref="newTaskInput"
						v-model="newTaskTitle"
						v-focus
						class="add-task-textarea input"
						:class="{'textarea-empty': newTaskTitle === ''}"
						:placeholder="$t('project.list.addPlaceholder')"
						rows="1"
						role="combobox"
						aria-autocomplete="list"
						:aria-expanded="autocomplete.isOpen.value"
						:aria-controls="autocompleteListboxId"
						:aria-activedescendant="autocomplete.isOpen.value ? autocompleteResults?.activeOptionId : undefined"
						@input="onTextareaActivity"
						@click="onTextareaActivity"
						@keyup="onTextareaActivity"
						@keydown="onTextareaKeydown"
					/>
					<QuickAddMagic
						:highlight-hint-icon="taskAddHovered"
					/>
					<div
						v-if="autocomplete.isOpen.value"
						ref="autocompleteWrapper"
						class="qac-autocomplete-wrapper"
						:style="{left: `${autocompletePosition.x}px`, top: `${autocompletePosition.y}px`}"
					>
						<QuickAddAutocompleteResults
							ref="autocompleteResults"
							:items="autocomplete.items.value"
							:listbox-id="autocompleteListboxId"
							@select="onAutocompleteSelect"
							@close="autocomplete.close()"
						/>
					</div>
				</div>
			</div>

			<p
				v-if="isMultiline"
				class="qac-multiline-hint help"
			>
				{{ $t('task.quickAdd.multilineHint') }}
			</p>
			<textarea
				v-else
				v-model="overrides.description"
				class="qac-description input"
				:placeholder="$t('task.quickAdd.descriptionPlaceholder')"
				rows="1"
			/>

			<div
				v-if="!isMultiline"
				class="qac-chip-row"
			>
				<PropertyChip
					icon="layer-group"
					:label="projectChipLabel"
					:is-set="overrides.project !== undefined"
					:show-clear="overrides.project !== undefined"
					@clear="clearOverride('project')"
				>
					<template #default="{close}">
						<ProjectSearch
							:model-value="overrides.project ?? undefined"
							@update:modelValue="(project) => onProjectPicked(project, close)"
						/>
					</template>
				</PropertyChip>

				<div class="qac-chip">
					<Datepicker
						:model-value="effectiveDate"
						:choose-date-label="$t('task.quickAdd.dateChip')"
						@update:modelValue="(val) => setOverride('dueDate', val)"
					/>
					<QacChipClear
						:show="overrides.dueDate !== undefined"
						@clear="clearOverride('dueDate')"
					/>
					<span
						v-if="repeatsLabel !== null"
						class="qac-repeats-hint"
					>
						{{ repeatsLabel }}
					</span>
				</div>

				<PropertyChip
					icon="tags"
					:label="labelsChipLabel"
					:is-set="overrides.labels !== undefined"
					:show-clear="overrides.labels !== undefined"
					@clear="clearOverride('labels')"
				>
					<EditLabels
						:model-value="effectiveLabels"
						:task-id="0"
						@update:modelValue="(val) => setOverride('labels', val)"
					/>
				</PropertyChip>

				<PropertyChip
					:is-set="overrides.priority !== undefined"
					:show-clear="overrides.priority !== undefined"
					@clear="clearOverride('priority')"
				>
					<template #trigger>
						<PriorityLabel
							:priority="effectivePriority ?? PRIORITIES.UNSET"
							:show-all="true"
						/>
					</template>
					<PrioritySelect
						:model-value="effectivePriority ?? PRIORITIES.UNSET"
						@update:modelValue="(val) => setOverride('priority', val)"
					/>
				</PropertyChip>

				<PropertyChip
					:icon="['far', 'clock']"
					:label="remindersChipLabel"
					:is-set="overrides.reminders !== undefined"
					:show-clear="overrides.reminders !== undefined"
					has-overflow
					@clear="clearOverride('reminders')"
				>
					<Reminders
						:model-value="effectiveReminders"
						:default-relative-to="remindersDefaultRelativeTo"
						@update:modelValue="(val) => setOverride('reminders', val)"
					/>
				</PropertyChip>

				<div class="qac-actions">
					<BaseButton
						class="qac-clear-button"
						:aria-label="$t('task.quickAdd.clear')"
						@click="clearComposer"
					>
						<Icon icon="xmark" />
					</BaseButton>
					<XButton
						class="qac-submit-button add-task-button"
						:disabled="newTaskTitle === '' || loading || undefined"
						icon="arrow-up"
						:loading="loading"
						:aria-label="$t('project.list.add')"
						@click="addTask()"
					>
						<span class="button-text">
							{{ $t('project.list.add') }}
						</span>
					</XButton>
				</div>
			</div>

			<div
				v-else
				class="qac-actions qac-actions-multiline"
			>
				<BaseButton
					class="qac-clear-button"
					:aria-label="$t('task.quickAdd.clear')"
					@click="clearComposer"
				>
					<Icon icon="xmark" />
				</BaseButton>
				<XButton
					class="add-task-button"
					:disabled="newTaskTitle === '' || loading || undefined"
					icon="plus"
					:loading="loading"
					:aria-label="$t('project.list.add')"
					@click="addTask()"
				>
					<span class="button-text">
						{{ $t('project.list.add') }}
					</span>
				</XButton>
			</div>
		</div>

		<Expandable :open="errorMessage !== ''">
			<p
				v-if="errorMessage !== ''"
				class="pbs-3 mbs-0 help is-danger"
			>
				{{ errorMessage }}
			</p>
		</Expandable>
	</div>
</template>

<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, watch} from 'vue'
import {useI18n} from 'vue-i18n'
import {onClickOutside, useElementHover} from '@vueuse/core'
import {useRouter} from 'vue-router'
import {autoUpdate, computePosition, flip, offset, shift} from '@floating-ui/dom'

import {RELATION_KIND} from '@/types/IRelationKind'
import type {ITask} from '@/modelTypes/ITask'
import type {IProject} from '@/modelTypes/IProject'
import type {ILabel} from '@/modelTypes/ILabel'

import Expandable from '@/components/base/Expandable.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import Datepicker from '@/components/input/Datepicker.vue'
import QuickAddMagic from '@/components/tasks/partials/QuickAddMagic.vue'
import ProjectSearch from '@/components/tasks/partials/ProjectSearch.vue'
import EditLabels from '@/components/tasks/partials/EditLabels.vue'
import PrioritySelect from '@/components/tasks/partials/PrioritySelect.vue'
import PriorityLabel from '@/components/tasks/partials/PriorityLabel.vue'
import Reminders from '@/components/tasks/partials/Reminders.vue'
import QacChipClear from '@/components/tasks/partials/QacChipClear.vue'
import PropertyChip from '@/components/tasks/partials/PropertyChip.vue'
import QuickAddAutocompleteResults from '@/components/tasks/partials/QuickAddAutocompleteResults.vue'
import {parseSubtasksViaIndention} from '@/helpers/parseSubtasksViaIndention'
import {getProjectTitle} from '@/helpers/getProjectTitle'
import TaskRelationService from '@/services/taskRelation'
import TaskRelationModel from '@/models/taskRelation'
import {getLabelsFromPrefix} from '@/modules/quickAddMagic'
import {PRIORITIES} from '@/constants/priorities'
import {buildQuickAddRepeatsLabel} from '@/helpers/recurrencePatternSummary'
import {REMINDER_PERIOD_RELATIVE_TO_TYPES} from '@/types/IReminderPeriodRelativeTo'

import {useAuthStore} from '@/stores/auth'
import {useTaskStore} from '@/stores/tasks'
import {useProjectStore} from '@/stores/projects'

import {useAutoHeightTextarea} from '@/composables/useAutoHeightTextarea'
import {useQuickAddComposer} from '@/composables/useQuickAddComposer'
import {useQuickAddAutocomplete, type TitleAutocompleteItem} from '@/composables/useQuickAddAutocomplete'
import TaskService from '@/services/task'
import TaskModel from '@/models/task'

const props = withDefaults(defineProps<{
	defaultPosition?: number,
}>(), {
	defaultPosition: undefined,
})

const emit = defineEmits(['taskAdded'])

const textareaId = computed(() => `task-add-textarea-${Math.random().toString(36).substr(2, 9)}`)

const newTaskTitle = ref('')
const {textarea: newTaskInput} = useAutoHeightTextarea(newTaskTitle)

const {t} = useI18n({useScope: 'global'})
const authStore = useAuthStore()
const taskStore = useTaskStore()
const projectStore = useProjectStore()
const router = useRouter()

const quickAddMagicMode = computed(() => authStore.settings.frontendSettings.quickAddMagicMode)

const {
	overrides,
	isMultiline,
	effectiveDate,
	effectivePriority,
	effectiveLabels,
	effectiveProjectName,
	effectiveRepeats,
	effectiveReminders,
	setOverride,
	clearOverride,
	clearAll: clearComposerOverrides,
	toStoreOverrides,
} = useQuickAddComposer(newTaskTitle, quickAddMagicMode)

// enable only if we don't have a modal
// onStartTyping(() => {
// 	if (newTaskInput.value === null || document.activeElement === newTaskInput.value) {
// 		return
// 	}
// 	newTaskInput.value.focus()
// })

const taskAdd = ref<HTMLElement | null>(null)
const taskAddHovered = useElementHover(taskAdd)

const errorMessage = ref('')

// Synchronous double-submit guard. The store loading flag only flips true after a
// 100ms debounce (setModuleLoading), so a fast double-Enter within that window would
// otherwise create two tasks. This ref is set immediately and cleared when the op settles.
const isSubmitting = ref(false)

function resetEmptyTitleError() {
	if (!newTaskTitle.value) {
		errorMessage.value = ''
	}
}

const loading = computed(() => taskStore.isLoading)

const currentProjectId = computed(() => {
	if (typeof router.currentRoute.value.params.projectId !== 'undefined') {
		return Number(router.currentRoute.value.params.projectId)
	}
	return authStore.settings.defaultProjectId
})

// Mirrors createNewTask's project-id resolution so assignee suggestions are scoped
// to the same project the task will land in: chip override, else a typed +project
// resolved by name (findProjectId tries the parsed name before the route default),
// else route/default. An explicit chip clear (`null`) falls through like no override.
const assigneeProjectId = computed<number | null>(() => {
	if (overrides.project !== undefined && overrides.project !== null) {
		return overrides.project.id
	}
	if (effectiveProjectName.value !== null) {
		const matched = projectStore.findProjectByExactname(effectiveProjectName.value)
		if (matched !== null) {
			return matched.id
		}
	}
	return currentProjectId.value || null
})

const autocomplete = useQuickAddAutocomplete({
	title: newTaskTitle,
	mode: quickAddMagicMode,
	isMultiline,
	assigneeProjectId,
})

const autocompleteWrapper = ref<HTMLElement | null>(null)
const autocompleteResults = ref<InstanceType<typeof QuickAddAutocompleteResults> | null>(null)
const autocompletePosition = ref({x: 0, y: 0})
const autocompleteListboxId = computed(() => `${textareaId.value}-listbox`)

async function updateAutocompletePosition() {
	if (!newTaskInput.value || !autocompleteWrapper.value) {
		return
	}
	const {x, y} = await computePosition(newTaskInput.value, autocompleteWrapper.value, {
		placement: 'bottom-start',
		strategy: 'absolute',
		middleware: [offset(4), flip(), shift({padding: 8})],
	})
	autocompletePosition.value = {x, y}
}

// autoUpdate (not a one-shot computePosition) so the dropdown stays put as the
// textarea auto-grows or the result list's own height changes while it's open.
let stopAutoUpdate: (() => void) | null = null

watch(autocomplete.isOpen, async (isOpen) => {
	if (!isOpen) {
		stopAutoUpdate?.()
		stopAutoUpdate = null
		return
	}
	await nextTick()
	if (!newTaskInput.value || !autocompleteWrapper.value) {
		return
	}
	stopAutoUpdate = autoUpdate(newTaskInput.value, autocompleteWrapper.value, updateAutocompletePosition)
})

onBeforeUnmount(() => {
	stopAutoUpdate?.()
	stopAutoUpdate = null
})

onClickOutside(autocompleteWrapper, () => {
	autocomplete.close()
}, {ignore: [newTaskInput]})

function onTextareaActivity() {
	if (newTaskInput.value) {
		autocomplete.setCaretOffset(newTaskInput.value.selectionStart ?? 0)
	}
}

function onAutocompleteSelect(item: TitleAutocompleteItem) {
	// The composer's own dropdown only ever offers project/label/assignee kinds
	// (useQuickAddAutocomplete never surfaces 'priority') - this guard just
	// satisfies the shared component's now-wider item type.
	if (item.kind === 'priority') {
		return
	}

	const result = autocomplete.insertItem(item)
	if (result === null) {
		return
	}

	newTaskTitle.value = result.text
	autocomplete.setCaretOffset(result.caret)

	nextTick(() => {
		newTaskInput.value?.setSelectionRange(result.caret, result.caret)
		newTaskInput.value?.focus()
	})
}

const projectChipLabel = computed(() => {
	if (overrides.project !== undefined) {
		return overrides.project === null ? t('task.quickAdd.projectChip') : getProjectTitle(overrides.project)
	}
	if (effectiveProjectName.value !== null) {
		return effectiveProjectName.value
	}
	const defaultProject = currentProjectId.value ? projectStore.projects[currentProjectId.value] : undefined
	return defaultProject ? getProjectTitle(defaultProject) : t('task.quickAdd.projectChip')
})

const labelsChipLabel = computed(() => {
	if (effectiveLabels.value.length === 0) {
		return t('task.quickAdd.labelsChip')
	}
	return effectiveLabels.value.map(l => l.title).join(', ')
})

const repeatsLabel = computed(() => buildQuickAddRepeatsLabel(effectiveRepeats.value, t))

const remindersChipLabel = computed(() => {
	if (effectiveReminders.value.length === 0) {
		return t('task.quickAdd.remindersChip')
	}
	return t('task.quickAdd.remindersChipCount', effectiveReminders.value.length)
})

// Quick-add reminders only ever relate to the due date - there's no start/end date chip here.
const remindersDefaultRelativeTo = computed(() => (
	effectiveDate.value ? REMINDER_PERIOD_RELATIVE_TO_TYPES.DUEDATE : null
))

function onProjectPicked(project: IProject | null, close: () => void) {
	setOverride('project', project)
	close()
}

function clearComposer() {
	newTaskTitle.value = ''
	clearComposerOverrides()
}

async function addTask() {
	if (newTaskTitle.value === '') {
		errorMessage.value = t('project.create.addTitleRequired')
		return
	}
	errorMessage.value = ''

	if (isSubmitting.value) {
		return
	}
	isSubmitting.value = true

	try {
		const taskTitleBackup = newTaskTitle.value
		// This allows us to find the tasks with the title they had before being parsed
		// by quick add magic.
		const createdTasks: { [key: ITask['title']]: ITask } = {}
		const tasksToCreate = parseSubtasksViaIndention(newTaskTitle.value, quickAddMagicMode.value)

		// The composer's chip overrides only apply to a single-task submission - a
		// multiline submission falls back to the plain multi-create/subtask path.
		const composerOverrides = tasksToCreate.length === 1 ? toStoreOverrides() : undefined

		// We ensure all labels exist prior to passing them down to the create task method
		// In the store it will only ever see one task at a time so there's no way to reliably
		// check if a new label was created before (because everything happens async). The store
		// itself surfaces any creation failures (e.g. link shares may not create labels).
		const allLabels = tasksToCreate.map(({title}) => getLabelsFromPrefix(title, quickAddMagicMode.value) ?? [])
		const requestedLabels = [...new Set(allLabels.flat())]
		const resolvedLabels = await taskStore.ensureLabelsExist(requestedLabels)
		const resolvedLabelsByTitle = new Map(resolvedLabels.map(l => [l.title.toLowerCase(), l]))

		// Every task (single or multi) gets its labels pre-resolved and passed down as an
		// override, so createNewTask never re-resolves by title and re-toasts a label that
		// already failed in the batch resolve above.
		const labelsOverrideFor = (title: string): ILabel[] | undefined => {
			if (composerOverrides?.labels !== undefined) {
				return composerOverrides.labels
			}
			const parsedLabels = getLabelsFromPrefix(title, quickAddMagicMode.value) ?? []
			if (parsedLabels.length === 0) {
				return undefined
			}
			return parsedLabels
				.map(labelTitle => resolvedLabelsByTitle.get(labelTitle.toLowerCase()))
				.filter((l): l is ILabel => l !== undefined)
		}

		const overridesFor = (title: string) => {
			const labels = labelsOverrideFor(title)
			if (composerOverrides === undefined && labels === undefined) {
				return undefined
			}
			// An empty `labels` array must stay present (not omitted): resolveOverride treats a
			// present-but-empty override as real, which is what stops createNewTask re-resolving
			// a failed label by title and re-toasting it.
			return {
				...composerOverrides,
				...(labels !== undefined ? {labels} : {}),
			}
		}

		const taskCollectionService = new TaskService()
		const projectIndices = new Map<number, number>()

		const currentProjectIdValue = currentProjectId.value

		// Create a map of project indices before creating tasks
		if (tasksToCreate.length > 1) {
			for (const {project} of tasksToCreate) {
				const projectId = (project !== null
					? await taskStore.findProjectId({project, projectId: 0})
					: currentProjectIdValue) ?? 0

				if (!projectIndices.has(projectId)) {
					const newestTask = await taskCollectionService.getAll(new TaskModel({}), {
						sort_by: ['id'],
						order_by: ['desc'],
						per_page: 1,
						filter: `project_id = ${projectId}`,
					})
					projectIndices.set(projectId, newestTask[0]?.index || 0)
				}
			}
		}

		const newTasks = tasksToCreate.map(async ({title, project}, index) => {
			if (title === '') {
				return
			}

			// If the task has a project specified, make sure to use it
			const projectId = (project !== null
				? await taskStore.findProjectId({project, projectId: 0})
				: currentProjectIdValue) ?? 0

			// Calculate new index for this task per project
			let taskIndex: number | undefined
			if (tasksToCreate.length > 1) {
				const lastIndex = projectIndices.get(projectId) ?? 0
				taskIndex = lastIndex + index + 1
			}

			const task = await taskStore.createNewTask({
				title,
				projectId: projectId || authStore.settings.defaultProjectId,
				position: props.defaultPosition,
				index: taskIndex,
			}, overridesFor(title))
			createdTasks[title] = task
			return task
		})

		try {
			newTaskTitle.value = ''
			await Promise.all(newTasks)

			const taskRelationService = new TaskRelationService()
			const allParentTasks = tasksToCreate.filter(t => t.parent !== null).map(t => t.parent)
			const relations = tasksToCreate.map(async t => {
				const createdTask = createdTasks[t.title]
				if (typeof createdTask === 'undefined') {
					return
				}

				const isParent = allParentTasks.includes(t.title)
				if (t.parent === null && !isParent) {
					return
				}

				const createdParentTask = t.parent !== null ? createdTasks[t.parent] : undefined
				if (typeof createdTask === 'undefined' || typeof createdParentTask === 'undefined') {
					return
				}

				const rel = await taskRelationService.create(new TaskRelationModel({
					taskId: createdTask.id,
					otherTaskId: createdParentTask.id,
					relationKind: RELATION_KIND.PARENTTASK,
				}))

				if (typeof createdTask.relatedTasks === 'undefined') {
					createdTask.relatedTasks = {}
				}
				if (typeof createdTask.relatedTasks[RELATION_KIND.PARENTTASK] === 'undefined') {
					createdTask.relatedTasks[RELATION_KIND.PARENTTASK] = []
				}
				createdTask.relatedTasks[RELATION_KIND.PARENTTASK].push({
					...createdParentTask,
					relatedTasks: {}, // To avoid endless references
				})

				if (typeof createdParentTask.relatedTasks === 'undefined') {
					createdParentTask.relatedTasks = {}
				}
				if (typeof createdParentTask.relatedTasks[RELATION_KIND.SUBTASK] === 'undefined') {
					createdParentTask.relatedTasks[RELATION_KIND.SUBTASK] = []
				}
				createdParentTask.relatedTasks[RELATION_KIND.SUBTASK].push({
					...createdTask,
					relatedTasks: {}, // To avoid endless references
				})

				return rel
			})
			await Promise.all(relations)

			// We're emitting all tasks at once at the end to avoid the same task showing up multiple times
			Object.values(createdTasks).forEach(task => {
				emit('taskAdded', task)
			})

			if (composerOverrides !== undefined) {
				clearComposerOverrides()
			}
		} catch (e) {
			newTaskTitle.value = taskTitleBackup
			const err = e as { message?: string }
			if (err.message === 'NO_PROJECT') {
				errorMessage.value = t('project.create.addProjectRequired')
				return
			}
			throw e
		}
	} finally {
		isSubmitting.value = false
	}
}

function handleEnter(e: KeyboardEvent) {
	// when pressing shift + enter we want to continue as we normally would. Otherwise, we want to create
	// the new task(s). The vue event modifier don't allow this, hence this method.
	if (e.shiftKey) {
		return
	}

	if (e.isComposing) {
		return
	}

	e.preventDefault()
	addTask()
}

function onTextareaKeydown(e: KeyboardEvent) {
	resetEmptyTitleError()

	// The dropdown gets first refusal on every keydown: if it consumes the event
	// (arrows/Enter/Tab/Esc while open) we must not fall through to submit-on-enter
	// or blur-on-esc below - autocompleteResults.onKeyDown() already called
	// preventDefault(), so Enter neither submits the task nor inserts a newline.
	if (autocomplete.isOpen.value && autocompleteResults.value?.onKeyDown(e)) {
		return
	}

	// `e.code` (not `e.key`) so this keeps matching keydown.enter/.esc events
	// synthesized by @vue/test-utils' trigger(), which only sets a real `code`.
	// NumpadEnter is included so the numeric keypad still submits.
	if (e.code === 'Enter' || e.code === 'NumpadEnter') {
		handleEnter(e)
	} else if (e.code === 'Escape') {
		blurTaskInput()
	}
}

function focusTaskInput() {
	newTaskInput.value?.focus()
}

function blurTaskInput() {
	newTaskInput.value?.blur()
}

defineExpose({
	focusTaskInput,
})
</script>

<style lang="scss" scoped>
.task-add,
	// overwrite bulma styles
.task-add .add-task__field {
	margin-block-end: 0;
}

.qac-card {
	border: 1px solid var(--grey-200);
	border-radius: $radius;
	padding: .5rem;
}

.task-add .add-task__field {
	display: flex;
	justify-content: flex-start;
	gap: .75rem;

	.control {
		flex-shrink: 0;
		flex-grow: 1;
		margin-block-end: 0;
	}
}

.task-input-wrapper {
	position: relative;
	flex-shrink: 1;
	flex-grow: 1;

	textarea {
		padding-inline: 2.5rem;
	}

	.icon {
		color: var(--grey-300);
	}

	.task-icon,
	:deep(.quick-add-magic-trigger-btn) {
		position: absolute;
		inset-block-start: .75rem;
	}

	:deep(.quick-add-magic-trigger-btn) {
		inset-inline-end: .75rem;
	}

	.task-icon {
		inset-inline-start: 1rem;
	}
}

.qac-autocomplete-wrapper {
	position: absolute;
	z-index: 20;
}

.qac-description {
	margin-block-start: .5rem;
	resize: none;
	border: none;
	box-shadow: none;
	padding-inline: 1rem;

	&:focus {
		box-shadow: none;
	}
}

.qac-multiline-hint {
	margin-block-start: .5rem;
	padding-inline: 1rem;
}

.qac-chip-row {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: .5rem;
	margin-block-start: .5rem;
	padding-inline: .5rem;
}

.qac-chip {
	position: relative;
	display: flex;
	align-items: center;
}

.qac-chip-clear {
	color: var(--grey-400);
	margin-inline-start: -.25rem;
}

.qac-repeats-hint {
	font-size: .8rem;
	color: var(--grey-400);
	margin-inline-start: .25rem;
}

.qac-actions {
	display: flex;
	align-items: center;
	gap: .5rem;
	margin-inline-start: auto;
}

.qac-actions-multiline {
	margin-block-start: .5rem;
	padding-inline: .5rem;
	justify-content: flex-end;
}

.qac-clear-button {
	color: var(--grey-400);
}

.add-task-button {
	block-size: 100% !important;

	@media screen and (max-width: $tablet) {
		.button-text {
			display: none;
		}

		:deep(.icon) {
			margin: 0 !important;
		}
	}
}

.add-task-textarea {
	transition: border-color $transition;
	resize: none;
}

// Adding this class when the textarea has no text prevents the textarea from wrapping the placeholder.
.textarea-empty {
	white-space: nowrap;
	text-overflow: ellipsis;
}

.control .icon {
	transition: all $transition;
	z-index: 4;
}
</style>

<style>
button.show-helper-text {
	inset-inline-end: 0;
}
</style>
