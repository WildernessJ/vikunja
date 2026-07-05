import {beforeEach, describe, expect, it, vi} from 'vitest'
import {mount} from '@vue/test-utils'
import type {IUser} from '@/modelTypes/IUser'

const projectGetAllMock = vi.fn()

vi.mock('@/services/projectUsers', () => ({
	default: class {
		loading = false
		getAll(...args: unknown[]) {
			return projectGetAllMock(...args)
		}
	},
}))

vi.mock('@/stores/auth', () => ({
	useAuthStore: () => ({info: {id: 1}}),
}))

vi.mock('@/stores/tasks', () => ({
	useTaskStore: () => ({
		addAssignee: vi.fn(() => Promise.resolve()),
		removeAssignee: vi.fn(() => Promise.resolve()),
	}),
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

function user(id: number, name: string): IUser {
	return {id, name, username: name} as IUser
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
		projectGetAllMock.mockReset()
		projectGetAllMock.mockResolvedValue([])
	})

	it('resets the preloaded members when the project changes', async () => {
		const wrapper = mountComponent({taskId: 1, projectId: 10})
		const ms = wrapper.findComponent(MultiselectStub)

		projectGetAllMock.mockResolvedValueOnce([user(2, 'Alice')])
		await ms.vm.$emit('focus')
		await Promise.resolve()
		await Promise.resolve()
		expect(ms.props('searchResults')).toEqual([user(2, 'Alice')])

		await wrapper.setProps({projectId: 20})
		expect(ms.props('searchResults')).toEqual([])

		// hasPreloaded was reset too, so focusing again refetches for the new project.
		projectGetAllMock.mockResolvedValueOnce([user(3, 'Bob')])
		await ms.vm.$emit('focus')
		await Promise.resolve()
		await Promise.resolve()
		expect(projectGetAllMock).toHaveBeenLastCalledWith({projectId: 20}, {s: ''})
		expect(ms.props('searchResults')).toEqual([user(3, 'Bob')])
	})

	it('keeps members and does not refetch when only the task changes within a project', async () => {
		const wrapper = mountComponent({taskId: 1, projectId: 10})
		const ms = wrapper.findComponent(MultiselectStub)

		projectGetAllMock.mockResolvedValueOnce([user(2, 'Alice')])
		await ms.vm.$emit('focus')
		await Promise.resolve()
		await Promise.resolve()
		expect(ms.props('searchResults')).toEqual([user(2, 'Alice')])

		const callsBefore = projectGetAllMock.mock.calls.length
		await wrapper.setProps({taskId: 2})
		expect(ms.props('searchResults')).toEqual([user(2, 'Alice')])

		// hasPreloaded stays set, so re-focusing does not trigger another fetch.
		await ms.vm.$emit('focus')
		await Promise.resolve()
		expect(projectGetAllMock.mock.calls.length).toBe(callsBefore)
	})

	it('drops a stale findUser response after the project changed mid-flight', async () => {
		const wrapper = mountComponent({taskId: 1, projectId: 10})
		const ms = wrapper.findComponent(MultiselectStub)

		const stale = deferred<IUser[]>()
		projectGetAllMock.mockReturnValueOnce(stale.promise)

		await ms.vm.$emit('search', '')

		// Navigate to another project before the in-flight request resolves.
		await wrapper.setProps({projectId: 20})
		expect(ms.props('searchResults')).toEqual([])

		// The stale response for project 10 resolves last and must be dropped.
		stale.resolve([user(2, 'Alice')])
		await stale.promise
		await Promise.resolve()
		expect(ms.props('searchResults')).toEqual([])
	})
})
