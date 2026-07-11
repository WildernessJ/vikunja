import {beforeEach, describe, expect, it, vi} from 'vitest'
import {ref} from 'vue'

const getAllMock = vi.fn()

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

// Mutable so a test can flip authentication and re-mount the composable.
const authStoreMock = {authenticated: true, settings: {timezone: 'utc'}, info: {id: 1}}
vi.mock('@/stores/auth', () => ({
	useAuthStore: () => authStoreMock,
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

describe('useTaskList does not fetch when logged out (issue #44 follow-up)', () => {
	beforeEach(() => {
		getAllMock.mockReset().mockResolvedValue([])
		authStoreMock.authenticated = true
	})

	it('skips loadTasks when the user is not authenticated', async () => {
		authStoreMock.authenticated = false
		const {loadTasks} = useTaskList(() => 1, () => 1)

		// The immediate setup watcher must not have fired a request either.
		expect(getAllMock).not.toHaveBeenCalled()

		const result = await loadTasks()

		expect(getAllMock).not.toHaveBeenCalled()
		expect(result).toEqual([])
	})

	it('still loads when authenticated', async () => {
		const {loadTasks} = useTaskList(() => 1, () => 1)
		await loadTasks()

		expect(getAllMock).toHaveBeenCalled()
	})
})
