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
					v-if="!isSavedFilterProject(project)"
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
						v-if="!project?.is_archived && canWrite"
						ref="addTaskRef"
						class="list-view__add-task d-print-none"
						@tasksAdded="updateTaskList"
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
import {useUpdateTaskPositionMutation} from '@/client/queries/taskMutations'
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
import {createProjectViewUpdate, useUpdateProjectViewMutation} from '@/client/queries/projectViews'
import {useProjects} from '@/composables/useProjects'
import {useTaskDragToProject} from '@/composables/useTaskDragToProject'
import {useCurrentProject} from '@/composables/useCurrentProject'
import {shouldShowTaskInListView, isTaskFromSubproject} from '@/composables/useTaskListFiltering'
import {getSubprojectRollupState, saveSubprojectRollupState, type SubprojectRollupState} from '@/helpers/subprojectRollupState'
import {PERMISSIONS as Permissions} from '@/constants/permissions'
import {calculateItemPosition} from '@/helpers/calculateItemPosition'
import type {TaskResponse} from '@/client/queries/tasks'
import {isSavedFilterProject, type ProjectResponse} from '@/client/queries/projects'

import {useAuthStore} from '@/stores/auth'
import {useBaseStore} from '@/stores/base'
import {useTaskDragState} from '@/composables/useTaskDragState'


const props = defineProps<{
	isLoadingProject: boolean,
	projectId: number,
	viewId: number,
}>()

const projectId = toRef(props, 'projectId')

defineOptions({name: 'List'})

const ctaVisible = ref(false)

const drag = ref(false)

const {t} = useI18n({useScope: 'global'})
const authStore = useAuthStore()
const projectList = useProjects()

const currentView = computed(() =>
	projectList.projects[projectId.value]?.views.find(v => v.id === props.viewId),
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
	() => defaultSortToSortBy(currentView.value?.default_sort_by ?? [], currentView.value?.default_order_by ?? []) ?? {position: 'asc'},
	() => projectId.value === -1
		? ['comment_count', 'is_unread']
		: ['subtasks', 'comment_count', 'is_unread'],
)
const currentUserId = computed(() => authStore.info?.id ?? 0)

function collectDescendants(id: number, visited: Set<number> = new Set()): ProjectResponse[] {
	// Guards against corrupt/imported parent_project_id cycles (see the backend's
	// maxDescendantDepth in pkg/models/task_collection.go for the same concern).
	if (visited.has(id)) {
		return []
	}
	visited.add(id)

	const children = projectList.getChildProjects(id).filter(p => !p.is_archived)
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

const positionMutation = useUpdateTaskPositionMutation()

const dragTasks = ref<TaskResponse[] | null>(null)
const tasks = computed({
	get: () => dragTasks.value ?? allTasks.value.filter(task => shouldShowTaskInListView(task, allTasks.value)),
	set: value => { dragTasks.value = value },
})
watch([projectId, () => props.viewId], () => { dragTasks.value = null })

const isPositionSorting = computed(() => 'position' in sortByParam.value)

const baseStore = useBaseStore()
const {setDraggedTask} = useTaskDragState()
const {handleTaskDropToProject} = useTaskDragToProject()
const {currentProject: project} = useCurrentProject()

const canWrite = computed(() => {
	return typeof project.value?.max_permission === 'number' &&
		project.value.max_permission > Permissions.READ &&
		project.value.id > 0
})

const isPseudoProject = computed(() => isSavedFilterProject(project.value) || project.value?.id === -1)

onMounted(async () => {
	await nextTick()
	ctaVisible.value = true
})

// No manual reordering while sub-project tasks are rolled up: foreign rows have
// no task_positions entry in this view, so a drag would write a mis-scoped row.
const canDragTasks = computed(() => (canWrite.value || isSavedFilterProject(project.value)) && !rollupState.value.enabled)

const isTouchDevice = ref(false)
if (typeof window !== 'undefined') {
	isTouchDevice.value = !window.matchMedia('(hover: hover) and (pointer: fine)').matches
}
const dragHandle = computed(() => isTouchDevice.value ? '.handle' : undefined)

const addTaskRef = ref<typeof AddTask | null>(null)

function focusNewTaskInput() {
	addTaskRef.value?.focusTaskInput()
}

const updateViewMutation = useUpdateProjectViewMutation(t('sorting.defaultSaved'))

// Saving a view's default sort calls ProjectView.Update, which requires project admin
// (pkg/models/project_view_permissions.go) — hide the action for non-admins so they
// don't hit a 403 toast on a control they can't use.
const canSaveDefaultSort = computed(() =>
	(project.value?.max_permission ?? Permissions.READ) >= Permissions.ADMIN && (project.value?.id ?? 0) > 0,
)

async function saveDefaultSort(newSortBy: SortBy) {
	const view = currentView.value
	if (!view?.id) {
		return
	}

	const {sortBy: defaultSortBy, orderBy: defaultOrderBy} = sortByToDefaultArrays(newSortBy)
	try {
		await updateViewMutation.mutateAsync({
			projectId: projectId.value,
			viewId: view.id,
			view: createProjectViewUpdate({...view, default_sort_by: defaultSortBy, default_order_by: defaultOrderBy}),
		})
	} catch {
		// The mutation already toasted the failure.
		return
	}
	// Re-run the sortBy setter now that resolvedSortByDefault reflects the new
	// default, so serializeSortBy sees newSortBy === default and drops `?sort=`.
	sortByParam.value = newSortBy
}

function updateTaskList() {
	baseStore.setHasTasks(true)
}

function updateTasks() {
	if (projectId.value < 0) void loadTasks()
}

function handleDragStart(e: { item: HTMLElement }) {
	drag.value = true
	dragTasks.value = [...tasks.value]
	const taskId = parseInt(e.item.dataset.taskId ?? '', 10)
	const task = tasks.value.find(t => t.id === taskId)

	if (task) {
		setDraggedTask(task)
	}
}

async function saveTaskPosition(e: { originalEvent?: MouseEvent, to: HTMLElement, from: HTMLElement, item: HTMLElement, newIndex: number }) {
	drag.value = false
	try {

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

		// e.newIndex is a DOM index: it counts elements still leaving the transition group, so it can
		// point past the last task. The list is already reordered here, so resolve the task by its id.
		const movedTaskId = parseInt(e.item.dataset.taskId ?? '', 10)
		const newIndex = tasks.value.findIndex(t => t.id === movedTaskId)

		if (newIndex === -1) {
			return
		}

		const taskBefore = tasks.value[newIndex - 1] ?? null
		const taskAfter = tasks.value[newIndex + 1] ?? null

		const position = calculateItemPosition(
			taskBefore !== null ? taskBefore.position : null,
			taskAfter !== null ? taskAfter.position : null,
		)

		await positionMutation.mutateAsync({
			position,
			project_view_id: props.viewId,
			taskId: movedTaskId,
		})
	} catch { /* Mutation reports the error. */ } finally {
		dragTasks.value = null
	}
}

const taskRefs = ref<(InstanceType<typeof SingleTaskInProject> | null)[]>([])
const focusedIndex = ref(-1)

// zhyswan-vuedraggable ships no slot types, so the #item scoped slot props type as {}.
// This reflects the shape it actually passes at runtime (SortableJS list item + index).
interface ItemSlotProps {
	element: TaskResponse,
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
