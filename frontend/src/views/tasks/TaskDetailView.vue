<template>
	<div
		ref="taskViewContainer"
		class="loader-container task-view-container"
		:class="{
			'is-loading': taskService.loading || !visible,
			'is-modal': isModal,
		}"
	>
		<!-- Removing everything until the task is loaded to prevent empty initialization of other components -->
		<div
			v-if="visible"
			class="task-view"
		>
			<BaseButton
				v-if="!isModal"
				class="back-button mbs-2"
				@click="lastProject ? router.back() : router.push(projectRoute)"
			>
				<Icon icon="arrow-left" />
				{{ $t('task.detail.back') }}
			</BaseButton>
			<Heading
				ref="heading"
				:task="task"
				:has-close="isModal"
				@close="$emit('close')"
			/>
			<!-- The visible title is an edit textarea, not a heading element - this
			     mirrors it so the document outline / screen readers still see one
			     top-level heading for the task. -->
			<h1 class="is-sr-only">
				{{ task.title }}
			</h1>
			<TaskTitleField
				:model-value="task.title"
				:disabled="!canWrite"
				:mode="quickAddMagicMode"
				:assignee-project-id="task.projectId"
				:on-save-literal-title="saveTitleLiteral"
				:on-accept-project="changeProject"
				:on-accept-label="acceptLabel"
				:on-accept-assignee="acceptAssignee"
				:on-accept-priority="setPriority"
				@update:modelValue="task.title = $event"
			/>
			<nav
				v-if="project?.id"
				aria-label="Breadcrumb"
				class="subtitle"
			>
				<template
					v-for="p in projectStore.getAncestors(project)"
					:key="p.id"
				>
					<a
						v-if="String(router.options.history.state?.back ?? '').includes('/projects/'+p.id+'/')"
						v-shortcut="p.id === project?.id ? 'KeyU' : ''"
						@click="router.back()"
					>
						{{ getProjectTitle(p) }}
					</a>
					<RouterLink
						v-else
						v-shortcut="p.id === project?.id ? 'KeyU' : ''"
						:to="{ name: 'project.index', params: { projectId: p.id } }"
					>
						{{ getProjectTitle(p) }}
					</RouterLink>
					<span
						v-if="p.id !== project?.id"
						class="has-text-grey-light"
					> &gt; </span>
				</template>
				<BucketSelect
					:task="task"
					:can-write="canWrite"
					@update:task="Object.assign(task, $event)"
				/>
			</nav>

			<ChecklistSummary :task="task" />

			<!-- Content and buttons -->
			<TaskPropertyChips
				ref="propertyChips"
				v-model:task="task"
				v-model:task-color="taskColor"
				:can-write="canWrite"
				:task-id="taskId"
				:is-link-share-auth="authStore.isLinkShareAuth"
				:reminders-default-relative-to="remindersDefaultRelativeTo"
				:save-priority="setPriority"
				:save-percent-done="setPercentDone"
				:save-estimated-duration="setEstimatedDuration"
				:save-generic="saveTask"
				:change-project="changeProject"
				:remove-repeat-after="removeRepeatAfter"
			/>

			<!-- Field-open keyboard shortcuts - faithful map to the pre-redesign
			     detail view. Hidden buttons because v-shortcut clicks the element
			     it's bound to; chip targets live inside TaskPropertyChips, a
			     separate component, so they can't host the directive directly. -->
			<div
				class="is-hidden"
				aria-hidden="true"
			>
				<button
					v-shortcut="'KeyL'"
					type="button"
					tabindex="-1"
					@click="propertyChips?.openChip('labels')"
				/>
				<button
					v-shortcut="'KeyP'"
					type="button"
					tabindex="-1"
					@click="propertyChips?.openChip('priority')"
				/>
				<button
					v-shortcut="'KeyC'"
					type="button"
					tabindex="-1"
					@click="propertyChips?.openChip('color')"
				/>
				<button
					v-shortcut="'KeyA'"
					type="button"
					tabindex="-1"
					@click="propertyChips?.openChip('assignees')"
				/>
				<button
					v-shortcut="'KeyM'"
					type="button"
					tabindex="-1"
					@click="propertyChips?.openChip('project')"
				/>
				<button
					v-shortcut="'KeyD'"
					type="button"
					tabindex="-1"
					@click="propertyChips?.openChip('dueDate')"
				/>
				<button
					v-shortcut="reminderShortcut"
					type="button"
					tabindex="-1"
					@click="propertyChips?.openChip('reminders')"
				/>
				<button
					v-shortcut="'KeyF'"
					type="button"
					tabindex="-1"
					@click="focusAttachments"
				/>
				<button
					v-shortcut="'KeyR'"
					type="button"
					tabindex="-1"
					@click="focusRelatedTasks"
				/>
			</div>

			<div class="detail-content">
				<!-- Description -->
				<div class="details content description">
					<Description
						:model-value="task"
						:can-write="canWrite"
						:attachment-upload="attachmentUploadForDescription"
						@update:modelValue="Object.assign(task, $event)"
					/>
				</div>

				<!-- Reactions -->
				<Reactions
					v-model="task.reactions"
					entity-kind="tasks"
					:entity-id="task.id"
					class="details d-print-none"
					:disabled="!canWrite"
				/>

				<!-- Attachments -->
				<div
					ref="attachmentsSection"
					class="content attachments"
				>
					<Attachments
						:ref="e => { attachmentsRef = e as any }"
						:edit-enabled="canWrite"
						:task="task"
						@taskChanged="({coverImageAttachmentId}) => task.coverImageAttachmentId = coverImageAttachmentId"
						@update:attachments="onAttachmentsUpdated"
					/>
				</div>

				<!-- Related Tasks -->
				<div
					ref="relatedTasksSection"
					class="content details mbe-0"
				>
					<h2 class="task-section-title">
						<span class="icon is-grey">
							<Icon icon="sitemap" />
						</span>
						{{ $t('task.attributes.relatedTasks') }}
					</h2>
					<RelatedTasks
						:edit-enabled="canWrite"
						:initial-related-tasks="task.relatedTasks"
						:project-id="task.projectId"
						:show-no-relations-notice="true"
						:task-id="taskId"
					/>
				</div>

				<!-- Comments -->
				<Comments
					:can-write="canWrite"
					:task-id="taskId"
					:project-id="task.projectId"
					:initial-comments="task.comments"
				/>

				<!-- Time Tracking -->
				<div
					v-if="timeTrackingEnabled"
					class="content time-tracking"
				>
					<TaskTimeTracking :task-id="task.id" />
				</div>

				<!-- Marker element for scroll-to-bottom button visibility -->
				<div
					ref="contentBottomMarker"
					class="content-bottom-marker"
				/>

				<!-- Non-property actions -->
				<div
					v-if="canWrite || isModal"
					class="task-detail-menu d-print-none"
				>
					<template v-if="canWrite">
						<XButton
							v-shortcut="'KeyT'"
							:class="{'is-pending': !task.done}"
							class="button--mark-done"
							icon="check-double"
							variant="secondary"
							@click="toggleTaskDone()"
						>
							{{ task.done ? $t('task.detail.undone') : $t('task.detail.done') }}
						</XButton>

						<Dropdown :trigger-label="$t('task.detail.actions.moreActions')">
							<DropdownItem
								v-shortcut="'KeyS'"
								:icon="task.isFavorite ? 'star' : ['far', 'star']"
								@click="toggleFavorite"
							>
								{{
									task.isFavorite ? $t('task.detail.actions.unfavorite') : $t('task.detail.actions.favorite')
								}}
							</DropdownItem>
							<TaskSubscription
								type="dropdown"
								entity="task"
								:entity-id="task.id"
								:model-value="task.subscription"
								@update:modelValue="sub => task.subscription = sub"
							/>
							<DropdownItem
								icon="copy"
								@click="duplicateCurrentTask"
							>
								{{ $t('task.detail.actions.duplicate') }}
							</DropdownItem>
							<hr class="dropdown-divider">
							<DropdownItem
								v-shortcut="deleteShortcut"
								icon="trash-alt"
								class="has-text-danger"
								@click="showDeleteModal = true"
							>
								{{ $t('task.detail.actions.delete') }}
							</DropdownItem>
						</Dropdown>
					</template>
				</div>

				<!-- Created / Updated [by] -->
				<CreatedUpdated :task="task" />
			</div>
		</div>

		<BaseButton
			v-if="showScrollToCommentsButton"
			v-tooltip="$t('task.detail.scrollToBottom')"
			class="scroll-to-comments-button d-print-none"
			:aria-label="$t('task.detail.scrollToBottom')"
			@click="scrollToBottom"
		>
			<Icon icon="chevron-down" />
		</BaseButton>

		<Modal
			:enabled="showDeleteModal"
			@close="showDeleteModal = false"
			@submit="deleteTask()"
		>
			<template #header>
				<span>{{ $t('task.detail.delete.header') }}</span>
			</template>

			<template #text>
				<p class="tw:text-balance">
					{{ $t('task.detail.delete.text1') }}
				</p>
				<p class="tw:text-balance">
					{{ $t('task.detail.delete.text2') }}
				</p>
			</template>
		</Modal>
	</div>
