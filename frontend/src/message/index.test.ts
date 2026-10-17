import {describe, it, expect, vi, beforeEach} from 'vitest'

const notify = vi.hoisted(() => vi.fn())
vi.mock('@kyvg/vue3-notification', () => ({notify}))

import {error, getErrorText} from './index'

describe('error', () => {
	beforeEach(() => notify.mockClear())

	it('reports one error object only once', () => {
		// A mutation reports its error in onError, and the caller's catch can
		// report the same rejection again.
		const cause = new Error('Network Error')
		error(cause)
		error(cause)

		expect(notify).toHaveBeenCalledTimes(1)
	})

	it('does not report a request-context abort', () => {
		error(new DOMException('Client request context changed', 'AbortError'))

		expect(notify).not.toHaveBeenCalled()
	})

	it('reports different errors with the same text separately', () => {
		error(new Error('Network Error'))
		error(new Error('Network Error'))
		error('plain string')
		error('plain string')

		expect(notify).toHaveBeenCalledTimes(4)
	})
})

describe('getErrorText', () => {
	it('interpolates i18n_params into the translated error message', () => {
		const text = getErrorText({
			response: {
				data: {
					code: 14002,
					message: 'The permission frobnicate of group tasks is invalid.',
					i18n_params: {permission: 'frobnicate', group: 'tasks'},
				},
			},
		})

		expect(text).toContain('frobnicate')
		expect(text).toContain('tasks')
	})

	it('falls back to empty placeholders when i18n_params is missing, without crashing', () => {
		const text = getErrorText({
			response: {
				data: {
					code: 14002,
					message: 'The permission frobnicate of group tasks is invalid.',
				},
			},
		})

		expect(text).not.toContain('{permission}')
		expect(text).not.toContain('{group}')
		expect(text).not.toContain('undefined')
	})

	it('falls back to data.message when there is no error code', () => {
		const text = getErrorText({
			response: {
				data: {
					message: 'Something went wrong',
				},
			},
		})

		expect(text).toBe('Something went wrong')
	})

	it('falls back to data.message for an unknown error code', () => {
		const text = getErrorText({
			response: {
				data: {
					code: 99999,
					message: 'some backend message',
				},
			},
		})

		expect(text).toBe('some backend message')
	})

	it('appends the server message of a request error given as cause', () => {
		const text = getErrorText(Object.assign(new Error('Error while refreshing user info:'), {
			cause: {
				message: 'Request failed with status code 500',
				response: {data: {message: 'Internal server error'}},
			},
		}))

		expect(text).toBe('Error while refreshing user info: Internal server error')
	})

	it('reads a direct problem response', () => {
		const text = getErrorText({
			code: 99999,
			detail: 'direct problem detail',
		})

		expect(text).toBe('direct problem detail')
	})
})
