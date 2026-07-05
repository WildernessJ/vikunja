import {setActivePinia, createPinia} from 'pinia'
import {describe, it, expect, beforeEach, vi} from 'vitest'

import type {ITask} from '@/modelTypes/ITask'

const taskUpdateMock = vi.fn()
vi.mock('@/services/task', () => ({
	default: class {
		update = taskUpdateMock
	},
}))

const loadAllProjectsMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/stores/projects', () => ({
	useProjectStore: () => ({
		loadAllProjects: loadAllProjectsMock,
	}),
}))

// The task store eagerly instantiates these sibling stores in its setup. Stub them
// so we can exercise toggleFavorite in isolation without their dependency graphs.
vi.mock('@/stores/base', () => ({useBaseStore: () => ({})}))
vi.mock('@/stores/kanban', () => ({useKanbanStore: () => ({})}))
vi.mock('@/stores/projectCounts', () => ({useProjectCountsStore: () => ({})}))
vi.mock('@/stores/labels', () => ({useLabelStore: () => ({})}))
vi.mock('@/stores/auth', () => ({useAuthStore: () => ({})}))
vi.mock('@/stores/config', () => ({useConfigStore: () => ({})}))

import {useTaskStore} from './tasks'

describe('tasks store toggleFavorite', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		taskUpdateMock.mockReset()
		loadAllProjectsMock.mockClear()
	})

	it('persists the flipped favorite state on success', async () => {
		const store = useTaskStore()
		const task = {id: 1, isFavorite: false} as ITask

		taskUpdateMock.mockResolvedValueOnce({id: 1, isFavorite: true} as ITask)

		const result = await store.toggleFavorite(task)

		expect(taskUpdateMock).toHaveBeenCalledOnce()
		expect(result.isFavorite).toBe(true)
		expect(loadAllProjectsMock).toHaveBeenCalledOnce()
	})

	it('reverts isFavorite to its prior value when the update fails', async () => {
		const store = useTaskStore()
		const task = {id: 1, isFavorite: false} as ITask

		taskUpdateMock.mockRejectedValueOnce(new Error('network down'))

		await expect(store.toggleFavorite(task)).rejects.toThrow()

		// The optimistic flip must be rolled back so the star doesn't linger unpersisted.
		expect(task.isFavorite).toBe(false)
		expect(loadAllProjectsMock).not.toHaveBeenCalled()
	})

	it('reverts a favorited task back to favorited when unfavoriting fails', async () => {
		const store = useTaskStore()
		const task = {id: 1, isFavorite: true} as ITask

		taskUpdateMock.mockRejectedValueOnce(new Error('network down'))

		await expect(store.toggleFavorite(task)).rejects.toThrow()

		expect(task.isFavorite).toBe(true)
	})
})
