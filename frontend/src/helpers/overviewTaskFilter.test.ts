import {describe, it, expect} from 'vitest'
import {normalizeOverviewProjectIds, resolveOverviewProjectScope} from './overviewTaskFilter'

describe('normalizeOverviewProjectIds', () => {
	it('returns an empty array for undefined (the on-login value)', () => {
		expect(normalizeOverviewProjectIds(undefined)).toEqual([])
	})

	it('returns an empty array for a non-array (tampered free-form JSON)', () => {
		expect(normalizeOverviewProjectIds(42)).toEqual([])
		expect(normalizeOverviewProjectIds({a: 1})).toEqual([])
		expect(normalizeOverviewProjectIds('1,2,3')).toEqual([])
		expect(normalizeOverviewProjectIds(null)).toEqual([])
	})

	it('keeps only numeric entries, dropping non-numbers', () => {
		expect(normalizeOverviewProjectIds([1, '2', 3, null, {}, 4])).toEqual([1, 3, 4])
	})

	it('passes a clean numeric array through unchanged', () => {
		expect(normalizeOverviewProjectIds([10, 20, 30])).toEqual([10, 20, 30])
	})

	it('returns a fresh array (not the same reference)', () => {
		const input = [1, 2]
		expect(normalizeOverviewProjectIds(input)).not.toBe(input)
	})
})

describe('resolveOverviewProjectScope', () => {
	const base = {
		overviewProjectIds: [],
		savedFilterId: null,
		savedFilterExists: false,
		showAll: true,
		hasLabelFilter: false,
	}

	it('scopes nothing when neither projects nor a saved filter are set', () => {
		expect(resolveOverviewProjectScope(base)).toEqual({projectFilterClause: '', projectId: null})
	})

	// --- existing saved-filter behavior must be preserved unchanged ---

	it('routes a valid saved filter through projectId (no filter clause)', () => {
		expect(resolveOverviewProjectScope({
			...base,
			savedFilterId: 7,
			savedFilterExists: true,
		})).toEqual({projectFilterClause: '', projectId: 7})
	})

	it('ignores the saved filter when a label filter is active (existing skip)', () => {
		expect(resolveOverviewProjectScope({
			...base,
			savedFilterId: 7,
			savedFilterExists: true,
			hasLabelFilter: true,
		})).toEqual({projectFilterClause: '', projectId: null})
	})

	it('ignores the saved filter when it no longer exists in the store', () => {
		expect(resolveOverviewProjectScope({
			...base,
			savedFilterId: 7,
			savedFilterExists: false,
		})).toEqual({projectFilterClause: '', projectId: null})
	})

	it('ignores the saved filter outside the overview (showAll false)', () => {
		expect(resolveOverviewProjectScope({
			...base,
			savedFilterId: 7,
			savedFilterExists: true,
			showAll: false,
		})).toEqual({projectFilterClause: '', projectId: null})
	})

	// --- new project-picker behavior ---

	it('emits a project-in clause and clears projectId when projects are selected', () => {
		expect(resolveOverviewProjectScope({
			...base,
			overviewProjectIds: [1, 2, 3],
		})).toEqual({projectFilterClause: 'project in 1, 2, 3', projectId: null})
	})

	it('lets selected projects win over a set saved filter', () => {
		expect(resolveOverviewProjectScope({
			...base,
			overviewProjectIds: [5],
			savedFilterId: 7,
			savedFilterExists: true,
		})).toEqual({projectFilterClause: 'project in 5', projectId: null})
	})

	it('composes with an active label filter (projects go in the clause, not projectId)', () => {
		expect(resolveOverviewProjectScope({
			...base,
			overviewProjectIds: [5],
			hasLabelFilter: true,
		})).toEqual({projectFilterClause: 'project in 5', projectId: null})
	})

	it('does not scope projects outside the overview (showAll false)', () => {
		expect(resolveOverviewProjectScope({
			...base,
			overviewProjectIds: [5],
			showAll: false,
		})).toEqual({projectFilterClause: '', projectId: null})
	})
})
