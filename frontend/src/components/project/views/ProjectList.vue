<template>
	<ProjectWrapper
		class="project-list"
		:is-loading-project="isLoadingProject"
		:project-id="projectId"
		:view-id
	>
		<template #header>
			<div class="filter-container">
				<SortPopup
					v-model="sortByParam"
					:can-save-default="canSaveDefaultSort"
					@saveDefault="saveDefaultSort"
				/>
				<FilterPopup
					v-if="!isSavedFilter(project)"
					v-model="params"
					:view-id="viewId"
					:project-id="projectId"
					@update:modelValue="loadTasks()"
				/>
				<SubprojectRollupPopup
					v-if="!isPseudoProject && descendantProjects.length > 0"
					v-model="rollupState"
					:projects="descendantProjects"
				/>
			</div>
		</template>

		<template #default>
			<div
				:class="{ 'is-loading': loading }"
				class="loader-container is-max-width-desktop list-view"
			>
				<Card
					:padding="false"
					:has-content="false"
					class="has-overflow"
				>
					<AddTask
						v-if="!project?.isArchived && canWrite"
						ref="addTaskRef"
						class="list-view__add-task d-print-none"
						:default-position="firstNewPosition"
						@taskAdded="updateTaskList"
					/>

					<Nothing v-if="ctaVisible && tasks.length === 0 && !loading">
						{{ $t('project.list.empty') }}
						<ButtonLink
							v-if="(project?.id ?? 0) > 0 && canWrite"
							@click="focusNewTaskInput()"
						>
							{{ $t('project.list.newTaskCta') }}
						</ButtonLink>
					</Nothing>

					<TaskDraggable
						v-if="tasks && tasks.length > 0"
						v-model="tasks"
						:group="{name: 'tasks', put: false}"
						:disabled="!canDragTasks || !isPositionSorting"
						item-key="id"
						tag="ul"
						:component-data="{
							class: {
								tasks: true,
								'dragging-disabled': !canDragTasks || !isPositionSorting
							},
							type: 'transition-group'
						}"
						:animation="100"
						:handle="dragHandle"
						:delay-on-touch-only="!isTouchDevice"
						:delay="isTouchDevice ? 0 : 1000"
						ghost-class="task-ghost"
						@start="handleDragStart"
						@end="saveTaskPosition"
					>
						<template #item="itemSlotProps">
							<SingleTaskInProject
								:ref="(el) => setTaskRef(el as InstanceType<typeof SingleTaskInProject> | null, getItemSlotProps(itemSlotProps).index)"
								:show-list-color="false"
								:can-mark-as-done="canWrite || isPseudoProject"
								:the-task="getItemSlotProps(itemSlotProps).element"
								:show-project="!isPseudoProject && isTaskFromSubproject(getItemSlotProps(itemSlotProps).element, projectId)"
								:all-tasks="allTasks"
								@taskUpdated="updateTasks"
								@taskDeleted="onTaskDeleted"
							>
								<span
									v-if="canDragTasks && isPositionSorting"
									class="icon handle"
								>
									<Icon icon="grip-lines" />
								</span>
							</SingleTaskInProject>
						</template>
					</TaskDraggable>

					<Pagination
						:total-pages="totalPages"
						:current-page="currentPage"
					/>
				</Card>
			</div>
		</template>
	</ProjectWrapper>
</template>


<script setup lang="ts">
import {ref, computed, nextTick, onMounted, onBeforeUnmount, watch, toRef} from 'vue'
import {useI18n} from 'vue-i18n'
import draggable from 'zhyswan-vuedraggable'

import ProjectWrapper from '@/components/project/ProjectWrapper.vue'
import ButtonLink from '@/components/misc/ButtonLink.vue'
import AddTask from '@/components/tasks/AddTask.vue'
import SingleTaskInProject from '@/components/tasks/partials/SingleTaskInProject.vue'
import FilterPopup from '@/components/project/partials/FilterPopup.vue'
import SubprojectRollupPopup from '@/components/project/partials/SubprojectRollupPopup.vue'
import Nothing from '@/components/misc/Nothing.vue'
import Pagination from '@/components/misc/Pagination.vue'
import SortPopup from '@/components/project/partials/SortPopup.vue'

