import {describe, it, expect, vi, beforeEach} from 'vitest'
import {nextTick} from 'vue'
import {mount} from '@vue/test-utils'
import {createI18n} from 'vue-i18n'
import {createRouter, createMemoryHistory} from 'vue-router'

// This file mounts without pinia, so the real useDateOnly (which reaches the auth store)
// can't run. It has to be a real ref: GanttChart puts `dateOnly` in a watch source list,
// and a plain object is an invalid watch source.
const dateOnlyMock = vi.hoisted((): {ref: {value: boolean}} => ({ref: {value: false}}))
vi.mock('@/composables/useDateOnly', async () => {
	const {ref} = await import('vue')
	dateOnlyMock.ref = ref(false)
	return {useDateOnly: () => ({store: dateOnlyMock.ref})}
})

import GanttChart from './GanttChart.vue'
import GanttTimelineHeader from './GanttTimelineHeader.vue'
import en from '@/i18n/lang/en.json'
import {i18n as globalI18n} from '@/i18n'
import {normalizeTask, type TaskResponse} from '@/client/queries/tasks'
import type {Task} from '@/client/generated'
import type {GanttFilters} from '@/views/project/helpers/useGanttFilters'

const i18n = createI18n({legacy: false, locale: 'en', messages: {en}})

// the dayjs locale sync reads the app-wide i18n instance, not the one installed on the wrapper
globalI18n.global.locale.value = 'en'
const router = createRouter({history: createMemoryHistory(), routes: [{path: '/', component: {template: '<div/>'}}]})

const FILTERS: GanttFilters = {
	projectId: 1,
	viewId: 1,
	dateFrom: '2026-08-01T00:00:00.000Z',
	dateTo: '2026-10-01T00:00:00.000Z',
	showTasksWithoutDates: false,
}

function mountChart(isLoading: boolean, tasks = new Map<number, TaskResponse>()) {
	return mount(GanttChart, {
		shallow: true,
		props: {
			isLoading,
			filters: FILTERS,
			tasks,
			defaultTaskStartDate: FILTERS.dateFrom,
			defaultTaskEndDate: FILTERS.dateTo,
		},
		global: {
			plugins: [i18n, router],
		},
	})
}

type ChartVm = {
	updateGanttTask: (id: string, newStart: Date, newEnd: Date) => void
	ganttBars: {start: Date, end: Date}[][]
}

function mountWithTask(task: Task) {
	const normalized = normalizeTask(task)
	return mountChart(false, new Map([[normalized.id, normalized]]))
}

// Updates carry ISO strings; the assertions read them back as local dates.
function emittedDates(wrapper: ReturnType<typeof mountChart>): Record<string, Date | undefined> {
	const update = wrapper.emitted('update:task')?.[0][0] as Record<string, string | undefined>
	return Object.fromEntries(['start_date', 'end_date', 'due_date']
		.map(field => [field, update[field] === undefined ? undefined : new Date(update[field]!)]))
}

describe('GanttChart.vue', () => {
	beforeEach(() => {
		dateOnlyMock.ref.value = false
	})

	it('measures the day width once the chart replaces the loading state', async () => {
		const wrapper = mountChart(true)
		expect(wrapper.findComponent(GanttTimelineHeader).exists()).toBe(false)

		await wrapper.setProps({isLoading: false})

		expect(wrapper.findComponent(GanttTimelineHeader).props('dayWidthPixels')).toBeGreaterThan(0)
	})
})

