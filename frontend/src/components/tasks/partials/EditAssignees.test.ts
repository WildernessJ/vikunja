import {beforeEach, describe, expect, it, vi} from 'vitest'
import {flushPromises, mount} from '@vue/test-utils'
import {VueQueryPlugin} from '@tanstack/vue-query'
import type {User} from '@/client/generated'
import {queryClient} from '@/client/queryClient'

// (projectId, query) => Promise<User[]>
const projectGetAllMock = vi.fn()

vi.mock('@/client/generated', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/client/generated')>()
	return {
		...actual,
		projectsUsersSearch: async ({path, query}: {path: {project: number}, query: {q: string}}) =>
			({data: {items: await projectGetAllMock(path.project, query.q)}}),
	}
})

vi.mock('@/stores/auth', () => ({
	useAuthStore: () => ({info: {id: 1}}),
}))

vi.mock('@/client/queries/taskMutations', () => ({
	useAddTaskAssigneeMutation: () => ({isPending: {value: false}, mutateAsync: vi.fn(() => Promise.resolve())}),
	useRemoveTaskAssigneeMutation: () => ({isPending: {value: false}, mutateAsync: vi.fn(() => Promise.resolve())}),
}))

vi.mock('vue-i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('vue-i18n')>()
	return {
		...actual,
		useI18n: () => ({t: (key: string) => key}),
	}
})

vi.mock('@/message', () => ({
	success: vi.fn(),
}))

import EditAssignees from './EditAssignees.vue'

const MultiselectStub = {
	name: 'Multiselect',
	props: ['searchResults', 'modelValue', 'loading'],
	emits: ['search', 'select', 'focus', 'update:modelValue'],
	template: '<div />',
}

function user(id: number, name: string): User {
	return {id, name, username: name}
}

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return {promise, resolve}
}

function mountComponent(props: {taskId: number, projectId: number}) {
	return mount(EditAssignees, {
		props: {
			modelValue: [],
			...props,
		},
		global: {
			plugins: [[VueQueryPlugin, {queryClient}]],
			mocks: {
				$t: (key: string) => key,
			},
			stubs: {
				Multiselect: MultiselectStub,
				User: true,
				AssigneeList: true,
			},
		},
	})
}

describe('EditAssignees', () => {
	beforeEach(() => {
		queryClient.clear()
		projectGetAllMock.mockReset()
		projectGetAllMock.mockResolvedValue([])
	})

	it('emits update:modelValue after removing an assignee', async () => {
		const ItemsMultiselectStub = {
			name: 'Multiselect',
			props: ['searchResults', 'modelValue', 'loading'],
			emits: ['search', 'select', 'focus', 'update:modelValue'],
			template: '<div><slot name="items" :items="modelValue" /></div>',
		}

		const wrapper = mount(EditAssignees, {
			props: {
				modelValue: [user(2, 'Alice')],
				taskId: 1,
				projectId: 10,
			},
			global: {
				plugins: [[VueQueryPlugin, {queryClient}]],
				mocks: {
					$t: (key: string) => key,
				},
				stubs: {
					Multiselect: ItemsMultiselectStub,
					User: true,
					AssigneeList: true,
				},
			},
		})

		const assigneeList = wrapper.findComponent({name: 'AssigneeList'})
		await assigneeList.vm.$emit('remove', user(2, 'Alice'))
		await flushPromises()

		expect(wrapper.emitted('update:modelValue')).toBeDefined()
		const lastEmit = wrapper.emitted('update:modelValue')!.at(-1)
		expect(lastEmit![0]).toEqual([])
	})

	it('resets the preloaded members when the project changes', async () => {
		const wrapper = mountComponent({taskId: 1, projectId: 10})
		const ms = wrapper.findComponent(MultiselectStub)

		projectGetAllMock.mockResolvedValueOnce([user(2, 'Alice')])
		await ms.vm.$emit('focus')
		await flushPromises()
		expect(ms.props('searchResults')).toEqual([user(2, 'Alice')])

		// The search is keyed by project, so the new project's members are fetched, never shown stale.
		projectGetAllMock.mockResolvedValueOnce([user(3, 'Bob')])
		await wrapper.setProps({projectId: 20})
		expect(ms.props('searchResults')).toEqual([])
		await flushPromises()
		expect(projectGetAllMock).toHaveBeenLastCalledWith(20, '')
		expect(ms.props('searchResults')).toEqual([user(3, 'Bob')])
	})

	it('keeps members and does not refetch when only the task changes within a project', async () => {
		const wrapper = mountComponent({taskId: 1, projectId: 10})
		const ms = wrapper.findComponent(MultiselectStub)

		projectGetAllMock.mockResolvedValueOnce([user(2, 'Alice')])
		await ms.vm.$emit('focus')
		await flushPromises()
		expect(ms.props('searchResults')).toEqual([user(2, 'Alice')])

		const callsBefore = projectGetAllMock.mock.calls.length
		await wrapper.setProps({taskId: 2})
		expect(ms.props('searchResults')).toEqual([user(2, 'Alice')])

		// Same project and query, so re-focusing serves the cached result without another fetch.
		await ms.vm.$emit('focus')
		await flushPromises()
		expect(projectGetAllMock.mock.calls.length).toBe(callsBefore)
	})

	it('drops a stale findUser response after the project changed mid-flight', async () => {
		const wrapper = mountComponent({taskId: 1, projectId: 10})
		const ms = wrapper.findComponent(MultiselectStub)

		const stale = deferred<User[]>()
		projectGetAllMock.mockReturnValueOnce(stale.promise)

		await ms.vm.$emit('search', '')

		// Navigate to another project before the in-flight request resolves.
		await wrapper.setProps({projectId: 20})
		expect(ms.props('searchResults')).toEqual([])

		// The stale response for project 10 resolves last and must be dropped.
		stale.resolve([user(2, 'Alice')])
		await stale.promise
		await flushPromises()
		expect(ms.props('searchResults')).toEqual([])
	})
})
