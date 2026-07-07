import {AuthenticatedHTTPFactory, apiV2Url} from '@/helpers/fetcher'
import {objectToCamelCase} from '@/helpers/case'

import type {IActivity} from '@/modelTypes/IActivity'

export function parseActivity(raw: Record<string, unknown>): IActivity {
	const a = objectToCamelCase(raw)
	return {
		id: a.id,
		projectId: a.projectId ?? 0,
		taskId: a.taskId ?? 0,
		actorId: a.actorId ?? 0,
		actor: a.actor ?? null,
		verb: a.verb ?? '',
		summary: a.summary ?? '',
		created: new Date(a.created),
		// The feed has no per-item permission; visibility follows project read access.
		maxPermission: null,
	}
}

export interface ActivityListParams {
	// Opaque keyset cursor from a previous response's nextCursor. Omit for the
	// first (newest) page.
	cursor?: string
	perPage?: number
	actorId?: number
	verb?: string
}

export interface ActivityListResult {
	items: IActivity[]
	nextCursor: string
}

export function useActivityService() {
	const http = AuthenticatedHTTPFactory()

	function buildParams(params: ActivityListParams) {
		return {
			cursor: params.cursor || undefined,
			per_page: params.perPage,
			actor_id: params.actorId || undefined,
			verb: params.verb || undefined,
		}
	}

	function toResult(data: {items?: Record<string, unknown>[], next_cursor?: string}): ActivityListResult {
		return {
			items: (data.items ?? []).map(parseActivity),
			nextCursor: data.next_cursor ?? '',
		}
	}

	async function getForProject(projectId: number, params: ActivityListParams = {}): Promise<ActivityListResult> {
		const {data} = await http.get(apiV2Url(`projects/${projectId}/activities`), {params: buildParams(params)})
		return toResult(data)
	}

	async function getAll(params: ActivityListParams = {}): Promise<ActivityListResult> {
		const {data} = await http.get(apiV2Url('activities'), {params: buildParams(params)})
		return toResult(data)
	}

	return {getForProject, getAll}
}
