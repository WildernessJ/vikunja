<template>
	<ProjectWrapper
		class="project-calendar"
		:is-loading-project="isLoadingProject"
		:project-id="projectId"
		:view-id
	>
		<template #default>
			<div class="calendar-layout">
				<div class="calendar-main">
					<div class="calendar-toolbar">
						<div class="calendar-nav">
							<XButton
								variant="secondary"
								:shadow="false"
								class="calendar-today"
								@click="goToday"
							>
								{{ $t('project.calendar.today') }}
							</XButton>
							<BaseButton
								class="calendar-prev"
								:aria-label="$t('project.calendar.previous')"
								@click="goPrevious"
							>
								<Icon icon="angle-left" />
							</BaseButton>
							<BaseButton
								class="calendar-next"
								:aria-label="$t('project.calendar.next')"
								@click="goNext"
							>
								<Icon icon="angle-right" />
							</BaseButton>
							<span class="calendar-period-label">{{ periodLabel }}</span>
						</div>
						<div class="calendar-mode-toggle">
							<BaseButton
								class="calendar-mode-month"
								:class="{'is-active': mode === 'month'}"
								@click="mode = 'month'"
							>
								{{ $t('project.calendar.month') }}
							</BaseButton>
							<BaseButton
								class="calendar-mode-week"
								:class="{'is-active': mode === 'week'}"
								@click="mode = 'week'"
							>
								{{ $t('project.calendar.week') }}
							</BaseButton>
						</div>
					</div>

					<Message
						v-if="windowTruncated"
						variant="warning"
						class="calendar-truncation-notice mbe-2"
					>
						{{ $t('project.calendar.windowTruncated') }}
					</Message>

					<div class="calendar-weekdays">
						<div
							v-for="label in weekdayLabels"
							:key="label"
							class="calendar-weekday"
						>
							{{ label }}
						</div>
					</div>

					<div
						class="calendar-grid loader-container"
						:class="[mode === 'week' ? 'is-week' : 'is-month', {'is-loading': loading}]"
					>
						<div
							v-for="day in days"
							:key="day.key"
							class="calendar-day"
							:class="{
								'is-outside-month': !day.inCurrentMonth,
								'is-today': day.isToday,
								'is-drop-target': dropTargetKey === day.key,
							}"
							:data-date="day.key"
							@dragover="onDragOver(day, $event)"
							@dragleave="onDragLeave(day)"
							@drop="onDrop(day, $event)"
						>
							<div class="calendar-day-header">
								<span class="calendar-day-number">{{ day.date.getDate() }}</span>
							</div>
							<div class="calendar-day-tasks">
								<BaseButton
									v-for="task in tasksByDay.get(day.key) ?? []"
									:key="task.id"
									class="calendar-task"
									:class="{'is-done': task.done}"
									:draggable="canWrite"
									:data-task-id="task.id"
									@click="openTask(task)"
									@dragstart="onTaskDragStart(task, $event)"
									@dragend="onTaskDragEnd"
								>
									{{ task.title }}
								</BaseButton>
							</div>
							<div
								class="calendar-day-body"
								@click="openQuickCreate(day)"
							>
								<AddTask
									v-if="canWrite && quickCreateKey === day.key"
									:ref="setQuickAddRef"
									class="calendar-quick-add"
									@taskAdded="task => onQuickTaskAdded(day, task)"
									@click.stop
								/>
							</div>
						</div>
					</div>
				</div>

				<aside class="calendar-unscheduled">
					<h3 class="calendar-unscheduled-title">
						{{ $t('project.calendar.unscheduled') }}
					</h3>
					<Message
						v-if="unscheduledTruncated"
						variant="warning"
						class="calendar-truncation-notice mbe-2"
					>
						{{ $t('project.calendar.unscheduledTruncated') }}
					</Message>
					<p
						v-if="unscheduledTasks.length === 0"
						class="calendar-unscheduled-empty"
					>
						{{ $t('project.calendar.unscheduledEmpty') }}
					</p>
					<BaseButton
						v-for="task in unscheduledTasks"
						:key="task.id"
						class="calendar-task"
						:class="{'is-done': task.done}"
						:draggable="canWrite"
						:data-task-id="task.id"
						@click="openTask(task)"
						@dragstart="onTaskDragStart(task, $event)"
						@dragend="onTaskDragEnd"
					>
						{{ task.title }}
					</BaseButton>
				</aside>
			</div>
		</template>
	</ProjectWrapper>
