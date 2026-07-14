import {beforeEach, describe, expect, it, vi} from 'vitest'
import {mount} from '@vue/test-utils'
import type {ILabel} from '@/modelTypes/ILabel'

const createLabelMock = vi.fn()
const addLabelMock = vi.fn(() => Promise.resolve())

vi.mock('@/stores/labels', () => ({
	useLabelStore: () => ({
		labels: {},
		isLoading: false,
		filterLabelsByQuery: (labels: ILabel[]) => labels,
		createLabel: (label: ILabel) => createLabelMock(label),
	}),
}))

vi.mock('@/stores/tasks', () => ({
	useTaskStore: () => ({
		addLabel: addLabelMock,
		removeLabel: vi.fn(() => Promise.resolve()),
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

import EditLabels from './EditLabels.vue'

const MultiselectStub = {
	name: 'Multiselect',
	props: ['searchResults', 'modelValue', 'loading', 'creatable'],
	emits: ['search', 'select', 'create', 'update:modelValue'],
	template: '<div />',
}

function label(id: number, title: string): ILabel {
	return {id, title, hexColor: 'ffffff'} as ILabel
}

function mountComponent(props: {taskId: number}) {
	return mount(EditLabels, {
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
			},
		},
	})
}

describe('EditLabels createAndAddLabel', () => {
	beforeEach(() => {
		createLabelMock.mockReset()
		addLabelMock.mockClear()
	})

	it('creates the label server-side and emits it when taskId is 0 (no task to persist a relation to yet)', async () => {
		const created = label(9, 'errand')
		createLabelMock.mockResolvedValueOnce(created)

		const wrapper = mountComponent({taskId: 0})
		const ms = wrapper.findComponent(MultiselectStub)

		await ms.vm.$emit('create', 'errand')
		await Promise.resolve()
		await Promise.resolve()

		expect(createLabelMock).toHaveBeenCalledOnce()
		expect(addLabelMock).not.toHaveBeenCalled()
		expect(wrapper.emitted('update:modelValue')).toBeTruthy()
		const lastEmit = wrapper.emitted('update:modelValue')!.at(-1)!
		expect(lastEmit[0]).toEqual([created])
	})

	it('still creates the label and adds the task-label relation when taskId is set', async () => {
		const created = label(9, 'errand')
		createLabelMock.mockResolvedValueOnce(created)

		const wrapper = mountComponent({taskId: 5})
		const ms = wrapper.findComponent(MultiselectStub)

		await ms.vm.$emit('create', 'errand')
		await Promise.resolve()
		await Promise.resolve()

		expect(createLabelMock).toHaveBeenCalledOnce()
		expect(addLabelMock).toHaveBeenCalledOnce()
		const lastEmit = wrapper.emitted('update:modelValue')!.at(-1)!
		expect(lastEmit[0]).toEqual([created])
	})
})
