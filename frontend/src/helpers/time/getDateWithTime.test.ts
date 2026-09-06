import {beforeEach, describe, expect, it, vi} from 'vitest'
import {setActivePinia, createPinia} from 'pinia'

import {getDateWithTime, getDefaultTimeParts, parseUserDefaultTime} from './getDateWithTime'
import {useAuthStore} from '@/stores/auth'
import type {IFrontendSettings} from '@/modelTypes/IUserSettings'

function setFrontendSettings(settings: {defaultDueTime?: string, dateOnly?: boolean}) {
	const authStore = useAuthStore()
	authStore.setUserSettings({
		...authStore.settings,
		frontendSettings: {
			// the store exposes settings as DeepReadonly, so the spread needs widening back
			...(authStore.settings.frontendSettings as IFrontendSettings),
			...settings,
		},
	})
}

function setDefaultDueTime(defaultDueTime?: string) {
	setFrontendSettings({defaultDueTime})
}

describe('getDateWithTime', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		useAuthStore()
	})

	it('uses the user default due time when configured', () => {
		setDefaultDueTime('14:30')

		const date = new Date(2026, 7, 4, 9, 15)
		const result = getDateWithTime(date)

		expect(result.getFullYear()).toBe(2026)
		expect(result.getMonth()).toBe(7)
		expect(result.getDate()).toBe(4)
		expect(result.getHours()).toBe(14)
		expect(result.getMinutes()).toBe(30)
	})

	it('falls back to the current nearest-hours default when the setting is empty', () => {
		setDefaultDueTime(undefined)

		const date = new Date(2026, 7, 4, 10, 15)
		const result = getDateWithTime(date)

		expect(result.getHours()).toBe(12)
		expect(result.getMinutes()).toBe(0)
	})

	it('returns end of day in date-only mode, ignoring the default due time', () => {
		setFrontendSettings({dateOnly: true, defaultDueTime: '14:30'})

		const result = getDateWithTime(new Date(2026, 7, 4, 9, 15))

		expect(result.getHours()).toBe(23)
		expect(result.getMinutes()).toBe(59)
		expect(result.getSeconds()).toBe(59)
		expect(result.getMilliseconds()).toBe(999)
	})

	it('returns end of day in date-only mode even before noon', () => {
		setFrontendSettings({dateOnly: true, defaultDueTime: undefined})

		const result = getDateWithTime(new Date(2026, 7, 4, 3, 0))

		expect(result.getDate()).toBe(4)
		expect(result.getHours()).toBe(23)
		expect(result.getMinutes()).toBe(59)
	})

	it('falls back when the stored time cannot be parsed', () => {
		setDefaultDueTime('25:99')

		const date = new Date(2026, 7, 4, 10, 15)
		const result = getDateWithTime(date)

		expect(result.getHours()).toBe(12)
		expect(result.getMinutes()).toBe(0)
	})
})

describe('parseUserDefaultTime', () => {
	it('returns fallback parts when no user value is configured', () => {
		setDefaultDueTime(undefined)

		expect(getDefaultTimeParts(new Date(2026, 7, 4, 10, 15))).toStrictEqual({hours: 12, minutes: 0})
	})

	it('parses valid times', () => {
		expect(parseUserDefaultTime('09:45')).toStrictEqual({hours: 9, minutes: 45})
	})

	it('rejects invalid values', () => {
		expect(parseUserDefaultTime(undefined)).toBeNull()
		expect(parseUserDefaultTime('9:45')).toBeNull()
		expect(parseUserDefaultTime('24:00')).toBeNull()
		expect(parseUserDefaultTime('12:60')).toBeNull()
	})
})
