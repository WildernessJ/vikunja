import {setActivePinia, createPinia} from 'pinia'
import {describe, it, expect, beforeEach, vi} from 'vitest'

import ProjectModel from '@/models/project'
import {PRIORITIES} from '@/constants/priorities'

const taskCreateMock = vi.fn()
vi.mock('@/services/task', () => ({
	default: class {
		create = taskCreateMock
		getAll = vi.fn().mockResolvedValue([])
	},
}))

vi.mock('@/services/labelTask', () => ({
	default: class {
		create = vi.fn().mockResolvedValue({})
	},
}))

const findProjectByExactnameMock = vi.fn().mockReturnValue(null)
const findProjectByIdentifierMock = vi.fn().mockReturnValue(null)
vi.mock('@/stores/projects', () => ({
	useProjectStore: () => ({
		findProjectByExactname: findProjectByExactnameMock,
		findProjectByIdentifier: findProjectByIdentifierMock,
	}),
}))

vi.mock('@/router', () => ({
	default: {
		currentRoute: {value: {params: {}}},
	},
}))

vi.mock('@/stores/base', () => ({useBaseStore: () => ({})}))
vi.mock('@/stores/kanban', () => ({useKanbanStore: () => ({})}))
vi.mock('@/stores/projectCounts', () => ({useProjectCountsStore: () => ({loadCounts: vi.fn().mockResolvedValue(undefined)})}))
vi.mock('@/stores/labels', () => ({useLabelStore: () => ({labels: {}, createLabel: vi.fn()})}))
vi.mock('@/stores/config', () => ({useConfigStore: () => ({concurrentWrites: true})}))
vi.mock('@/stores/auth', () => ({
	useAuthStore: () => ({
		settings: {
			frontendSettings: {
				quickAddMagicMode: 'vikunja',
				quickAddDefaultReminders: [],
			},
		},
	}),
}))

import {useTaskStore} from './tasks'

describe('tasks store createNewTask', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		taskCreateMock.mockReset().mockImplementation(async (task) => task)
		findProjectByExactnameMock.mockReset().mockReturnValue(null)
		findProjectByIdentifierMock.mockReset().mockReturnValue(null)
	})

	describe('finding #1: empty-title fast path', () => {
		it('creates a task with the raw title when input is pure magic tokens and there are no overrides', async () => {
			const store = useTaskStore()

			const created = await store.createNewTask({title: '!3', projectId: 1})

			expect(taskCreateMock).toHaveBeenCalledOnce()
			expect(created.title).toBe('!3')
		})

		it('still takes the raw-title fast path when overrides carry no meaningful values (empty object)', async () => {
			const store = useTaskStore()

			const created = await store.createNewTask({title: '!3', projectId: 1}, {})

			expect(taskCreateMock).toHaveBeenCalledOnce()
			expect(created.title).toBe('!3')
		})

		it('keeps the raw title (never empty) when overrides carry values and parsed text is empty', async () => {
			const store = useTaskStore()

			const created = await store.createNewTask({title: '!3', projectId: 1}, {priority: 2})

			expect(created.title).toBe('!3')
			expect(created.title).not.toBe('')
		})
	})

	describe('finding #2: explicit null override vs absent override (tri-state)', () => {
		it('resolves the parsed +project when projectId override is absent', async () => {
			const project = new ProjectModel({id: 42, title: 'groceries'})
			findProjectByExactnameMock.mockReturnValue(project)

			const store = useTaskStore()
			const created = await store.createNewTask({title: 'Buy milk +groceries', projectId: 1})

			expect(created.projectId).toBe(42)
		})

		it('falls back to the passed-in projectId (not the parsed +project) when projectId override is explicitly cleared (null)', async () => {
			const project = new ProjectModel({id: 42, title: 'groceries'})
			findProjectByExactnameMock.mockReturnValue(project)

			const store = useTaskStore()
			const created = await store.createNewTask({title: 'Buy milk +groceries', projectId: 7}, {projectId: null})

			expect(created.projectId).toBe(7)
			expect(created.projectId).not.toBe(42)
		})

		it('uses an explicit projectId override over both the parsed project and the passed-in projectId', async () => {
			const project = new ProjectModel({id: 42, title: 'groceries'})
			findProjectByExactnameMock.mockReturnValue(project)

			const store = useTaskStore()
			const created = await store.createNewTask({title: 'Buy milk +groceries', projectId: 7}, {projectId:99})

			expect(created.projectId).toBe(99)
		})

		it('resolves the parsed priority when priority override is absent', async () => {
			const store = useTaskStore()
			const created = await store.createNewTask({title: 'Buy milk !3', projectId: 1})

			expect(created.priority).toBe(3)
		})

		it('honors an explicitly cleared (null) priority override instead of falling back to the parsed priority', async () => {
			const store = useTaskStore()
			const created = await store.createNewTask({title: 'Buy milk !3', projectId: 1}, {priority: null})

			// TaskModel maps a null/undefined priority to its UNSET default (0).
			expect(created.priority).toBe(PRIORITIES.UNSET)
		})

		it('carries overrides.description through to the created task', async () => {
			const store = useTaskStore()
			const created = await store.createNewTask({title: 'Buy milk', projectId: 1}, {description: 'from the store, oat milk'})

			expect(created.description).toBe('from the store, oat milk')
		})
	})
})
