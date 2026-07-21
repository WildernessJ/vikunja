import {test, expect, beforeEach} from 'vitest'
import {getSubprojectRollupState, saveSubprojectRollupState} from './subprojectRollupState'

beforeEach(() => {
	localStorage.clear()
})

test('defaults to disabled with no exclusions when nothing was saved', () => {
	expect(getSubprojectRollupState(1, 1)).toEqual({enabled: false, excluded: []})
})

test('persists enabled state and exclusions for the given user/project only', () => {
	saveSubprojectRollupState(1, 1, {enabled: true, excluded: [12, 15]})

	expect(getSubprojectRollupState(1, 1)).toEqual({enabled: true, excluded: [12, 15]})
	expect(getSubprojectRollupState(1, 2)).toEqual({enabled: false, excluded: []})
})

test('namespaces state per user so two users on the same browser do not share it', () => {
	saveSubprojectRollupState(1, 1, {enabled: true, excluded: [12]})

	expect(getSubprojectRollupState(2, 1)).toEqual({enabled: false, excluded: []})
})

test('turning it off again removes the stored entry', () => {
	saveSubprojectRollupState(1, 1, {enabled: true, excluded: [12]})
	expect(getSubprojectRollupState(1, 1).enabled).toBe(true)

	saveSubprojectRollupState(1, 1, {enabled: false, excluded: []})
	expect(getSubprojectRollupState(1, 1)).toEqual({enabled: false, excluded: []})
})

test('migrates the legacy non-namespaced boolean key on read', () => {
	localStorage.setItem('showSubprojectTasks:1', 'true')

	expect(getSubprojectRollupState(1, 1)).toEqual({enabled: true, excluded: []})
})

test('write-through migrates the legacy key into the namespaced key and removes the old one', () => {
	localStorage.setItem('showSubprojectTasks:1', 'true')

	getSubprojectRollupState(7, 1)

	expect(localStorage.getItem('showSubprojectTasks:1')).toBeNull()
	expect(getSubprojectRollupState(7, 1)).toEqual({enabled: true, excluded: []})
})

test('legacy key is ignored when it is not exactly "true"', () => {
	localStorage.setItem('showSubprojectTasks:1', 'false')

	expect(getSubprojectRollupState(1, 1)).toEqual({enabled: false, excluded: []})
})

test('sanitizes malformed non-numeric exclusion entries instead of passing them through', () => {
	localStorage.setItem('subprojectRollup:1:1', JSON.stringify({enabled: true, excluded: ['x', 12, null, 15, {}, 3.5]}))

	expect(getSubprojectRollupState(1, 1)).toEqual({enabled: true, excluded: [12, 15, 3.5]})
})