</template>

<script lang="ts" setup>
import {ref, shallowReactive, computed, watch, nextTick, onMounted} from 'vue'
import {useRouter, useRoute, type RouteLocation, onBeforeRouteLeave} from 'vue-router'
import {useI18n} from 'vue-i18n'
import {unrefElement, useDebounceFn, useElementSize, useIntersectionObserver, useMutationObserver} from '@vueuse/core'
import {klona} from 'klona/lite'

import TaskService from '@/services/task'
import TaskModel from '@/models/task'

import type {ITask} from '@/modelTypes/ITask'
import type {IAttachment} from '@/modelTypes/IAttachment'
import type {IProject} from '@/modelTypes/IProject'
import type {ILabel} from '@/modelTypes/ILabel'
import type {IUser} from '@/modelTypes/IUser'
import type {IRepeatAfter} from '@/types/IRepeatAfter'

import {type Priority} from '@/constants/priorities'
import {PERMISSIONS} from '@/constants/permissions'
import {PRO_FEATURE} from '@/constants/proFeatures'

import BaseButton from '@/components/base/BaseButton.vue'

// partials
import Attachments from '@/components/tasks/partials/Attachments.vue'
import TaskTimeTracking from '@/components/time-tracking/TaskTimeTracking.vue'
import ChecklistSummary from '@/components/tasks/partials/ChecklistSummary.vue'
import Comments from '@/components/tasks/partials/Comments.vue'
import CreatedUpdated from '@/components/tasks/partials/CreatedUpdated.vue'
import Description, {type AttachmentUploadFunction} from '@/components/tasks/partials/Description.vue'
import Heading from '@/components/tasks/partials/Heading.vue'
import RelatedTasks from '@/components/tasks/partials/RelatedTasks.vue'
import TaskSubscription from '@/components/misc/Subscription.vue'
import BucketSelect from '@/components/tasks/partials/BucketSelect.vue'
import Reactions from '@/components/input/Reactions.vue'
import TaskTitleField from '@/components/tasks/partials/TaskTitleField.vue'
import TaskPropertyChips from '@/components/tasks/partials/TaskPropertyChips.vue'
import Dropdown from '@/components/misc/Dropdown.vue'
import DropdownItem from '@/components/misc/DropdownItem.vue'

