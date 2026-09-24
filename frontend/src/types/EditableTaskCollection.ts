import type {TaskCollection} from '@/client/generated'

// The roll-up fields are task-listing parameters (fork), never part of a stored filter.
export type EditableTaskCollection = Required<Omit<TaskCollection, 'sort_by' | 'order_by' | 'include_child_projects' | 'excluded_project_ids'>> & {
	sort_by: string[]
	order_by: string[]
}
