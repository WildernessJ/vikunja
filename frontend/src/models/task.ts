import {PRIORITIES, type Priority} from '@/constants/priorities'

import type {ITask} from '@/modelTypes/ITask'
import type {ILabel} from '@/modelTypes/ILabel'
import type {IUser} from '@/modelTypes/IUser'
import type {IAttachment} from '@/modelTypes/IAttachment'
import type {IProject} from '@/modelTypes/IProject'
import type {ISubscription} from '@/modelTypes/ISubscription'
import type {IBucket} from '@/modelTypes/IBucket'

import type {IRepeatAfter} from '@/types/IRepeatAfter'
import type {IRelationKind} from '@/types/IRelationKind'
import {TASK_REPEAT_MODES, type IRepeatMode} from '@/types/IRepeatMode'

import {parseDateOrNull} from '@/helpers/parseDateOrNull'
import {secondsToPeriod} from '@/helpers/time/period'

import AbstractModel from './abstractModel'
import LabelModel from './label'
import UserModel from './user'
import AttachmentModel from './attachment'
import SubscriptionModel from './subscription'
import type {ITaskReminder} from '@/modelTypes/ITaskReminder'
import type {IReactionPerEntity} from '@/modelTypes/IReaction'
import type {ITaskComment} from '@/modelTypes/ITaskComment.ts'
import TaskReminderModel from '@/models/taskReminder'
import TaskCommentModel from '@/models/taskComment.ts'

export function	getHexColor(hexColor: string): string | undefined {
	if (hexColor === '' || hexColor === '#') {
		return undefined
	}

	return hexColor
}

/**
 * Parses `repeatAfterSeconds` into a usable js object.
 */
export function parseRepeatAfter(repeatAfterSeconds: number): IRepeatAfter {
	
	const period = secondsToPeriod(repeatAfterSeconds)
	
	return {
		type: period.unit,
		amount: period.amount,
	}
}

export function getTaskIdentifier(task: ITask | null | undefined): string {
	if (task === null || typeof task === 'undefined') {
		return ''
	}
	
	if (task.identifier === '') {
		return `#${task.index}`
	}

	return task.identifier
}

export default class TaskModel extends AbstractModel<ITask> implements ITask {
	id = 0
	title = ''
	description = ''
	done = false
	doneAt: Date | null = null
	priority: Priority = PRIORITIES.UNSET
	labels: ILabel[] = []
	assignees: IUser[] = []

	dueDate: Date | null = null
	deadline: Date | null = null
	startDate: Date | null = null
	endDate: Date | null = null
	repeatAfter: number | IRepeatAfter = 0
	repeatFromCurrentDate = false
	repeatMode: IRepeatMode = TASK_REPEAT_MODES.REPEAT_MODE_DEFAULT
	repeatRrule = ''
	repeatFromCompletion = false
	reminders: ITaskReminder[] = []
	parentTaskId: ITask['id'] = 0
	hexColor = ''
	percentDone = 0
	estimatedDuration = 0
	relatedTasks:  Partial<Record<IRelationKind, ITask[]>> = {}
	attachments: IAttachment[] = []
	coverImageAttachmentId: IAttachment['id'] | null = null
	identifier = ''
	index = 0
	isFavorite = false
	subscription!: ISubscription

	position = 0

	reactions: IReactionPerEntity = {}
	comments: ITaskComment[] = []

	createdBy!: IUser
	created!: Date
	updated!: Date

	projectId: IProject['id'] = 0
	bucketId: IBucket['id'] = 0
	buckets: IBucket[] = []

	constructor(data: Partial<ITask> = {}) {
		super()
		this.assignData(data)

		this.id = Number(this.id)
		this.title = this.title?.trim()
		const doneAt = this.doneAt
		this.doneAt = doneAt === null ? null : parseDateOrNull(doneAt)

		this.labels = this.labels
			.map(l => new LabelModel(l))
			.sort((a, b) => a.title.localeCompare(b.title))

		// Parse the assignees into user models
		this.assignees = this.assignees.map(a => {
			return new UserModel(a)
		})

		const dueDate = this.dueDate
		this.dueDate = dueDate === null ? null : parseDateOrNull(dueDate)
		const deadline = this.deadline
		this.deadline = deadline === null ? null : parseDateOrNull(deadline)
		const startDate = this.startDate
		this.startDate = startDate === null ? null : parseDateOrNull(startDate)
		const endDate = this.endDate
		this.endDate = endDate === null ? null : parseDateOrNull(endDate)

		// Parse the repeat after into something usable
		this.repeatAfter = parseRepeatAfter(this.repeatAfter as number)

		this.reminders = this.reminders.map(r => new TaskReminderModel(r))

		if (this.hexColor !== '' && this.hexColor.substring(0, 1) !== '#') {
			this.hexColor = '#' + this.hexColor
		}

		// Convert all subtasks to task models
		Object.keys(this.relatedTasks).forEach(relationKind => {
			const kind = relationKind as IRelationKind
			this.relatedTasks[kind] = this.relatedTasks[kind]!.map((t: ITask) => {
				return new TaskModel(t)
			})
		})

		// Make all attachments to attachment models
		this.attachments = this.attachments.map(a => new AttachmentModel(a))

		// Set the task identifier to empty if the project does not have one
		if (this.identifier === `-${this.index}`) {
			this.identifier = ''
		}

		if (typeof this.subscription !== 'undefined' && this.subscription !== null) {
			this.subscription = new SubscriptionModel(this.subscription)
		}

		this.createdBy = new UserModel(this.createdBy)
		this.created = new Date(this.created)
		this.updated = new Date(this.updated)

		this.projectId = Number(this.projectId)

		// If we would use the camel cased value here, it would lose the reactions - emojis can't be camel cased.
		// The comments will be camel cased anyway in the constructor of the task comment model.
		this.comments = (data.comments || []).map(c => new TaskCommentModel(c))

		// We can't convert emojis to camel case, hence we do this manually
		this.reactions = {}
		const reactions = data.reactions || {}
		Object.keys(reactions).forEach(reaction => {
			this.reactions[reaction] = reactions[reaction].map(u => new UserModel(u))
		})
	}

	getTextIdentifier() {
		return getTaskIdentifier(this)
	}

	getHexColor() {
		return getHexColor(this.hexColor)
	}
}