import {useTaskList, defaultSortToSortBy, sortByToDefaultArrays, type SortBy} from '@/composables/useTaskList'
import type {ExpandTaskFilterParam} from '@/services/taskCollection'
import ProjectViewService from '@/services/projectViews'
import ProjectViewModel from '@/models/projectView'
import {success, error} from '@/message'
import {useTaskDragToProject} from '@/composables/useTaskDragToProject'
import {shouldShowTaskInListView, isTaskFromSubproject} from '@/composables/useTaskListFiltering'
import {getSubprojectRollupState, saveSubprojectRollupState, type SubprojectRollupState} from '@/helpers/subprojectRollupState'
import {PERMISSIONS as Permissions} from '@/constants/permissions'
import {calculateItemPosition} from '@/helpers/calculateItemPosition'
import type {ITask} from '@/modelTypes/ITask'
import {isSavedFilter, useSavedFilter, getSavedFilterIdFromProjectId} from '@/services/savedFilter'

import {useAuthStore} from '@/stores/auth'
import {useBaseStore} from '@/stores/base'
import {useProjectStore} from '@/stores/projects'
import {useTaskStore} from '@/stores/tasks'

import type {IProject} from '@/modelTypes/IProject'
import type {IProjectView} from '@/modelTypes/IProjectView'
import TaskPositionService from '@/services/taskPosition'
import TaskPositionModel from '@/models/taskPosition'

const props = defineProps<{
        isLoadingProject: boolean,
        projectId: IProject['id'],
        viewId: IProjectView['id'],
}>()

const projectId = toRef(props, 'projectId')

defineOptions({name: 'List'})

const ctaVisible = ref(false)

const drag = ref(false)

const {t} = useI18n({useScope: 'global'})
const authStore = useAuthStore()
const projectStore = useProjectStore()

const currentView = computed(() =>
	projectStore.projects[projectId.value]?.views.find(v => v.id === props.viewId),
)

const {
	tasks: allTasks,
	loading,
	totalPages,
	currentPage,
	loadTasks,
	params,
	sortByParam,
} = useTaskList(
	() => projectId.value,
	() => props.viewId,
	() => defaultSortToSortBy(currentView.value?.defaultSortBy ?? [], currentView.value?.defaultOrderBy ?? []) ?? {position: 'asc'},
	() => (projectId.value === -1
		? ['comment_count', 'is_unread']
		: ['subtasks', 'comment_count', 'is_unread']) as unknown as ExpandTaskFilterParam,
)
const currentUserId = computed(() => authStore.info?.id ?? 0)

function collectDescendants(id: IProject['id'], visited: Set<IProject['id']> = new Set()): IProject[] {
	// Guards against corrupt/imported parent_project_id cycles (see the backend's
	// maxDescendantDepth in pkg/models/task_collection.go for the same concern).
	if (visited.has(id)) {
		return []
	}
	visited.add(id)

	const children = projectStore.getChildProjects(id).filter(p => !p.isArchived)
	return children.flatMap(child => [child, ...collectDescendants(child.id, visited)])
}

const descendantProjects = computed(() => collectDescendants(projectId.value))

const rollupState = ref<SubprojectRollupState>({enabled: false, excluded: []})

// Restore per-project on mount/switch before syncing back into params, so a
// stale state from a previous project id can't leak into the initial request.
watch(projectId, id => {
	rollupState.value = getSubprojectRollupState(currentUserId.value, id)
}, {immediate: true})

watch(rollupState, state => {
	params.value.include_child_projects = state.enabled
	params.value.excluded_project_ids = state.enabled ? state.excluded : undefined
	saveSubprojectRollupState(currentUserId.value, projectId.value, state)
}, {immediate: true, deep: true})

const taskPositionService = ref(new TaskPositionService())

// isSavedFilter() requires a full IProject; here we only have an id, so re-implement its check locally.
function isSavedFilterId(id: IProject['id']) {
	return getSavedFilterIdFromProjectId(id) > 0
}

// Saved filter composable for accessing filter data
const _savedFilter = useSavedFilter(() => (isSavedFilterId(projectId.value) ? projectId.value : undefined) as number).filter

const tasks = ref<ITask[]>([])
watch(
	allTasks,
	() => {
		const isFiltered = isSavedFilterId(projectId.value)
		tasks.value = ([...allTasks.value]).filter(t => shouldShowTaskInListView(t, allTasks.value, isFiltered))
	},
)

const isPositionSorting = computed(() => 'position' in sortByParam.value)

const firstNewPosition = computed(() => {
	if (tasks.value.length === 0) {
		return 0
	}

	return calculateItemPosition(null, tasks.value[0].position)
})

