import {beforeEach, describe, expect, it, vi} from 'vitest'
import {ref} from 'vue'
import type {ITask} from '@/modelTypes/ITask'

const getAllMock = vi.fn()
let serviceInstance: {totalPages: number}

vi.mock('vue-router', () => ({
	useRouter: () => ({
		replace: vi.fn(() => Promise.resolve()),
		currentRoute: {value: {query: {}}},
	}),
	isNavigationFailure: () => false,
}))

vi.mock('@vueuse/router', () => ({
	useRouteQuery: (_key: string, def?: unknown) => ref(def),
}))

vi.mock('@/message', () => ({
	error: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
	useAuthStore: () => ({
		settings: {timezone: 'utc'},
		info: {id: 1},
	}),
}))

vi.mock('@/stores/viewFilters', () => ({
	useViewFiltersStore: () => ({
		getViewQuery: () => ({}),
		setViewQuery: vi.fn(),
		clearViewQuery: vi.fn(),
	}),
}))

vi.mock('@/services/taskCollection', () => ({
	default: class {
		loading = false
		totalPages = 1
		getAll(...args: unknown[]) {
			serviceInstance = this
			return getAllMock(...args)
		}
	},
	getDefaultTaskFilterParams: () => ({
		sort_by: ['position', 'id'],
		order_by: ['asc', 'desc'],
		filter: '',
		filter_include_nulls: false,
		filter_timezone: '',
		s: '',
		expand: 'subtasks',
	}),
}))

import {useTaskList} from './useTaskList'

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return {promise, resolve, reject}
}

function task(id: number): ITask {
	return {id, title: `Task ${id}`} as ITask
}

describe('useTaskList request sequencing', () => {
	beforeEach(() => {
		getAllMock.mockReset()
		// The immediate watcher fires one load during setup; give it something to resolve.
		getAllMock.mockResolvedValue([])
	})

	it('drops a stale response that resolves after a newer one', async () => {
		const {tasks, loadTasks} = useTaskList(() => 1, () => 1)

		const older = deferred<ITask[]>()
		const newer = deferred<ITask[]>()

		getAllMock.mockReturnValueOnce(older.promise)
		const olderLoad = loadTasks()

		getAllMock.mockReturnValueOnce(newer.promise)
		const newerLoad = loadTasks()

		// The newer request (project switched to) lands first.
		newer.resolve([task(2)])
		await newerLoad
		expect(tasks.value).toEqual([task(2)])

		// The older request resolves last and must NOT overwrite the newer tasks.
		older.resolve([task(1)])
		await olderLoad
		expect(tasks.value).toEqual([task(2)])
	})

	it('applies the latest response when requests resolve in order', async () => {
		const {tasks, loadTasks} = useTaskList(() => 1, () => 1)

		const first = deferred<ITask[]>()
		const second = deferred<ITask[]>()

		getAllMock.mockReturnValueOnce(first.promise)
		const firstLoad = loadTasks()
		first.resolve([task(1)])
		await firstLoad
		expect(tasks.value).toEqual([task(1)])

		getAllMock.mockReturnValueOnce(second.promise)
		const secondLoad = loadTasks()
		second.resolve([task(2)])
		await secondLoad
		expect(tasks.value).toEqual([task(2)])
	})

	it('does not clobber totalPages with a stale response', async () => {
		const {totalPages, loadTasks} = useTaskList(() => 1, () => 1)

		const older = deferred<ITask[]>()
		const newer = deferred<ITask[]>()

		getAllMock.mockReturnValueOnce(older.promise)
		const olderLoad = loadTasks()

		getAllMock.mockReturnValueOnce(newer.promise)
		const newerLoad = loadTasks()

		// The newer request lands first with its own pagination.
		serviceInstance.totalPages = 7
		newer.resolve([task(2)])
		await newerLoad
		expect(totalPages.value).toBe(7)

		// The older request resolves last: `getAll` already overwrote the shared
		// service's pagination, but the guarded composable state must keep the
		// newest request's page count.
		serviceInstance.totalPages = 3
		older.resolve([task(1)])
		await olderLoad
		expect(totalPages.value).toBe(7)
	})

	it('does not surface an error from a superseded request', async () => {
		const {error} = await import('@/message')
		const {loadTasks} = useTaskList(() => 1, () => 1)

		const older = deferred<ITask[]>()
		const newer = deferred<ITask[]>()

		getAllMock.mockReturnValueOnce(older.promise)
		const olderLoad = loadTasks()

		getAllMock.mockReturnValueOnce(newer.promise)
		const newerLoad = loadTasks()

		newer.resolve([task(2)])
		await newerLoad

		vi.mocked(error).mockClear()
		older.reject(new Error('stale request failed'))
		await olderLoad

		expect(error).not.toHaveBeenCalled()
	})
})
