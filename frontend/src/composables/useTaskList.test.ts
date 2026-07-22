import {describe, it, expect, beforeEach, vi} from 'vitest'
import {defineComponent, h, nextTick, ref} from 'vue'
import {mount, flushPromises} from '@vue/test-utils'
import {setActivePinia, createPinia} from 'pinia'
import {createRouter, createMemoryHistory, type Router} from 'vue-router'

const getAll = vi.fn(async (..._args: unknown[]) => [])
vi.mock('@/services/taskCollection', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/taskCollection')>()
	return {
		...actual,
		default: class {
			loading = false
			totalPages = 1
			getAll = getAll
		},
	}
})

import {useTaskList, buildStoredQuery, defaultSortToSortBy, sortByToDefaultArrays} from './useTaskList'
import {useAuthStore} from '@/stores/auth'

describe('buildStoredQuery', () => {
	it('includes sort when set', () => {
		expect(buildStoredQuery({sort: 'due_date:asc', filter: undefined, s: undefined, page: 1}))
			.toEqual({sort: 'due_date:asc'})
	})

	it('includes filter and search when set', () => {
		expect(buildStoredQuery({sort: undefined, filter: 'done = false', s: 'foo', page: 1}))
			.toEqual({filter: 'done = false', s: 'foo'})
	})

	it('omits page when it equals the default of 1', () => {
		expect(buildStoredQuery({sort: 'id:desc', filter: undefined, s: undefined, page: 1}))
			.toEqual({sort: 'id:desc'})
	})

	it('includes page when greater than 1', () => {
		expect(buildStoredQuery({sort: undefined, filter: undefined, s: undefined, page: 3}))
			.toEqual({page: '3'})
	})

	it('returns an empty object when nothing is set', () => {
		expect(buildStoredQuery({sort: undefined, filter: undefined, s: undefined, page: 1}))
			.toEqual({})
	})

	it('skips empty strings', () => {
		expect(buildStoredQuery({sort: '', filter: '', s: '', page: 1}))
			.toEqual({})
	})
})

// The second positional argument passed to TaskCollectionService.getAll carries
// the sort_by/order_by the backend uses to decide whether to rank by relevance.
function lastRequestParams(): Record<string, unknown> {
	return getAll.mock.calls.at(-1)?.[1] as Record<string, unknown>
}

async function mountTaskList(
	query: Record<string, string>,
	sortByDefault?: Parameters<typeof useTaskList>[2],
): Promise<Router> {
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [{path: '/', name: 'home', component: {render: () => null}}],
	})
	await router.push({path: '/', query})
	await router.isReady()

	const TestComponent = defineComponent({
		setup() {
			useTaskList(() => 1, () => 1, sortByDefault)
			return () => h('div')
		},
	})

	mount(TestComponent, {global: {plugins: [router]}})
	await flushPromises()
	await nextTick()
	return router
}

describe('useTaskList sort handling for relevance ranking', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		// loadTasks refuses to fetch for a logged-out session (issue #44 follow-up)
		useAuthStore().setAuthenticated(true)
		getAll.mockClear()
	})

	it('omits the sort while searching with the default sort so the backend ranks by relevance', async () => {
		await mountTaskList({s: 'find me'})

		const params = lastRequestParams()
		expect(params.s).toBe('find me')
		expect(params.sort_by).toEqual([])
		expect(params.order_by).toEqual([])
	})

	it('keeps an explicit user sort while searching so the user sort is respected', async () => {
		await mountTaskList({s: 'find me', sort: 'title:asc'})

		const params = lastRequestParams()
		expect(params.s).toBe('find me')
		expect(params.sort_by).toEqual(['title'])
		expect(params.order_by).toEqual(['asc'])
	})

	it('sends the default sort when not searching', async () => {
		await mountTaskList({})

		const params = lastRequestParams()
		expect(params.s).toBe('')
		expect(params.sort_by).not.toHaveLength(0)
		// id always sorts last so other sort columns take precedence.
		expect(params.sort_by).toEqual(['id'])
		expect(params.order_by).toEqual(['desc'])
	})
})

describe('defaultSortToSortBy', () => {
	it('zips parallel sort_by/order_by arrays into a SortBy record', () => {
		expect(defaultSortToSortBy(['priority'], ['desc'])).toEqual({priority: 'desc'})
	})

	it('zips multiple fields in order', () => {
		expect(defaultSortToSortBy(['priority', 'title'], ['desc', 'asc']))
			.toEqual({priority: 'desc', title: 'asc'})
	})

	it('returns undefined for an empty sort_by array', () => {
		expect(defaultSortToSortBy([], [])).toBeUndefined()
	})

	it('returns undefined when sort_by is missing entirely', () => {
		expect(defaultSortToSortBy(undefined as unknown as string[], [])).toBeUndefined()
	})

	it('skips fields with no matching order (mismatched array lengths)', () => {
		expect(defaultSortToSortBy(['priority', 'title'], ['desc'])).toEqual({priority: 'desc'})
	})

	it('ignores unknown sort fields', () => {
		expect(defaultSortToSortBy(['not_a_real_field'], ['asc'])).toBeUndefined()
	})
})

describe('sortByToDefaultArrays', () => {
	it('splits a SortBy record into parallel arrays', () => {
		expect(sortByToDefaultArrays({priority: 'desc', title: 'asc'}))
			.toEqual({sortBy: ['priority', 'title'], orderBy: ['desc', 'asc']})
	})

	it('returns empty arrays for an empty SortBy', () => {
		expect(sortByToDefaultArrays({})).toEqual({sortBy: [], orderBy: []})
	})
})

describe('useTaskList sortByDefault precedence (persisted default vs URL sort)', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		useAuthStore().setAuthenticated(true)
		getAll.mockClear()
	})

	it('applies the persisted default when the URL has no explicit sort', async () => {
		await mountTaskList({}, {priority: 'desc'})

		const params = lastRequestParams()
		expect(params.sort_by).toEqual(['priority'])
		expect(params.order_by).toEqual(['desc'])
	})

	it('lets an explicit URL sort override the persisted default', async () => {
		await mountTaskList({sort: 'title:asc'}, {priority: 'desc'})

		const params = lastRequestParams()
		expect(params.sort_by).toEqual(['title'])
		expect(params.order_by).toEqual(['asc'])
	})

	it('accepts a reactive getter and reflects its current value', async () => {
		await mountTaskList({}, () => ({due_date: 'asc'}))

		const params = lastRequestParams()
		expect(params.sort_by).toEqual(['due_date'])
		expect(params.order_by).toEqual(['asc'])
	})

	it('re-resolves the default sort when the getter result changes (e.g. the view finished loading)', async () => {
		const router = createRouter({
			history: createMemoryHistory(),
			routes: [{path: '/', name: 'home', component: {render: () => null}}],
		})
		await router.push({path: '/'})
		await router.isReady()

		const persistedDefault = ref<import('./useTaskList').SortBy>({})

		const TestComponent = defineComponent({
			setup() {
				useTaskList(() => 1, () => 1, () => persistedDefault.value)
				return () => h('div')
			},
		})

		mount(TestComponent, {global: {plugins: [router]}})
		await flushPromises()
		await nextTick()

		expect(lastRequestParams().sort_by).toEqual([])

		persistedDefault.value = {priority: 'desc'}
		await flushPromises()
		await nextTick()

		const params = lastRequestParams()
		expect(params.sort_by).toEqual(['priority'])
		expect(params.order_by).toEqual(['desc'])
	})
})
