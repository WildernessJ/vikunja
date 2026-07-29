import {ref, onMounted} from 'vue'

import {
	createPushSubscription,
	deletePushSubscription,
	getPushPublicKey,
	type IPushSubscriptionPayload,
} from '@/services/pushSubscription'

// The id of the row the server created for this device. Kept so unsubscribing
// can delete exactly it; when it's missing (cleared storage, other browser
// profile) we re-post the endpoint to resolve the id instead.
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

/**
 * Drives this device's Web Push subscription: whether the instance offers it,
 * whether this browser can do it, and the subscribe/unsubscribe round trip.
 */
export function usePushNotifications() {
	const isSupported = browserSupportsPush()

	const supported = ref(isSupported)
	// Whether the instance has Web Push configured at all.
	const available = ref(false)
	const subscribed = ref(false)
	const loading = ref(false)
	const permission = ref<PushPermission>(
		isSupported ? Notification.permission as PushPermission : 'default',
	)

	let publicKey = ''

	async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
		if (!supported.value) {
			return null
		}
		// The service worker is only registered in production builds, so in dev
		// this never resolves — don't hang the settings page waiting for it.
		return await Promise.race([
			navigator.serviceWorker.ready,
			new Promise<null>(resolve => window.setTimeout(() => resolve(null), 3000)),
		])
	}

	async function load() {
		if (!supported.value) {
			return
		}

		loading.value = true
		try {
			const key = await getPushPublicKey()
			available.value = key.enabled
			publicKey = key.publicKey

			if (!available.value) {
				return
			}

			const registration = await getRegistration()
			if (registration === null) {
				return
			}
			subscribed.value = await registration.pushManager.getSubscription() !== null
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

			// Reuse an existing browser subscription: re-subscribing with a
			// different key silently breaks delivery to the old one.
			const subscription = await registration.pushManager.getSubscription()
				?? await registration.pushManager.subscribe({
					// iOS only delivers a push that shows a notification, so
					// there is no silent option to opt into here.
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
			const registration = await getRegistration()
			const subscription = await registration?.pushManager.getSubscription() ?? null

			if (subscription !== null) {
				const stored = window.localStorage.getItem(SUBSCRIPTION_ID_KEY)
				// Without a remembered id, post the endpoint first: the server
				// upserts and hands back the id of the row to delete.
				const id = stored !== null
					? Number(stored)
					: await createPushSubscription(toPayload(subscription))

				await deletePushSubscription(id)
				await subscription.unsubscribe()
			}

			window.localStorage.removeItem(SUBSCRIPTION_ID_KEY)
			subscribed.value = false
		} finally {
			loading.value = false
		}
	}

	onMounted(load)

	return {
		supported,
		available,
		subscribed,
		permission,
		loading,
		subscribe,
		unsubscribe,
	}
}
