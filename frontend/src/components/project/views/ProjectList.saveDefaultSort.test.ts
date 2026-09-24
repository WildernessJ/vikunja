import {describe, it, expect, vi, beforeEach} from 'vitest'
import {defineComponent, h} from 'vue'
import {mount, flushPromises} from '@vue/test-utils'
import {createPinia, setActivePinia} from 'pinia'
import {createRouter, createMemoryHistory, type Router} from 'vue-router'
import {createI18n} from 'vue-i18n'
import {VueQueryPlugin} from '@tanstack/vue-query'
import en from '@/i18n/lang/en.json'

// Full-mount ProjectList (real pinia stores, real query cache, real router, real useTaskList) rather than
// unit-testing saveDefaultSort in isolation: the bug this guards against (#70) is in the
// interaction between the SortPopup emit order and the `sortBy` URL setter in
// useTaskList, so the seam that matters is the real reactive wiring, not the function body.
const successMock = vi.hoisted(() => vi.fn())
const errorMock = vi.hoisted(() => vi.fn())
vi.mock('@/message', () => ({
	success: successMock,
	error: errorMock,
	translate: (key: string) => key,
}))

// The server's copy of the project; the detail query refetches it after every view mutation.
const server = vi.hoisted(() => ({project: null as unknown}))
const updateMock = vi.hoisted(() => vi.fn())
vi.mock('@/client/generated', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/client/generated')>()
	return {
		...actual,
		projectViewsUpdate: updateMock,
		projectsRead: async () => ({data: server.project}),
	}
})

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

import ProjectList from './ProjectList.vue'
import type {Project, ProjectView} from '@/client/generated'
import {queryClient} from '@/client/queryClient'
import {getCachedProject, normalizeProject, projectKeys} from '@/client/queries/projects'
import {useAuthStore} from '@/stores/auth'
import {useBaseStore} from '@/stores/base'
import {PERMISSIONS as Permissions} from '@/constants/permissions'

const VIEW: ProjectView = {
	id: 1,
	project_id: 1,
	title: 'List',
	view_kind: 'list',
	default_sort_by: ['priority'],
	default_order_by: ['desc'],
}

const PROJECT: Project = {
	id: 1,
	title: 'Test project',
	max_permission: Permissions.ADMIN,
	views: [VIEW],
}

function cachedView() {
	return getCachedProject(1)?.views[0]
}

const i18n = createI18n({legacy: false, locale: 'en', messages: {en}})

// A minimal stand-in for the real SortPopup: emits update:modelValue then saveDefault,
// matching SortPopup.saveAsDefault's actual emit order (the order the bug depends on).
const SortPopupStub = {
	props: ['modelValue', 'canSaveDefault'],
	emits: ['update:modelValue', 'saveDefault'],
	template: '<button class="save-default-sort" @click="$emit(\'update:modelValue\', {title: \'asc\'}); $emit(\'saveDefault\', {title: \'asc\'})" />',
}

async function mountProjectList(query: Record<string, string> = {}): Promise<{wrapper: ReturnType<typeof mount>, router: Router}> {
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [{path: '/', name: 'home', component: {render: () => null}}],
	})
	await router.push({path: '/', query})
	await router.isReady()

	server.project = PROJECT
	queryClient.setQueryData(projectKeys.detail(1), normalizeProject(PROJECT))
	queryClient.setQueryData(projectKeys.list(), {projects: [normalizeProject(PROJECT)], favoriteProject: null, savedFilterProjects: []})

	// useBaseStore calls useI18n() at store-setup time, which needs an active component
	// instance — seed it from a wrapper's setup (runs before the child's) rather than
	// calling the store composable at the top level of the test.
	const Harness = defineComponent({
		setup() {
			useBaseStore().setCurrentProject({id: 1})
			return () => h(ProjectList, {
				isLoadingProject: false,
				projectId: 1,
				viewId: 1,
			})
		},
	})

	const wrapper = mount(Harness, {
		global: {
			plugins: [router, i18n, [VueQueryPlugin, {queryClient}]],
			stubs: {
				ProjectWrapper: {template: '<div><slot name="header" /><slot name="default" /></div>'},
				SortPopup: SortPopupStub,
				AddTask: true,
				FilterPopup: true,
				SubprojectRollupPopup: true,
				Nothing: true,
				Pagination: true,
			},
		},
	})
	await flushTwice()
	return {wrapper, router}
}

// Two drains settle the mocked async mount (initial load + the follow-up watcher tick).
async function flushTwice() {
	await flushPromises()
	await flushPromises()
}

describe('ProjectList saveDefaultSort (#69, #70)', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		queryClient.clear()
		useAuthStore().setAuthenticated(true)
		getAll.mockClear()
		updateMock.mockReset()
		successMock.mockClear()
		errorMock.mockClear()
	})

	it('persists the new default, updates the cache, toasts success, and clears the redundant ?sort= param', async () => {
		const updatedView: ProjectView = {...VIEW, default_sort_by: ['title'], default_order_by: ['asc']}
		updateMock.mockImplementation(async () => {
			server.project = {...PROJECT, views: [updatedView]}
			return {data: updatedView}
		})

		const {wrapper, router} = await mountProjectList()

		await wrapper.find('.save-default-sort').trigger('click')
		await flushPromises()

		expect(updateMock).toHaveBeenCalledOnce()
		const sent = updateMock.mock.calls[0][0]
		expect(sent.path).toEqual({project: 1, view: 1})
		expect(sent.body.default_sort_by).toEqual(['title'])
		expect(sent.body.default_order_by).toEqual(['asc'])

		expect(cachedView()?.default_sort_by).toEqual(['title'])
		expect(successMock).toHaveBeenCalledOnce()
		expect(errorMock).not.toHaveBeenCalled()

		// The setter re-ran now that the persisted default matches the applied sort,
		// so serializeSortBy dropped the now-redundant `?sort=` param.
		expect(router.currentRoute.value.query.sort).toBeUndefined()
	})

	it('toasts an error and keeps the saved default when the persist call rejects', async () => {
		updateMock.mockRejectedValue(new Error('nope'))

		const {wrapper} = await mountProjectList()

		await wrapper.find('.save-default-sort').trigger('click')
		await flushPromises()

		expect(updateMock).toHaveBeenCalledOnce()
		expect(errorMock).toHaveBeenCalledOnce()
		expect(successMock).not.toHaveBeenCalled()
		expect(cachedView()?.default_sort_by).toEqual(['priority'])
	})
})
