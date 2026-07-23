import {describe, it, expect, vi} from 'vitest'
import {mount} from '@vue/test-utils'

import {PRIORITIES} from '@/constants/priorities'
import {TASK_REPEAT_MODES} from '@/types/IRepeatMode'
import type {ITask} from '@/modelTypes/ITask'

vi.mock('@/stores/projects', () => ({
	useProjectStore: () => ({
		projects: {},
	}),
}))

vi.mock('vue-i18n', () => ({
	useI18n: () => ({t: (key: string) => key}),
	createI18n: () => ({
		global: {t: (key: string) => key},
	}),
}))

import TaskPropertyChips from './TaskPropertyChips.vue'

function baseTask(): ITask {
	return {
		id: 1,
		projectId: 1,
		priority: PRIORITIES.UNSET,
		labels: [],
		assignees: [],
		reminders: [],
		repeatAfter: {amount: 0, type: 'days'},
		repeatMode: TASK_REPEAT_MODES.REPEAT_MODE_DEFAULT,
		percentDone: 0,
		estimatedDuration: 0,
		dueDate: null,
		startDate: null,
		endDate: null,
		deadline: null,
		hexColor: '',
	} as unknown as ITask

}

function mountChips(overrides: Partial<Record<string, unknown>> = {}) {
	return mount(TaskPropertyChips, {
		props: {
			task: baseTask(),
			taskColor: '',
			canWrite: true,
			taskId: 1,
			isLinkShareAuth: false,
			remindersDefaultRelativeTo: null,
			savePriority: vi.fn(),
			savePercentDone: vi.fn(),
			saveEstimatedDuration: vi.fn(),
			saveGeneric: vi.fn(),
			changeProject: vi.fn(),
			removeRepeatAfter: vi.fn(),
			...overrides,
		},
		global: {
			mocks: {$t: (key: string) => key},
			stubs: {
				Icon: true,
				ProjectSearch: true,
				EditLabels: true,
				EditAssignees: true,
				PrioritySelect: true,
				PriorityLabel: true,
				Reminders: true,
				RepeatAfter: true,
				PercentDoneSelect: true,
				EditEstimatedDuration: true,
				ColorPicker: true,
				Datepicker: true,
			},
		},
	})
}

describe('TaskPropertyChips', () => {
	it('renders all 13 property chips', () => {
		const wrapper = mountChips()

		// 9 popup-based chips (project, priority, labels, assignees, reminders,
		// repeat, percentDone, duration, color) + 4 self-popup date chips (due,
		// start, end, deadline) = 13.
		expect(wrapper.findAllComponents({name: 'PropertyChip'})).toHaveLength(9)
		expect(wrapper.findAll('.date-chip')).toHaveLength(4)
	})

	it('opens the priority widget in its popup when the priority chip is clicked', async () => {
		const wrapper = mountChips()

		expect(wrapper.findComponent({name: 'PrioritySelect'}).exists()).toBe(false)

		const priorityChip = wrapper.findAllComponents({name: 'PropertyChip'})
			.find(c => c.findComponent({name: 'PriorityLabel'}).exists())
		await priorityChip?.find('.property-chip-button').trigger('click')

		expect(wrapper.findComponent({name: 'PrioritySelect'}).exists()).toBe(true)
	})

	it('renders unset chips as ghosts and set chips as filled', () => {
		const task = baseTask()
		task.priority = PRIORITIES.HIGH
		const wrapper = mountChips({task})

		const priorityChip = wrapper.findAllComponents({name: 'PropertyChip'})
			.find(c => c.findComponent({name: 'PriorityLabel'}).exists())

		expect(priorityChip?.props('isSet')).toBe(true)
	})

	it('disables every chip when canWrite is false', () => {
		const wrapper = mountChips({canWrite: false})

		wrapper.findAllComponents({name: 'PropertyChip'}).forEach(chip => {
			expect(chip.props('disabled')).toBe(true)
		})

		wrapper.findAll('.date-chip').forEach(chip => {
			expect(chip.findComponent({name: 'Datepicker'}).props('disabled')).toBe(true)
		})
	})

	it('opens the labels chip popup via openChip("labels") (F3 - KeyL shortcut)', async () => {
		const wrapper = mountChips()

		// The popup's content (and thus EditLabels) only renders once open, so
		// the chip has to be found by its icon prop rather than its content.
		const labelsChip = wrapper.findAllComponents({name: 'PropertyChip'})
			.find(c => c.props('icon') === 'tags')
		expect(labelsChip?.find('.property-chip-popup').exists()).toBe(false)

		wrapper.vm.openChip('labels')
		await wrapper.vm.$nextTick()

		expect(labelsChip?.find('.property-chip-popup').exists()).toBe(true)
	})
})
