import AbstractService from './abstractService'
import AvatarModel from '@/models/avatar'
import type { IAvatar } from '@/modelTypes/IAvatar'

export default class AvatarService extends AbstractService<IAvatar> {
	constructor() {
		super({
			get: '/user/settings/avatar',
			update: '/user/settings/avatar',
			create: '/user/settings/avatar/upload',
		})
	}

	modelFactory(data: Partial<IAvatar>) {
		return new AvatarModel(data)
	}

	useCreateInterceptor() {
		return false
	}

	// Widened to stay a compatible override of AbstractService.create(model: IAvatar);
	// the only caller passes a Blob, never an IAvatar.
	create(model: IAvatar | Blob) {
		const blob = model instanceof Blob ? model : new Blob()
		return this.uploadBlob(
			this.paths.create,
			blob,
			'avatar',
			'avatar.jpg', // This fails without a file name
		)
	}
}
