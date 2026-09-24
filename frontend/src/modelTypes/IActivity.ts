import type {IAbstract} from './IAbstract'
import type {IUser} from './IUser'

export interface IActivity extends IAbstract {
	id: number
	projectId: number
	// 0 for project-level activity, or when the referenced task has since been
	// deleted (task_deleted tombstone). Renderers must tolerate a missing task.
	taskId: number
	actorId: IUser['id']
	actor: IUser | null
	verb: string
	summary: string

	created: Date
}