</template>

<script setup lang="ts">
import {computed, ref, watch, shallowReactive, type ComponentPublicInstance} from 'vue'
import {useRouter} from 'vue-router'
import {onClickOutside} from '@vueuse/core'
import {klona} from 'klona/lite'

import ProjectWrapper from '@/components/project/ProjectWrapper.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import XButton from '@/components/input/Button.vue'
import AddTask from '@/components/tasks/AddTask.vue'
import Message from '@/components/misc/Message.vue'

import {useBaseStore} from '@/stores/base'
import {useAuthStore} from '@/stores/auth'
import {useTaskStore} from '@/stores/tasks'

import TaskCollectionService, {type TaskFilterParams} from '@/services/taskCollection'
import {buildDateWindowFilterQuery} from '@/helpers/time/dateWindowFilterQuery'
import {formatDate} from '@/helpers/time/formatDate'
import {PERMISSIONS} from '@/constants/permissions'
import {error} from '@/message'

import type {ITask} from '@/modelTypes/ITask'
import type {IProjectView} from '@/modelTypes/IProjectView'
import type {DateKebab} from '@/types/DateKebab'

const props = defineProps<{
	isLoadingProject: boolean,
	projectId: number,
	viewId: IProjectView['id'],
}>()

const MONTH_GRID_DAYS = 42
const WEEK_GRID_DAYS = 7
const DAY_MS = 86_400_000
// Vikunja's filter language has no IS NULL operator, so we pair a clause no task
// can satisfy with filter_include_nulls: getFilterCond wraps each referenced field
// as `(field > "9999-12-31" OR field IS NULL)`, and AND-ing all three yields
// exactly the fully-dateless tasks (due AND start AND end all null).
const UNSCHEDULED_FILTER = 'due_date > "9999-12-31" && start_date > "9999-12-31" && end_date > "9999-12-31"'

const router = useRouter()
const baseStore = useBaseStore()
const authStore = useAuthStore()
const taskStore = useTaskStore()

// Two decoupled services so each keeps its own totalPages for the truncation guard.
const windowTaskService = shallowReactive(new TaskCollectionService())
const unscheduledTaskService = shallowReactive(new TaskCollectionService())

const mode = ref<'month' | 'week'>('month')
const anchor = ref<Date>(startOfDay(new Date()))
const taskById = ref<Map<ITask['id'], ITask>>(new Map())
const windowTruncated = ref(false)
const unscheduledTruncated = ref(false)
const loading = computed(() => windowTaskService.loading || unscheduledTaskService.loading)

const canWrite = computed(() => (baseStore.currentProject?.maxPermission ?? PERMISSIONS.READ) > PERMISSIONS.READ)
const weekStart = computed<number>(() => authStore.settings.weekStart ?? 0)

interface CalendarDay {
	date: Date
	key: DateKebab
	inCurrentMonth: boolean
	isToday: boolean
}

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

// Day key built from *local* calendar parts, matching how the rest of the app
// displays dates. toISOString() would use UTC and could shift the day near
// midnight for users east/west of UTC.
function dayKey(date: Date): DateKebab {
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	return `${y}-${m}-${d}` as DateKebab
}

// Calendar-day difference, computed from local Y/M/D projected onto UTC so DST
// transitions can never add or drop an hour that would round to the wrong day.
function calendarDayDelta(from: Date, to: Date): number {
	const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
	const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
	return Math.round((b - a) / DAY_MS)
}

