import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {mount, flushPromises} from '@vue/test-utils'

const searchProjectMock = vi.fn()
const filterLabelsByQueryMock = vi.fn()
const getLabelsByExactTitlesMock = vi.fn().mockReturnValue([])
const getAllAssigneesMock = vi.fn().mockResolvedValue([])

const website = {id: 1, title: 'Website'}
const urgentLabel = {id: 9, title: 'urgent', hexColor: 'ff0000'}

vi.mock('@/stores/projects', () => ({
	useProjectStore: () => ({
		projects: {1: website},
		searchProject: searchProjectMock,
	}),
}))

vi.mock('@/stores/labels', () => ({
	useLabelStore: () => ({
		labels: {9: urgentLabel},
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

const errorMock = vi.hoisted(() => vi.fn())
vi.mock('@/message', () => ({
	error: errorMock,
}))

import {PrefixMode} from '@/modules/quickAddMagic'
import TaskTitleField from './TaskTitleField.vue'

// Each mount registers its own window 'beforeunload' listener (F-B); track every
// instance so it can be unmounted after its test, otherwise stale listeners from
// earlier tests fire (and pollute) later tests' beforeunload assertions.
const mountedWrappers: ReturnType<typeof mount>[] = []

afterEach(() => {
	mountedWrappers.splice(0).forEach(w => w.unmount())
})

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
	mountedWrappers.push(wrapper)

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
		errorMock.mockReset()
	})

	afterEach(() => {
		document.body.innerHTML = ''
	})

	it('applies the project and strips the token in a single save, with no trailing literal save (F2)', async () => {
		searchProjectMock.mockReturnValue([website])
		const {wrapper, onAcceptProject, onSaveLiteralTitle} = mountField()

		await typeAndPlaceCaretAtEnd(wrapper, 'Ship it +Web')
		const item = wrapper.find('.qac-autocomplete-item')
		await item.trigger('pointerdown')
		await wrapper.find('textarea').trigger('blur')
		await item.trigger('click')
		await flushPromises()

		expect(onAcceptProject).toHaveBeenCalledTimes(1)
		expect(onAcceptProject).toHaveBeenCalledWith(website, 'Ship it')
		expect(onSaveLiteralTitle).not.toHaveBeenCalled()
		expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('Ship it')
	})

	it('offers a priority dropdown for the "!" token and applies + strips in a single save (F2)', async () => {
		const {wrapper, onAcceptPriority, onSaveLiteralTitle} = mountField()

		await typeAndPlaceCaretAtEnd(wrapper, 'Ship it !2')

		expect(wrapper.text()).toContain('task.priority.medium')

		const item = wrapper.find('.qac-autocomplete-item')
		await item.trigger('pointerdown')
		await wrapper.find('textarea').trigger('blur')
		await item.trigger('click')
		await flushPromises()

		expect(onAcceptPriority).toHaveBeenCalledTimes(1)
		expect(onAcceptPriority).toHaveBeenCalledWith(2, 'Ship it')
		expect(onSaveLiteralTitle).not.toHaveBeenCalled()
	})

	it('applies a label via addLabel and still does exactly one literal-title save to persist the strip', async () => {
		filterLabelsByQueryMock.mockReturnValue([urgentLabel])
		getLabelsByExactTitlesMock.mockReturnValue([])
		const {wrapper, onAcceptLabel, onSaveLiteralTitle} = mountField({modelValue: 'Ship it'})

		await typeAndPlaceCaretAtEnd(wrapper, 'Ship it *urg')
		const item = wrapper.find('.qac-autocomplete-item')
		await item.trigger('pointerdown')
		await wrapper.find('textarea').trigger('blur')
		await item.trigger('click')
		await flushPromises()

		expect(onAcceptLabel).toHaveBeenCalledTimes(1)
		expect(onAcceptLabel).toHaveBeenCalledWith(urgentLabel)
		expect(onSaveLiteralTitle).toHaveBeenCalledTimes(1)
		expect(onSaveLiteralTitle).toHaveBeenCalledWith('Ship it')
	})

	it('(F1c) clicking a real dropdown item saves exactly once - the pointerdown-triggered blur does not also literal-save', async () => {
		searchProjectMock.mockReturnValue([website])
		const {wrapper, onAcceptProject, onSaveLiteralTitle} = mountField()

		await typeAndPlaceCaretAtEnd(wrapper, 'Ship it +Web')
		const item = wrapper.find('.qac-autocomplete-item')

		// Reproduces the real browser order: pointerdown steals focus (blur
		// fires) before the click that actually selects the item.
		await item.trigger('pointerdown')
		await wrapper.find('textarea').trigger('blur')
		await item.trigger('click')
		await flushPromises()

		expect(onAcceptProject).toHaveBeenCalledTimes(1)
		expect(onSaveLiteralTitle).not.toHaveBeenCalled()
	})

	it('(F1a) saves the literal title verbatim on blur even while the dropdown is still open on an unmatched token', async () => {
		const {wrapper, onSaveLiteralTitle, onAcceptAssignee} = mountField({modelValue: 'Buy milk'})

		// "@store" has no closing space, so the assignee token (and its empty
		// results dropdown) stays open right up to the end of the text - the
		// exact shape of the bug: an unmatched trailing token.
		await typeAndPlaceCaretAtEnd(wrapper, 'Buy milk @store')
		expect(wrapper.find('.task-title-autocomplete-wrapper').exists()).toBe(true)

		// Click-away: no pointerdown lands inside the dropdown wrapper.
		await wrapper.find('textarea').trigger('blur')
		await flushPromises()

		expect(onSaveLiteralTitle).toHaveBeenCalledWith('Buy milk @store')
		expect(onAcceptAssignee).not.toHaveBeenCalled()
	})

	it('(F1b) saves the literal title verbatim on Tab-out while the dropdown is still open', async () => {
		const {wrapper, onSaveLiteralTitle} = mountField({modelValue: 'Buy milk'})

		await typeAndPlaceCaretAtEnd(wrapper, 'Buy milk @store')
		expect(wrapper.find('.task-title-autocomplete-wrapper').exists()).toBe(true)

		// Tab isn't special-cased in onKeydown, so it falls through to the
		// browser's native tab-away, which blurs the textarea.
		await wrapper.find('textarea').trigger('keydown', {code: 'Tab'})
		await wrapper.find('textarea').trigger('blur')
		await flushPromises()

		expect(onSaveLiteralTitle).toHaveBeenCalledWith('Buy milk @store')
	})

	it('saves the literal title verbatim on blur when nothing was accepted and the dropdown is closed', async () => {
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

	// Regression for F-D (1): the old Heading.save() told the user why an empty
	// title was reverted instead of failing silently.
	it('(F-D) shows a titleRequired error when the title is cleared on blur', async () => {
		const {wrapper} = mountField({modelValue: 'Buy milk'})

		await typeAndPlaceCaretAtEnd(wrapper, '   ')
		await wrapper.find('textarea').trigger('blur')
		await flushPromises()

		expect(errorMock).toHaveBeenCalledWith({message: 'task.detail.titleRequired'})
	})

	// Regression for F-D (2): onSelect used to strip the token and save the
	// literal title even when the store lookup for the accepted project/label
	// missed, silently losing the property while still consuming the token.
	it('(F-D) aborts the accept without stripping or saving when the project store lookup misses', async () => {
		searchProjectMock.mockReturnValue([{id: 404, title: 'Ghost'}])
		const {wrapper, onAcceptProject, onSaveLiteralTitle} = mountField()

		await typeAndPlaceCaretAtEnd(wrapper, 'Ship it +Ghost')
		const item = wrapper.find('.qac-autocomplete-item')
		await item.trigger('pointerdown')
		await item.trigger('click')
		await flushPromises()

		expect(onAcceptProject).not.toHaveBeenCalled()
		expect(onSaveLiteralTitle).not.toHaveBeenCalled()
		expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('Ship it +Ghost')
	})

	it('(F-D) aborts the accept without stripping or saving when the label store lookup misses', async () => {
		filterLabelsByQueryMock.mockReturnValue([{id: 404, title: 'ghost', hexColor: '000000'}])
		getLabelsByExactTitlesMock.mockReturnValue([])
		const {wrapper, onAcceptLabel, onSaveLiteralTitle} = mountField({modelValue: 'Ship it'})

		await typeAndPlaceCaretAtEnd(wrapper, 'Ship it *ghost')
		const item = wrapper.find('.qac-autocomplete-item')
		await item.trigger('pointerdown')
		await item.trigger('click')
		await flushPromises()

		expect(onAcceptLabel).not.toHaveBeenCalled()
		expect(onSaveLiteralTitle).not.toHaveBeenCalled()
		expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('Ship it *ghost')
	})
})

// Regression for F-B: the old Heading.vue warned on tab-close/refresh with an
// unsaved title edit; the redesign dropped it.
describe('TaskTitleField beforeunload guard (F-B)', () => {
	beforeEach(() => {
		searchProjectMock.mockReset().mockReturnValue([])
		filterLabelsByQueryMock.mockReset().mockReturnValue([])
		getLabelsByExactTitlesMock.mockReset().mockReturnValue([])
		getAllAssigneesMock.mockReset().mockResolvedValue([])
		errorMock.mockReset()
	})

	afterEach(() => {
		document.body.innerHTML = ''
	})

	function dispatchBeforeUnload() {
		const event = new Event('beforeunload', {cancelable: true})
		window.dispatchEvent(event)
		return event
	}

	it('signals the browser when there is an unsaved title edit', async () => {
		const {wrapper} = mountField({modelValue: 'Buy milk'})

		await wrapper.find('textarea').setValue('Buy milk and eggs')

		const event = dispatchBeforeUnload()

		expect(event.defaultPrevented).toBe(true)
	})

	it('is a no-op when the title has no unsaved changes', async () => {
		const {wrapper} = mountField({modelValue: 'Buy milk'})
		// Sanity: the textarea reflects modelValue, so it's clean.
		expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('Buy milk')

		const event = dispatchBeforeUnload()

		expect(event.defaultPrevented).toBe(false)
	})
})
