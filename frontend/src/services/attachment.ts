import AbstractService from './abstractService'
import AttachmentModel from '../models/attachment'

import type {Method} from 'axios'
import type { IAttachment } from '@/modelTypes/IAttachment'

import {downloadBlob} from '@/helpers/downloadBlob'

export enum PREVIEW_SIZE {
	SM = 'sm',
	MD = 'md',
	LG = 'lg',
	XL = 'xl',
}

// Shape of the upload response payload: not an IAttachment itself, but declared as
// extending it so it stays assignable through AbstractService's Model-typed create()/modelCreateFactory() overrides.
interface AttachmentUploadResponse extends IAttachment {
	success: IAttachment[]
	errors: {message: string}[] | null
}

export default class AttachmentService extends AbstractService<IAttachment> {
	constructor() {
		super({
			create: '/tasks/{taskId}/attachments',
			getAll: '/tasks/{taskId}/attachments',
			delete: '/tasks/{taskId}/attachments/{id}',
		})
	}

	processModel(model: IAttachment) {
		return {
			...model,
			created: new Date(model.created).toISOString(),
		}
	}

	useCreateInterceptor() {
		return false
	}

	modelFactory(data: Partial<IAttachment>) {
		return new AttachmentModel(data)
	}

	modelCreateFactory(data: Partial<IAttachment> & {success?: Partial<IAttachment>[] | null, errors?: {message: string}[] | null}) {
		// Success contains the uploaded attachments
		const success = (data.success === null || typeof data.success === 'undefined' ? [] : data.success).map((a: Partial<IAttachment>) => {
			return this.modelFactory(a)
		})
		return {...data, success} as unknown as AttachmentUploadResponse
	}

	getBlobUrl(model: IAttachment | string, size?: PREVIEW_SIZE | Method, data?: Record<string, unknown>) {
		if (typeof model === 'string') {
			// When model is a url string, size stands in for the base method's `method` param
			// (no caller ever passes a PREVIEW_SIZE alongside a string model).
			return AbstractService.prototype.getBlobUrl.call(this, model, size as Method | undefined, data)
		}

		let mainUrl = '/tasks/' + model.taskId + '/attachments/' + model.id
		if (size !== undefined) {
			mainUrl += `?preview_size=${size}`
		}

		return AbstractService.prototype.getBlobUrl.call(this, mainUrl)
	}

	async download(model: IAttachment) {
		const url = await this.getBlobUrl(model)
		return downloadBlob(url, model.file.name)
	}

	/**
	 * Uploads a file to the server
	 * @param files
	 * @returns {Promise<any|never>}
	 */
	create(model: IAttachment, files: File[] | FileList = []): Promise<AttachmentUploadResponse> {
		const data = new FormData()
		for (let i = 0; i < files.length; i++) {
			// TODO: Validation of file size
			data.append('files', new Blob([files[i]]), files[i].name)
		}

		return this.uploadFormData(
			this.getReplacedRoute(this.paths.create, model),
			data,
		) as unknown as Promise<AttachmentUploadResponse>
	}
}
