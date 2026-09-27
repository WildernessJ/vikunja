import {beforeEach, describe, expect, it, vi} from 'vitest'
import {defineComponent} from 'vue'
import {mount} from '@vue/test-utils'
import {createPinia, setActivePinia} from 'pinia'
import {QueryClient, VueQueryPlugin} from '@tanstack/vue-query'

import type {TaskReminder, TaskWritable} from '@/client/generated'
import {PRIORITIES} from '@/constants/priorities'
import type {QuickAddOverrides} from '@/helpers/task'
import type {IUserSettings} from '@/modelTypes/IUserSettings'

const sdk = vi.hoisted(() => ({
	tasksCreate: vi.fn(),
	labelsList: vi.fn(),
	labelsCreate: vi.fn(),
	taskLabelsCreate: vi.fn(),
	taskAssigneesCreate: vi.fn(),
	projectsUsersSearch: vi.fn(),
	projectsList: vi.fn(),
}))
vi.mock('@/client/generated', () => sdk)
vi.mock('@/message', () => ({error: vi.fn(), success: vi.fn(), translatedError: (key: string) => new Error(key)}))
vi.mock('vue-router', async importOriginal => ({
	...(await importOriginal<typeof import('vue-router')>()),
	useRouter: () => ({currentRoute: {value: {params: {}}}}),
}))

import {useAuthStore} from '@/stores/auth'
import {useQuickAddTask} from './useQuickAddTask'

function quickAdd() {
	const pinia = createPinia()
	setActivePinia(pinia)
	let actions!: ReturnType<typeof useQuickAddTask>
	mount(defineComponent({
		setup() {
			actions = useQuickAddTask()
			return () => null
		},
	}), {global: {plugins: [pinia, [VueQueryPlugin, {queryClient: new QueryClient()}]]}})
	return actions
}

type FrontendSettings = IUserSettings['frontendSettings']

async function create(title: string, projectId: number, overrides?: QuickAddOverrides, frontendSettings: Partial<FrontendSettings> = {}) {
	const actions = quickAdd()
	const auth = useAuthStore()
	auth.setUserSettings({
		...auth.settings,
		frontendSettings: {...auth.settings.frontendSettings, ...frontendSettings},
	} as IUserSettings)
	await actions.createNewTask({title, project_id: projectId}, overrides)
	return sdk.tasksCreate.mock.lastCall![0] as {path: {project: number}, body: TaskWritable}
}

const reminder = (relative_period: number): TaskReminder => ({relative_period, relative_to: 'due_date'})

