// frontend_settings is free-form JSON stored verbatim, so a tampered value could be a
// non-array or hold non-numeric junk. Normalize to a fresh numeric array: reads never throw.
export function normalizeOverviewProjectIds(value: unknown): number[] {
	return Array.isArray(value)
		? value.filter((id): id is number => typeof id === 'number')
		: []
}

interface OverviewProjectScopeInput {
	overviewProjectIds: number[]
	savedFilterId: number | null | undefined
	savedFilterExists: boolean
	showAll: boolean
	hasLabelFilter: boolean
}

interface OverviewProjectScope {
	projectFilterClause: string
	projectId: number | null
}

// A direct project selection wins over the saved filter: it goes into the filter string
// (composing with any label filter) and forces projectId null to hit the multi-project
// endpoint, whereas a saved filter is a pseudo-project reachable only via projectId.
export function resolveOverviewProjectScope(input: OverviewProjectScopeInput): OverviewProjectScope {
	const {overviewProjectIds, savedFilterId, savedFilterExists, showAll, hasLabelFilter} = input

	if (showAll && overviewProjectIds.length > 0) {
		return {projectFilterClause: `project in ${overviewProjectIds.join(', ')}`, projectId: null}
	}

	if (showAll && savedFilterId && savedFilterExists && !hasLabelFilter) {
		return {projectFilterClause: '', projectId: savedFilterId}
	}

	return {projectFilterClause: '', projectId: null}
}
