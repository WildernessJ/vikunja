import {describe, it, expect, vi, beforeEach} from 'vitest'
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
import type {ITask} from '@/modelTypes/ITask'
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

function mountChart(isLoading: boolean, tasks = new Map<ITask['id'], ITask>()) {
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

type ChartVm = {updateGanttTask: (id: string, newStart: Date, newEnd: Date) => void}

function mountWithTask(task: ITask) {
	const tasks = new Map<ITask['id'], ITask>([[task.id, task]])
	return mountChart(false, tasks)
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
		const wrapper = mountWithTask({id: 1, dueDate: new Date(2026, 8, 10, 10, 0)} as ITask)

		;(wrapper.vm as unknown as ChartVm).updateGanttTask('1', new Date(2026, 8, 9, 0, 0), new Date(2026, 8, 10, 9, 0))

		const update = wrapper.emitted('update:task')?.[0][0] as {dueDate: Date}
		expect(update.dueDate.getFullYear()).toBe(2026)
		expect(update.dueDate.getMonth()).toBe(8)
		expect(update.dueDate.getDate()).toBe(10)
		expect(update.dueDate.getHours()).toBe(23)
		expect(update.dueDate.getMinutes()).toBe(59)
		expect(update.dueDate.getSeconds()).toBe(59)
		expect(update.dueDate.getMilliseconds()).toBe(999)
	})

	it('keeps the before-noon heuristic when date-only is off', async () => {
		const wrapper = mountWithTask({id: 1, dueDate: new Date(2026, 8, 10, 10, 0)} as ITask)

		;(wrapper.vm as unknown as ChartVm).updateGanttTask('1', new Date(2026, 8, 9, 0, 0), new Date(2026, 8, 10, 9, 0))

		const update = wrapper.emitted('update:task')?.[0][0] as {dueDate: Date}
		expect(update.dueDate.getDate()).toBe(10)
		expect(update.dueDate.getHours()).toBe(0)
		expect(update.dueDate.getMinutes()).toBe(0)
		expect(update.dueDate.getSeconds()).toBe(0)
		expect(update.dueDate.getMilliseconds()).toBe(0)
	})

	it('forces the end side but not the start side for a start+end task when date-only is on', async () => {
		dateOnlyMock.ref.value = true
		const wrapper = mountWithTask({
			id: 1,
			startDate: new Date(2026, 8, 8, 8, 0),
			endDate: new Date(2026, 8, 10, 8, 0),
		} as ITask)

		;(wrapper.vm as unknown as ChartVm).updateGanttTask('1', new Date(2026, 8, 9, 14, 0), new Date(2026, 8, 10, 9, 0))

		const update = wrapper.emitted('update:task')?.[0][0] as {startDate: Date, endDate: Date}
		expect(update.endDate.getDate()).toBe(10)
		expect(update.endDate.getHours()).toBe(23)
		expect(update.endDate.getMinutes()).toBe(59)
		expect(update.endDate.getSeconds()).toBe(59)
		expect(update.endDate.getMilliseconds()).toBe(999)
		expect(update.startDate.getDate()).toBe(9)
		expect(update.startDate.getHours()).toBe(0)
		expect(update.startDate.getMilliseconds()).toBe(0)
	})
})
