import {describe, it, expect, vi, beforeEach} from 'vitest'
import {mount, flushPromises} from '@vue/test-utils'

const createNewTaskMock = vi.fn()
const ensureLabelsExistMock = vi.fn().mockResolvedValue([])
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

vi.mock('@/stores/projects', () => ({
	useProjectStore: () => ({
		projects: {},
	}),
}))

vi.mock('@/services/task', () => ({
	default: class {
		getAll = vi.fn().mockResolvedValue([])
	},
}))

vi.mock('@/services/taskRelation', () => ({
	default: class {
		create = vi.fn().mockResolvedValue({})
	},
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
				ProjectSearch: true,
				EditLabels: true,
				PrioritySelect: true,
				PriorityLabel: true,
				Datepicker: true,
				SimpleButton: true,
				BaseButton: true,
				CustomTransition: true,
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

describe('AddTask chip state', () => {
	beforeEach(() => {
		createNewTaskMock.mockReset().mockImplementation(async ({title}: {title: string}) => ({id: 1, title}))
		ensureLabelsExistMock.mockClear()
		findProjectIdMock.mockReset()
	})

	it('shows the multiline hint and hides chips once more than one task is detected', async () => {
		const wrapper = mountAddTask()
		const textarea = wrapper.find('textarea')

		await textarea.setValue('First task\nSecond task')

		expect(wrapper.find('.qac-multiline-hint').exists()).toBe(true)
		expect(wrapper.find('.qac-chip-row').exists()).toBe(false)
	})

	it('shows chips and the description field for single-line input', async () => {
		const wrapper = mountAddTask()
		const textarea = wrapper.find('textarea')

		await textarea.setValue('Buy milk')

		expect(wrapper.find('.qac-multiline-hint').exists()).toBe(false)
		expect(wrapper.find('.qac-chip-row').exists()).toBe(true)
		expect(wrapper.find('.qac-description').exists()).toBe(true)
	})

	it('passes chip overrides through to createNewTask on submit for a single-line task', async () => {
		const wrapper = mountAddTask()
		const textarea = wrapper.find('textarea')

		await textarea.setValue('Buy milk')
		textarea.trigger('keydown.enter')
		await flushPromises()

		expect(createNewTaskMock).toHaveBeenCalledTimes(1)
		const [, overrides] = createNewTaskMock.mock.calls[0]
		expect(overrides).toEqual({})
	})

	it('does not pass composer overrides through for a multiline (multi-task) submission', async () => {
		const wrapper = mountAddTask()
		const textarea = wrapper.find('textarea')

		await textarea.setValue('First task\nSecond task')
		textarea.trigger('keydown.enter')
		await flushPromises()

		expect(createNewTaskMock).toHaveBeenCalledTimes(2)
		for (const call of createNewTaskMock.mock.calls) {
			expect(call[1]).toBeUndefined()
		}
	})

	it('shows a clear button in multiline mode that resets the title', async () => {
		const wrapper = mountAddTask()
		const textarea = wrapper.find('textarea')

		await textarea.setValue('First task\nSecond task')

		const clearButton = wrapper.find('.qac-actions-multiline .qac-clear-button')
		expect(clearButton.exists()).toBe(true)

		await clearButton.trigger('click')

		expect((textarea.element as HTMLTextAreaElement).value).toBe('')
	})
})