function addDays(date: Date, delta: number): Date {
	const shifted = new Date(date.getTime())
	shifted.setDate(shifted.getDate() + delta)
	return shifted
}

function startOfWeek(date: Date): Date {
	const d = startOfDay(date)
	const diff = (d.getDay() - weekStart.value + 7) % 7
	return addDays(d, -diff)
}

const gridStart = computed<Date>(() => {
	if (mode.value === 'week') {
		return startOfWeek(anchor.value)
	}
	return startOfWeek(new Date(anchor.value.getFullYear(), anchor.value.getMonth(), 1))
})

const gridLength = computed(() => mode.value === 'week' ? WEEK_GRID_DAYS : MONTH_GRID_DAYS)

const days = computed<CalendarDay[]>(() => {
	const todayKey = dayKey(new Date())
	const anchorMonth = anchor.value.getMonth()
	const result: CalendarDay[] = []
	for (let i = 0; i < gridLength.value; i++) {
		const date = addDays(gridStart.value, i)
		result.push({
			date,
			key: dayKey(date),
			inCurrentMonth: mode.value === 'week' || date.getMonth() === anchorMonth,
			isToday: dayKey(date) === todayKey,
		})
	}
	return result
})

const windowFrom = computed<DateKebab>(() => days.value[0].key)
const windowTo = computed<DateKebab>(() => days.value[days.value.length - 1].key)

const weekdayLabels = computed<string[]>(() => {
	const labels: string[] = []
	// 2024-01-07 is a Sunday; offset by weekStart to get the configured order.
	for (let i = 0; i < 7; i++) {
		const date = new Date(2024, 0, 7 + ((weekStart.value + i) % 7))
		labels.push(formatDate(date, 'ddd'))
	}
	return labels
})

const periodLabel = computed(() => {
	if (mode.value === 'month') {
		return formatDate(anchor.value, 'MMMM YYYY')
	}
	const end = addDays(gridStart.value, 6)
	return `${formatDate(gridStart.value, 'MMM D')} – ${formatDate(end, 'MMM D, YYYY')}`
})

function taskAnchorDate(task: ITask): Date | null {
	if (task.startDate && task.endDate) {
		return task.startDate
	}
	if (task.dueDate) {
		return task.dueDate
	}
	if (task.startDate) {
		return task.startDate
	}
	if (task.endDate) {
		return task.endDate
	}
	return null
}

function taskDayKeys(task: ITask): DateKebab[] {
	if (task.startDate && task.endDate) {
		const keys: DateKebab[] = []
		const span = calendarDayDelta(task.startDate, task.endDate)
		for (let i = 0; i <= span; i++) {
			keys.push(dayKey(addDays(task.startDate, i)))
		}
		return keys
	}
	const anchorDate = taskAnchorDate(task)
	return anchorDate ? [dayKey(anchorDate)] : []
}

const allTasks = computed<ITask[]>(() => [...taskById.value.values()])

const tasksByDay = computed<Map<DateKebab, ITask[]>>(() => {
	const map = new Map<DateKebab, ITask[]>()
	for (const task of allTasks.value) {
		for (const key of taskDayKeys(task)) {
			const bucket = map.get(key)
			if (bucket) {
				bucket.push(task)
			} else {
				map.set(key, [task])
			}
		}
	}
	return map
})

// Only fully-dateless tasks belong in the panel. The server fetch keys on due_date
// being null, so a task with a start/end but no due_date would leak in — this
// predicate is the authoritative filter, never the server response alone.
const unscheduledTasks = computed<ITask[]>(() =>
	allTasks.value.filter(task => taskAnchorDate(task) === null),
)

// Merge one fetched set into taskById while preserving the other set. We classify
// existing entries by their dates (dateless = unscheduled, dated = windowed) so a
// refetch of one set only replaces its own category and never wipes the other —
// and the two watchers below can run independently without clobbering each other.
function mergeTasks(fetched: ITask[], keepDateless: boolean) {
	const next = new Map<ITask['id'], ITask>()
	for (const task of taskById.value.values()) {
		if ((taskAnchorDate(task) === null) === keepDateless) {
			next.set(task.id, task)
		}
	}
	for (const task of fetched) {
		next.set(task.id, task)
	}
	taskById.value = next
}

