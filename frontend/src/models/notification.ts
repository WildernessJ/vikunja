import AbstractModel from './abstractModel'
import {parseDateOrNull} from '@/helpers/parseDateOrNull'
import UserModel, {getDisplayName} from '@/models/user'
import TaskModel from '@/models/task'
import TaskCommentModel from '@/models/taskComment'
import ProjectModel from '@/models/project'
import TeamModel from '@/models/team'

import {
	NOTIFICATION_NAMES,
	type INotification,
	type NotificationTaskComment,
	type NotificationTask,
	type NotificationAssigned,
	type NotificationCreated,
	type NotificationTaskReminder,
	type NotificationMemberAdded,
} from '@/modelTypes/INotification'
import type { IUser } from '@/modelTypes/IUser'

export default class NotificationModel extends AbstractModel<INotification> implements INotification {
	id = 0
	name = ''
	notification!: INotification['notification']
	read = false
	readAt: Date | null = null

	created!: Date

	constructor(data: Partial<INotification>) {
		super()
		this.assignData(data)

		switch (this.name) {
			case NOTIFICATION_NAMES.TASK_COMMENT: {
				const n = this.notification as NotificationTaskComment
				this.notification = {
					doer: new UserModel(n.doer),
					task: new TaskModel(n.task),
					comment: new TaskCommentModel(n.comment),
				}
				break
			}
			case NOTIFICATION_NAMES.TASK_ASSIGNED: {
				const n = this.notification as NotificationAssigned
				this.notification = {
					doer: new UserModel(n.doer),
					task: new TaskModel(n.task),
					assignee: new UserModel(n.assignee),
				}
				break
			}
			case NOTIFICATION_NAMES.TASK_DELETED: {
				const n = this.notification as NotificationTask
				this.notification = {
					doer: new UserModel(n.doer),
					task: new TaskModel(n.task),
				}
				break
			}
			case NOTIFICATION_NAMES.PROJECT_CREATED: {
				const n = this.notification as NotificationCreated
				// NotificationCreated also declares `task`, but project.created events carry no task; see report.
				const reconstructed: Pick<NotificationCreated, 'doer' | 'project'> = {
					doer: new UserModel(n.doer),
					project: new ProjectModel(n.project),
				}
				this.notification = reconstructed as NotificationCreated
				break
			}
			case NOTIFICATION_NAMES.TEAM_MEMBER_ADDED: {
				const n = this.notification as NotificationMemberAdded
				this.notification = {
					doer: new UserModel(n.doer),
					member: new UserModel(n.member),
					team: new TeamModel(n.team),
				}
				break
			}
			case NOTIFICATION_NAMES.TASK_REMINDER: {
				const n = this.notification as NotificationTaskReminder
				// NotificationTaskReminder also declares `doer`, but reminder events carry no doer; see report.
				const reconstructed: Pick<NotificationTaskReminder, 'task' | 'project'> = {
					task: new TaskModel(n.task),
					project: new ProjectModel(n.project),
				}
				this.notification = reconstructed as NotificationTaskReminder
				break
			}
			case NOTIFICATION_NAMES.TASK_MENTIONED: {
				const n = this.notification as NotificationTask
				this.notification = {
					doer: new UserModel(n.doer),
					task: new TaskModel(n.task),
				}
				break
			}
		}

		this.created = new Date(this.created)
		const readAt = this.readAt
		this.readAt = readAt === null ? null : parseDateOrNull(readAt)
	}

	toText(user: IUser | null = null) {
		let who: string

		switch (this.name) {
			case NOTIFICATION_NAMES.TASK_COMMENT: {
				const n = this.notification as NotificationTaskComment
				return `commented on ${n.task.getTextIdentifier()}`
			}
			case NOTIFICATION_NAMES.TASK_ASSIGNED: {
				const n = this.notification as NotificationAssigned
				who = `${getDisplayName(n.assignee)}`

				if (user !== null && user.id === n.assignee.id) {
					who = 'you'
				}

				return `assigned ${who} to ${n.task.getTextIdentifier()}`
			}
			case NOTIFICATION_NAMES.TASK_DELETED: {
				const n = this.notification as NotificationTask
				return `deleted ${n.task.getTextIdentifier()}`
			}
			case NOTIFICATION_NAMES.PROJECT_CREATED: {
				const n = this.notification as NotificationCreated
				return `created ${n.project.title}`
			}
			case NOTIFICATION_NAMES.TEAM_MEMBER_ADDED: {
				const n = this.notification as NotificationMemberAdded
				who = `${getDisplayName(n.member)}`

				if (user !== null && user.id === n.member.id) {
					who = 'you'
				}

				return `added ${who} to the ${n.team.name} team`
			}
			case NOTIFICATION_NAMES.TASK_REMINDER: {
				const n = this.notification as NotificationTaskReminder
				return `Reminder for ${n.task.getTextIdentifier()} ${n.task.title} (${n.project.title})`
			}
			case NOTIFICATION_NAMES.TASK_MENTIONED: {
				const n = this.notification as NotificationTask
				return `${getDisplayName(n.doer)} mentioned you on ${n.task.getTextIdentifier()}`
			}
		}

		return ''
	}
}