const baseStore = useBaseStore()
const taskStore = useTaskStore()
const {handleTaskDropToProject} = useTaskDragToProject()
// baseStore.currentProject is a DeepReadonly<IProject>; copy it to get back a plain IProject.
const project = computed<IProject | null>(() => {
	return baseStore.currentProject ? {...baseStore.currentProject} as IProject : null
})

const canWrite = computed(() => {
	return project.value?.maxPermission !== null && project.value?.maxPermission !== undefined &&
		project.value.maxPermission > Permissions.READ && (project.value?.id ?? 0) > 0
})

const isPseudoProject = computed(() => (project.value && isSavedFilter(project.value)) || project.value?.id === -1)

onMounted(async () => {
	await nextTick()
	ctaVisible.value = true
})

// No manual reordering while sub-project tasks are rolled up: foreign rows have
// no task_positions entry in this view, so a drag would write a mis-scoped row.
const canDragTasks = computed(() => (canWrite.value || isSavedFilter(project.value)) && !rollupState.value.enabled)

const isTouchDevice = ref(false)
if (typeof window !== 'undefined') {
	isTouchDevice.value = !window.matchMedia('(hover: hover) and (pointer: fine)').matches
}
const dragHandle = computed(() => isTouchDevice.value ? '.handle' : undefined)

const addTaskRef = ref<typeof AddTask | null>(null)

function focusNewTaskInput() {
	addTaskRef.value?.focusTaskInput()
}

const projectViewService = new ProjectViewService()

// Saving a view's default sort calls ProjectView.Update, which requires project admin
// (pkg/models/project_view_permissions.go) — hide the action for non-admins so they
// don't hit a 403 toast on a control they can't use.
const canSaveDefaultSort = computed(() =>
	(project.value?.maxPermission ?? Permissions.READ) >= Permissions.ADMIN && (project.value?.id ?? 0) > 0,
)

async function saveDefaultSort(newSortBy: SortBy) {
	const view = currentView.value
	if (!view) {
		return
	}

	const {sortBy: defaultSortBy, orderBy: defaultOrderBy} = sortByToDefaultArrays(newSortBy)
	try {
		const updatedView = await projectViewService.update(new ProjectViewModel({
			...view,
			defaultSortBy,
			defaultOrderBy,
		}))
		projectStore.setProjectView(updatedView)
		success({message: t('sorting.defaultSaved')})
	} catch (e) {
		error(e)
	}
}

function updateTaskList(task: ITask) {
	if (!isPositionSorting.value) {
		// reload tasks with current filter and sorting
		loadTasks()
	} else {
		allTasks.value = [
			task,
			...allTasks.value,
		]
	}

	baseStore.setHasTasks(true)
}

function updateTasks(updatedTask: ITask) {
	if (projectId.value < 0) {
		// Reload tasks to keep saved filter results in sync
		loadTasks(false)
		return
	}

	const idx = tasks.value.findIndex(t => t.id === updatedTask.id)
	if (idx === -1) {
		return
	}

	// Moved out of this project (e.g. via the context menu) — drop it rather than
	// leave it visible here, matching the drag-to-project path in saveTaskPosition.
	// Guard on the row's *previous* projectId so a cross-project subtask that was
	// always foreign to this view isn't dropped on an unrelated edit.
	if (tasks.value[idx].projectId === projectId.value && updatedTask.projectId !== projectId.value) {
		tasks.value = tasks.value.filter(t => t.id !== updatedTask.id)
		return
	}

	tasks.value[idx] = updatedTask
}

function onTaskDeleted(deletedTask: ITask) {
	tasks.value = tasks.value.filter(t => t.id !== deletedTask.id)
}

function handleDragStart(e: { item: HTMLElement }) {
	drag.value = true
	const taskId = parseInt(e.item.dataset.taskId ?? '', 10)
	const task = tasks.value.find(t => t.id === taskId)

	if (task) {
		taskStore.setDraggedTask(task)
	}
}

