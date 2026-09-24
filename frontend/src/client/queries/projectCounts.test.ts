import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {defineComponent, h} from 'vue'
import {flushPromises, mount} from '@vue/test-utils'
import {createPinia, setActivePinia} from 'pinia'

import type {ITask} from '@/modelTypes/ITask'

const {getProjectCountsMock, taskUpdateMock} = vi.hoisted(() => ({
	getProjectCountsMock: vi.fn(),
	taskUpdateMock: vi.fn(),
}))

vi.mock('@/services/projectCounts', () => ({getProjectCounts: getProjectCountsMock}))
vi.mock('@/services/task', () => ({
	default: class {
		update = taskUpdateMock
	},
}))
vi.mock('@/stores/auth', () => ({
	useAuthStore: () => ({authUser: {id: 1}, settings: {timezone: 'UTC'}}),
}))
vi.mock('@/stores/base', () => ({useBaseStore: () => ({})}))
vi.mock('@/stores/kanban', () => ({useKanbanStore: () => ({ensureTaskIsInCorrectBucket: vi.fn()})}))
vi.mock('@/stores/config', () => ({useConfigStore: () => ({})}))
vi.mock('@/composables/useGlobalNow', async () => {
	const {ref} = await import('vue')
	return {useGlobalNow: () => ({now: ref(new Date()), update: vi.fn()})}
})

import {queryClient} from '@/client/queryClient'
import {useProjectCounts} from './projectCounts'
import {useAppBadge} from '@/composables/useAppBadge'
import {useTaskStore} from '@/stores/tasks'

const SidebarCount = defineComponent({
	setup() {
		const counts = useProjectCounts()
		return () => h('span', {class: 'sidebar-count'}, String(counts.getForProject(1)?.dueOverdue ?? 0))
	},
})

const TodayBadge = defineComponent({
	setup() {
		const {todayTotal} = useProjectCounts()
		useAppBadge()
		return () => h('span', {class: 'today-count'}, String(todayTotal.value))
	},
})

describe('project counts seam', () => {
	const setAppBadge = vi.fn().mockResolvedValue(undefined)

	beforeEach(() => {
		setActivePinia(createPinia())
		queryClient.clear()
		getProjectCountsMock.mockReset()
		taskUpdateMock.mockReset()
		setAppBadge.mockClear()
		Object.defineProperty(navigator, 'setAppBadge', {value: setAppBadge, configurable: true})
	})

	afterEach(() => {
		queryClient.clear()
	})

	it('refreshes the sidebar count, Today count and app badge together after a task update', async () => {
		getProjectCountsMock.mockResolvedValueOnce({1: {open: 3, dueOverdue: 2}})
		const sidebar = mount(SidebarCount)
		const today = mount(TodayBadge)
		await flushPromises()

		expect(sidebar.text()).toBe('2')
		expect(today.text()).toBe('2')
		expect(setAppBadge).toHaveBeenLastCalledWith(2)

		// The task is marked done, so one fewer task is due.
		taskUpdateMock.mockImplementationOnce(async (task: ITask) => task)
		getProjectCountsMock.mockResolvedValueOnce({1: {open: 2, dueOverdue: 1}})
		await useTaskStore().update({id: 1, done: true} as ITask)
		await flushPromises()

		expect(getProjectCountsMock).toHaveBeenCalledTimes(2)
		expect(sidebar.text()).toBe('1')
		expect(today.text()).toBe('1')
		expect(setAppBadge).toHaveBeenLastCalledWith(1)

		sidebar.unmount()
		today.unmount()
	})
})