// This component is reused (not remounted) across project/view navigation, since
// the router keeps the same route component and only swaps params — see
// ProjectView.vue. Each loader below is guarded by its own sequence number,
// bumped every time its watcher fires, so a response that lands after a newer
// request has already started (project switch, or rapid window/project nav)
// is discarded instead of being merged into the wrong project's state.
let unscheduledLoadSeq = 0
let windowLoadSeq = 0

// The grid: one windowed request for the tasks intersecting the visible days,
// with include_nulls OFF so dateless tasks never compete for its page budget.
async function loadWindowTasks(seq: number, projectId: number, viewId: IProjectView['id']) {
	const params: TaskFilterParams = {
		sort_by: ['due_date', 'start_date', 'id'],
		order_by: ['asc', 'asc', 'asc'],
		filter: buildDateWindowFilterQuery(windowFrom.value, windowTo.value),
		filter_include_nulls: false,
		filter_timezone: authStore.settings.timezone,
		s: '',
		per_page: 250,
	}
	const loaded = await windowTaskService.getAll({projectId, viewId}, params) as ITask[]
	if (seq !== windowLoadSeq || projectId !== props.projectId || viewId !== props.viewId) {
		return
	}
	windowTruncated.value = windowTaskService.totalPages > 1
	// keepDateless: preserve the unscheduled set, replace the windowed one.
	mergeTasks(loaded, true)
}

// The panel: a separate, window-independent request returning only fully-dateless
// tasks (due AND start AND end all null). Refetched only on project/view change.
async function loadUnscheduledTasks(seq: number, projectId: number, viewId: IProjectView['id']) {
	const params: TaskFilterParams = {
		sort_by: ['id'],
		order_by: ['asc'],
		filter: UNSCHEDULED_FILTER,
		filter_include_nulls: true,
		filter_timezone: authStore.settings.timezone,
		s: '',
		per_page: 250,
	}
	const loaded = await unscheduledTaskService.getAll({projectId, viewId}, params) as ITask[]
	if (seq !== unscheduledLoadSeq || projectId !== props.projectId || viewId !== props.viewId) {
		return
	}
	unscheduledTruncated.value = unscheduledTaskService.totalPages > 1
	// keepDateless false: preserve the windowed set, replace the unscheduled one.
	mergeTasks(loaded, false)
}

// Window-independent panel fetch — only on project/view change. This is the
// single place taskById gets reset: it fires exactly once per navigation
// (unlike the windowed watcher below, which also refires on window-only
// changes), so resetting here can't race a second reset from the other watcher.
watch(
	() => [props.projectId, props.viewId],
	() => {
		unscheduledLoadSeq += 1
		taskById.value = new Map()
		windowTruncated.value = false
		unscheduledTruncated.value = false
		if (!props.projectId || !props.viewId) {
			return
		}
		void loadUnscheduledTasks(unscheduledLoadSeq, props.projectId, props.viewId)
	},
	{immediate: true},
)

// Windowed grid fetch — also refires as the visible date range changes. Bumps
// its own sequence on every trigger (project/view change *or* window nav) so
// rapid window navigation within the same project is guarded too, not just
// project switches.
watch(
	() => [props.projectId, props.viewId, windowFrom.value, windowTo.value],
	() => {
		windowLoadSeq += 1
		if (!props.projectId || !props.viewId) {
			return
		}
		void loadWindowTasks(windowLoadSeq, props.projectId, props.viewId)
	},
	{immediate: true},
)

function goToday() {
	anchor.value = startOfDay(new Date())
}

function goPrevious() {
	anchor.value = mode.value === 'week'
		? addDays(anchor.value, -7)
		: new Date(anchor.value.getFullYear(), anchor.value.getMonth() - 1, 1)
}

