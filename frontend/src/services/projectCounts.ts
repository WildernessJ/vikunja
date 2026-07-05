import {AuthenticatedHTTPFactory, apiV2Url} from '@/helpers/fetcher'
import type {IProjectCount} from '@/modelTypes/IProjectCount'

interface ProjectCountResponse {
	open: number
	due_overdue: number
}

// The counts endpoint only exists on /api/v2, hence the absolute URL. Its
// top-level keys are project ids, so we can't blanket-camelCase the response;
// each entry is mapped explicitly instead.
export async function getProjectCounts(): Promise<Record<number, IProjectCount>> {
	const http = AuthenticatedHTTPFactory()
	const {data} = await http.get<Record<string, ProjectCountResponse>>(apiV2Url('projects/counts'))

	const counts: Record<number, IProjectCount> = {}
	for (const [projectId, value] of Object.entries(data ?? {})) {
		counts[Number(projectId)] = {
			open: value.open ?? 0,
			dueOverdue: value.due_overdue ?? 0,
		}
	}
	return counts
}
