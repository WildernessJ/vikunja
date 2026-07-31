import {ref, onMounted} from 'vue'

import {
	createPushSubscription,
	deletePushSubscription,
	getPushPublicKey,
	type IPushSubscriptionPayload,
} from '@/services/pushSubscription'

// The id of the row the server created for this device. Kept so unsubscribing
// can delete exactly it; when it's missing (cleared storage, other browser
// profile) the explicit unsubscribe re-posts the endpoint to resolve the id.
// Logout deliberately does not — see dropDevicePushSubscription.
const SUBSCRIPTION_ID_KEY = 'pushSubscriptionId'

export type PushPermission = 'default' | 'granted' | 'denied'

function browserSupportsPush(): boolean {
	return typeof window !== 'undefined'
		&& 'serviceWorker' in navigator
		&& 'PushManager' in window
		&& 'Notification' in window
}

// applicationServerKey wants raw bytes, but VAPID keys travel as base64url.
// Backed by an explicit ArrayBuffer so the result is not typed over the
// SharedArrayBuffer union, which BufferSource rejects.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
	const padding = '='.repeat((4 - base64String.length % 4) % 4)
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
	const raw = window.atob(base64)

	const output = new Uint8Array(new ArrayBuffer(raw.length))
	for (let i = 0; i < raw.length; i++) {
		output[i] = raw.charCodeAt(i)
	}
	return output
}