import {uploadFile} from '@/helpers/attachments'
import {getProjectTitle} from '@/helpers/getProjectTitle'
import {isAppleDevice} from '@/helpers/isAppleDevice'
import {scrollIntoView} from '@/helpers/scrollIntoView'
import {TASK_REPEAT_MODES} from '@/types/IRepeatMode'
import {REMINDER_PERIOD_RELATIVE_TO_TYPES} from '@/types/IReminderPeriodRelativeTo'
import {playPopSound} from '@/helpers/playPop'

import {useTaskStore} from '@/stores/tasks'
import {useKanbanStore} from '@/stores/kanban'
import {useProjectStore} from '@/stores/projects'
import {useAuthStore} from '@/stores/auth'
import {useBaseStore} from '@/stores/base'
import {useConfigStore} from '@/stores/config'

import {useTitle} from '@/composables/useTitle'
import {useTaskDetailShortcuts} from '@/composables/useTaskDetailShortcuts'

import {success} from '@/message'
import type {Action as MessageAction} from '@/message'

interface HTTPErrorResponse {
	response?: {
		status?: number
		data?: {
			code?: number
			message?: string
		}
	}
}

const props = defineProps<{
	taskId: ITask['id'],
	backdropView?: RouteLocation['fullPath'],
}>()

