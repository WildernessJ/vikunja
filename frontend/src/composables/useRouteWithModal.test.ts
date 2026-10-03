import {describe, it, expect, vi, afterEach} from 'vitest'
import {defineComponent, h} from 'vue'
import {mount} from '@vue/test-utils'
import {createRouter, createWebHistory} from 'vue-router'

const baseStore = vi.hoisted(() => ({currentProjectId: 0}))
vi.mock('@/stores/base', () => ({useBaseStore: () => baseStore}))
vi.mock('@/composables/useProjects', () => ({useProjects: () => ({projects: {}})}))

import {useRouteWithModal} from './useRouteWithModal'

const mountedWrappers: {unmount: () => void}[] = []

afterEach(() => {
	while (mountedWrappers.length > 0) {
		mountedWrappers.pop()?.unmount()
	}
})

// `closeModal` reads `state.back` and `state.backdropView`, which only the real History API
// populates - memory history leaves `back` empty.
async function setup({navigation, currentProjectId, state = {}}: {
	navigation: string[],
	currentProjectId: number,
	state?: Record<string, unknown>,
}) {
	baseStore.currentProjectId = currentProjectId
	window.history.replaceState(null, '', '/')

	const empty = {render: () => null}
	const router = createRouter({
		history: createWebHistory(),
		routes: [
			{path: '/', name: 'home', component: empty},
			{path: '/projects/:projectId', name: 'project.index', component: empty},
			{path: '/projects/:projectId/:viewId', name: 'project.view', component: empty},
			{path: '/tasks/:id', name: 'task.detail', component: empty},
			{path: '/:pathMatch(.*)*', name: 'not-found', component: empty},
		],
	})
	for (const path of navigation) {
		await router.push(path)
	}
	await router.isReady()
	window.history.replaceState({...window.history.state, ...state}, '')

	let closeModal!: () => void
	const wrapper = mount(defineComponent({
		setup() {
			closeModal = useRouteWithModal().closeModal
			return () => h('div')
		},
	}), {global: {plugins: [router]}})
	mountedWrappers.push(wrapper)

	const push = vi.spyOn(router, 'push').mockResolvedValue(undefined)
	const back = vi.spyOn(router, 'back').mockImplementation(() => {})
	return {closeModal, push, back}
}

describe('useRouteWithModal closeModal', () => {
	it('opens the current project on the back entry\'s view, with the backdrop\'s query', async () => {
		const {closeModal, push, back} = await setup({
			navigation: ['/projects/5/10', '/tasks/1'],
			currentProjectId: 7,
			state: {backdropView: '/projects/5/10?dateFrom=2026-10-01'},
		})

		closeModal()

		expect(back).not.toHaveBeenCalled()
		expect(push).toHaveBeenCalledWith({
			name: 'project.view',
			params: {projectId: 7, viewId: '10'},
			query: {dateFrom: '2026-10-01'},
		})
	})

	it('goes back when no project is current', async () => {
		const {closeModal, push, back} = await setup({navigation: ['/projects/5/10', '/tasks/1'], currentProjectId: 0})

		closeModal()

		expect(back).toHaveBeenCalledOnce()
		expect(push).not.toHaveBeenCalled()
	})

	it.each([
		['a saved filter', '/projects/-2/5'],
		['a non-numeric view id', '/projects/5/abc'],
		['a non-project route', '/tasks/2'],
	])('goes back when the back entry is %s', async (_, backPath) => {
		const {closeModal, push, back} = await setup({navigation: [backPath, '/tasks/1'], currentProjectId: 7})

		closeModal()

		expect(back).toHaveBeenCalledOnce()
		expect(push).not.toHaveBeenCalled()
	})

	it('opens the backdrop when there is no back entry', async () => {
		const {closeModal, push, back} = await setup({
			navigation: ['/tasks/1'],
			currentProjectId: 7,
			state: {back: null, backdropView: '/projects/5/10'},
		})

		closeModal()

		expect(back).not.toHaveBeenCalled()
		expect(push).toHaveBeenCalledWith(expect.objectContaining({
			name: 'project.view',
			params: {projectId: '5', viewId: '10'},
		}))
	})

	it('opens the current project when there is no back entry and no backdrop', async () => {
		const {closeModal, push} = await setup({navigation: ['/tasks/1'], currentProjectId: 7, state: {back: null}})

		closeModal()

		expect(push).toHaveBeenCalledWith({name: 'project.index', params: {projectId: 7}})
	})

	it('goes home when there is no back entry, no backdrop and no current project', async () => {
		const {closeModal, push} = await setup({navigation: ['/tasks/1'], currentProjectId: 0, state: {back: null}})

		closeModal()

		expect(push).toHaveBeenCalledWith({name: 'home'})
	})
})
