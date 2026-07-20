import AbstractService from '@/services/abstractService'
import TaskModel from '@/models/task'

import type {ITask} from '@/modelTypes/ITask'
import type {IBucket} from '@/modelTypes/IBucket'
import BucketModel from '@/models/bucket'

export type ExpandTaskFilterParam = 'subtasks' | 'buckets' | 'reactions' | 'comment_count' | 'is_unread' | null

export interface TaskFilterParams {
	sort_by: ('start_date' | 'end_date' | 'due_date' | 'done' | 'id' | 'position' | 'title')[],
	order_by: ('asc' | 'desc')[],
	filter: string,
	filter_include_nulls: boolean,
	filter_timezone?: string,
	s: string,
	per_page?: number,
	expand?: ExpandTaskFilterParam,
	include_child_projects?: boolean,
}

export function getDefaultTaskFilterParams(): TaskFilterParams {
	return {
		sort_by: ['position', 'id'],
		order_by: ['asc', 'desc'],
		filter: '',
		filter_include_nulls: false,
		filter_timezone: '',
		s: '',
		expand: 'subtasks',
		include_child_projects: false,
	}
}

export default class TaskCollectionService extends AbstractService<ITask> {
	constructor() {
		super({
			getAll: '/projects/{projectId}/views/{viewId}/tasks',
			// /projects/{projectId}/tasks when viewId is not provided
		})
	}

	getReplacedRoute(path: string, pathparams: Record<string, unknown>): string {
		if (!pathparams.viewId) {
			return super.getReplacedRoute('/projects/{projectId}/tasks', pathparams)
		}
		return super.getReplacedRoute(path, pathparams)
	}

	modelFactory(data: Partial<ITask> & {project_view_id?: unknown}) {
		// FIXME: There must be a better way for this…
		if (typeof data.project_view_id !== 'undefined') {
			return new BucketModel(data as unknown as Partial<IBucket>) as unknown as ITask
		}
		return new TaskModel(data)
	}
}
