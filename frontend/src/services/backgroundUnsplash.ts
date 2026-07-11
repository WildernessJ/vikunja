import AbstractService from './abstractService'
import BackgroundImageModel from '../models/backgroundImage'
import ProjectModel from '@/models/project'
import type { IBackgroundImage } from '@/modelTypes/IBackgroundImage'
import type { IProject } from '@/modelTypes/IProject'

export default class BackgroundUnsplashService extends AbstractService<IBackgroundImage> {
	constructor() {
		super({
			getAll: '/backgrounds/unsplash/search',
			update: '/projects/{projectId}/backgrounds/unsplash',
		})
	}

	modelFactory(data: Partial<IBackgroundImage>) {
		return new BackgroundImageModel(data)
	}

	modelUpdateFactory(data: Partial<IBackgroundImage>): IBackgroundImage {
		return new ProjectModel(data as unknown as Partial<IProject>) as unknown as IBackgroundImage
	}

	async thumb(model: IBackgroundImage) {
		const response = await this.http({
			url: `/backgrounds/unsplash/images/${model.id}/thumb`,
			method: 'GET',
			responseType: 'blob',
		})
		return window.URL.createObjectURL(new Blob([response.data]))
	}
}