function goNext() {
	anchor.value = mode.value === 'week'
		? addDays(anchor.value, 7)
		: new Date(anchor.value.getFullYear(), anchor.value.getMonth() + 1, 1)
}

function openTask(task: ITask) {
	router.push({
		name: 'task.detail',
		params: {id: task.id},
		state: {backdropView: router.currentRoute.value.fullPath},
	})
}

const draggedTask = ref<ITask | null>(null)
const dropTargetKey = ref<DateKebab | null>(null)

function onTaskDragStart(task: ITask, event: DragEvent) {
	if (!canWrite.value) {
		event.preventDefault()
		return
	}
	draggedTask.value = task
	event.dataTransfer?.setData('text/plain', String(task.id))
	if (event.dataTransfer) {
		event.dataTransfer.effectAllowed = 'move'
	}
}

function onTaskDragEnd() {
	draggedTask.value = null
	dropTargetKey.value = null
}

function onDragOver(day: CalendarDay, event: DragEvent) {
	if (!canWrite.value || !draggedTask.value) {
		return
	}
	event.preventDefault()
	dropTargetKey.value = day.key
}

function onDragLeave(day: CalendarDay) {
	if (dropTargetKey.value === day.key) {
		dropTargetKey.value = null
	}
}

async function onDrop(day: CalendarDay, event: DragEvent) {
	if (!canWrite.value) {
		return
	}
	event.preventDefault()
	const task = draggedTask.value
	dropTargetKey.value = null
	draggedTask.value = null
	if (!task) {
		return
	}
	await rescheduleTask(task, day.date)
}

async function rescheduleTask(task: ITask, targetDay: Date) {
	const updated = klona(task)
	const anchorDate = taskAnchorDate(task)

	if (anchorDate === null) {
		// Dateless task dropped from the unscheduled panel: give it a due date on
		// the target day. Noon keeps it clear of the midnight timezone boundary.
		updated.dueDate = new Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate(), 12, 0, 0)
	} else {
		const delta = calendarDayDelta(anchorDate, targetDay)
		if (delta === 0) {
			return
		}
		// Shift every present date by the same whole-day delta, preserving each
		// one's time-of-day and the start↔end span.
		if (task.dueDate) {
			updated.dueDate = addDays(task.dueDate, delta)
		}
		if (task.startDate) {
			updated.startDate = addDays(task.startDate, delta)
		}
		if (task.endDate) {
			updated.endDate = addDays(task.endDate, delta)
		}
	}

	replaceTask(updated)
	try {
		const saved = await taskStore.update(updated)
		replaceTask(saved)
	} catch (e) {
		replaceTask(task)
		error(e)
	}
}

function replaceTask(task: ITask) {
	const next = new Map(taskById.value)
	next.set(task.id, task)
	taskById.value = next
}

const quickCreateKey = ref<DateKebab | null>(null)
const quickAddRef = ref<ComponentPublicInstance | null>(null)
// Kept out of the template: a `| null` union in a template ref expression trips
// eslint's vue/no-deprecated-filter (it reads the `|` as a Vue 2 filter pipe).
function setQuickAddRef(el: Element | ComponentPublicInstance | null) {
	quickAddRef.value = el as ComponentPublicInstance | null
}

// Dismiss the inline quick-create when clicking anywhere outside it. onClickOutside
// resolves quickAddRef to the AddTask root element; a null ref (nothing open) makes
// the handler a no-op, so opening a day cell isn't cancelled by its own click.
onClickOutside(quickAddRef, () => {
	quickCreateKey.value = null
})

function openQuickCreate(day: CalendarDay) {
	if (!canWrite.value) {
		return
	}
	quickCreateKey.value = day.key
}

async function onQuickTaskAdded(day: CalendarDay, task: ITask) {
	quickCreateKey.value = null
	const updated = klona(task)
	updated.dueDate = new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate(), 12, 0, 0)
	replaceTask(updated)
	try {
		const saved = await taskStore.update(updated)
		replaceTask(saved)
	} catch (e) {
		error(e)
	}
}
</script>

