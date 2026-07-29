import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {createPushSubscriptionMock, deletePushSubscriptionMock} = vi.hoisted(() => ({
	createPushSubscriptionMock: vi.fn(),
	deletePushSubscriptionMock: vi.fn(),
}))

vi.mock('@/services/pushSubscription', () => ({
	createPushSubscription: createPushSubscriptionMock,
	deletePushSubscription: deletePushSubscriptionMock,
	getPushPublicKey: vi.fn(),
}))

import {dropDevicePushSubscription} from './usePushNotifications'

const SUBSCRIPTION_ID_KEY = 'pushSubscriptionId'

const unsubscribeMock = vi.fn()

function fakeBrowserSubscription() {
	return {
		endpoint: 'https://push.example.com/subscription-a',
		getKey: () => new Uint8Array([1, 2, 3]).buffer,
		unsubscribe: unsubscribeMock,
	}
}

// Stands in for a browser that has push: a registered service worker holding a
// live subscription. Without all three of these `browserSupportsPush()` is
// false and the whole path is a no-op.
function stubPushCapableBrowser(subscription: unknown) {
	const registration = {pushManager: {getSubscription: () => Promise.resolve(subscription)}}

	vi.stubGlobal('navigator', {
		serviceWorker: {
			getRegistration: () => Promise.resolve(registration),
			ready: Promise.resolve(registration),
		},
	})
	vi.stubGlobal('PushManager', class {})
	vi.stubGlobal('Notification', class {})
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

	it('does nothing when the browser has no subscription', async () => {
		stubPushCapableBrowser(null)

		await dropDevicePushSubscription()

		expect(createPushSubscriptionMock).not.toHaveBeenCalled()
		expect(deletePushSubscriptionMock).not.toHaveBeenCalled()
	})
})
