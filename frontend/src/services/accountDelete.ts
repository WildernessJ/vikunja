import AbstractService from './abstractService'
import type {IAbstract} from '@/modelTypes/IAbstract'

export default class AccountDeleteService extends AbstractService {
	request(password: string) {
		return this.post('/user/deletion/request', {password} as unknown as IAbstract)
	}

	confirm(token: string) {
		return this.post('/user/deletion/confirm', {token} as unknown as IAbstract)
	}

	cancel(password: string) {
		return this.post('/user/deletion/cancel', {password} as unknown as IAbstract)
	}
}
