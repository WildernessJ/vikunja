import AbstractModel from './abstractModel'
import UserModel from './user'

import {PERMISSIONS, type Permission} from '@/constants/permissions'
import type {ILinkShare} from '@/modelTypes/ILinkShare'
import type {IUser} from '@/modelTypes/IUser'

export default class LinkShareModel extends AbstractModel<ILinkShare> implements ILinkShare {
	id = 0
	hash = ''
	permission: Permission = PERMISSIONS.READ
	sharingType = 0 // FIXME: use correct numbers
	projectId = 0
	name = ''
	password = ''

	sharedBy!: IUser
	created!: Date
	updated!: Date

	constructor(data: Partial<ILinkShare>) {
		super()
		this.assignData(data)

		this.sharedBy = new UserModel(this.sharedBy)

		this.created = new Date(this.created)
		this.updated = new Date(this.updated)
	}
}
