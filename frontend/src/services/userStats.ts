import {AuthenticatedHTTPFactory, apiV2Url} from '@/helpers/fetcher'
import type {IUserStats} from '@/modelTypes/IUserStats'

// The API clamps to 1..52; keep the client in the same range so a selector can
// never send a value the endpoint would reject with a 422.
export const MIN_STATS_WEEKS = 1
export const MAX_STATS_WEEKS = 52

interface UserStatsDayResponse {
	date: string
	count: number
}

interface UserProjectStatsResponse {
	project_id: number
	open: number
	completed_in_window: number
	overdue: number
}

interface UserStatsResponse {
	completed_per_day: UserStatsDayResponse[]
	completed_in_projects: number
	created_by_me: number
	open: number
	overdue: number
	projects: UserProjectStatsResponse[]
}

// The stats endpoint only exists on /api/v2, hence the absolute URL.
export async function getUserStats(weeks: number = 12): Promise<IUserStats> {
	const clamped = Math.min(MAX_STATS_WEEKS, Math.max(MIN_STATS_WEEKS, Math.round(weeks)))
	const http = AuthenticatedHTTPFactory()
	const {data} = await http.get<UserStatsResponse>(apiV2Url('user/stats'), {params: {weeks: clamped}})

	return {
		completedPerDay: (data?.completed_per_day ?? []).map(d => ({
			date: d.date,
			count: d.count ?? 0,
		})),
		completedInProjects: data?.completed_in_projects ?? 0,
		createdByMe: data?.created_by_me ?? 0,
		open: data?.open ?? 0,
		overdue: data?.overdue ?? 0,
		projects: (data?.projects ?? []).map(p => ({
			projectId: p.project_id,
			open: p.open ?? 0,
			completedInWindow: p.completed_in_window ?? 0,
			overdue: p.overdue ?? 0,
		})),
	}
}