defineEmits<{
	'close': [],
}>()

const router = useRouter()
const route = useRoute()
const {t} = useI18n({useScope: 'global'})

const projectStore = useProjectStore()
const taskStore = useTaskStore()
const configStore = useConfigStore()
const timeTrackingEnabled = computed(() => configStore.isProFeatureEnabled(PRO_FEATURE.TIME_TRACKING))
const kanbanStore = useKanbanStore()
const authStore = useAuthStore()
const baseStore = useBaseStore()
const quickAddMagicMode = computed(() => authStore.settings.frontendSettings.quickAddMagicMode)

const task = ref<ITask>(new TaskModel())
const remindersDefaultRelativeTo = computed(() => {
	if (task.value.dueDate) {
		return REMINDER_PERIOD_RELATIVE_TO_TYPES.DUEDATE
	}
	if (task.value.startDate) {
		return REMINDER_PERIOD_RELATIVE_TO_TYPES.STARTDATE
	}
	if (task.value.endDate) {
		return REMINDER_PERIOD_RELATIVE_TO_TYPES.ENDDATE
	}
	return null
})
const taskNotFound = ref(false)
const taskTitle = computed(() => task.value.title)
useTitle(taskTitle)

const lastProject = computed(() => {
	const backRoute = router.options.history.state?.back
	if (!backRoute || typeof backRoute !== 'string') {
		return null
	}

	const projectMatch = backRoute.match(/\/projects\/(-?\d+)/)
	if (!projectMatch || !projectMatch[1]) {
		return null
	}

	const id = parseInt(projectMatch[1])

	return projectStore.projects[id] ?? null
})

const lastProjectOrTaskProject = computed(() => lastProject.value ?? project.value)

// Match native OS conventions for "delete the selected item"
const deleteShortcut = isAppleDevice() ? 'Backspace' : 'Delete'
const reminderShortcut = computed(() => isAppleDevice() ? 'Shift+KeyR' : 'Alt+KeyR')

onBeforeRouteLeave(async () => {
	if (taskNotFound.value) {
		return
	}

	if (!lastProjectOrTaskProject.value) {
		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				stop()
				resolve()
			}, 5000) // 5 second timeout
			
			const stop = watch(lastProjectOrTaskProject, (p) => {
				if (p) {
					clearTimeout(timeout)
					stop()
					resolve()
				}
			})
		})
	}

	if (lastProjectOrTaskProject.value) {
		await baseStore.handleSetCurrentProjectIfNotSet(lastProjectOrTaskProject.value)
	}
})

// We doubled the task color property here because verte does not have a real change property, leading
// to the color property change being triggered when the # is removed from it, leading to an update,
// which leads in turn to a change... This creates an infinite loop in which the task is updated, changed,
// updated, changed, updated and so on.
// To prevent this, we put the task color property in a separate value which is set to the task color
// when it is saved and loaded.
const taskColor = ref<ITask['hexColor']>('')

// Used to avoid flashing of empty elements if the task content is not yet loaded.
const visible = ref(false)

const project = computed(() => projectStore.projects[task.value.projectId])

const projectRoute = computed(() => ({
	name: 'project.index',
	params: {projectId: task.value.projectId},
	hash: route.hash,
}))

const canWrite = computed(() => (
	task.value.maxPermission !== null &&
	task.value.maxPermission > PERMISSIONS.READ
))

const isModal = computed(() => Boolean(props.backdropView))

async function attachmentUpload(file: File, onSuccess?: (url: string) => void) {
	const uploaded = await uploadFile(props.taskId, file, onSuccess)
	if (uploaded.length > 0) {
		onAttachmentsUpdated([...task.value.attachments, ...uploaded])
	}
	return uploaded
}

// Description only cares about the onSuccess callback firing with the uploaded url; its return value is discarded.
const attachmentUploadForDescription: AttachmentUploadFunction = async (file, onSuccess) => {
	const uploaded = await attachmentUpload(file, onSuccess)
	return uploaded[0] ? String(uploaded[0].id) : ''
}

function onAttachmentsUpdated(attachments: IAttachment[]) {
	task.value.attachments = attachments
	kanbanStore.setTaskInBucket({
		...task.value,
		attachments,
	})
}

