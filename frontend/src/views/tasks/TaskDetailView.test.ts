import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {computed, defineComponent, h} from 'vue'
import {mount, flushPromises} from '@vue/test-utils'
import {createPinia, setActivePinia} from 'pinia'
import {createRouter, createWebHistory, useRoute, RouterView, type Router} from 'vue-router'
import {createI18n} from 'vue-i18n'
import en from '@/i18n/lang/en.json'

import {PERMISSIONS} from '@/constants/permissions'
import {LINK_SHARE_HASH_PREFIX} from '@/constants/linkShareHash'

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
// route, so a garbage back path has to carry the same `returnability` it does in the
// app. Which real routes carry it is covered in `src/router/index.test.ts`.
const NON_RETURNABLE = {returnability: 'no'} as const
const NON_RETURNABLE_BUT_RESTORED = {returnability: 'no-but-restore'} as const

const CATCH_ALL_ROUTES = [
	{path: '/:pathMatch(.*)*', name: 'not-found', component: {render: () => null}, meta: NON_RETURNABLE},
	{path: '/:pathMatch(.*)', name: 'bad-not-found', component: {render: () => null}, meta: NON_RETURNABLE},
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
			{path: '/login', name: 'user.login', component: {render: () => null}, meta: NON_RETURNABLE},
			{path: '/auth/openid/:provider', name: 'openid.auth', component: {render: () => null}, meta: NON_RETURNABLE},
			{path: '/migrate/:service', name: 'migrate.service', component: {render: () => null}, meta: NON_RETURNABLE_BUT_RESTORED},
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

	// `'no-but-restore'` differs from `'no'` only in what the auth guard restores after a login;
	// both are equally off limits to the back button, whose code is spent by the time we return.
	it('pushes the project route when the previous history entry is a migration callback', async () => {
		const {wrapper, router} = await mountTaskDetail(PERMISSIONS.READ_WRITE, ['/migrate/trello?code=one-shot', '/tasks/1'])
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
// `seedProjectIds` are put in the store from the wrapping component's setup, the
// only place they can land before the view's first task load runs.
async function mountInRouterView(navigation: string[], seedProjectIds: number[] = []) {
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
			{path: '/projects/:parentProjectId/new', name: 'project.createFromParent', component: {render: () => null}},
			{path: '/projects/:projectId/activity', name: 'project.activity', component: {render: () => null}},
			{path: '/projects/:projectId/:viewId', name: 'project.view', component: {render: () => null}},
			...CATCH_ALL_ROUTES,
		],
	})
	for (const path of navigation) {
		await router.push(path)
	}
	await router.isReady()

	const App = defineComponent({
		setup() {
			const projectStore = useProjectStore()
			seedProjectIds.forEach(id => projectStore.setProject(projectFixture(id)))
			return () => h(RouterView)
		},
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

describe('TaskDetailView current project on load', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		useAuthStore().setAuthenticated(true)
		getMock.mockReset()
	})

	it('sets the current project from the project view the task was opened from', async () => {
		await mountInRouterView(['/projects/7/70', '/tasks/1'], [7])

		expect(useBaseStore().currentProject?.id).toBe(7)
	})

	// The create-project route names its param parentProjectId, so a plain projectId read
	// silently loses the highlight for a task opened from that form.
	it('sets the current project from the parent of a project create form', async () => {
		await mountInRouterView(['/projects/5/new', '/tasks/1'], [5])

		expect(useBaseStore().currentProject?.id).toBe(5)
	})

	it('does not re-apply that project when the reused instance loads a task opened from elsewhere', async () => {
		const {router} = await mountInRouterView(['/projects/7/70', '/tasks/1'], [7])
		const preSet = spyOnPreSet()

		await router.push('/tasks/2')
		await flushPromises()

		expect(preSet).not.toHaveBeenCalled()
	})

	// #77 as the user hits it. The spy above cannot see this: the pre-set short-circuits on id
	// equality, so the stale value only becomes visible once the current project has moved on
	// from the one cached at mount - which is what changing a task's project does.
	it('does not overwrite a project set since, when the reused instance loads another task', async () => {
		const {router} = await mountInRouterView(['/projects/7/70', '/tasks/1'], [7, 9])
		useBaseStore().setCurrentProject(projectFixture(9))

		await router.push('/tasks/2')
		await flushPromises()

		expect(useBaseStore().currentProject?.id).toBe(9)
	})
})

