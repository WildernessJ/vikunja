import {describe, it, expect, beforeAll, afterAll} from 'vitest'

import {daySpan} from './daySpan'
import {roundToNaturalDayBoundary} from './roundToNaturalDayBoundary'

describe('daySpan', () => {
	it('counts a 25-hour fall-back day as one day', () => {
		// tests run in America/Los_Angeles, where 2026-11-01 is 25 hours long
		expect(daySpan(new Date(2026, 9, 30), new Date(2026, 10, 5, 23, 59, 59, 999))).toBe(7)
	})

	it('counts a 23-hour spring-forward day as one day', () => {
		expect(daySpan(new Date(2026, 2, 7), new Date(2026, 2, 9, 23, 59, 59, 999))).toBe(3)
	})

	// In Cairo, DST starts at midnight: 2026-04-24 00:00 does not exist, so the start of that day is 01:00.
	describe('where DST starts at midnight', () => {
		let previous: string | undefined
		beforeAll(() => {
			previous = process.env.TZ
			process.env.TZ = 'Africa/Cairo'
		})
		afterAll(() => {
			process.env.TZ = previous
		})

		it('counts whole days to a start that falls on the DST day', () => {
			const start = roundToNaturalDayBoundary(new Date(2026, 3, 24, 9, 0), true)
			expect(daySpan(new Date(2026, 0, 1), start)).toBe(113)
		})

		it('counts whole days to an end that rounds back to the DST day', () => {
			const end = roundToNaturalDayBoundary(new Date(2026, 3, 24, 9, 0))
			expect(daySpan(new Date(2026, 3, 21), end)).toBe(3)
		})
	})
})