const heading = ref<HTMLElement | null>(null)

async function scrollToHeading() {
	scrollIntoView(unrefElement(heading))
}

const attachmentsRef = ref<InstanceType<typeof Attachments> | null>(null)
const attachmentsSection = ref<HTMLElement | null>(null)
const relatedTasksSection = ref<HTMLElement | null>(null)
const propertyChips = ref<InstanceType<typeof TaskPropertyChips> | null>(null)

// Attachments/Related tasks are always-visible sections now (no more
// activeFields toggle) - KeyF/KeyR just bring them into view and hand focus
// to their first control, replicating the old openAttachments/setRelatedTasksActive intent.
function focusAttachments() {
	if (!attachmentsSection.value) {
		return
	}
	scrollIntoView(attachmentsSection.value)
	attachmentsRef.value?.openFilePicker()
}

function focusRelatedTasks() {
	const el = relatedTasksSection.value
	if (!el) {
		return
	}
	scrollIntoView(el)

	// Relations already exist -> the add-relation form is collapsed behind this
	// button, same as the old setFieldActive('relatedTasks') + button-click did.
	const toggleButton = el.querySelector<HTMLElement>('#showRelatedTasksFormButton')
	if (toggleButton) {
		toggleButton.click()
		return
	}
	el.querySelector<HTMLElement>('input, textarea, button')?.focus()
}

const taskViewContainer = ref<HTMLElement | null>(null)
const scrollContainer = ref<HTMLElement | null>(null)
const contentBottomMarker = ref<HTMLElement | null>(null)
const bottomMarkerVisible = ref(true)
const isScrollable = ref(false)

