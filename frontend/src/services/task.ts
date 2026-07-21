import AbstractService from './abstractService'
import TaskModel from '@/models/task'
import type {ITask} from '@/modelTypes/ITask'
import type {IRelationKind} from '@/types/IRelationKind'
import AttachmentService from './attachment'
import LabelService from './label'

import {colorFromHex} from '@/helpers/color/colorFromHex'
import {SECONDS_A_DAY, SECONDS_A_HOUR, SECONDS_A_WEEK} from '@/constants/date'
import {objectToSnakeCase} from '@/helpers/case'
import {AuthenticatedHTTPFactory} from '@/helpers/fetcher'

const parseDate = (date: Date | null) => {
	if (date) {
		return new Date(date).toISOString()
	}

	return null
}

export default class TaskService extends AbstractService<ITask> {
	constructor() {
		super({
			create: '/projects/{projectId}/tasks',
			getAll: '/tasks',
			get: '/tasks/{id}',
			update: '/tasks/{id}',
			delete: '/tasks/{id}',
		})
	}

	modelFactory(data: Partial<ITask>) {
		return new TaskModel(data)
	}

	beforeUpdate(model: ITask) {
		return this.processModel(model)
	}

	beforeCreate(model: ITask) {
		return this.processModel(model)
	}

	autoTransformBeforePost(): boolean {
		return false
	}

	processModel(updatedModel: ITask) {
		// remove all nulls, these would create empty reminders
		const reminders = updatedModel.reminders
			.filter(r => r !== null)
			.map(r => ({
				...r,
				// Make normal timestamps from js dates
				reminder: new Date(r.reminder!).toISOString(),
			}))

		// Make the repeating amount to seconds
		let repeatAfterSeconds = 0
		if (updatedModel.repeatAfter !== null && typeof updatedModel.repeatAfter === 'object' && (updatedModel.repeatAfter.amount !== null || updatedModel.repeatAfter.amount !== 0)) {
			switch (updatedModel.repeatAfter.type) {
				case 'hours':
					repeatAfterSeconds = updatedModel.repeatAfter.amount * SECONDS_A_HOUR
					break
				case 'days':
					repeatAfterSeconds = updatedModel.repeatAfter.amount * SECONDS_A_DAY
					break
				case 'weeks':
					repeatAfterSeconds = updatedModel.repeatAfter.amount * SECONDS_A_WEEK
					break
			}
		}

		// Do the same for all related tasks
		const relatedTasks = {...updatedModel.relatedTasks}
		;(Object.keys(relatedTasks) as IRelationKind[]).forEach(relationKind => {
			relatedTasks[relationKind] = relatedTasks[relationKind]!.map(t => {
				return this.processModel(t)
			})
		})

		// Process all attachments to prevent parsing errors
		if (updatedModel.attachments.length > 0) {
			const attachmentService = new AttachmentService()
			updatedModel.attachments.map(a => {
				return attachmentService.processModel(a)
			})
		}

		// Preprocess all labels
		const labels = updatedModel.labels.length > 0
			? updatedModel.labels.map(l => new LabelService().processModel(l))
			: updatedModel.labels

		const model = {
			...updatedModel,
			title: updatedModel.title?.trim(),
			// Ensure that projectId is an int
			projectId: Number(updatedModel.projectId),
			// Convert dates into an iso string
			dueDate: parseDate(updatedModel.dueDate),
			deadline: parseDate(updatedModel.deadline),
			startDate: parseDate(updatedModel.startDate),
			endDate: parseDate(updatedModel.endDate),
			doneAt: parseDate(updatedModel.doneAt),
			deletedAt: parseDate(updatedModel.deletedAt),
			created: new Date(updatedModel.created).toISOString(),
			updated: new Date(updatedModel.updated).toISOString(),
			reminderDates: null,
			reminders,
			repeatAfter: repeatAfterSeconds,
			hexColor: colorFromHex(updatedModel.hexColor),
			relatedTasks,
			labels,
		}

		const transformed = objectToSnakeCase(model)

		// We can't convert emojis to skane case, hence we add them back again
		transformed.reactions = {}
		Object.keys(updatedModel.reactions || {}).forEach(reaction => {
			transformed.reactions[reaction] = updatedModel.reactions[reaction].map(u => objectToSnakeCase(u))
		})

		return transformed as ITask
	}

	async markTaskAsRead(taskId: ITask['id']): Promise<void> {
		const cancel = this.setLoading()
	
		try {
			await AuthenticatedHTTPFactory().post(`/tasks/${taskId}/read`, {} as ITask)
		} finally {
			cancel()
		}
	}
}

