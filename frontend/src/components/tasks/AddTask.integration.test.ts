import {describe, it, expect, vi, beforeEach} from 'vitest'
import {mount, flushPromises} from '@vue/test-utils'
import {createPinia, setActivePinia} from 'pinia'

// Only the service (HTTP) layer is mocked here - useTaskStore and useLabelStore run for
// real, so the AddTask -> createNewTask -> addLabelsToTask -> ensureLabelsExist chain
// actually executes, unlike AddTask.test.ts (mocks the whole tasks store) or
// tasks.createNewTask.test.ts (calls the store directly, bypassing AddTask's overrides).

const errorMock = vi.hoisted(() => vi.fn())
vi.mock('@/message', () => ({
	error: errorMock,
	success: vi.fn(),
	translate: (key: string, params: Record<string, unknown>) => `${key}:${JSON.stringify(params)}`,
}))

const taskCreateMock = vi.hoisted(() => vi.fn())
vi.mock('@/services/task', () => ({
	default: class {
		create = taskCreateMock
		getAll = vi.fn().mockResolvedValue([])
	},
}))

const labelCreateMock = vi.hoisted(() => vi.fn())
vi.mock('@/services/label', () => ({
	default: class {
		create = labelCreateMock
	},
}))

const labelTaskCreateMock = vi.hoisted(() => vi.fn())
vi.mock('@/services/labelTask', () => ({
	default: class {
		create = labelTaskCreateMock
	},
}))

vi.mock('@/services/taskRelation', () => ({
	default: class {
		create = vi.fn().mockResolvedValue({})
	},
}))

vi.mock('@/router', () => ({
	default: {
		currentRoute: {value: {params: {}}},
	},
}))

vi.mock('vue-router', () => ({
	useRouter: () => ({
		currentRoute: {value: {params: {}}},
	}),
}))

vi.mock('vue-i18n', () => ({
	useI18n: () => ({t: (key: string) => key}),
	createI18n: () => ({global: {t: (key: string) => key}}),
}))

vi.mock('@/stores/auth', () => ({
	useAuthStore: () => ({
		settings: {
			defaultProjectId: 1,
			frontendSettings: {
				quickAddMagicMode: 'vikunja',
				quickAddDefaultReminders: false,
			},
		},
	}),
}))

vi.mock('@/stores/projects', () => ({
	useProjectStore: () => ({
		projects: {},
		findProjectByExactname: vi.fn().mockReturnValue(null),
		findProjectByIdentifier: vi.fn().mockReturnValue(null),
	}),
}))

vi.mock('@/stores/base', () => ({useBaseStore: () => ({})}))
vi.mock('@/stores/kanban', () => ({useKanbanStore: () => ({})}))
vi.mock('@/stores/projectCounts', () => ({useProjectCountsStore: () => ({loadCounts: vi.fn().mockResolvedValue(undefined)})}))
vi.mock('@/stores/config', () => ({useConfigStore: () => ({concurrentWrites: true})}))

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

describe('AddTask integration - real task/label store chain (#57)', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		errorMock.mockClear()
		taskCreateMock.mockReset().mockImplementation(async task => task)
		labelCreateMock.mockReset()
		labelTaskCreateMock.mockReset().mockResolvedValue({})
	})

	it('single task: label create rejects - toasts once, task is still created, label is not attached', async () => {
		labelCreateMock.mockRejectedValue(new Error('link shares may not create labels'))

		const wrapper = mountAddTask()
		const textarea = wrapper.find('textarea')

		await textarea.setValue('Buy milk *groceries')
		textarea.trigger('keydown.enter')
		await flushPromises()

		expect(errorMock).toHaveBeenCalledOnce()
		expect(taskCreateMock).toHaveBeenCalledOnce()
		expect(labelTaskCreateMock).not.toHaveBeenCalled()
	})

	it('single task: label create succeeds - no toast, label attached, created exactly once', async () => {
		labelCreateMock.mockImplementation(async label => ({...label, id: 99}))

		const wrapper = mountAddTask()
		const textarea = wrapper.find('textarea')

		await textarea.setValue('Buy milk *groceries')
		textarea.trigger('keydown.enter')
		await flushPromises()

		expect(errorMock).not.toHaveBeenCalled()
		expect(labelCreateMock).toHaveBeenCalledOnce()
		expect(labelTaskCreateMock).toHaveBeenCalledOnce()
	})

	it('multi-line: two tasks sharing one failing label - toasts exactly once total, not once per task', async () => {
		labelCreateMock.mockRejectedValue(new Error('link shares may not create labels'))

		const wrapper = mountAddTask()
		const textarea = wrapper.find('textarea')

		await textarea.setValue('Buy milk *groceries\nWalk dog *groceries')
		textarea.trigger('keydown.enter')
		await flushPromises()

		expect(taskCreateMock).toHaveBeenCalledTimes(2)
		expect(errorMock).toHaveBeenCalledOnce()
		expect(labelTaskCreateMock).not.toHaveBeenCalled()
	})
})