function resolveScrollContainer() {
	let el = taskViewContainer.value

	while (el) {
		const overflowY = getComputedStyle(el).overflowY
		if (['auto', 'scroll', 'overlay'].includes(overflowY)) {
			scrollContainer.value = el
			return
		}
		el = el.parentElement
	}

	scrollContainer.value = (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

function updateScrollable() {
	const scroller = scrollContainer.value
	if (!scroller) {
		isScrollable.value = false
		return
	}

	isScrollable.value = scroller.scrollHeight > scroller.clientHeight + 1
}

const showScrollToCommentsButton = computed(() => {
	return isScrollable.value && !bottomMarkerVisible.value
})

function scrollToBottom() {
	if (!contentBottomMarker.value) {
		return
	}

	contentBottomMarker.value.scrollIntoView({
		behavior: 'smooth',
		block: 'end',
		inline: 'nearest',
	})
}

useIntersectionObserver(
	contentBottomMarker,
	([entry]) => {
		bottomMarkerVisible.value = entry?.isIntersecting ?? true
	},
	{threshold: 0.1},
)

const debouncedMutationHandler = useDebounceFn(async () => {
	await nextTick()
	resolveScrollContainer()
	updateScrollable()
}, 100)

useMutationObserver(
	taskViewContainer,
	debouncedMutationHandler,
	{subtree: true, childList: true},
)

const {height: scrollContainerHeight} = useElementSize(scrollContainer)
watch(scrollContainerHeight, () => updateScrollable())

onMounted(async () => {
	await nextTick()
	resolveScrollContainer()
	updateScrollable()
})

const taskService = shallowReactive(new TaskService())

// load task
watch(
	() => props.taskId,
	async (id) => {
		if (id === undefined) {
			return
		}

		try {
			const expand = ['reactions', 'comments', 'is_unread', 'buckets']
			if (timeTrackingEnabled.value) {
				// Only request the (server-computed) count when the feature is on.
				expand.push('time_entries_count')
			}
			const loaded = await taskService.get({id} as ITask, {expand})
			Object.assign(task.value, loaded)
			taskColor.value = task.value.hexColor

			if (task.value.isUnread) {
				await taskStore.markTaskAsRead(task.value.id)
				task.value.isUnread = false
			}

			if (lastProject.value) {
				await baseStore.handleSetCurrentProjectIfNotSet(lastProject.value)
			}
		} catch (caughtError) {
			const e = caughtError as HTTPErrorResponse
			// 403 means the task exists but is not visible to us; treat it like
			// a 404 so we route away instead of rendering an empty task shell.
			if (e?.response?.status === 404 || e?.response?.status === 403) {
				taskNotFound.value = true
				router.replace({name: 'not-found'})
				return
			}

			throw e
		} finally {
			await nextTick()
			scrollToHeading()
			resolveScrollContainer()
			updateScrollable()
			visible.value = true
		}
	}, {immediate: true})

async function saveTask(
	currentTask: ITask | null = null,
	undoCallback?: () => void,
) {
	if (currentTask === null) {
		currentTask = klona(task.value)
	}

	if (!canWrite.value) {
		return
	}

	currentTask.hexColor = taskColor.value

	// If no end date is being set, but a start date and due date,
	// use the due date as the end date
	if (
		currentTask.endDate === null &&
		currentTask.startDate !== null &&
		currentTask.dueDate !== null
	) {
		currentTask.endDate = currentTask.dueDate
	}

	const updatedTask = await taskStore.update(currentTask) // TODO: markraw ?
	Object.assign(task.value, updatedTask)

	let actions: MessageAction[] = []
	if (undoCallback) {
		actions = [{
			title: t('task.undo'),
			callback: undoCallback,
		}]
	}
	success({message: t('task.detail.updateSuccess')}, actions)
}

useTaskDetailShortcuts({
	task: () => task.value,
	taskTitle: () => taskTitle.value,
	onSave: saveTask,
})

const showDeleteModal = ref(false)

async function deleteTask() {
	await taskStore.delete(task.value)
	success({message: t('task.detail.deleteSuccess')})
	router.push({name: 'project.index', params: {projectId: task.value.projectId}})
}

async function toggleTaskDone() {
	const newTask = {
		...task.value,
		done: !task.value.done,
	}

	if (newTask.done) {
		playPopSound()
	}

	await saveTask(
		newTask,
		toggleTaskDone,
	)
}

// title is set when this comes from the title field's token-accept path, so
// the stripped title and the new project persist in the same PATCH instead of
// a redundant trailing literal-title save.
async function changeProject(project: IProject | null, title?: string) {
	if (project === null) {
		return
	}
	kanbanStore.removeTaskInBucket(task.value)
	await saveTask({
		...task.value,
		projectId: project.id,
		...(title === undefined ? {} : {title}),
	})
	baseStore.setCurrentProject(project)
}

async function toggleFavorite() {
	const newTask = await taskStore.toggleFavorite(task.value)
	Object.assign(task.value, newTask)
}

async function duplicateCurrentTask() {
	const duplicatedTask = await taskStore.duplicateTask(task.value.id)
	if (duplicatedTask) {
		success({message: t('task.detail.duplicateSuccess')})
		router.push({
			name: 'task.detail',
			params: {id: duplicatedTask.id},
		})
	}
}

async function setPriority(priority: number, title?: string) {
	const newTask: ITask = {
		...task.value,
		priority: priority as Priority,
		...(title === undefined ? {} : {title}),
	}

	return saveTask(newTask)
}

async function setPercentDone(percentDone: number) {
	const newTask: ITask = {
		...task.value,
		percentDone,
	}

	return saveTask(newTask)
}

async function setEstimatedDuration(estimatedDuration: number) {
	const newTask: ITask = {
		...task.value,
		estimatedDuration,
	}

	return saveTask(newTask)
}

async function removeRepeatAfter() {
	(task.value.repeatAfter as IRepeatAfter).amount = 0
	task.value.repeatMode = TASK_REPEAT_MODES.REPEAT_MODE_DEFAULT
	await saveTask()
}

// The title field's literal blur/Enter save and its post-accept strip-and-save
// both go through this.
async function saveTitleLiteral(title: string) {
	task.value.title = title
	await saveTask()
}

// Accepting a *label token in the title only ever offers already-existing
// labels (useQuickAddAutocomplete's dropdown doesn't surface unmatched names),
// so this mirrors EditLabels' addLabel - the same taskStore action, not a fork.
async function acceptLabel(label: ILabel) {
	if (task.value.labels.some(l => l.id === label.id)) {
		return
	}
	await taskStore.addLabel({label, taskId: task.value.id})
	task.value.labels.push(label)
}

async function acceptAssignee(user: IUser) {
	if (task.value.assignees.some(a => a.id === user.id)) {
		return
	}
	await taskStore.addAssignee({user, taskId: task.value.id})
	task.value.assignees.push(user)
}
</script>

<style lang="scss" scoped>
.task-view-container {
	// simulate sass lighten($primary, 30) by increasing lightness 30% to 73%
	--primary-light: hsla(var(--primary-h), var(--primary-s), 73%, var(--primary-a));
	padding-block-end: 0;

	@media screen and (min-width: $desktop) {
		padding-block-end: 1rem;
	}
}

.task-view {
	padding-block-start: 1rem;
	padding-inline: .5rem;
	background-color: var(--site-background);

	@media screen and (min-width: $desktop) {
		padding: 1rem;
	}
}

.is-modal .task-view {
	border-radius: $radius;
	padding: 1rem;
	color: var(--text);
	background-color: var(--site-background) !important;

	@media screen and (width <= calc(#{$desktop} + 1px)) {
		border-radius: 0;
	}
}

.task-view * {
	transition: opacity 50ms ease;
}

.is-loading .task-view * {
	opacity: 0;
}


.subtitle {
	color: var(--grey-500);
	margin-block-end: 1rem;

	a {
		color: var(--grey-800);
	}
}

h2 .button {
	vertical-align: middle;
}

.icon.is-grey {
	color: var(--grey-400);
}

.details {
	padding-block-end: 0.75rem;
	flex-flow: row wrap;
	margin-block-end: 0;

	.detail-title {
		display: block;
		color: var(--grey-400);
	}

	.none {
		font-style: italic;
	}

	// Break after the 2nd element
	.column:nth-child(2n) {
		page-break-after: always; // CSS 2.1 syntax
		break-after: always; // New syntax
	}

}

.details.labels-list,
.assignees {
	:deep(.multiselect) {
		.input-wrapper {
			&:not(:focus-within, :hover) {
				background: transparent;
				border-color: transparent;
			}
		}
	}
}

:deep(.details),
:deep(.heading) {
	.input:not(.has-defaults),
	.textarea,
	.select:not(.has-defaults) select {
		cursor: pointer;
		transition: all $transition-duration;

		&::placeholder {
			color: var(--text-light);
			opacity: 1;
			font-style: italic;
		}

		&:not(:disabled) {
			&:hover,
			&:active,
			&:focus {
				background: var(--scheme-main);
				border-color: var(--border);
				cursor: text;
			}

			&:hover,
			&:active {
				cursor: text;
				border-color: var(--link)
			}
		}
	}

	.select:not(.has-defaults):after {
		opacity: 0;
	}

	.select:not(.has-defaults):hover:after {
		opacity: 1;
	}
}

.attachments {
	margin-block-end: 0;

	table tr:last-child td {
		border-inline-end: none;
	}
}

.task-detail-menu {
	display: flex;
	align-items: center;
	gap: .5rem;
	margin-block: 1rem;

	.button--mark-done {
		background-color: transparent;
		box-shadow: none;

		// bright brand green with fixed dark text passes contrast in both themes
		&.is-pending {
			background-color: var(--success);
			color: hsl(215, 27.9%, 16.9%);

			&:hover,
			&:focus {
				filter: brightness(1.05);
			}
		}
	}
}

.dropdown-divider {
	background-color: var(--border-light);
	border: none;
	display: block;
	block-size: 1px;
	margin: .5rem 0;
}

.checklist-summary {
	padding-inline-start: .25rem;
}

.detail-content {
	@media print {
		inline-size: 100% !important;
	}
}

.scroll-to-comments-button {
	position: fixed;
	// Position above the keyboard shortcuts button (which is at bottom: calc(1rem - 4px))
	inset-block-end: 2.5rem;
	inset-inline-end: .75rem;
	z-index: 10;
	inline-size: 2rem;
	block-size: 2rem;
	border-radius: 100%;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	background-color: var(--site-background);
	border: 1px solid var(--grey-300);
	color: var(--grey-500);
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	transition: all $transition;

	&:hover {
		background-color: var(--grey-100);
		color: var(--grey-700);
	}

	@media screen and (max-width: $tablet) {
		// Hide on mobile since keyboard shortcuts button is also hidden
		display: none;
	}
}
</style>

<style lang="scss">
// global style to override position when the modal task detail is active
.modal-content .scroll-to-comments-button {
	inset-block-end: .75rem;
	inset-inline-end: 1rem;
}
</style>
