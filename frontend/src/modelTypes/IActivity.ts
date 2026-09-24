import type {IAbstract} from './IAbstract'
import type {IUser} from './IUser'
import type {ITask} from './ITask'

export interface IActivity extends IAbstract {
	id: number
	projectId: number
	// 0 for project-level activity, or when the referenced task has since been
	// deleted (task_deleted tombstone). Renderers must tolerate a missing task.
	taskId: ITask['id']
	actorId: IUser['id']
	actor: IUser | null
	verb: string
	summary: string

	created: Date
}
