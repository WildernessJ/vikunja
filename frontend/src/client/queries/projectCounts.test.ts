import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {defineComponent, h} from 'vue'
import {flushPromises, mount} from '@vue/test-utils'
import {createPinia, setActivePinia} from 'pinia'
import {VueQueryPlugin} from '@tanstack/vue-query'

const {getProjectCountsMock, sdk} = vi.hoisted(() => ({
	getProjectCountsMock: vi.fn(),
	sdk: {
		patchTasksRead: vi.fn(),
		tasksCreate: vi.fn(),
		tasksDelete: vi.fn(),
		taskBucketUpdate: vi.fn(),
	},
}))

vi.mock('@/services/projectCounts', () => ({getProjectCounts: getProjectCountsMock}))
vi.mock('@/client/generated', () => sdk)
vi.mock('@/stores/auth', () => ({
	useAuthStore: () => ({authUser: {id: 1}, settings: {timezone: 'UTC'}}),
}))
vi.mock('@/composables/useGlobalNow', async () => {
	const {ref} = await import('vue')
	return {useGlobalNow: () => ({now: ref(new Date()), update: vi.fn()})}
})

import {queryClient} from '@/client/queryClient'
import {useProjectCounts} from './projectCounts'
import {useAppBadge} from '@/composables/useAppBadge'
import {
	createTaskMutationOptions,
	deleteTaskMutationOptions,
	moveTaskMutationOptions,
	updateTaskMutationOptions,
} from './taskMutations'

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

// Runs a mutation through the shared client exactly like a component's useMutation would.
function run<TInput>(options: {mutationFn?: unknown}, input: TInput) {
	return queryClient.getMutationCache().build(queryClient, options as never).execute(input as never)
}

const TASK = {id: 1, title: 'Task', project_id: 1, done: true}

describe('project counts seam', () => {
	const setAppBadge = vi.fn().mockResolvedValue(undefined)

	beforeEach(() => {
		setActivePinia(createPinia())
		queryClient.clear()
		getProjectCountsMock.mockReset()
		Object.values(sdk).forEach(mock => mock.mockReset())
		setAppBadge.mockClear()
		Object.defineProperty(navigator, 'setAppBadge', {value: setAppBadge, configurable: true})
	})

	afterEach(() => {
		queryClient.clear()
	})

	it.each([
		['update', () => run(updateTaskMutationOptions(), TASK)],
		['create', () => run(createTaskMutationOptions(), {title: 'New', project_id: 1})],
		['delete', () => run(deleteTaskMutationOptions(), 1)],
		['bucket move', () => run(moveTaskMutationOptions(), {project: 1, view: 1, bucket: 2, task: TASK})],
	])('refreshes the sidebar count, Today count and app badge together after a task %s', async (_label, mutate) => {
		getProjectCountsMock.mockResolvedValueOnce({1: {open: 3, dueOverdue: 2}})
		const sidebar = mount(SidebarCount, {global: {plugins: [[VueQueryPlugin, {queryClient}]]}})
		const today = mount(TodayBadge, {global: {plugins: [[VueQueryPlugin, {queryClient}]]}})
		await flushPromises()

		expect(sidebar.text()).toBe('2')
		expect(today.text()).toBe('2')
		expect(setAppBadge).toHaveBeenLastCalledWith(2)

		sdk.patchTasksRead.mockResolvedValue({data: TASK})
		sdk.tasksCreate.mockResolvedValue({data: {...TASK, id: 2, done: false}})
		sdk.tasksDelete.mockResolvedValue({data: {}})
		sdk.taskBucketUpdate.mockResolvedValue({data: {bucket_id: 2, task: TASK}})
		getProjectCountsMock.mockResolvedValueOnce({1: {open: 2, dueOverdue: 1}})
		await mutate()
		await flushPromises()

		expect(getProjectCountsMock).toHaveBeenCalledTimes(2)
		expect(sidebar.text()).toBe('1')
		expect(today.text()).toBe('1')
		expect(setAppBadge).toHaveBeenLastCalledWith(1)

		sidebar.unmount()
		today.unmount()
	})
})
