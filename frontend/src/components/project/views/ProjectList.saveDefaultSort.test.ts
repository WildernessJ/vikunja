import {describe, it, expect, vi, beforeEach} from 'vitest'
import {defineComponent, h} from 'vue'
import {mount, flushPromises} from '@vue/test-utils'
import {createPinia, setActivePinia} from 'pinia'
import {createRouter, createMemoryHistory, type Router} from 'vue-router'
import {createI18n} from 'vue-i18n'
import en from '@/i18n/lang/en.json'

// Full-mount ProjectList (real pinia stores, real router, real useTaskList) rather than
// unit-testing saveDefaultSort in isolation: the bug this guards against (#70) is in the
// interaction between the SortPopup emit order and the `sortBy` URL setter in
// useTaskList, so the seam that matters is the real reactive wiring, not the function body.
const successMock = vi.hoisted(() => vi.fn())
const errorMock = vi.hoisted(() => vi.fn())
vi.mock('@/message', () => ({
	success: successMock,
	error: errorMock,
}))

const updateMock = vi.hoisted(() => vi.fn())
vi.mock('@/services/projectViews', () => ({
	default: class {
		update = updateMock
	},
}))

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
import {useAuthStore} from '@/stores/auth'
import {useProjectStore} from '@/stores/projects'
import {useBaseStore} from '@/stores/base'
import {PERMISSIONS as Permissions} from '@/constants/permissions'
import ProjectModel from '@/models/project'
import ProjectViewModel from '@/models/projectView'

const VIEW = new ProjectViewModel({
	id: 1,
	projectId: 1,
	title: 'List',
	viewKind: 'list',
	defaultSortBy: ['priority'],
	defaultOrderBy: ['desc'],
})

const PROJECT = new ProjectModel({
	id: 1,
	title: 'Test project',
	maxPermission: Permissions.ADMIN,
	views: [VIEW],
})

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

	// useBaseStore/useProjectStore call useI18n() at store-setup time, which needs an
	// active component instance — seed them from a wrapper's setup (runs before the
	// child's) rather than calling the store composables at the top level of the test.
	const Harness = defineComponent({
		setup() {
			useProjectStore().setProject(new ProjectModel(PROJECT))
			useBaseStore().setCurrentProject(new ProjectModel(PROJECT))
			return () => h(ProjectList, {
				isLoadingProject: false,
				projectId: 1,
				viewId: 1,
			})
		},
	})

	const wrapper = mount(Harness, {
		global: {
			plugins: [router, i18n],
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
		useAuthStore().setAuthenticated(true)
		getAll.mockClear()
		updateMock.mockReset()
		successMock.mockClear()
		errorMock.mockClear()
	})

	it('persists the new default, updates the store, toasts success, and clears the redundant ?sort= param', async () => {
		const updatedView = new ProjectViewModel({...VIEW, defaultSortBy: ['title'], defaultOrderBy: ['asc']})
		updateMock.mockResolvedValue(updatedView)

		const {wrapper, router} = await mountProjectList()

		await wrapper.find('.save-default-sort').trigger('click')
		await flushPromises()

		expect(updateMock).toHaveBeenCalledOnce()
		const sentView = updateMock.mock.calls[0][0]
		expect(sentView.defaultSortBy).toEqual(['title'])
		expect(sentView.defaultOrderBy).toEqual(['asc'])

		expect(useProjectStore().projects[1].views[0].defaultSortBy).toEqual(['title'])
		expect(successMock).toHaveBeenCalledOnce()
		expect(errorMock).not.toHaveBeenCalled()

		// The setter re-ran now that the persisted default matches the applied sort,
		// so serializeSortBy dropped the now-redundant `?sort=` param.
		expect(router.currentRoute.value.query.sort).toBeUndefined()
	})

	it('toasts an error and does not update the store when the persist call rejects', async () => {
		updateMock.mockRejectedValue(new Error('nope'))

		const {wrapper} = await mountProjectList()

		await wrapper.find('.save-default-sort').trigger('click')
		await flushPromises()

		expect(updateMock).toHaveBeenCalledOnce()
		expect(errorMock).toHaveBeenCalledOnce()
		expect(successMock).not.toHaveBeenCalled()
		expect(useProjectStore().projects[1].views[0].defaultSortBy).toEqual(['priority'])
	})
})
