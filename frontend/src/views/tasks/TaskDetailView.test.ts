import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {computed, defineComponent, h} from 'vue'
import {mount, flushPromises} from '@vue/test-utils'
import {createPinia, setActivePinia} from 'pinia'
import {createRouter, createWebHistory, useRoute, RouterView, type Router} from 'vue-router'
import {createI18n} from 'vue-i18n'
import en from '@/i18n/lang/en.json'

import {PERMISSIONS} from '@/constants/permissions'

// Regression for F-C: the hidden field-open shortcut buttons (KeyL/P/C/A/M,
// reminders, KeyF/KeyR) used to render unconditionally, so v-shortcut could
// pop open editors on a read-only task even though they were inert on `main`
// (gated behind canWrite there). Full-mounting the real view is the seam that
// matters since the bug is about what actually lands in the DOM.
const getMock = vi.hoisted(() => vi.fn())
vi.mock('@/services/task', () => ({
	default: class {
		loading = false
		get = getMock
	},
}))

// Reactions.vue pulls in vuemoji-picker, which drags a browser-only
// emoji-picker-element import path that vitest/happy-dom can't resolve -
// stub it at the module level so its script never runs.
vi.mock('@/components/input/Reactions.vue', () => ({
	default: {name: 'Reactions', template: '<div />'},
}))

import TaskDetailView from './TaskDetailView.vue'
import {useAuthStore} from '@/stores/auth'
import {useBaseStore} from '@/stores/base'
import {useProjectStore} from '@/stores/projects'
import ProjectModel from '@/models/project'

const i18n = createI18n({legacy: false, locale: 'en', messages: {en}})

function taskFixture(maxPermission: number) {
	return {
		id: 1,
		title: 'Test task',
		projectId: 1,
		maxPermission,
		labels: [],
		assignees: [],
		reminders: [],
		attachments: [],
		relatedTasks: {},
		reactions: {},
		comments: [],
		repeatAfter: {amount: 0, type: 'days'},
		repeatMode: 0,
		percentDone: 0,
		estimatedDuration: 0,
		dueDate: null,
		startDate: null,
		endDate: null,
		deadline: null,
		hexColor: '',
		done: false,
		isFavorite: false,
		subscription: null,
		isUnread: false,
	}
}

// Every mount installs a router that listens on window popstate. Leaving them
// mounted lets a later test's real back navigation drive stale apps into
// rendering against detached DOM.
const mountedWrappers: {unmount: () => void}[] = []

afterEach(() => {
	while (mountedWrappers.length > 0) {
		mountedWrappers.pop()?.unmount()
	}
})

const CHILD_STUBS = {
	Heading: true,
	TaskTitleField: true,
	BucketSelect: true,
	ChecklistSummary: true,
	TaskPropertyChips: true,
	Description: true,
	Reactions: true,
	Attachments: true,
	RelatedTasks: true,
	Comments: true,
	TaskTimeTracking: true,
	CreatedUpdated: true,
	Dropdown: true,
	DropdownItem: true,
	TaskSubscription: true,
	Modal: true,
}

// Only the routes these tests navigate through, plus the two catch-alls - the real
// router's `/:pathMatch(.*)*` means `router.resolve()` never returns an unmatched
// route, so the view's denylist has to see the same 404 names it sees in the app.
const CATCH_ALL_ROUTES = [
	{path: '/:pathMatch(.*)*', name: 'not-found', component: {render: () => null}},
	{path: '/:pathMatch(.*)', name: 'bad-not-found', component: {render: () => null}},
]

