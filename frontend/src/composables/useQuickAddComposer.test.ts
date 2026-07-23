import {describe, expect, it} from 'vitest'
import {nextTick, ref} from 'vue'

import {useQuickAddComposer} from './useQuickAddComposer'
import {PrefixMode} from '@/modules/quickAddMagic'
import {PRIORITIES} from '@/constants/priorities'
import ProjectModel from '@/models/project'
import LabelModel from '@/models/label'
import TaskReminderModel from '@/models/taskReminder'

describe('useQuickAddComposer', () => {
	it('reflects text-parsed values when no override is set', () => {
		const title = ref('Buy milk !3 tomorrow')
		const mode = ref(PrefixMode.Default)
		const {effectivePriority, effectiveDate} = useQuickAddComposer(title, mode)

		expect(effectivePriority.value).toBe(PRIORITIES.HIGH)
		expect(effectiveDate.value).not.toBeNull()
	})

	it('an override takes precedence over the text-parsed value', () => {
		const title = ref('Buy milk !3')
		const mode = ref(PrefixMode.Default)
		const {effectivePriority, setOverride} = useQuickAddComposer(title, mode)

		expect(effectivePriority.value).toBe(PRIORITIES.HIGH)
		setOverride('priority', PRIORITIES.LOW)
		expect(effectivePriority.value).toBe(PRIORITIES.LOW)
	})

	it('clearing an override falls back to the text-parsed value again', () => {
		const title = ref('Buy milk !3')
		const mode = ref(PrefixMode.Default)
		const {effectivePriority, setOverride, clearOverride} = useQuickAddComposer(title, mode)

		setOverride('priority', PRIORITIES.LOW)
		expect(effectivePriority.value).toBe(PRIORITIES.LOW)
		clearOverride('priority')
		expect(effectivePriority.value).toBe(PRIORITIES.HIGH)
	})

	it('clearAll resets every override', () => {
		const title = ref('Buy milk !3 *errand')
		const mode = ref(PrefixMode.Default)
		const {effectivePriority, effectiveLabels, setOverride, clearAll} = useQuickAddComposer(title, mode)

		setOverride('priority', PRIORITIES.LOW)
		setOverride('labels', [new LabelModel({id: 1, title: 'urgent'})])
		clearAll()

		expect(effectivePriority.value).toBe(PRIORITIES.HIGH)
		expect(effectiveLabels.value.map(l => l.title)).toEqual(['errand'])
	})

	it('does not parse text when quickAddMagicMode is disabled, but overrides still apply', () => {
		const title = ref('Buy milk !3 tomorrow')
		const mode = ref(PrefixMode.Disabled)
		const {effectivePriority, effectiveDate, setOverride} = useQuickAddComposer(title, mode)

		expect(effectivePriority.value).toBeNull()
		expect(effectiveDate.value).toBeNull()

		setOverride('priority', PRIORITIES.URGENT)
		expect(effectivePriority.value).toBe(PRIORITIES.URGENT)
	})

	it('detects multiline input and disables parsed chip reflection', () => {
		const title = ref('First task\n\tSubtask')
		const mode = ref(PrefixMode.Default)
		const {isMultiline, effectivePriority} = useQuickAddComposer(title, mode)

		expect(isMultiline.value).toBe(true)

		title.value = 'First task !3\n\tSubtask'
		expect(isMultiline.value).toBe(true)
		expect(effectivePriority.value).toBeNull()
	})

	it('single line input is not multiline', () => {
		const title = ref('Buy milk')
		const mode = ref(PrefixMode.Default)
		const {isMultiline} = useQuickAddComposer(title, mode)

		expect(isMultiline.value).toBe(false)
	})

	it('effectiveLabels merges text-parsed label names with override ILabel objects', () => {
		const title = ref('Errand *chores')
		const mode = ref(PrefixMode.Default)
		const {effectiveLabels, setOverride} = useQuickAddComposer(title, mode)

		expect(effectiveLabels.value.map(l => l.title)).toEqual(['chores'])

		const overrideLabel = new LabelModel({id: 5, title: 'urgent'})
		setOverride('labels', [overrideLabel])
		expect(effectiveLabels.value).toEqual([overrideLabel])
	})

	it('effectiveReminders reflects text-parsed reminders, and a chip override wins over them', () => {
		const title = ref('Buy milk ~1d')
		const mode = ref(PrefixMode.Default)
		const {effectiveReminders, setOverride} = useQuickAddComposer(title, mode)

		expect(effectiveReminders.value).toHaveLength(1)
		expect(effectiveReminders.value[0].relativePeriod).toBe(-86400)

		const chipReminder = new TaskReminderModel({reminder: new Date('2026-08-01T09:00:00Z'), relativeTo: null})
		setOverride('reminders', [chipReminder])
		expect(effectiveReminders.value).toEqual([chipReminder])
	})

	it('effectiveProject reflects an overridden project, not the parsed project name', async () => {
		const title = ref('Buy milk +groceries')
		const mode = ref(PrefixMode.Default)
		const {effectiveProjectName, effectiveProject, setOverride} = useQuickAddComposer(title, mode)

		expect(effectiveProjectName.value).toBe('groceries')
		expect(effectiveProject.value).toBeNull()

		const project = new ProjectModel({id: 9, title: 'Work'})
		setOverride('project', project)
		await nextTick()
		expect(effectiveProject.value).toEqual(project)
		expect(effectiveProjectName.value).toBeNull()
	})

	it('toStoreOverrides only includes keys that were explicitly overridden', () => {
		const title = ref('Buy milk !3')
		const mode = ref(PrefixMode.Default)
		const {setOverride, toStoreOverrides} = useQuickAddComposer(title, mode)

		expect(toStoreOverrides()).toEqual({})

		setOverride('priority', PRIORITIES.LOW)
		expect(toStoreOverrides()).toEqual({priority: PRIORITIES.LOW})

		const project = new ProjectModel({id: 3, title: 'Home'})
		setOverride('project', project)
		expect(toStoreOverrides()).toEqual({priority: PRIORITIES.LOW, projectId: 3})
	})

	it('clearing an override via null due date is a deliberate clear, distinct from unset', () => {
		const title = ref('Buy milk tomorrow')
		const mode = ref(PrefixMode.Default)
		const {effectiveDate, setOverride, toStoreOverrides} = useQuickAddComposer(title, mode)

		expect(effectiveDate.value).not.toBeNull()

		setOverride('dueDate', null)
		expect(effectiveDate.value).toBeNull()
		expect(toStoreOverrides()).toEqual({dueDate: null})
	})
})
