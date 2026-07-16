import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {mount, flushPromises} from '@vue/test-utils'

const createNewTaskMock = vi.fn()
const ensureLabelsExistMock = vi.fn().mockResolvedValue(undefined)
const findProjectIdMock = vi.fn()
const searchProjectMock = vi.fn()
const findProjectByExactnameMock = vi.fn().mockReturnValue(null)
const filterLabelsByQueryMock = vi.fn()
const getLabelsByExactTitlesMock = vi.fn().mockReturnValue([])
const getAllAssigneesMock = vi.fn().mockResolvedValue([])

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
				quickAddMagicMode: 'vikunja',
				quickAddDefaultReminders: false,
			},
		},
	}),
}))

vi.mock('@/stores/projects', () => ({
	useProjectStore: () => ({
		projects: {},
		searchProject: searchProjectMock,
		findProjectByExactname: findProjectByExactnameMock,
	}),
}))

vi.mock('@/stores/labels', () => ({
	useLabelStore: () => ({
		filterLabelsByQuery: filterLabelsByQueryMock,
		getLabelsByExactTitles: getLabelsByExactTitlesMock,
	}),
}))

vi.mock('@/services/projectUsers', () => ({
	default: class {
		getAll = getAllAssigneesMock
	},
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
		attachTo: document.body,
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

function keydown(key: string, code = key) {
	return new KeyboardEvent('keydown', {key, code, bubbles: true, cancelable: true})
}

async function typeAndPlaceCaretAtEnd(textarea: ReturnType<typeof mountAddTask>['vm']['$el'], wrapper: ReturnType<typeof mountAddTask>, text: string) {
	const el = wrapper.find('textarea').element as HTMLTextAreaElement
	await wrapper.find('textarea').setValue(text)
	el.setSelectionRange(text.length, text.length)
	await wrapper.find('textarea').trigger('input')
	await flushPromises()
}

describe('AddTask quick-add autocomplete', () => {
	beforeEach(() => {
		createNewTaskMock.mockReset().mockImplementation(async ({title}: {title: string}) => ({id: 1, title}))
		ensureLabelsExistMock.mockClear()
		findProjectIdMock.mockReset()
		searchProjectMock.mockReset().mockReturnValue([])
		findProjectByExactnameMock.mockReset().mockReturnValue(null)
		filterLabelsByQueryMock.mockReset().mockReturnValue([])
		getLabelsByExactTitlesMock.mockReset().mockReturnValue([])
		getAllAssigneesMock.mockReset().mockResolvedValue([])
	})

	afterEach(() => {
		document.body.innerHTML = ''
	})

	it('opens the dropdown with matching projects while typing a project token', async () => {
		searchProjectMock.mockReturnValue([{id: 1, title: 'MyProject'}])
		const wrapper = mountAddTask()

		await typeAndPlaceCaretAtEnd(null, wrapper, '+MyProj')

		expect(wrapper.find('.qac-autocomplete-wrapper').exists()).toBe(true)
		expect(wrapper.text()).toContain('MyProject')
	})

	it('inserts the highlighted item on ArrowDown + Enter, without submitting the task', async () => {
		searchProjectMock.mockReturnValue([
			{id: 1, title: 'ProjectOne'},
			{id: 2, title: 'ProjectTwo'},
		])
		const wrapper = mountAddTask()
		await typeAndPlaceCaretAtEnd(null, wrapper, '+Project')

		const textarea = wrapper.find('textarea')
		await textarea.element.dispatchEvent(keydown('ArrowDown'))
		await textarea.element.dispatchEvent(keydown('Enter'))
		await flushPromises()

		expect((textarea.element as HTMLTextAreaElement).value).toBe('+ProjectTwo ')
		expect(createNewTaskMock).not.toHaveBeenCalled()
	})

	it('does not submit or insert a newline when Enter is pressed while the dropdown is open', async () => {
		searchProjectMock.mockReturnValue([{id: 1, title: 'ProjectOne'}])
		const wrapper = mountAddTask()
		await typeAndPlaceCaretAtEnd(null, wrapper, '+Project')

		const textarea = wrapper.find('textarea')
		await textarea.element.dispatchEvent(keydown('Enter'))
		await flushPromises()

		expect(createNewTaskMock).not.toHaveBeenCalled()
		expect((textarea.element as HTMLTextAreaElement).value).not.toContain('\n')
	})

	it('closes the dropdown on Escape without inserting or submitting', async () => {
		searchProjectMock.mockReturnValue([{id: 1, title: 'ProjectOne'}])
		const wrapper = mountAddTask()
		await typeAndPlaceCaretAtEnd(null, wrapper, '+Project')

		expect(wrapper.find('.qac-autocomplete-wrapper').exists()).toBe(true)

		const textarea = wrapper.find('textarea')
		await textarea.element.dispatchEvent(keydown('Escape'))
		await flushPromises()

		expect(wrapper.find('.qac-autocomplete-wrapper').exists()).toBe(false)
		expect((textarea.element as HTMLTextAreaElement).value).toBe('+Project')
		expect(createNewTaskMock).not.toHaveBeenCalled()
	})

	it('scopes assignee suggestions to a typed +project, not just the route/default', async () => {
		vi.useFakeTimers()
		try {
			findProjectByExactnameMock.mockReturnValue({id: 42, title: 'Work'})
			getAllAssigneesMock.mockResolvedValue([])
			const wrapper = mountAddTask()

			await typeAndPlaceCaretAtEnd(null, wrapper, '+Work @a')
			await vi.advanceTimersByTimeAsync(300)

			expect(findProjectByExactnameMock).toHaveBeenCalledWith('Work')
			expect(getAllAssigneesMock).toHaveBeenCalledWith({projectId: 42}, {s: 'a'})
		} finally {
			vi.useRealTimers()
		}
	})

	it('does not open the dropdown for multiline input', async () => {
		searchProjectMock.mockReturnValue([{id: 1, title: 'ProjectOne'}])
		const wrapper = mountAddTask()

		await typeAndPlaceCaretAtEnd(null, wrapper, 'first task\n+Project')

		expect(wrapper.find('.qac-autocomplete-wrapper').exists()).toBe(false)
	})

	it('closes the dropdown when clicking outside of it', async () => {
		searchProjectMock.mockReturnValue([{id: 1, title: 'ProjectOne'}])
		const wrapper = mountAddTask()
		await typeAndPlaceCaretAtEnd(null, wrapper, '+Project')
		expect(wrapper.find('.qac-autocomplete-wrapper').exists()).toBe(true)

		document.body.dispatchEvent(new MouseEvent('click', {bubbles: true}))
		await flushPromises()

		expect(wrapper.find('.qac-autocomplete-wrapper').exists()).toBe(false)
	})

	it('still selects an item on click instead of treating it as an outside click', async () => {
		searchProjectMock.mockReturnValue([{id: 1, title: 'ProjectOne'}])
		const wrapper = mountAddTask()
		await typeAndPlaceCaretAtEnd(null, wrapper, '+Project')

		await wrapper.find('.qac-autocomplete-item').trigger('click')
		await flushPromises()

		const textarea = wrapper.find('textarea')
		expect((textarea.element as HTMLTextAreaElement).value).toBe('+ProjectOne ')
	})

	it('does not throw when unmounted while the dropdown is open', async () => {
		searchProjectMock.mockReturnValue([{id: 1, title: 'ProjectOne'}])
		const wrapper = mountAddTask()
		await typeAndPlaceCaretAtEnd(null, wrapper, '+Project')

		expect(() => wrapper.unmount()).not.toThrow()
	})
})
