import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {mount, flushPromises} from '@vue/test-utils'

const searchProjectMock = vi.fn()
const filterLabelsByQueryMock = vi.fn()
const getLabelsByExactTitlesMock = vi.fn().mockReturnValue([])
const getAllAssigneesMock = vi.fn().mockResolvedValue([])

const website = {id: 1, title: 'Website'}

vi.mock('@/stores/projects', () => ({
	useProjectStore: () => ({
		projects: {1: website},
		searchProject: searchProjectMock,
	}),
}))

vi.mock('@/stores/labels', () => ({
	useLabelStore: () => ({
		labels: {},
		filterLabelsByQuery: filterLabelsByQueryMock,
		getLabelsByExactTitles: getLabelsByExactTitlesMock,
	}),
}))

vi.mock('@/services/projectUsers', () => ({
	default: class {
		getAll = getAllAssigneesMock
	},
}))

vi.mock('vue-i18n', () => ({
	useI18n: () => ({t: (key: string) => key}),
	createI18n: () => ({
		global: {t: (key: string) => key},
	}),
}))

import {PrefixMode} from '@/modules/quickAddMagic'
import TaskTitleField from './TaskTitleField.vue'

function mountField(overrides: Partial<Record<string, unknown>> = {}) {
	const onSaveLiteralTitle = vi.fn().mockResolvedValue(undefined)
	const onAcceptProject = vi.fn().mockResolvedValue(undefined)
	const onAcceptLabel = vi.fn().mockResolvedValue(undefined)
	const onAcceptAssignee = vi.fn().mockResolvedValue(undefined)
	const onAcceptPriority = vi.fn().mockResolvedValue(undefined)

	const wrapper = mount(TaskTitleField, {
		attachTo: document.body,
		props: {
			modelValue: 'Ship it',
			disabled: false,
			mode: PrefixMode.Default,
			assigneeProjectId: 1,
			onSaveLiteralTitle,
			onAcceptProject,
			onAcceptLabel,
			onAcceptAssignee,
			onAcceptPriority,
			...overrides,
		},
		global: {
			mocks: {$t: (key: string) => key},
			stubs: {
				Icon: true,
			},
		},
	})

	return {wrapper, onSaveLiteralTitle, onAcceptProject, onAcceptLabel, onAcceptAssignee, onAcceptPriority}
}

async function typeAndPlaceCaretAtEnd(wrapper: ReturnType<typeof mountField>['wrapper'], text: string) {
	const el = wrapper.find('textarea').element as HTMLTextAreaElement
	await wrapper.find('textarea').setValue(text)
	el.setSelectionRange(text.length, text.length)
	await wrapper.find('textarea').trigger('input')
	await flushPromises()
}

describe('TaskTitleField', () => {
	beforeEach(() => {
		searchProjectMock.mockReset().mockReturnValue([])
		filterLabelsByQueryMock.mockReset().mockReturnValue([])
		getLabelsByExactTitlesMock.mockReset().mockReturnValue([])
		getAllAssigneesMock.mockReset().mockResolvedValue([])
	})

	afterEach(() => {
		document.body.innerHTML = ''
	})

	it('applies the project and strips the token when a dropdown item is accepted', async () => {
		searchProjectMock.mockReturnValue([website])
		const {wrapper, onAcceptProject, onSaveLiteralTitle} = mountField()

		await typeAndPlaceCaretAtEnd(wrapper, 'Ship it +Web')
		await wrapper.find('.qac-autocomplete-item').trigger('click')
		await flushPromises()

		expect(onAcceptProject).toHaveBeenCalledWith(website)
		expect(onSaveLiteralTitle).toHaveBeenCalledWith('Ship it')
		expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('Ship it')
	})

	it('offers a priority dropdown for the "!" token and applies + strips on accept', async () => {
		const {wrapper, onAcceptPriority, onSaveLiteralTitle} = mountField()

		await typeAndPlaceCaretAtEnd(wrapper, 'Ship it !2')

		expect(wrapper.text()).toContain('task.priority.medium')

		await wrapper.find('.qac-autocomplete-item').trigger('click')
		await flushPromises()

		expect(onAcceptPriority).toHaveBeenCalledWith(2)
		expect(onSaveLiteralTitle).toHaveBeenCalledWith('Ship it')
	})

	it('saves the literal title verbatim on blur when nothing was accepted', async () => {
		const {wrapper, onSaveLiteralTitle, onAcceptAssignee} = mountField({modelValue: 'Buy milk'})

		await typeAndPlaceCaretAtEnd(wrapper, 'Buy milk @ the store')
		await wrapper.find('textarea').trigger('blur')
		await flushPromises()

		expect(onSaveLiteralTitle).toHaveBeenCalledWith('Buy milk @ the store')
		expect(onAcceptAssignee).not.toHaveBeenCalled()
	})

	it('reverts an empty title on blur instead of saving it', async () => {
		const {wrapper, onSaveLiteralTitle} = mountField({modelValue: 'Buy milk'})

		await typeAndPlaceCaretAtEnd(wrapper, '   ')
		await wrapper.find('textarea').trigger('blur')
		await flushPromises()

		expect(onSaveLiteralTitle).not.toHaveBeenCalled()
		expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('Buy milk')
	})
})
