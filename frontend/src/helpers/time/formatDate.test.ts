import {describe, expect, it} from 'vitest'

import {formatDateSinceDay, formatDisplayDateFormat} from './formatDate'
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