async function saveTaskPosition(e: { originalEvent?: MouseEvent, to: HTMLElement, from: HTMLElement, newIndex: number }) {
	drag.value = false

	// Check if dropped on a sidebar project
	const {moved} = await handleTaskDropToProject(e, (task) => {
		tasks.value = tasks.value.filter(t => t.id !== task.id)
	})

	if (moved) {
		return
	}

	// If dropped outside this list
	if (e.to !== e.from) {
		return
	}

	const task = tasks.value[e.newIndex]
	const taskBefore = tasks.value[e.newIndex - 1] ?? null
	const taskAfter = tasks.value[e.newIndex + 1] ?? null

	const position = calculateItemPosition(taskBefore !== null ? taskBefore.position : null, taskAfter !== null ? taskAfter.position : null)

	await taskPositionService.value.update(new TaskPositionModel({
		position,
		projectViewId: props.viewId,
		taskId: task.id,
	}))
	tasks.value[e.newIndex] = {
		...task,
		position,
	}
}

const taskRefs = ref<(InstanceType<typeof SingleTaskInProject> | null)[]>([])
const focusedIndex = ref(-1)

// zhyswan-vuedraggable ships no slot types, so the #item scoped slot props type as {}.
// This reflects the shape it actually passes at runtime (SortableJS list item + index).
interface ItemSlotProps {
	element: ITask,
	index: number,
}

function getItemSlotProps(slotProps: unknown): ItemSlotProps {
	return slotProps as ItemSlotProps
}

// Omit + re-add $slots (rather than intersect over the original) so vue-tsc's
// `T extends { $slots: infer Slots }` check resolves to our slot, not `{}`.
const TaskDraggable = draggable as unknown as new () => Omit<InstanceType<typeof draggable>, '$slots'> & {
	$slots: {
		item(props: ItemSlotProps): unknown,
	},
}

function setTaskRef(el: InstanceType<typeof SingleTaskInProject> | null, index: number) {
	if (el === null) {
		delete taskRefs.value[index]
	} else {
		taskRefs.value[index] = el
	}
}

function focusTask(index: number) {
	if (index < 0 || index >= tasks.value.length) {
		return
	}

	const taskRef = taskRefs.value[index]

	focusedIndex.value = index
	taskRef?.focus()
}

function handleListNavigation(e: KeyboardEvent) {
	if (e.target instanceof HTMLElement && (e.target.closest('input, textarea, select, [contenteditable="true"]'))) {
		return
	}

	if (e.code === 'KeyJ') {
		e.preventDefault()
		focusTask(Math.min(focusedIndex.value + 1, tasks.value.length - 1))
		return
	}

	if (e.code === 'KeyK') {
		e.preventDefault()
		if (focusedIndex.value === -1) {
			focusTask(tasks.value.length - 1)
			return
		}

		if (focusedIndex.value === 0) {
			addTaskRef.value?.focusTaskInput()
			focusedIndex.value = -1
			return
		}

		focusTask(Math.max(focusedIndex.value - 1, 0))
		return
	}

	if (e.code === 'Enter') {
		if (e.isComposing) {
			return
		}

		// Links and buttons activate natively on Enter; leave them alone
		if (e.target instanceof HTMLElement && e.target.closest('a, button, [role="button"]')) {
			return
		}

		// Only act when a row was focused via J/K roving navigation
		if (focusedIndex.value < 0) {
			return
		}

		e.preventDefault()
		taskRefs.value[focusedIndex.value]?.click(e)
	}
}

onMounted(() => {
	document.addEventListener('keydown', handleListNavigation)
})

onBeforeUnmount(() => {
	document.removeEventListener('keydown', handleListNavigation)
})
</script>

<style lang="scss" scoped>
.filter-container {
	display: flex;
	align-items: center;
	gap: .5rem;

	:deep(.popup) {
		inset-block-start: 3rem;
		inset-inline-end: 0;
		max-inline-size: 300px;
	}
}

.tasks {
	padding: .5rem;
}

.task-ghost {
	border-radius: $radius;
	background: var(--grey-100);
	border: 2px dashed var(--grey-300);

	* {
		opacity: 0;
	}
}

.list-view__add-task {
	padding: 1rem 1rem 0;
}

.link-share-view .card {
	border: none;
	box-shadow: none;
}

:deep(.single-task .handle) {
	cursor: grab;
	margin-inline-end: .25rem;
	color: var(--grey-400);
}

@media (hover: hover) and (pointer: fine) {
	:deep(.single-task .handle) {
		display: none;
	}
}

:deep(.tasks:not(.dragging-disabled) .single-task) {
	cursor: grab;
	-webkit-touch-callout: none;
	user-select: none;
	touch-action: manipulation;

	&:active {
		cursor: grabbing;
	}
}

.list-view {
	padding-block-end: 1rem;

	:deep(.card) {
		margin-block-end: 0;
	}
}
</style>
