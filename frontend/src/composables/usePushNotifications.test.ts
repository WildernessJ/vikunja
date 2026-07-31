import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {defineComponent, h} from 'vue'
import {mount, type VueWrapper} from '@vue/test-utils'

const {createPushSubscriptionMock, deletePushSubscriptionMock, getPushPublicKeyMock} = vi.hoisted(() => ({
	createPushSubscriptionMock: vi.fn(),
	deletePushSubscriptionMock: vi.fn(),
	getPushPublicKeyMock: vi.fn(),
}))

vi.mock('@/services/pushSubscription', () => ({
	createPushSubscription: createPushSubscriptionMock,
	deletePushSubscription: deletePushSubscriptionMock,
	getPushPublicKey: getPushPublicKeyMock,
}))

import {dropDevicePushSubscription, usePushNotifications, type PushPermission} from './usePushNotifications'

const SUBSCRIPTION_ID_KEY = 'pushSubscriptionId'

// base64url for the bytes [1, 2, 3], so a subscription can be given exactly the
// applicationServerKey the composable derives from it.
const TEST_PUBLIC_KEY = 'AQID'
const TEST_APPLICATION_SERVER_KEY = new Uint8Array([1, 2, 3]).buffer

const USER_AGENT = window.navigator.userAgent

const unsubscribeMock = vi.fn()

function fakeBrowserSubscription(applicationServerKey?: ArrayBuffer) {
	return {
		endpoint: 'https://push.example.com/subscription-a',
		getKey: () => new Uint8Array([1, 2, 3]).buffer,
		unsubscribe: unsubscribeMock,
		options: applicationServerKey === undefined ? undefined : {applicationServerKey},
	}
}

interface BrowserStubOptions {
	// false stands in for an origin with no service worker at all — every dev
	// build, and a production first visit before `window.load` has fired.
	registered?: boolean
	permission?: PushPermission
	requestPermission?: () => Promise<PushPermission>
	subscribe?: () => Promise<unknown>
}

// Stands in for a browser that has push: a registered service worker holding a
// live subscription. Without all three of these `browserSupportsPush()` is
// false and the whole path is a no-op.
function stubPushCapableBrowser(subscription: unknown, options: BrowserStubOptions = {}) {
	const registration = {
		pushManager: {
			getSubscription: () => Promise.resolve(subscription),
			subscribe: options.subscribe ?? (() => Promise.resolve(subscription)),
		},
	}
	const registered = options.registered ?? true
	const permission = options.permission ?? 'granted'

	vi.stubGlobal('navigator', {
		// Vue's devtools hook reads this while mounting; the real navigator's
		// getters cannot be re-hosted on a stub, so it is copied across.
		userAgent: USER_AGENT,
		serviceWorker: {
			getRegistration: () => Promise.resolve(registered ? registration : undefined),
			ready: Promise.resolve(registration),
		},
	})
	vi.stubGlobal('PushManager', class {})
	vi.stubGlobal('Notification', {
		permission,
		requestPermission: options.requestPermission ?? (() => Promise.resolve(permission)),
	})
}

type PushComposable = ReturnType<typeof usePushNotifications>

let wrapper: VueWrapper | undefined

// The composable loads on mount, so it needs a component instance; the state it
// returns is what General.vue gates the toggle on.
function mountComposable(): PushComposable {
	let composable!: PushComposable
	wrapper = mount(defineComponent({
		setup() {
			composable = usePushNotifications()
			return () => h('div')
		},
	}))
	return composable
}

// `loading` goes true synchronously on mount and false in load()'s finally, so
// it is the signal that the whole lifecycle has run — including the failure path.
async function settled(composable: PushComposable) {
	await vi.waitFor(() => expect(composable.loading.value).toBe(false))
}

