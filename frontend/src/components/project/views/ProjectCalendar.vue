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
import {computed, ref, type ComponentPublicInstance} from 'vue'
import {useRouter} from 'vue-router'
import {onClickOutside} from '@vueuse/core'

import ProjectWrapper from '@/components/project/ProjectWrapper.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import XButton from '@/components/input/Button.vue'
import AddTask from '@/components/tasks/AddTask.vue'
import Message from '@/components/misc/Message.vue'

import {useCurrentProject} from '@/composables/useCurrentProject'
import {useAuthStore} from '@/stores/auth'
import {useTasks} from '@/composables/useTasks'
import {useUpdateTaskMutation} from '@/client/queries/taskMutations'
import type {TaskFilterParams, TaskResponse} from '@/client/queries/tasks'
import type {Task} from '@/client/generated'
import {parseDateOrNull} from '@/helpers/parseDateOrNull'

import {buildDateWindowFilterQuery} from '@/helpers/time/dateWindowFilterQuery'
import {calendarDueDateForDay} from '@/components/project/views/calendarDueDate'
import {formatDate} from '@/helpers/time/formatDate'
import {useDateOnly} from '@/composables/useDateOnly'
import {PERMISSIONS} from '@/constants/permissions'

import type {DateKebab} from '@/types/DateKebab'

const props = defineProps<{
	isLoadingProject: boolean,
	projectId: number,
	viewId: number,
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
const authStore = useAuthStore()
const updateTask = useUpdateTaskMutation(true)
const {store: dateOnly} = useDateOnly()

const mode = ref<'month' | 'week'>('month')
const anchor = ref<Date>(startOfDay(new Date()))

const {currentProject} = useCurrentProject()
const canWrite = computed(() => (currentProject.value?.max_permission ?? PERMISSIONS.READ) > PERMISSIONS.READ)
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

function taskDates(task: TaskResponse) {
	return {
		due: parseDateOrNull(task.due_date),
		start: parseDateOrNull(task.start_date),
		end: parseDateOrNull(task.end_date),
	}
}

function taskAnchorDate(task: TaskResponse): Date | null {
	const {due, start, end} = taskDates(task)
	if (start && end) {
		return start
	}
	return due ?? start ?? end ?? null
}

function taskDayKeys(task: TaskResponse): DateKebab[] {
	const {start, end} = taskDates(task)
	if (start && end) {
		const keys: DateKebab[] = []
		const span = calendarDayDelta(start, end)
		for (let i = 0; i <= span; i++) {
			keys.push(dayKey(addDays(start, i)))
		}
		return keys
	}
	const anchorDate = taskAnchorDate(task)
	return anchorDate ? [dayKey(anchorDate)] : []
}

// The grid: one windowed request for the tasks intersecting the visible days,
// with include_nulls OFF so dateless tasks never compete for its page budget.
const windowQuery = useTasks(() => ({
	project: props.projectId,
	view: props.viewId,
	params: {
		sort_by: ['due_date', 'start_date', 'id'],
		order_by: ['asc', 'asc', 'asc'],
		filter: buildDateWindowFilterQuery(windowFrom.value, windowTo.value),
		filter_include_nulls: false,
		filter_timezone: authStore.settings.timezone,
		per_page: 250,
	} satisfies TaskFilterParams,
}), {enabled: () => Boolean(props.projectId && props.viewId)})

// The panel: a separate, window-independent request returning only fully-dateless
// tasks (due AND start AND end all null).
const unscheduledQuery = useTasks(() => ({
	project: props.projectId,
	view: props.viewId,
	params: {
		sort_by: ['id'],
		order_by: ['asc'],
		filter: UNSCHEDULED_FILTER,
		filter_include_nulls: true,
		filter_timezone: authStore.settings.timezone,
		per_page: 250,
	} satisfies TaskFilterParams,
}), {enabled: () => Boolean(props.projectId && props.viewId)})

const windowTruncated = computed(() => windowQuery.totalPages.value > 1)
const unscheduledTruncated = computed(() => unscheduledQuery.totalPages.value > 1)
const loading = computed(() => windowQuery.isFetching.value || unscheduledQuery.isFetching.value)

// Both sets merged by id: a task dropped from the panel onto a day is still only in the
// unscheduled result until the next fetch, and must show on the grid right away.
const allTasks = computed<TaskResponse[]>(() => [...new Map(
	[...unscheduledQuery.tasks.value, ...windowQuery.tasks.value].map(task => [task.id, task]),
).values()])
const tasksByDay = computed<Map<DateKebab, TaskResponse[]>>(() => {
	const map = new Map<DateKebab, TaskResponse[]>()
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
const unscheduledTasks = computed<TaskResponse[]>(() =>
	allTasks.value.filter(task => taskAnchorDate(task) === null),
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

function openTask(task: TaskResponse) {
	router.push({
		name: 'task.detail',
		params: {id: task.id},
		state: {backdropView: router.currentRoute.value.fullPath},
	})
}

const draggedTask = ref<TaskResponse | null>(null)
const dropTargetKey = ref<DateKebab | null>(null)

function onTaskDragStart(task: TaskResponse, event: DragEvent) {
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

async function rescheduleTask(task: TaskResponse, targetDay: Date) {
	const anchorDate = taskAnchorDate(task)
	const updated: TaskResponse = {...task}

	if (anchorDate === null) {
		// Dateless task dropped from the unscheduled panel: give it a due date on
		// the target day.
		updated.due_date = calendarDueDateForDay(targetDay, dateOnly.value).toISOString()
	} else {
		const delta = calendarDayDelta(anchorDate, targetDay)
		if (delta === 0) {
			return
		}
		// Shift every present date by the same whole-day delta, preserving each
		// one's time-of-day and the start↔end span.
		const {due, start, end} = taskDates(task)
		if (due) {
			updated.due_date = addDays(due, delta).toISOString()
		}
		if (start) {
			updated.start_date = addDays(start, delta).toISOString()
		}
		if (end) {
			updated.end_date = addDays(end, delta).toISOString()
		}
	}

	// Optimistic: the mutation moves the task in every cached list and rolls back (and reports) on failure.
	await updateTask.mutateAsync(updated).catch(() => undefined)
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

async function onQuickTaskAdded(day: CalendarDay, task: Task) {
	quickCreateKey.value = null
	await updateTask.mutateAsync({
		...task,
		id: task.id!,
		due_date: calendarDueDateForDay(day.date, dateOnly.value).toISOString(),
	}).catch(() => undefined)
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

	// The quick-add composer's chip popups are absolutely positioned inside a day
	// cell; overflow: hidden would clip them at the grid edge while composing.
	&:has(.calendar-quick-add) {
		overflow: visible;
	}

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
