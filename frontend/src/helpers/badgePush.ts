// The service worker's half of the badge-push contract (see pkg/models/push_badge.go).
// It lives here rather than inline in sw.ts because sw.ts can only be loaded with
// the workbox globals and the build-time precache manifest in place, and the
// "always show a notification" rule below is too load-bearing to leave untested.

// The Badging API is not in the TS worker lib yet.
export type BadgingNavigator = {
	setAppBadge?: (count?: number) => Promise<void>
	clearAppBadge?: () => Promise<void>
}

interface BadgePushPayload {
	title?: string
	body?: string
	badgeCount?: number
	type?: string
}

// Only the parts of the real types this needs, so the handler can be driven
// without a service worker.
interface BadgePushEvent {
	data?: {json: () => unknown} | null
}

interface BadgeNotificationRegistration {
	showNotification(title: string, options?: {
		body?: string
		icon?: string
		badge?: string
		tag?: string
		data?: unknown
	}): Promise<void>
}

// Mirrors the pushed count onto the app icon. Best-effort: the promise rejects
// on iOS depending on install and notification-permission state, and the API is
// missing entirely on some browsers.
function applyPushedBadge(nav: BadgingNavigator, count: number): Promise<void> {
	if (count > 0) {
		return nav.setAppBadge?.(count).catch(() => {}) ?? Promise.resolve()
	}
	return nav.clearAppBadge?.().catch(() => {}) ?? Promise.resolve()
}

function parsePayload(event: BadgePushEvent): BadgePushPayload {
	try {
		const parsed = event.data?.json()
		return typeof parsed === 'object' && parsed !== null ? parsed as BadgePushPayload : {}
	} catch {
		return {}
	}
}

/**
 * Handles a badge refresh pushed by the server. iOS drops the push subscription
 * of an app that receives a push without showing a notification, so every push
 * shows one — including one whose payload is missing or unparseable, which is
 * still a push that was accepted. Users who only want the badge mute the
 * surfaces in the OS settings instead.
 */
export function handleBadgePush(
	event: BadgePushEvent,
	registration: BadgeNotificationRegistration,
	nav: BadgingNavigator,
	baseUrl: string,
): Promise<unknown> {
	const payload = parsePayload(event)

	const work: Promise<unknown>[] = [
		registration.showNotification(payload.title ?? 'Vikunja', {
			body: payload.body ?? '',
			icon: `${baseUrl}images/icons/android-chrome-192x192.png`,
			badge: `${baseUrl}images/icons/android-chrome-192x192.png`,
			// One tag for all badge pushes so a new count replaces the previous
			// one instead of stacking up a notification per refresh.
			tag: 'vikunja-badge',
			data: {type: payload.type},
		}),
	]

	// Without a count there is nothing to say about the badge; clearing it would
	// wipe a number that is still correct.
	if (typeof payload.badgeCount === 'number') {
		work.push(applyPushedBadge(nav, payload.badgeCount))
	}

	return Promise.all(work)
}
