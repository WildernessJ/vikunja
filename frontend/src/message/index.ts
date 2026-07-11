import {i18n} from '@/i18n'
import {notify} from '@kyvg/vue3-notification'

interface ErrorResponseData {
	code?: number
	message?: string
	detail?: string
}

interface ErrorLike {
	reason?: {
		response?: {
			data?: ErrorResponseData
		}
	}
	response?: {
		data?: ErrorResponseData
	}
	message?: string
	cause?: {
		message?: string
	}
}

export function getErrorText(r: unknown): string {
	const err = r as ErrorLike
	const data = err?.reason?.response?.data || err?.response?.data

	if (data?.code) {
		const path = `error.${data.code}`
		let message: string = i18n.global.t(path)

		if (data?.code && data?.message && (data.code === 4016 || data.code === 4017 || data.code === 4018 || data.code === 4019 || data.code === 4024)) {
			message += '\n' + data.message
		}

		// If message and path are equal no translation exists for that error code
		if (path !== message) {
			return message
		}
	}
	
	// v2 errors are RFC 9457 problem+json, which carries `detail` instead of `message`.
	let message = data?.message || data?.detail || err.message

	if (typeof err.cause?.message !== 'undefined') {
		message += ' ' + err.cause.message
	}

	return message
}

export interface Action {
	title: string,
	callback: () => void,
}

export function error(e: unknown, actions: Action[] = []) {
	notify({
		type: 'error',
		title: i18n.global.t('error.error'),
		text: getErrorText(e),
		ignoreDuplicates: true,
		data: {
			actions: actions,
		},
	})
}

export function success(e: unknown, actions: Action[] = []) {
	notify({
		type: 'success',
		title: i18n.global.t('error.success'),
		text: getErrorText(e),
		ignoreDuplicates: true,
		data: {
			actions: actions,
		},
	})
}
