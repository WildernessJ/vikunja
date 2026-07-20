import {test, expect} from 'vitest'
import {getShowSubprojectTasksState, saveShowSubprojectTasksState} from './showSubprojectTasksState'

test('defaults to off when nothing was saved', () => {
	expect(getShowSubprojectTasksState(1)).toBe(false)
})

test('persists the toggle for the given project only', () => {
	saveShowSubprojectTasksState(1, true)

	expect(getShowSubprojectTasksState(1)).toBe(true)
	expect(getShowSubprojectTasksState(2)).toBe(false)
})

test('restores the saved state for each project independently', () => {
	saveShowSubprojectTasksState(1, true)
	saveShowSubprojectTasksState(2, false)
	saveShowSubprojectTasksState(3, true)

	expect(getShowSubprojectTasksState(1)).toBe(true)
	expect(getShowSubprojectTasksState(2)).toBe(false)
	expect(getShowSubprojectTasksState(3)).toBe(true)
})

test('turning it off again removes the stored entry', () => {
	saveShowSubprojectTasksState(1, true)
	expect(getShowSubprojectTasksState(1)).toBe(true)

	saveShowSubprojectTasksState(1, false)
	expect(getShowSubprojectTasksState(1)).toBe(false)
})
