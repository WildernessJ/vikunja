import AbstractService from './abstractService'
import {downloadBlob} from '../helpers/downloadBlob'
import type {IAbstract} from '@/modelTypes/IAbstract'

const DOWNLOAD_NAME = 'vikunja-export.zip'

interface IPasswordRequest extends IAbstract {
	password: string
}

export default class DataExportService extends AbstractService {
	request(password: string) {
		return this.post('/user/export/request', {password} as IPasswordRequest)
	}

	status() {
		return this.getM('/user/export')
	}
	
	async download(password: string) {
		const clear = this.setLoading()
		try {
			const url = await this.getBlobUrl('/user/export/download', 'POST', {password})
			downloadBlob(url, DOWNLOAD_NAME)
		} finally {
			clear()
		}
	}
}