const BREADCRUMB_LINK = 'nav[aria-label="Breadcrumb"] a'

describe('TaskDetailView breadcrumb', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		useAuthStore().setAuthenticated(true)
		getMock.mockReset()
	})

	it('stays a real link pointing at the project', async () => {
		const {wrapper} = await mountInRouterView(['/projects/1/10', '/tasks/1'], [1])

		expect(wrapper.find(BREADCRUMB_LINK).attributes('href')).toBe('/projects/1')
	})

	it('goes back when the previous entry is a view of that project', async () => {
		const {wrapper, router} = await mountInRouterView(['/projects/1/10', '/tasks/1'], [1])
		const {back, push} = spyOnNavigation(router)

		await wrapper.find(BREADCRUMB_LINK).trigger('click')

		expect(back).toHaveBeenCalled()
		expect(push).not.toHaveBeenCalled()
	})

	it('pushes the project route when the reused instance came from another task', async () => {
		const {wrapper, router} = await mountInRouterView(['/projects/1/10', '/tasks/1'], [1])
		await router.push('/tasks/2')
		await flushPromises()
		const {back, push} = spyOnNavigation(router)

		await wrapper.find(BREADCRUMB_LINK).trigger('click')

		expect(back).not.toHaveBeenCalled()
		expect(push).toHaveBeenCalledWith(expect.objectContaining({name: 'project.index'}))
	})

	it('pushes the project route when the previous entry belongs to a different project', async () => {
		const {wrapper, router} = await mountInRouterView(['/projects/2/20', '/tasks/1'], [1])
		const {back, push} = spyOnNavigation(router)

		await wrapper.find(BREADCRUMB_LINK).trigger('click')

		expect(back).not.toHaveBeenCalled()
		expect(push).toHaveBeenCalledWith(expect.objectContaining({name: 'project.index'}))
	})

	// These carry the same projectId but are not what the crumb's href points at, so popping
	// would drop the user somewhere the link never advertised.
	it.each([
		'/projects/1/activity',
		'/projects/1/new',
	])('pushes the project route when the previous entry is %s', async previous => {
		const {wrapper, router} = await mountInRouterView([previous, '/tasks/1'], [1])
		const {back, push} = spyOnNavigation(router)

		await wrapper.find(BREADCRUMB_LINK).trigger('click')

		expect(back).not.toHaveBeenCalled()
		expect(push).toHaveBeenCalledWith(expect.objectContaining({name: 'project.index'}))
	})

	// Link share JWTs live in memory only, so a crumb opened in a new tab without the hash
	// dead-ends at /login.
	it('keeps the link share hash on the link', async () => {
		const hash = `${LINK_SHARE_HASH_PREFIX}abc123`
		const {wrapper} = await mountInRouterView(['/projects/1/10', `/tasks/1${hash}`], [1])

		expect(wrapper.find(BREADCRUMB_LINK).attributes('href')).toBe(`/projects/1${hash}`)
	})

	// vue-router's own guardEvent treats a cancelled click as "not ours", so navigate() no-ops -
	// popping history on the same event would navigate a click the page already called off.
	it('does not go back when an ancestor already cancelled the click', async () => {
		const {wrapper, router} = await mountInRouterView(['/projects/1/10', '/tasks/1'], [1])
		const {back, push} = spyOnNavigation(router)
		const link = wrapper.find(BREADCRUMB_LINK)
		// Capture phase on an ancestor, so it runs before the crumb's own handler - a listener on
		// the anchor itself would be queued behind the one Vue bound there first.
		link.element.parentElement?.addEventListener('click', event => event.preventDefault(), true)

		await link.trigger('click')

		expect(back).not.toHaveBeenCalled()
		expect(push).not.toHaveBeenCalled()
	})
})