async function mountTaskDetail(maxPermission: number, navigation: string[] = ['/']) {
	getMock.mockResolvedValue(taskFixture(maxPermission))

	// Memory history never populates `state.back`, which is exactly what the back
	// button reads - so the router has to run on the real History API here.
	window.history.replaceState(null, '', '/')

	const router = createRouter({
		history: createWebHistory(),
		routes: [
			{path: '/', name: 'home', component: {render: () => null}},
			{path: '/projects/:projectId', name: 'project.index', component: {render: () => null}},
			{path: '/tasks/:id', name: 'task.detail', component: {render: () => null}},
			{path: '/login', name: 'user.login', component: {render: () => null}},
			{path: '/auth/openid/:provider', name: 'openid.auth', component: {render: () => null}},
			...CATCH_ALL_ROUTES,
		],
	})
	for (const path of navigation) {
		await router.push(path)
	}
	await router.isReady()

	const Harness = defineComponent({
		setup() {
			const route = useRoute()
			const taskId = computed(() => Number(route.params.id ?? 1))
			return () => h(TaskDetailView, {taskId: taskId.value})
		},
	})

	const wrapper = mount(Harness, {
		global: {
			plugins: [router, i18n],
			stubs: CHILD_STUBS,
		},
	})
	mountedWrappers.push(wrapper)

	await flushPromises()
	await flushPromises()

	return {wrapper, router}
}

describe('TaskDetailView field-open shortcut buttons (F-C)', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		useAuthStore().setAuthenticated(true)
		getMock.mockReset()
	})

	it('does not render the hidden field-open shortcut buttons when the task is read-only', async () => {
		const {wrapper} = await mountTaskDetail(PERMISSIONS.READ)

		expect(wrapper.find('button[tabindex="-1"]').exists()).toBe(false)
	})

	it('renders the hidden field-open shortcut buttons when the task is writable', async () => {
		const {wrapper} = await mountTaskDetail(PERMISSIONS.READ_WRITE)

		expect(wrapper.findAll('button[tabindex="-1"]').length).toBeGreaterThan(0)
	})
})

// Spying without an implementation would let happy-dom actually navigate, which
// fires popstate asynchronously - possibly after the test that triggered it.
function spyOnNavigation(router: Router) {
	return {
		back: vi.spyOn(router, 'back').mockImplementation(() => {}),
		push: vi.spyOn(router, 'push').mockImplementation(async () => undefined),
	}
}

describe('TaskDetailView back button', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		useAuthStore().setAuthenticated(true)
		getMock.mockReset()
	})

	it('goes back to the previous in-app view', async () => {
		const {wrapper, router} = await mountTaskDetail(PERMISSIONS.READ_WRITE, ['/', '/tasks/1'])
		const {back, push} = spyOnNavigation(router)

		await wrapper.find('.back-button').trigger('click')

		expect(back).toHaveBeenCalled()
		expect(push).not.toHaveBeenCalled()
	})

	it('goes back after this instance was reused for a second task', async () => {
		const {wrapper, router} = await mountTaskDetail(PERMISSIONS.READ_WRITE, ['/tasks/1'])
		await router.push('/tasks/2')
		await flushPromises()
		const {back, push} = spyOnNavigation(router)

		await wrapper.find('.back-button').trigger('click')

		expect(back).toHaveBeenCalled()
		expect(push).not.toHaveBeenCalled()
	})

	it('pushes the project route when there is no previous history entry', async () => {
		const {wrapper, router} = await mountTaskDetail(PERMISSIONS.READ_WRITE, ['/tasks/1'])
		const {back, push} = spyOnNavigation(router)

		await wrapper.find('.back-button').trigger('click')

		expect(back).not.toHaveBeenCalled()
		expect(push).toHaveBeenCalledWith(expect.objectContaining({name: 'project.index'}))
	})

	it('pushes the project route when the previous history entry is the login page', async () => {
		const {wrapper, router} = await mountTaskDetail(PERMISSIONS.READ_WRITE, ['/login', '/tasks/1'])
		const {back, push} = spyOnNavigation(router)

		await wrapper.find('.back-button').trigger('click')

		expect(back).not.toHaveBeenCalled()
		expect(push).toHaveBeenCalledWith(expect.objectContaining({name: 'project.index'}))
	})

	it('pushes the project route when the previous history entry is an openid callback', async () => {
		const {wrapper, router} = await mountTaskDetail(PERMISSIONS.READ_WRITE, ['/auth/openid/gitlab?code=consumed', '/tasks/1'])
		const {back, push} = spyOnNavigation(router)

		await wrapper.find('.back-button').trigger('click')

		expect(back).not.toHaveBeenCalled()
		expect(push).toHaveBeenCalledWith(expect.objectContaining({name: 'project.index'}))
	})

	it('pushes the project route when the previous history entry only matches the catch-all', async () => {
		const {wrapper, router} = await mountTaskDetail(PERMISSIONS.READ_WRITE, ['/some-garbage-path', '/tasks/1'])
		const {back, push} = spyOnNavigation(router)

		await wrapper.find('.back-button').trigger('click')

		expect(back).not.toHaveBeenCalled()
		expect(push).toHaveBeenCalledWith(expect.objectContaining({name: 'project.index'}))
	})
})

