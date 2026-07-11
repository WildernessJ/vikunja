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

// Notification action
self.addEventListener('notificationclick', function (event: NotificationEvent) {
	const taskId = event.notification.data.taskId
	event.notification.close()

	switch (event.action) {
		case 'show-task':
			self.clients.openWindow(`${fullBaseUrl}tasks/${taskId}`)
			break
	}
})

workbox.core.clientsClaim()
// The precaching code provided by Workbox.
self.__precacheManifest = ([] as unknown[]).concat(self.__precacheManifest || [])
workbox.precaching.precacheAndRoute(self.__precacheManifest, {})