function encodeKey(subscription: globalThis.PushSubscription, name: 'p256dh' | 'auth'): string {
	const key = subscription.getKey(name)
	if (key === null) {
		throw new Error(`The push subscription is missing its ${name} key`)
	}
	// btoa over the raw bytes, then to base64url — what the backend stores.
	return window.btoa(String.fromCharCode(...new Uint8Array(key)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '')
}

function toPayload(subscription: globalThis.PushSubscription): IPushSubscriptionPayload {
	return {
		endpoint: subscription.endpoint,
		p256dh: encodeKey(subscription, 'p256dh'),
		auth: encodeKey(subscription, 'auth'),
	}
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
	if (!browserSupportsPush()) {
		return null
	}
	// The service worker is only registered in production builds, so in dev
	// `ready` never resolves — don't hang the settings page, or logout, waiting
	// for something that was never registered.
	if (await navigator.serviceWorker.getRegistration() === undefined) {
		return null
	}
	return await Promise.race([
		navigator.serviceWorker.ready,
		new Promise<null>(resolve => window.setTimeout(() => resolve(null), 3000)),
	])
}

// A subscription created with a different application server key is dead: the
// push service rejects every send signed with the current one, while the browser
// still reports a live subscription. Detect it instead of reusing it forever.
function usesApplicationServerKey(subscription: globalThis.PushSubscription, publicKey: string): boolean {
	const current = subscription.options?.applicationServerKey
	if (!current) {
		return false
	}

	const inUse = new Uint8Array(current)
	const wanted = urlBase64ToUint8Array(publicKey)

	return inUse.length === wanted.length
		&& inUse.every((byte, i) => byte === wanted[i])
}

function storedSubscriptionId(): number | null {
	const stored = window.localStorage.getItem(SUBSCRIPTION_ID_KEY)
	if (stored === null) {
		return null
	}
	// Anything else (a truncated write, a value from an older format) would go
	// out as DELETE /push-subscriptions/NaN and 422.
	const id = Number(stored)
	return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * Removes this device's subscription: server row first, then the browser's own
 * subscription, then the remembered id. The browser side and the cleanup run
 * even if the server call fails — a device the user asked to detach must stop
 * receiving, and the server prunes the orphaned row on its next 410.
 */
async function removeDeviceSubscription(): Promise<void> {
	const registration = await getRegistration()
	const subscription = await registration?.pushManager.getSubscription() ?? null

	try {
		if (subscription !== null) {
			// Without a remembered id, post the endpoint first: the server
			// upserts and hands back the id of the row to delete.
			const id = storedSubscriptionId() ?? await createPushSubscription(toPayload(subscription))
			await deletePushSubscription(id)
		}
	} finally {
		window.localStorage.removeItem(SUBSCRIPTION_ID_KEY)
		await subscription?.unsubscribe()
	}
}

/**
 * Detaches this device on logout. A push subscription belongs to the browser,
 * not to the session: left in place, the next user to log in on the same
 * installed PWA sees the toggle on, receives nothing, and the previous user's
 * task counts keep arriving on a device that is no longer theirs.
 *
 * Never throws — logout must not depend on it.
 */
export async function dropDevicePushSubscription(): Promise<void> {
	try {
		const registration = await getRegistration()
		const subscription = await registration?.pushManager.getSubscription() ?? null
		const id = storedSubscriptionId()

		window.localStorage.removeItem(SUBSCRIPTION_ID_KEY)

		// Neither side may cancel the other. Sequential awaits would let a
		// browser that refuses to detach skip the delete, and logout clears
		// localStorage immediately after, so an id skipped here can never be
		// recovered — while a still-live endpoint never 410s, leaving the row
		// pushing the departing user's counts at whoever holds the device next.
		//
		// Deliberately no post-to-resolve-the-id: posting registers the endpoint
		// to the user on their way out, which is the leak this exists to close.
		// Losing a row we cannot name is the lesser evil.
		await Promise.allSettled([
			subscription?.unsubscribe() ?? Promise.resolve(),
			id !== null ? deletePushSubscription(id) : Promise.resolve(),
		])
	} catch (e) {
		console.debug('Could not remove this device\'s push subscription on logout', e)
	}
}

/**
 * Drives this device's Web Push subscription: whether the instance offers it,
 * whether this browser can do it, and the subscribe/unsubscribe round trip.
 */
export function usePushNotifications() {
	const isSupported = browserSupportsPush()

	// Whether the instance has Web Push configured and this browser can use it.
	const available = ref(false)
	const subscribed = ref(false)
	const loading = ref(false)
	const permission = ref<PushPermission>(
		isSupported ? Notification.permission as PushPermission : 'default',
	)

	let publicKey = ''

	async function load() {
		if (!isSupported) {
			return
		}

		loading.value = true
		try {
			const key = await getPushPublicKey()
			publicKey = key.publicKey
			available.value = false

			if (!key.enabled) {
				return
			}

			// The instance offering push is only half of it: without a registered
			// service worker nothing can receive one, so the toggle would prompt
			// for notification permission and then throw. That is every dev build
			// (registerServiceWorker only registers under PROD) and a production
			// first visit before `window.load` has run.
			const registration = await getRegistration()
			if (registration === null) {
				return
			}
			available.value = true

			const subscription = await registration.pushManager.getSubscription()
			subscribed.value = subscription !== null && usesApplicationServerKey(subscription, publicKey)
		} finally {
			loading.value = false
		}
	}

	async function subscribe() {
		loading.value = true
		try {
			permission.value = await Notification.requestPermission() as PushPermission
			if (permission.value !== 'granted') {
				return
			}

			const registration = await getRegistration()
			if (registration === null) {
				throw new Error('No service worker is registered, so push notifications cannot be delivered')
			}

			let subscription = await registration.pushManager.getSubscription()
			if (subscription !== null && !usesApplicationServerKey(subscription, publicKey)) {
				// Signed with a key this instance no longer has: every send to it
				// would 403 while the UI happily showed the toggle on.
				await subscription.unsubscribe()
				subscription = null
			}

			subscription ??= await registration.pushManager.subscribe({
				// iOS only delivers a push that shows a notification, so there
				// is no silent option to opt into here.
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(publicKey),
			})

			const id = await createPushSubscription(toPayload(subscription))
			window.localStorage.setItem(SUBSCRIPTION_ID_KEY, String(id))
			subscribed.value = true
		} finally {
			loading.value = false
		}
	}

	async function unsubscribe() {
		loading.value = true
		try {
			await removeDeviceSubscription()
		} finally {
			// The browser subscription is gone either way, so the toggle must
			// not stay on because the server call failed.
			subscribed.value = false
			loading.value = false
		}
	}

	onMounted(() => {
		// An instance without the v2 push routes (or an offline settings page)
		// must not produce an unhandled rejection; `available` stays false, which
		// is what hides the feature.
		load().catch(e => console.debug('Could not load the push notification state', e))
	})

	return {
		available,
		subscribed,
		permission,
		loading,
		subscribe,
		unsubscribe,
	}
}
