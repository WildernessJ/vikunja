import {watch} from 'vue'
import {storeToRefs} from 'pinia'

import {useProjectCountsStore} from '@/stores/projectCounts'
import {isDesktopApp} from '@/helpers/desktopAuth'

// The Badging API is not in the TS DOM lib yet.
type BadgingNavigator = Navigator & {
	setAppBadge?: (count?: number) => Promise<void>
	clearAppBadge?: () => Promise<void>
}

// Mirrors the Today count onto the application icon: the macOS dock badge when
// running in the desktop wrapper, otherwise the installed-PWA icon badge via
// the Web Badging API. Best-effort — silently ignored where unsupported.
export function useAppBadge() {
	const {todayTotal} = storeToRefs(useProjectCountsStore())

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
}
