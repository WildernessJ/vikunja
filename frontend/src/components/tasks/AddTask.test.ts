import {describe, it, expect, vi, beforeEach} from 'vitest'
import {mount, flushPromises} from '@vue/test-utils'

const createNewTaskMock = vi.fn()
const ensureLabelsExistMock = vi.fn().mockResolvedValue(undefined)
const findProjectIdMock = vi.fn()

vi.mock('@/stores/tasks', () => ({
	useTaskStore: () => ({
		isLoading: false,
		ensureLabelsExist: ensureLabelsExistMock,
		findProjectId: findProjectIdMock,
		createNewTask: createNewTaskMock,
	}),
}))

vi.mock('@/stores/auth', () => ({
	useAuthStore: () => ({
		settings: {
			defaultProjectId: 1,
			frontendSettings: {
				quickAddMagicMode: 'disabled',
				quickAddDefaultReminders: false,
			},
		},
	}),
}))

vi.mock('vue-router', () => ({
	useRouter: () => ({
		currentRoute: {value: {params: {}}},
	}),
}))

vi.mock('vue-i18n', () => ({
	useI18n: () => ({t: (key: string) => key}),
	createI18n: () => ({
		global: {t: (key: string) => key},
	}),
}))

import AddTask from './AddTask.vue'

function mountAddTask() {
	return mount(AddTask, {
		global: {
			mocks: {$t: (key: string) => key},
			directives: {focus: {}},
			stubs: {
				QuickAddMagic: true,
				Expandable: true,
				Icon: true,
				XButton: true,
			},
		},
	})
}

describe('AddTask double-submit guard', () => {
	beforeEach(() => {
		createNewTaskMock.mockReset().mockImplementation(async ({title}: {title: string}) => ({id: 1, title}))
		ensureLabelsExistMock.mockClear()
		findProjectIdMock.mockReset()
	})

	it('creates only one task when Enter is pressed twice within the debounce window', async () => {
		const wrapper = mountAddTask()
		const textarea = wrapper.find('textarea')
		await textarea.setValue('Buy milk')

		// Two synchronous Enter presses before any async work settles: the store loading
		// flag is debounced 100ms, so only a synchronous guard prevents the double create.
		textarea.trigger('keydown.enter')
		textarea.trigger('keydown.enter')

		await flushPromises()

		expect(createNewTaskMock).toHaveBeenCalledTimes(1)
	})

	it('allows a new submission once the previous one has settled', async () => {
		const wrapper = mountAddTask()
		const textarea = wrapper.find('textarea')

		await textarea.setValue('First task')
		textarea.trigger('keydown.enter')
		await flushPromises()

		await textarea.setValue('Second task')
		textarea.trigger('keydown.enter')
		await flushPromises()

		expect(createNewTaskMock).toHaveBeenCalledTimes(2)
	})
})
