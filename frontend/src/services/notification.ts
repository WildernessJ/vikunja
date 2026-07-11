import AbstractService from '@/services/abstractService'
import NotificationModel from '@/models/notification'
import type {INotification} from '@/modelTypes/INotification'

export default class NotificationService extends AbstractService<INotification> {
	constructor() {
		super({
			getAll: '/notifications',
			update: '/notifications/{id}',
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
			created: new Date(model.created).toISOString(),
			readAt: model.readAt ? new Date(model.readAt).toISOString() : null,
		} as unknown as INotification
	}
	
	async markAllRead() {
		return this.post('/notifications', false as unknown as INotification)
	}
}