<style lang="scss" scoped>
.calendar-layout {
	display: flex;
	gap: 1rem;
	align-items: flex-start;

	@media screen and (max-width: $tablet) {
		flex-direction: column;
	}
}

.calendar-main {
	flex: 1 1 auto;
	min-inline-size: 0;
}

.calendar-toolbar {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 1rem;
	margin-block-end: 1rem;
	flex-wrap: wrap;
}

.calendar-nav {
	display: flex;
	align-items: center;
	gap: .5rem;
}

.calendar-period-label {
	font-weight: bold;
	font-size: 1.1rem;
	margin-inline-start: .5rem;
}

.calendar-mode-toggle {
	display: inline-flex;
	background: var(--white);
	border-radius: $radius;
	box-shadow: var(--shadow-sm);
	padding: .25rem;

	.button {
		padding: .25rem .75rem;
		border-radius: $radius;

		&.is-active {
			color: var(--switch-view-color);
			background: var(--primary);
			font-weight: bold;
		}
	}
}

.calendar-weekdays {
	display: grid;
	grid-template-columns: repeat(7, 1fr);
	gap: 1px;
	font-size: .8rem;
	font-weight: bold;
	color: var(--grey-500);
	margin-block-end: .25rem;
}

.calendar-weekday {
	padding: .25rem .5rem;
	text-align: center;
}

.calendar-grid {
	display: grid;
	grid-template-columns: repeat(7, 1fr);
	gap: 1px;
	background: var(--grey-200);
	border: 1px solid var(--grey-200);
	border-radius: $radius;
	overflow: hidden;

	&.is-month {
		grid-auto-rows: minmax(6.5rem, 1fr);
	}

	&.is-week {
		grid-auto-rows: minmax(12rem, 1fr);
	}
}

.calendar-day {
	background: var(--white);
	padding: .25rem;
	display: flex;
	flex-direction: column;
	min-inline-size: 0;

	&.is-outside-month {
		background: var(--grey-50);

		.calendar-day-number {
			color: var(--grey-400);
		}
	}

	&.is-today .calendar-day-number {
		background: var(--primary);
		color: var(--white);
		border-radius: 50%;
	}

	&.is-drop-target {
		outline: 2px dashed var(--primary);
		outline-offset: -2px;
	}
}

.calendar-day-header {
	display: flex;
	justify-content: flex-end;
}

.calendar-day-number {
	font-size: .8rem;
	inline-size: 1.5rem;
	block-size: 1.5rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
}

.calendar-day-tasks {
	display: flex;
	flex-direction: column;
	gap: .15rem;
}

.calendar-day-body {
	flex: 1 1 auto;
	min-block-size: 1rem;
	cursor: text;
}

.calendar-task {
	display: block;
	inline-size: 100%;
	text-align: start;
	font-size: .75rem;
	padding: .1rem .35rem;
	border-radius: $radius;
	background: var(--primary);
	color: var(--white);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	cursor: pointer;

	&.is-done {
		background: var(--grey-300);
		color: var(--grey-600);
		text-decoration: line-through;
	}

	&[draggable='true'] {
		cursor: grab;
	}
}

.calendar-quick-add {
	margin-block-start: .25rem;
}

.calendar-unscheduled {
	flex: 0 0 16rem;
	background: var(--white);
	border: 1px solid var(--grey-200);
	border-radius: $radius;
	padding: .75rem;

	@media screen and (max-width: $tablet) {
		flex-basis: auto;
		inline-size: 100%;
	}

	.calendar-task {
		margin-block-end: .25rem;
	}
}

.calendar-unscheduled-title {
	font-size: .9rem;
	font-weight: bold;
	margin-block-end: .5rem;
}

.calendar-unscheduled-empty {
	font-size: .8rem;
	color: var(--grey-500);
}
</style>