describe('dropDevicePushSubscription', () => {
	beforeEach(() => {
		createPushSubscriptionMock.mockReset().mockResolvedValue(42)
		deletePushSubscriptionMock.mockReset().mockResolvedValue(undefined)
		unsubscribeMock.mockReset().mockResolvedValue(true)
		window.localStorage.clear()
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	// The point of the logout path is to stop pushes reaching a device that is
	// no longer this user's. Posting the endpoint to resolve an id does the
	// opposite: it registers (or takes over) a row for the user who is on their
	// way out, and if the delete after it fails they keep receiving their task
	// counts on a shared device until that row's next 410.
	it('never posts the endpoint, even when no id is remembered', async () => {
		stubPushCapableBrowser(fakeBrowserSubscription())

		await dropDevicePushSubscription()

		expect(createPushSubscriptionMock).not.toHaveBeenCalled()
		expect(deletePushSubscriptionMock).not.toHaveBeenCalled()
		expect(unsubscribeMock).toHaveBeenCalled()
	})

	it('deletes the remembered row and detaches the browser', async () => {
		window.localStorage.setItem(SUBSCRIPTION_ID_KEY, '7')
		stubPushCapableBrowser(fakeBrowserSubscription())

		await dropDevicePushSubscription()

		expect(createPushSubscriptionMock).not.toHaveBeenCalled()
		expect(deletePushSubscriptionMock).toHaveBeenCalledWith(7)
		expect(unsubscribeMock).toHaveBeenCalled()
		expect(window.localStorage.getItem(SUBSCRIPTION_ID_KEY)).toBeNull()
	})

	it('detaches the browser even when the delete fails, and does not throw', async () => {
		window.localStorage.setItem(SUBSCRIPTION_ID_KEY, '7')
		deletePushSubscriptionMock.mockRejectedValue(new Error('offline'))
		stubPushCapableBrowser(fakeBrowserSubscription())

		await expect(dropDevicePushSubscription()).resolves.toBeUndefined()

		expect(unsubscribeMock).toHaveBeenCalled()
		expect(window.localStorage.getItem(SUBSCRIPTION_ID_KEY)).toBeNull()
	})

	// The mirror of the case above, and the one that actually strands a row: the
	// browser refusing to detach must not cancel the server-side delete. Logout
	// clears localStorage right after, so an id skipped here is unrecoverable,
	// and a live endpoint never 410s — the row would keep pushing the departing
	// user's counts to a device someone else now uses.
	it('deletes the remembered row even when the browser refuses to detach', async () => {
		window.localStorage.setItem(SUBSCRIPTION_ID_KEY, '7')
		unsubscribeMock.mockRejectedValue(new DOMException('network', 'AbortError'))
		stubPushCapableBrowser(fakeBrowserSubscription())

		await expect(dropDevicePushSubscription()).resolves.toBeUndefined()

		expect(createPushSubscriptionMock).not.toHaveBeenCalled()
		expect(deletePushSubscriptionMock).toHaveBeenCalledWith(7)
		expect(window.localStorage.getItem(SUBSCRIPTION_ID_KEY)).toBeNull()
	})

	it('does nothing when the browser has no subscription', async () => {
		stubPushCapableBrowser(null)

		await dropDevicePushSubscription()

		expect(createPushSubscriptionMock).not.toHaveBeenCalled()
		expect(deletePushSubscriptionMock).not.toHaveBeenCalled()
	})
})

describe('usePushNotifications', () => {
	beforeEach(() => {
		createPushSubscriptionMock.mockReset().mockResolvedValue(42)
		deletePushSubscriptionMock.mockReset().mockResolvedValue(undefined)
		getPushPublicKeyMock.mockReset().mockResolvedValue({enabled: true, publicKey: TEST_PUBLIC_KEY})
		unsubscribeMock.mockReset().mockResolvedValue(true)
		window.localStorage.clear()
	})

	afterEach(() => {
		wrapper?.unmount()
		wrapper = undefined
		vi.unstubAllGlobals()
	})

	describe('load', () => {
		it('is unavailable when the instance does not offer push', async () => {
			getPushPublicKeyMock.mockResolvedValue({enabled: false, publicKey: ''})
			stubPushCapableBrowser(null)

			const push = mountComposable()
			await settled(push)

			expect(push.available.value).toBe(false)
			expect(push.subscribed.value).toBe(false)
		})

		// `available` gates the settings toggle, and the toggle fires a real OS
		// permission prompt. Without a registered service worker there is nothing
		// that could ever receive the push, so offering it prompts the user and
		// then throws — which is every dev build, and a production first visit
		// before `window.load` has registered the worker.
		it('is unavailable when no service worker is registered', async () => {
			stubPushCapableBrowser(null, {registered: false})

			const push = mountComposable()
			await settled(push)

			expect(push.available.value).toBe(false)
		})

		it('is available when the instance offers push and a worker is registered', async () => {
			stubPushCapableBrowser(null)

			const push = mountComposable()
			await settled(push)

			expect(push.available.value).toBe(true)
			expect(push.subscribed.value).toBe(false)
		})

		it('reports being subscribed only for a subscription using the current VAPID key', async () => {
			stubPushCapableBrowser(fakeBrowserSubscription(TEST_APPLICATION_SERVER_KEY))

			const push = mountComposable()
			await settled(push)

			expect(push.available.value).toBe(true)
			expect(push.subscribed.value).toBe(true)
		})

		it('does not report being subscribed when the key was rotated', async () => {
			stubPushCapableBrowser(fakeBrowserSubscription(new Uint8Array([9, 9, 9]).buffer))

			const push = mountComposable()
			await settled(push)

			expect(push.subscribed.value).toBe(false)
		})

		// An instance without the v2 push routes, or an offline settings page.
		it('does not reject when the public key cannot be fetched', async () => {
			getPushPublicKeyMock.mockRejectedValue(new Error('404'))
			stubPushCapableBrowser(null)

			const push = mountComposable()
			await settled(push)

			expect(push.available.value).toBe(false)
		})
	})

	describe('subscribe', () => {
		it('does not touch the server or claim success when permission is denied', async () => {
			stubPushCapableBrowser(null, {permission: 'denied'})

			const push = mountComposable()
			await settled(push)
			await push.subscribe()

			expect(createPushSubscriptionMock).not.toHaveBeenCalled()
			expect(push.subscribed.value).toBe(false)
			expect(push.permission.value).toBe('denied')
			expect(push.loading.value).toBe(false)
		})

		it('does not claim success when no service worker is registered', async () => {
			stubPushCapableBrowser(null, {registered: false})

			const push = mountComposable()
			await settled(push)

			await expect(push.subscribe()).rejects.toThrow()
			expect(createPushSubscriptionMock).not.toHaveBeenCalled()
			expect(push.subscribed.value).toBe(false)
			expect(push.loading.value).toBe(false)
		})

		it('registers the device and remembers the row id', async () => {
			stubPushCapableBrowser(null, {subscribe: () => Promise.resolve(fakeBrowserSubscription(TEST_APPLICATION_SERVER_KEY))})

			const push = mountComposable()
			await settled(push)
			await push.subscribe()

			expect(createPushSubscriptionMock).toHaveBeenCalledWith({
				endpoint: 'https://push.example.com/subscription-a',
				p256dh: 'AQID',
				auth: 'AQID',
			})
			expect(push.subscribed.value).toBe(true)
			expect(window.localStorage.getItem(SUBSCRIPTION_ID_KEY)).toBe('42')
		})
	})
})
