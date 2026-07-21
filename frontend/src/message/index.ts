import {i18n} from '@/i18n'
import {notify} from '@kyvg/vue3-notification'

// vue-i18n's `t` is typed against the full message schema, whose overload
// resolution is excessively deep (TS2589) — especially with dynamic keys.
// Call it through a loosely-typed wrapper (behaviour identical at runtime).
export function translate(key: string, params: Record<string, unknown> = {}): string {
	return (i18n.global as unknown as {t: (key: string, params: Record<string, unknown>) => string}).t(key, params)
}

interface ErrorResponseData {
	code?: number
	message?: string
	detail?: string
	i18n_params?: Record<string, unknown>
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
		let message: string = translate(path, data.i18n_params ?? {})

		if (data?.code && data?.message && (data.code === 4016 || data.code === 4017 || data.code === 4018 || data.code === 4019 || data.code === 4024)) {
			message += '\n' + data.message
		}

		// If message and path are equal no translation exists for that error code
		if (path !== message) {
			return message
		}
	}
	
	// v2 errors are RFC 9457 problem+json, which carries `detail` instead of `message`.
	let message = data?.message || data?.detail || err.message || ''

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
		title: translate('error.error'),
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
		title: translate('error.success'),
		text: getErrorText(e),
		ignoreDuplicates: true,
		data: {
			actions: actions,
		},
	})
}
