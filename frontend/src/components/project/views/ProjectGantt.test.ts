import {shallowMount} from '@vue/test-utils'
import {describe, expect, it, vi} from 'vitest'
import {ref} from 'vue'
import dayjs from 'dayjs'

const addTask = vi.fn()

vi.mock('@/views/project/helpers/useGanttFilters', () => ({
	useGanttFilters: () => ({
		filters: ref({projectId: 1, viewId: 1, dateFrom: '', dateTo: '', showTasksWithoutDates: false}),
		hasDefaultFilters: ref(true),
		setDefaultFilters: vi.fn(),
		tasks: ref(new Map()),
		isLoading: ref(false),
		addTask,
		updateTask: vi.fn(),
	}),
}))

vi.mock('@/stores/base', () => ({
	useBaseStore: () => ({currentProject: {id: 1, maxPermission: 2}}),
}))

vi.mock('@/helpers/useFlatpickrLanguage', () => ({
	useFlatpickrLanguage: () => ({}),
}))

vi.mock('vue-i18n', async importOriginal => ({
	...await importOriginal<typeof import('vue-i18n')>(),
	useI18n: () => ({t: (key: string) => key}),
}))

import ProjectGantt from './ProjectGantt.vue'

describe('ProjectGantt.addGanttTask', () => {
	it('creates the task with the canonical end of day', async () => {
		const wrapper = shallowMount(ProjectGantt, {
			props: {isLoadingProject: false, projectId: 1, viewId: 1, route: {} as never},
			global: {
				mocks: {$t: (key: string) => key},
				stubs: {ProjectWrapper: {template: '<div><slot name="default"/></div>'}},
			},
		})

		await (wrapper.vm as unknown as {addGanttTask: (title: string) => Promise<void>}).addGanttTask('x')

		const {startDate, endDate} = addTask.mock.calls[0][0] as {startDate: Date, endDate: Date}
		expect(startDate.getHours()).toBe(0)
		expect(dayjs(endDate).diff(startDate, 'day')).toBe(7)
		expect([endDate.getHours(), endDate.getMinutes(), endDate.getSeconds(), endDate.getMilliseconds()])
			.toEqual([23, 59, 59, 999])
	})
})
