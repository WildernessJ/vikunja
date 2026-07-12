import AbstractService from './abstractService'
import LabelModel from '@/models/label'
import type {ILabel} from '@/modelTypes/ILabel'
import {colorFromHex} from '@/helpers/color/colorFromHex'

export default class LabelService extends AbstractService<ILabel> {
	constructor() {
		super({
			create: '/labels',
			getAll: '/labels',
			get: '/labels/{id}',
			update: '/labels/{id}',
			delete: '/labels/{id}',
		})
	}

	processModel(label: ILabel) {
		return {
			...label,
			created: new Date(label.created).toISOString(),
			updated: new Date(label.updated).toISOString(),
			hexColor: colorFromHex(label.hexColor),
		} as unknown as ILabel
	}

	modelFactory(data: Partial<ILabel>) {
		return new LabelModel(data)
	}

	beforeUpdate(label: ILabel) {
		return this.processModel(label)
	}

	beforeCreate(label: ILabel) {
		return this.processModel(label)
	}
}
