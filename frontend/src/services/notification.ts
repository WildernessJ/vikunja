import AbstractService from '@/services/abstractService'
import NotificationModel from '@/models/notification'
import type {INotification} from '@/modelTypes/INotification'
import {toISOStringOrNull} from '@/helpers/time/toISOStringOrNull'

export default class NotificationService extends AbstractService<INotification> {
	constructor() {
		super({
			getAll: '/notifications',
			update: '/notifications/{id}',
			delete: '/notifications',
		})
	}

	modelFactory(data: Partial<INotification>) {
		return new NotificationModel(data)
	}

	beforeUpdate(model: INotification) {
		if (!model) {
			return model
		}

		// The API wants ISO date strings on the wire, even though INotification's
		// created/readAt are typed as Date locally — cast to stay a compatible override.
		return {
			...model,
			created: toISOStringOrNull(model.created),
			readAt: toISOStringOrNull(model.readAt),
		} as unknown as INotification
	}
	
	async markAllRead() {
		return this.post('/notifications', false as unknown as INotification)
	}
}