describe('useQuickAddTask fork quick-add rules', () => {
	beforeEach(() => {
		Object.values(sdk).forEach(mock => mock.mockReset())
		sdk.labelsList.mockResolvedValue({data: {items: [], total_pages: 1}})
		sdk.projectsUsersSearch.mockResolvedValue({data: {items: []}})
		sdk.projectsList.mockResolvedValue({data: {items: [{id: 42, title: 'groceries'}], total_pages: 1}})
		sdk.tasksCreate.mockImplementation(async ({body}: {body: TaskWritable}) => ({data: {id: 7, ...body}}))
	})

	describe('date-only mode', () => {
		it('gives the API-bound due date the canonical end of day when the setting is on', async () => {
			const {body} = await create('buy milk tomorrow', 1, undefined, {dateOnly: true})

			expect(new Date(body.due_date!).getHours()).toBe(23)
			expect(new Date(body.due_date!).getMinutes()).toBe(59)
		})

		it('leaves the due date on its default time when the setting is off', async () => {
			const {body} = await create('buy milk tomorrow', 1)

			expect(new Date(body.due_date!).getHours()).not.toBe(23)
		})
	})

	describe('empty-title fast path', () => {
		it('keeps the raw title when the input is pure magic and there are no overrides', async () => {
			const {body} = await create('!3', 1)
			expect(body.title).toBe('!3')
		})

		it('still takes the raw-title path for an empty overrides object', async () => {
			const {body} = await create('!3', 1, {})
			expect(body.title).toBe('!3')
		})

		it('keeps the raw title (never empty) when overrides carry values and parsed text is empty', async () => {
			const {body} = await create('!3', 1, {priority: 2})
			expect(body.title).toBe('!3')
			expect(body.priority).toBe(2)
		})
	})

	describe('explicit null override vs absent override', () => {
		it('resolves the parsed +project when the project override is absent', async () => {
			const {path} = await create('Buy milk +groceries', 1)
			expect(path.project).toBe(42)
		})

		it('falls back to the passed-in project when the project override is cleared (null)', async () => {
			const {path} = await create('Buy milk +groceries', 7, {projectId: null})
			expect(path.project).toBe(7)
		})

		it('uses an explicit project override over the parsed and the passed-in project', async () => {
			const {path} = await create('Buy milk +groceries', 7, {projectId: 99})
			expect(path.project).toBe(99)
		})

		it('resolves the parsed priority when the priority override is absent', async () => {
			const {body} = await create('Buy milk !3', 1)
			expect(body.priority).toBe(3)
		})

		it('honors a cleared (null) priority override instead of the parsed priority', async () => {
			const {body} = await create('Buy milk !3', 1, {priority: null})
			expect(body.priority).toBe(PRIORITIES.UNSET)
		})

		it('carries the description override through', async () => {
			const {body} = await create('Buy milk', 1, {description: 'from the store, oat milk'})
			expect(body.description).toBe('from the store, oat milk')
		})

		it('lets a reminders override replace the quick-add defaults', async () => {
			const {body} = await create('Buy milk', 1, {dueDate: new Date('2026-12-25'), reminders: [reminder(-900)]}, {quickAddDefaultReminders: [{relativePeriod: -3600}]})
			expect(body.reminders).toEqual([reminder(-900)])
		})

		it('honors a cleared ([]) reminders override instead of the quick-add defaults', async () => {
			const {body} = await create('Buy milk', 1, {dueDate: new Date('2026-12-25'), reminders: []}, {quickAddDefaultReminders: [{relativePeriod: -3600}]})
			expect(body.reminders).toEqual([])
		})

		it('falls back to the quick-add default reminders when the reminders override is absent', async () => {
			const {body} = await create('Buy milk', 1, {dueDate: new Date('2026-12-25')}, {quickAddDefaultReminders: [{relativePeriod: -3600}]})
			expect(body.reminders).toEqual([reminder(-3600)])
		})
	})

	describe('reminders parsed from ~ magic-text', () => {
		it('persists a parsed relative ~1d reminder', async () => {
			const {body} = await create('Buy milk ~1d', 1)
			expect(body.title).toBe('Buy milk')
			expect(body.reminders).toEqual([reminder(-86400)])
		})

		it('lets a chip reminders override win over the parsed ~ reminder', async () => {
			const {body} = await create('Buy milk ~1d', 1, {reminders: [reminder(-900)]})
			expect(body.reminders).toEqual([reminder(-900)])
		})

		it('replaces (does not stack onto) the quick-add defaults with parsed ~ reminders', async () => {
			const {body} = await create('Buy milk ~1d', 1, {dueDate: new Date('2026-12-25')}, {quickAddDefaultReminders: [{relativePeriod: -3600}]})
			expect(body.reminders).toEqual([reminder(-86400)])
		})
	})

	describe('fork task fields', () => {
		it('sends an RRULE recurrence parsed from the title', async () => {
			const {body} = await create('Standup every monday', 1)
			expect(body.repeat_mode).toBe(3)
			expect(body.repeat_rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
		})

		it('sends a deadline parsed from the title', async () => {
			const {body} = await create('Ship it {apr 15}', 1)
			expect(body.deadline).toBeTruthy()
			expect(body.title).toBe('Ship it')
		})
	})
})
