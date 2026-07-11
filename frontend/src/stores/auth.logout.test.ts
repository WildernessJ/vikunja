import {describe, it, expect, beforeEach, vi} from 'vitest'
import {setActivePinia, createPinia} from 'pinia'

import {useAuthStore} from './auth'
import UserSettingsModel from '@/models/userSettings'
import {DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY} from '@/helpers/appearance'

const {routerPushMock} = vi.hoisted(() => ({
	routerPushMock: vi.fn(),
}))

vi.mock('@/helpers/auth', () => ({
	refreshToken: vi.fn(),
	getToken: vi.fn(() => null as string | null),
	saveToken: vi.fn(),
	removeToken: vi.fn(),
}))

vi.mock('@/router', () => ({
	default: {push: routerPushMock},
}))

vi.mock('@/composables/useWebSocket', () => ({
	useWebSocket: () => ({disconnect: vi.fn(), connect: vi.fn()}),
}))

function fakeHttp() {
	return {
		post: vi.fn().mockResolvedValue({data: {}}),
		get: vi.fn().mockResolvedValue({data: {}}),
		request: vi.fn().mockResolvedValue({data: {}}),
		interceptors: {
			request: {use: vi.fn()},
			response: {use: vi.fn()},
		},
	}
}

vi.mock('@/helpers/fetcher', () => ({
	HTTPFactory: () => fakeHttp(),
	AuthenticatedHTTPFactory: () => fakeHttp(),
	getApiBaseUrl: () => 'http://localhost/api/v1/',
}))

vi.mock('@/helpers/redirectToProvider', () => ({
	getRedirectUrlFromCurrentFrontendPath: vi.fn(),
	redirectToProvider: vi.fn(),
	redirectToProviderOnLogout: vi.fn(() => false),
}))

describe('auth store logout resets appearance settings (issue #44)', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		routerPushMock.mockReset()
	})

	it('resets frontend settings to model defaults so appearance composables re-fire', async () => {
		const store = useAuthStore()
		store.setUserSettings(new UserSettingsModel({
			frontendSettings: {
				fontSize: '125',
				fontFamily: 'monospace',
				colorSchema: 'dark',
			},
		} as never))

		expect(store.settings.frontendSettings.fontSize).toBe('125')

		await store.logout()

		expect(store.settings.frontendSettings.fontSize).toBe(DEFAULT_FONT_SIZE)
		expect(store.settings.frontendSettings.fontFamily).toBe(DEFAULT_FONT_FAMILY)
		expect(store.settings.frontendSettings.colorSchema).toBe('auto')
	})

	it('marks the session unauthenticated so settings-driven watchers cannot fetch during teardown', async () => {
		const store = useAuthStore()
		store.setAuthenticated(true)

		await store.logout()

		expect(store.authenticated).toBe(false)
	})
})
