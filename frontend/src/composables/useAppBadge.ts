import {watch} from 'vue'
import {storeToRefs} from 'pinia'
import {useEventListener, useThrottleFn} from '@vueuse/core'

import {useProjectCountsStore} from '@/stores/projectCounts'
import {useAuthStore} from '@/stores/auth'
import {useGlobalNow} from '@/composables/useGlobalNow'
import {getStartOfTomorrowInTimezone} from '@/helpers/time/startOfTomorrow'
import {isDesktopApp} from '@/helpers/desktopAuth'
import {MILLISECONDS_A_HOUR, MILLISECONDS_A_MINUTE} from '@/constants/date'

// The Badging API is not in the TS DOM lib yet.
type BadgingNavigator = Navigator & {
	setAppBadge?: (count?: number) => Promise<void>
	clearAppBadge?: () => Promise<void>
}

// Mirrors the Today count onto the application icon: the macOS dock badge when
// running in the desktop wrapper, otherwise the installed-PWA icon badge via
// the Web Badging API. Best-effort — silently ignored where unsupported.
export function useAppBadge() {
	const authStore = useAuthStore()
	const projectCountsStore = useProjectCountsStore()
	const {todayTotal} = storeToRefs(projectCountsStore)
	const {now} = useGlobalNow()

	function applyBadge(count: number) {
		const n = count > 0 ? count : 0

		if (isDesktopApp()) {
			window.vikunjaDesktop?.setBadgeCount(n)
			return
		}

		const nav = navigator as BadgingNavigator
		if (typeof nav.setAppBadge !== 'function') {
			return
		}
		// Promises can reject on Safari/iOS depending on install and
		// notification-permission state; swallow so it never surfaces as an
		// unhandled rejection.
		if (n > 0) {
			nav.setAppBadge(n).catch(() => {})
		} else {
			nav.clearAppBadge?.().catch(() => {})
		}
	}

	watch(todayTotal, applyBadge, {immediate: true})

	// Counts are otherwise fetched only on sidebar mount and after task
	// mutations in this client, so the badge goes stale whenever the due-today
	// set changes without one: tasks crossing the day boundary, or edits made
	// from another device. Refresh on rollover and on window focus.
	//
	// Gated on authUser, not authenticated: link-share sessions count as
	// authenticated but get a 403 from the counts endpoint. Best-effort like
	// the badge itself, hence the swallowed rejection — these fire exactly
	// when the network may be gone (wake from sleep, midnight on a closed
	// laptop).
	function reloadCounts() {
		if (!authStore.authUser) {
			return
		}
		projectCountsStore.loadCounts().catch(() => {})
	}

	// The timezone setting is empty until checkAuth() has loaded the user
	// settings (App setup runs first), so the boundary must follow it instead
	// of being computed once.
	let dayBoundary = getStartOfTomorrowInTimezone(authStore.settings.timezone)
	watch(() => authStore.settings.timezone, (tz) => {
		dayBoundary = getStartOfTomorrowInTimezone(tz)
	})

	watch(now, (current) => {
		if (current < dayBoundary) {
			return
		}
		dayBoundary = getStartOfTomorrowInTimezone(authStore.settings.timezone)
		// Around DST transitions the helper can return an instant up to an
		// hour before the real midnight it aims for — without forcing the
		// boundary forward, that turns this watch into a refetch on every
		// tick until the clocks agree again.
		if (dayBoundary <= current) {
			dayBoundary = new Date(current.getTime() + MILLISECONDS_A_HOUR)
		}
		reloadCounts()
	})

	useEventListener('focus', useThrottleFn(reloadCounts, MILLISECONDS_A_MINUTE))
}