describe('GanttChart.vue date-only writes', () => {
	beforeEach(() => {
		dateOnlyMock.ref.value = false
	})

	it('writes the canonical end of day for a due-only task when date-only is on', async () => {
		dateOnlyMock.ref.value = true
		const wrapper = mountWithTask({id: 1, due_date: new Date(2026, 8, 10, 10, 0).toISOString()} as Task)

		;(wrapper.vm as unknown as ChartVm).updateGanttTask('1', new Date(2026, 8, 9, 0, 0), new Date(2026, 8, 10, 9, 0))

		const update = emittedDates(wrapper)
		expect(update.due_date!.getFullYear()).toBe(2026)
		expect(update.due_date!.getMonth()).toBe(8)
		expect(update.due_date!.getDate()).toBe(10)
		expect(update.due_date!.getHours()).toBe(23)
		expect(update.due_date!.getMinutes()).toBe(59)
		expect(update.due_date!.getSeconds()).toBe(59)
		expect(update.due_date!.getMilliseconds()).toBe(999)
	})

	it('keeps the before-noon heuristic when date-only is off', async () => {
		const wrapper = mountWithTask({id: 1, due_date: new Date(2026, 8, 10, 10, 0).toISOString()} as Task)

		;(wrapper.vm as unknown as ChartVm).updateGanttTask('1', new Date(2026, 8, 9, 0, 0), new Date(2026, 8, 10, 9, 0))

		const update = emittedDates(wrapper)
		expect(update.due_date!.getDate()).toBe(10)
		expect(update.due_date!.getHours()).toBe(0)
		expect(update.due_date!.getMinutes()).toBe(0)
		expect(update.due_date!.getSeconds()).toBe(0)
		expect(update.due_date!.getMilliseconds()).toBe(0)
	})

	it('forces the end side but not the start side for a start+end task when date-only is on', async () => {
		dateOnlyMock.ref.value = true
		const wrapper = mountWithTask({
			id: 1,
			start_date: new Date(2026, 8, 8, 8, 0).toISOString(),
			end_date: new Date(2026, 8, 10, 8, 0).toISOString(),
		} as Task)

		;(wrapper.vm as unknown as ChartVm).updateGanttTask('1', new Date(2026, 8, 9, 14, 0), new Date(2026, 8, 10, 9, 0))

		const update = emittedDates(wrapper)
		expect(update.end_date!.getDate()).toBe(10)
		expect(update.end_date!.getHours()).toBe(23)
		expect(update.end_date!.getMinutes()).toBe(59)
		expect(update.end_date!.getSeconds()).toBe(59)
		expect(update.end_date!.getMilliseconds()).toBe(999)
		expect(update.start_date!.getDate()).toBe(9)
		expect(update.start_date!.getHours()).toBe(0)
		expect(update.start_date!.getMilliseconds()).toBe(0)
	})

	// One case per remaining updateGanttTask branch, all before-noon so the force is what passes them.
	it.each([
		['start_date + due_date', {start_date: new Date(2026, 8, 8, 8, 0).toISOString(), due_date: new Date(2026, 8, 10, 8, 0).toISOString()}, 'due_date'],
		['end_date only', {end_date: new Date(2026, 8, 10, 8, 0).toISOString()}, 'end_date'],
		['no dates', {}, 'end_date'],
	])('writes the canonical end of day for a %s task when date-only is on', (_label, dates, field) => {
		dateOnlyMock.ref.value = true
		const wrapper = mountWithTask({id: 1, ...dates} as Task)

		;(wrapper.vm as unknown as ChartVm).updateGanttTask('1', new Date(2026, 8, 9, 0, 0), new Date(2026, 8, 10, 9, 0))

		const update = emittedDates(wrapper)
		expect(update[field]!.getDate()).toBe(10)
		expect(update[field]!.getHours()).toBe(23)
		expect(update[field]!.getMilliseconds()).toBe(999)
	})

	it('does not write an end for a start-only task', () => {
		dateOnlyMock.ref.value = true
		const wrapper = mountWithTask({id: 1, start_date: new Date(2026, 8, 8, 8, 0).toISOString()} as Task)

		;(wrapper.vm as unknown as ChartVm).updateGanttTask('1', new Date(2026, 8, 9, 0, 0), new Date(2026, 8, 10, 9, 0))

		const update = emittedDates(wrapper)
		expect(update.start_date?.getDate()).toBe(9)
		expect(update.end_date).toBeUndefined()
		expect(update.due_date).toBeUndefined()
	})

	// Covers getRoundedDate's end-side force and dateOnly in the bars watcher: with the
	// view kept alive, a toggle flip in settings must redraw without a reload.
	it('rounds a legacy before-noon end to the canonical end of day for bar geometry, and redraws on a toggle flip', async () => {
		const wrapper = mountWithTask({
			id: 1,
			start_date: new Date(2026, 8, 8, 8, 0).toISOString(),
			end_date: new Date(2026, 8, 10, 9, 30).toISOString(),
		} as Task)
		const vm = wrapper.vm as unknown as ChartVm
		expect(vm.ganttBars[0][0].end.getDate()).toBe(10)
		expect(vm.ganttBars[0][0].end.getHours()).toBe(0)

		dateOnlyMock.ref.value = true
		await nextTick()

		expect(vm.ganttBars[0][0].end.getDate()).toBe(10)
		expect(vm.ganttBars[0][0].end.getHours()).toBe(23)
		expect(vm.ganttBars[0][0].end.getMilliseconds()).toBe(999)
		expect(vm.ganttBars[0][0].start.getHours()).toBe(0)
	})
})
