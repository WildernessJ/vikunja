import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {defineComponent, h, nextTick, ref} from 'vue'
import {mount, type VueWrapper} from '@vue/test-utils'

const {loadCountsMock, startOfTomorrowState} = vi.hoisted(() => ({
	loadCountsMock: vi.fn(),
	startOfTomorrowState: {
		mock: vi.fn(),
		actual: undefined as ((tz?: string) => Date) | undefined,
	},
}))

const todayTotal = ref(0)
const authUser = ref(true)
const timezone = ref('UTC')
const now = ref(new Date())

vi.mock('@/stores/projectCounts', () => ({
	useProjectCountsStore: () => ({
		todayTotal,
		loadCounts: loadCountsMock,
	}),
}))

vi.mock('@/stores/auth', () => ({
	useAuthStore: () => ({
		get authUser() {
			return authUser.value
		},
		settings: {
			get timezone() {
				return timezone.value
			},
		},
	}),
}))

vi.mock('@/composables/useGlobalNow', () => ({
	useGlobalNow: () => ({now, update: vi.fn()}),
}))

// Wrapped instead of replaced so single tests can force a broken return value
// (the DST case) while everything else runs against the real boundary math.
vi.mock('@/helpers/time/startOfTomorrow', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/helpers/time/startOfTomorrow')>()
	startOfTomorrowState.actual = actual.getStartOfTomorrowInTimezone
	return {getStartOfTomorrowInTimezone: startOfTomorrowState.mock}
})

import {useAppBadge} from './useAppBadge'

function mountComposable(): VueWrapper {
	return mount(defineComponent({
		setup() {
			useAppBadge()
			return () => h('div')
		},
	}))
}

// The composable reads the clock two ways — the shared `now` ref for the watch
// and dayjs() for the boundary — so a test must advance both together.
async function setNow(iso: string) {
	vi.setSystemTime(new Date(iso))
	now.value = new Date(iso)
	await nextTick()
}

// Counts are otherwise only fetched on sidebar mount and after task mutations
// in this client, so without these refreshes the badge silently goes stale —
// midnight rollover being the everyday case.
describe('useAppBadge count refreshing', () => {
	let wrapper: VueWrapper

	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-08-05T08:00:00Z'))
		now.value = new Date('2026-08-05T08:00:00Z')
		authUser.value = true
		timezone.value = 'UTC'
		loadCountsMock.mockReset()
		loadCountsMock.mockResolvedValue(undefined)
		startOfTomorrowState.mock.mockReset()
		startOfTomorrowState.mock.mockImplementation(tz => startOfTomorrowState.actual!(tz))
		wrapper = mountComposable()
	})

	afterEach(() => {
		wrapper.unmount()
		vi.useRealTimers()
	})

	it('reloads the counts when the day rolls over in the account timezone', async () => {
		await setNow('2026-08-06T00:01:00Z')

		expect(loadCountsMock).toHaveBeenCalledTimes(1)
	})

	it('does not reload before the day boundary', async () => {
		await setNow('2026-08-05T23:59:00Z')

		expect(loadCountsMock).not.toHaveBeenCalled()
	})

	it('reloads only once per rollover, then again the next day', async () => {
		await setNow('2026-08-06T00:01:00Z')
		await setNow('2026-08-06T00:02:00Z')
		expect(loadCountsMock).toHaveBeenCalledTimes(1)

		await setNow('2026-08-07T00:01:00Z')
		expect(loadCountsMock).toHaveBeenCalledTimes(2)
	})

	it('does not refetch every tick when the recomputed boundary fails to advance', async () => {
		// Around DST transitions the helper can return an instant up to an
		// hour in the past; the composable must force the boundary forward
		// instead of firing on every subsequent clock tick.
		startOfTomorrowState.mock.mockReturnValue(new Date('2026-08-06T00:00:00Z'))

		await setNow('2026-08-06T00:01:00Z')
		await setNow('2026-08-06T00:02:00Z')
		await setNow('2026-08-06T00:59:00Z')
		expect(loadCountsMock).toHaveBeenCalledTimes(1)

		// The forced boundary must stay near, not jump to the far future:
		// once the hour passes, refreshing resumes.
		await setNow('2026-08-06T01:02:00Z')
		expect(loadCountsMock).toHaveBeenCalledTimes(2)
	})

	it('follows the account timezone once the user settings load after mount', async () => {
		// At App mount the settings have not been fetched yet, so the
		// composable starts with an empty timezone and must pick up the real
		// one when it arrives.
		wrapper.unmount()
		timezone.value = ''
		wrapper = mountComposable()

		timezone.value = 'America/New_York'
		await nextTick()

		// 01:00 UTC on the 6th is still 21:00 on the 5th in New York.
		await setNow('2026-08-06T01:00:00Z')
		expect(loadCountsMock).not.toHaveBeenCalled()

		// 04:01 UTC is 00:01 in New York — the day rolled over.
		await setNow('2026-08-06T04:01:00Z')
		expect(loadCountsMock).toHaveBeenCalledTimes(1)
	})

	it('reloads the counts when the window regains focus', () => {
		window.dispatchEvent(new Event('focus'))

		expect(loadCountsMock).toHaveBeenCalledTimes(1)
	})

	it('throttles focus reloads to once a minute', async () => {
		window.dispatchEvent(new Event('focus'))
		window.dispatchEvent(new Event('focus'))
		expect(loadCountsMock).toHaveBeenCalledTimes(1)

		await setNow('2026-08-05T08:01:01Z')
		window.dispatchEvent(new Event('focus'))
		expect(loadCountsMock).toHaveBeenCalledTimes(2)
	})

	it('swallows reload failures', async () => {
		loadCountsMock.mockRejectedValue(new Error('network down'))

		window.dispatchEvent(new Event('focus'))
		await vi.waitFor(() => expect(loadCountsMock).toHaveBeenCalledTimes(1))
	})

	it('does not reload without a real user session (logged out or link share)', async () => {
		authUser.value = false

		window.dispatchEvent(new Event('focus'))
		await setNow('2026-08-06T00:01:00Z')

		expect(loadCountsMock).not.toHaveBeenCalled()
	})
})

describe('useAppBadge badge application', () => {
	let wrapper: VueWrapper
	const setAppBadge = vi.fn().mockResolvedValue(undefined)
	const clearAppBadge = vi.fn().mockResolvedValue(undefined)

	beforeEach(() => {
		Object.defineProperty(window.navigator, 'setAppBadge', {value: setAppBadge, configurable: true})
		Object.defineProperty(window.navigator, 'clearAppBadge', {value: clearAppBadge, configurable: true})
		setAppBadge.mockClear()
		clearAppBadge.mockClear()
		todayTotal.value = 0
		wrapper = mountComposable()
	})

	afterEach(() => {
		wrapper.unmount()
		delete (window.navigator as unknown as Record<string, unknown>).setAppBadge
		delete (window.navigator as unknown as Record<string, unknown>).clearAppBadge
	})

	it('mirrors the today count onto the app badge', async () => {
		todayTotal.value = 3
		await nextTick()

		expect(setAppBadge).toHaveBeenCalledWith(3)
	})

	it('clears the badge when nothing is due', async () => {
		todayTotal.value = 3
		await nextTick()
		// The immediate watch already cleared once at mount; only the 3 → 0
		// transition may add another call.
		clearAppBadge.mockClear()

		todayTotal.value = 0
		await nextTick()

		expect(clearAppBadge).toHaveBeenCalledTimes(1)
	})
})