function projectFixture(id: number) {
	return new ProjectModel({id, title: `Project ${id}`})
}

// Rendering through a RouterView is what makes `onBeforeRouteLeave` register:
// it needs the matched-route key RouterView provides, which a plain mount lacks.
async function mountInRouterView(navigation: string[]) {
	getMock.mockResolvedValue(taskFixture(PERMISSIONS.READ_WRITE))

	window.history.replaceState(null, '', '/')

	const router = createRouter({
		history: createWebHistory(),
		routes: [
			{path: '/', name: 'home', component: {render: () => null}},
			{path: '/tasks/today', name: 'tasks.today', component: {render: () => null}},
			{
				path: '/tasks/:id',
				name: 'task.detail',
				component: TaskDetailView,
				props: route => ({taskId: Number(route.params.id)}),
			},
			{path: '/projects/:projectId', name: 'project.index', component: {render: () => null}},
			{path: '/projects/:projectId/:viewId', name: 'project.view', component: {render: () => null}},
			...CATCH_ALL_ROUTES,
		],
	})
	for (const path of navigation) {
		await router.push(path)
	}
	await router.isReady()

	const App = defineComponent({
		setup: () => () => h(RouterView),
	})

	const wrapper = mount(App, {
		global: {
			plugins: [router, i18n],
			stubs: CHILD_STUBS,
		},
	})
	mountedWrappers.push(wrapper)

	await flushPromises()
	await flushPromises()

	return {wrapper, router}
}

// happy-dom fires popstate asynchronously, so the router settles some ticks after
// the call - poll instead of guessing a tick count.
async function goBackAndSettle(router: Router, expectedPath: string) {
	router.back()

	for (let i = 0; i < 100 && router.currentRoute.value.fullPath !== expectedPath; i++) {
		await new Promise(resolve => setTimeout(resolve, 1))
		await flushPromises()
	}

	expect(router.currentRoute.value.fullPath).toBe(expectedPath)
}

// The base and project stores both call useI18n/useRouter in their setup, so they
// can only be instantiated from inside a component - hence spying after the mount.
function spyOnPreSet() {
	return vi.spyOn(useBaseStore(), 'handleSetCurrentProjectIfNotSet')
		.mockImplementation(async () => {})
}

describe('TaskDetailView leave guard', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		useAuthStore().setAuthenticated(true)
		getMock.mockReset()
	})

	it('does not pre-set the current project when going back to a non-project view', async () => {
		const {router} = await mountInRouterView(['/tasks/today', '/tasks/1'])
		useProjectStore().setProject(projectFixture(1))
		const preSet = spyOnPreSet()

		await goBackAndSettle(router, '/tasks/today')

		expect(preSet).not.toHaveBeenCalled()
	})

	it('pre-sets the destination project, not the history entry before it', async () => {
		const {router} = await mountInRouterView(['/projects/2/20', '/projects/1/10', '/tasks/1'])
		const projectStore = useProjectStore()
		projectStore.setProject(projectFixture(1))
		projectStore.setProject(projectFixture(2))
		const preSet = spyOnPreSet()

		await goBackAndSettle(router, '/projects/1/10')

		expect(preSet).toHaveBeenCalledWith(expect.objectContaining({id: 1}))
	})

	it('does not pre-set anything when the destination project is not in the store', async () => {
		const {router} = await mountInRouterView(['/projects/1/10', '/tasks/1'])
		const preSet = spyOnPreSet()

		await goBackAndSettle(router, '/projects/1/10')

		expect(preSet).not.toHaveBeenCalled()
	})
})
