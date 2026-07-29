/// <reference lib="webworker" />

import {getFullBaseUrl} from './helpers/getFullBaseUrl'

declare let self: ServiceWorkerGlobalScope & typeof globalThis
declare const __WORKBOX_VERSION__: string

// Injected by workbox-cli via importScripts; no upstream types exist for this global.
declare const workbox: {
	setConfig: (config: { modulePathPrefix: string }) => void
	routing: {
		registerRoute: (pattern: RegExp, strategy: unknown) => void
	}
	strategies: {
		StaleWhileRevalidate: new () => unknown
		NetworkOnly: new (options: { fetchOptions: { cache: string } }) => unknown
	}
	core: {
		clientsClaim: () => void
	}
	precaching: {
		precacheAndRoute: (manifest: unknown[], options: Record<string, unknown>) => void
	}
}

declare global {
	interface ServiceWorkerGlobalScope {
		__precacheManifest?: unknown[]
	}
}

const fullBaseUrl = getFullBaseUrl()
const workboxVersion = __WORKBOX_VERSION__

importScripts(`${fullBaseUrl}workbox-${workboxVersion}/workbox-sw.js`)
workbox.setConfig({
	modulePathPrefix: `${fullBaseUrl}workbox-${workboxVersion}`,
})

import { precacheAndRoute } from 'workbox-precaching'
precacheAndRoute(self.__WB_MANIFEST)

// Cache assets
workbox.routing.registerRoute(
	// This regexp matches all files in precache-manifest
	new RegExp('.+\\.(css|json|js|svg|woff2|png|html|txt|wav)$'),
	new workbox.strategies.StaleWhileRevalidate(),
)

// Construct pattern with full base URL
const apiRoutePattern = new RegExp(`${fullBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}api\\/v1\\/.*$`)
// Always send api requests through the network and bypass the browser's HTTP cache
workbox.routing.registerRoute(
	apiRoutePattern,
	new workbox.strategies.NetworkOnly({
		fetchOptions: {
			cache: 'no-store',
		},
	}),
)

// This code listens for the user's confirmation to update the app.
self.addEventListener('message', (e: ExtendableMessageEvent) => {
	if (!e.data) {
		return
	}

	switch (e.data) {
		case 'skipWaiting':
			self.skipWaiting()
			break
		default:
			// NOOP
			break
	}
})

// The Badging API is not in the TS worker lib yet.
type BadgingWorkerNavigator = WorkerNavigator & {
	setAppBadge?: (count?: number) => Promise<void>
	clearAppBadge?: () => Promise<void>
}

interface BadgePushPayload {
	title?: string
	body?: string
	badgeCount?: number
	type?: string
}

// Mirrors the pushed count onto the app icon. Best-effort: the promise rejects
// on iOS depending on install and notification-permission state, and the API is
// missing entirely on some browsers.
function applyPushedBadge(count: number): Promise<void> {
	const nav = self.navigator as BadgingWorkerNavigator

	if (count > 0) {
		return nav.setAppBadge?.(count).catch(() => {}) ?? Promise.resolve()
	}
	return nav.clearAppBadge?.().catch(() => {}) ?? Promise.resolve()
}

// Badge refresh pushed by the server. iOS drops the push subscription of an app
// that receives a push without showing a notification, so every push shows one;
// users who only want the badge mute the surfaces in the OS settings instead.
self.addEventListener('push', (event: PushEvent) => {
	// A missing or unparseable payload is still a push that was accepted, so it
	// still has to surface something — returning early is exactly the silent
	// push iOS revokes the subscription over.
	let payload: BadgePushPayload = {}
	try {
		payload = event.data?.json() ?? {}
	} catch {
		// Keep the defaults.
	}

	const work: Promise<unknown>[] = [
		self.registration.showNotification(payload.title ?? 'Vikunja', {
			body: payload.body ?? '',
			icon: `${fullBaseUrl}images/icons/android-chrome-192x192.png`,
			badge: `${fullBaseUrl}images/icons/android-chrome-192x192.png`,
			// One tag for all badge pushes so a new count replaces the previous
			// one instead of stacking up a notification per refresh.
			tag: 'vikunja-badge',
			data: {type: payload.type},
		}),
	]

	// Without a count there is nothing to say about the badge; clearing it would
	// wipe a number that is still correct.
	if (typeof payload.badgeCount === 'number') {
		work.push(applyPushedBadge(payload.badgeCount))
	}

	event.waitUntil(Promise.all(work))
})

// Notification action
self.addEventListener('notificationclick', function (event: NotificationEvent) {
	const taskId = event.notification.data?.taskId
	event.notification.close()

	switch (event.action) {
		case 'show-task':
			event.waitUntil(self.clients.openWindow(`${fullBaseUrl}tasks/${taskId}`))
			break
		default:
			// Badge pushes carry no action; clicking one opens the app.
			event.waitUntil(self.clients.openWindow(
				taskId ? `${fullBaseUrl}tasks/${taskId}` : fullBaseUrl,
			))
	}
})

workbox.core.clientsClaim()
// The precaching code provided by Workbox.
self.__precacheManifest = ([] as unknown[]).concat(self.__precacheManifest || [])
workbox.precaching.precacheAndRoute(self.__precacheManifest, {})

