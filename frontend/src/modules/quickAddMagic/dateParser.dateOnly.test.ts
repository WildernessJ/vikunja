import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {parseDate} from './dateParser'

// 09:00 exactly: calculateNearestHours returns 9, so every default-time path lands
// before noon — where roundToNaturalDayBoundary's heuristic alone would give 00:00.
// Anything asserting 23:59:59.999 therefore proves the forced end-of-day ran.
const NOW = new Date('2024-03-05T09:00:00')

function endOfDayOf(date: Date): Date {
	const d = new Date(date)
	d.setHours(23, 59, 59, 999)
	return d
}

describe('parseDate with dateOnly', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(NOW)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('gives a bare "tomorrow" the canonical end of day', () => {
		const {date} = parseDate('foo tomorrow', new Date(NOW), true)

		expect(date).toEqual(endOfDayOf(new Date('2024-03-06T00:00:00')))
	})

	it('keeps an explicit "at 3pm" time', () => {
		const {date} = parseDate('foo tomorrow at 3pm', new Date(NOW), true)

		expect(date).toEqual(new Date('2024-03-06T15:00:00.000'))
	})

	it('keeps "tonight" at 21:00 — an intentional time, not a default', () => {
		const {date} = parseDate('foo tonight', new Date(NOW), true)

		expect(date?.getHours()).toBe(21)
		expect(date?.getDate()).toBe(5)
	})

	it('gives "next week" the canonical end of day', () => {
		const {date} = parseDate('foo next week', new Date(NOW), true)

		expect(date).toEqual(endOfDayOf(new Date('2024-03-12T00:00:00')))
	})

	it('gives a weekday the canonical end of day', () => {
		const {date} = parseDate('foo monday', new Date(NOW), true)

		expect(date).toEqual(endOfDayOf(new Date('2024-03-11T00:00:00')))
	})

	it('gives an ordinal day the canonical end of day', () => {
		const {date} = parseDate('foo 24th', new Date(NOW), true)

		expect(date).toEqual(endOfDayOf(new Date('2024-03-24T00:00:00')))
	})

	it('gives a numeric date the canonical end of day', () => {
		const {date} = parseDate('foo 2024-04-02', new Date(NOW), true)

		expect(date).toEqual(endOfDayOf(new Date('2024-04-02T00:00:00')))
	})

	it('gives "in 3 days" the canonical end of day', () => {
		const {date} = parseDate('foo in 3 days', new Date(NOW), true)

		expect(date).toEqual(endOfDayOf(new Date('2024-03-08T00:00:00')))
	})

	it('leaves "in 3 hours" on its computed clock time', () => {
		const {date} = parseDate('foo in 3 hours', new Date(NOW), true)

		expect(date).toEqual(new Date('2024-03-05T12:00:00'))
	})

	it('gives "end of month" the canonical end of day', () => {
		const {date} = parseDate('foo end of month', new Date(NOW), true)

		expect(date).toEqual(endOfDayOf(new Date('2024-03-31T00:00:00')))
	})

	it('leaves a bare time expression alone', () => {
		const {date} = parseDate('foo at 14:00', new Date(NOW), true)

		expect(date).toEqual(new Date('2024-03-05T14:00:00.000'))
	})

	it('is a no-op when the flag is off', () => {
		const withFlagOff = parseDate('foo tomorrow', new Date(NOW), false)
		const withNoFlag = parseDate('foo tomorrow', new Date(NOW))

		expect(withFlagOff.date).toEqual(withNoFlag.date)
		expect(withFlagOff.date?.getHours()).toBe(9)
	})
})
