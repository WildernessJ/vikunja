import {beforeEach, describe, expect, it} from 'vitest'
import {createPinia, setActivePinia} from 'pinia'

import {dateIsValid, formatDate, formatDateLong, formatDateSinceDay, formatDisplayDateFormat, formatISO} from './formatDate'
import {DATE_DISPLAY} from '@/constants/dateDisplay'
import {TIME_FORMAT} from '@/constants/timeFormat'

const DATE = new Date('2024-03-05T15:30:00')

function daysFromNow(days: number): Date {
	const d = new Date()
	d.setDate(d.getDate() + days)
	return d
}

describe('formatDisplayDateFormat with dateOnly', () => {
	it('drops the time from a slash format, leaving no trailing space', () => {
		expect(formatDisplayDateFormat(DATE, DATE_DISPLAY.DD_SLASH_MM_YYYY, TIME_FORMAT.HOURS_24, true))
			.toBe('05/03/2024')
	})

	it('drops the time from an Intl format', () => {
		const formatted = formatDisplayDateFormat(DATE, DATE_DISPLAY.DAY_MONTH_YEAR, TIME_FORMAT.HOURS_24, true)

		expect(formatted).not.toMatch(/\d{1,2}:\d{2}/)
		expect(formatted).toContain('2024')
	})

	it('keeps the time when the flag is off', () => {
		expect(formatDisplayDateFormat(DATE, DATE_DISPLAY.DD_SLASH_MM_YYYY, TIME_FORMAT.HOURS_24))
			.toBe('05/03/2024 15:30')
	})
})

describe('formatDateLong with dateOnly', () => {
	it('drops the time', () => {
		expect(formatDateLong(DATE, true)).not.toMatch(/\d{1,2}:\d{2}/)
	})

	it('keeps the time when the flag is off', () => {
		expect(formatDateLong(DATE)).toMatch(/\d{1,2}:\d{2}/)
	})
})

describe('formatDateSinceDay', () => {
	it('names today, tomorrow and yesterday', () => {
		expect(formatDateSinceDay(daysFromNow(0))).toBe('Today')
		expect(formatDateSinceDay(daysFromNow(1))).toBe('Tomorrow')
		expect(formatDateSinceDay(daysFromNow(-1))).toBe('Yesterday')
	})

	it('clamps further dates to day granularity', () => {
		expect(formatDateSinceDay(daysFromNow(3))).toBe('in 3 days')
		expect(formatDateSinceDay(daysFromNow(-3))).toBe('3 days ago')
	})

	it('returns an empty string for an invalid date', () => {
		expect(formatDateSinceDay(null)).toBe('')
	})
})

describe('dateIsValid', () => {
	it.each([
		['a valid date', new Date('2021-02-06T12:00:00Z'), true],
		['a valid date string', '2021-02-06 12:00', true],
		['an invalid date', new Date('not a date'), false],
		['an unparseable string', 'not a date', false],
		['null', null, false],
		['undefined', undefined, false],
		['the api zero time', '0001-01-01T00:00:00Z', false],
	])('returns %s', (_name, date, expected) => {
		expect(dateIsValid(date)).toBe(expected)
	})
})

describe('formatISO', () => {
	it('formats a valid date', () => {
		expect(formatISO(new Date('2021-02-06T12:00:00Z'))).toBe('2021-02-06T12:00:00.000Z')
	})

	it.each([
		['an invalid date', new Date('not a date')],
		['null', null],
		['undefined', undefined],
		['the api zero time', '0001-01-01T00:00:00Z'],
	])('returns an empty string for %s', (_name, date) => {
		expect(formatISO(date)).toBe('')
	})
})

describe('formatDate', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
	})

	it('formats a valid date', () => {
		expect(formatDate(new Date(2021, 1, 6, 12, 0), 'YYYY-MM-DD')).toBe('2021-02-06')
	})

	it.each([
		['an invalid date', new Date('not a date')],
		['null', null],
		['undefined', undefined],
		['the api zero time', '0001-01-01T00:00:00Z'],
	])('returns an empty string for %s', (_name, date) => {
		expect(formatDate(date, 'YYYY-MM-DD')).toBe('')
	})
})
