// frontend_settings is free-form JSON stored verbatim, so a tampered value could be a
// non-array or hold non-numeric junk. Normalize to a fresh numeric array: reads never throw.
export function normalizeOverviewProjectIds(value: unknown): number[] {
	// Real project ids are positive integers; anything else (NaN, floats, negatives from a
	// tampered blob) would produce e.g. `project in NaN` and make the backend reject the filter.
	return Array.isArray(value)
		? value.filter((id): id is number => Number.isInteger(id) && (id as number) > 0)
		: []
}

interface OverviewProjectScopeInput {
	overviewProjectIds: number[]
	savedFilterId: number | null | undefined
	savedFilterExists: boolean
	showAll: boolean
	hasLabelFilter: boolean
	exclude: boolean
}

interface OverviewProjectScope {
	projectFilterClause: string
	projectId: number | null
}

// A direct project selection wins over the saved filter: it goes into the filter string
// (composing with any label filter) and forces projectId null to hit the multi-project
// endpoint, whereas a saved filter is a pseudo-project reachable only via projectId.
export function resolveOverviewProjectScope(input: OverviewProjectScopeInput): OverviewProjectScope {
	const {overviewProjectIds, savedFilterId, savedFilterExists, showAll, hasLabelFilter, exclude} = input

	if (showAll && overviewProjectIds.length > 0) {
		const operator = exclude ? 'not in' : 'in'
		return {projectFilterClause: `project ${operator} ${overviewProjectIds.join(', ')}`, projectId: null}
	}

	if (showAll && savedFilterId && savedFilterExists && !hasLabelFilter) {
		return {projectFilterClause: '', projectId: savedFilterId}
	}

	return {projectFilterClause: '', projectId: null}
}
