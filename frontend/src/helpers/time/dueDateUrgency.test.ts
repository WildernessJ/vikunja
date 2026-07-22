import {describe, it, expect} from 'vitest'
import {getDueDateUrgency} from './dueDateUrgency'

// Wednesday. Buckets are calendar-day based in the local timezone, so times of
// day only matter for the today/overdue boundary (midnight), never within a day.
const NOW = new Date('2026-07-22T15:00:00')

describe('getDueDateUrgency', () => {
	it('returns null when there is no due date', () => {
		expect(getDueDateUrgency(null, NOW)).toBeNull()
		expect(getDueDateUrgency(undefined, NOW)).toBeNull()
	})

	it('treats the zero/epoch date as no due date', () => {
		expect(getDueDateUrgency(new Date(0), NOW)).toBeNull()
	})

	it('buckets a date before today as overdue', () => {
		expect(getDueDateUrgency(new Date('2026-07-21T23:59:00'), NOW)).toBe('overdue')
	})

	it('buckets any time earlier today as today, not overdue', () => {
		expect(getDueDateUrgency(new Date('2026-07-22T09:00:00'), NOW)).toBe('today')
	})

	it('buckets a later time today as today', () => {
		expect(getDueDateUrgency(new Date('2026-07-22T23:00:00'), NOW)).toBe('today')
	})

	it('buckets the next calendar day as tomorrow', () => {
		expect(getDueDateUrgency(new Date('2026-07-23T10:00:00'), NOW)).toBe('tomorrow')
	})

	it('buckets a later day in the same week as this-week', () => {
		expect(getDueDateUrgency(new Date('2026-07-24T10:00:00'), NOW)).toBe('this-week')
	})

	it('buckets a date two weeks out as later', () => {
		expect(getDueDateUrgency(new Date('2026-08-05T10:00:00'), NOW)).toBe('later')
	})

	it('prefers tomorrow over this-week even when tomorrow crosses a week boundary', () => {
		// Saturday now; Sunday is both "tomorrow" and the start of the next week.
		const saturday = new Date('2026-07-25T12:00:00')
		expect(getDueDateUrgency(new Date('2026-07-26T09:00:00'), saturday)).toBe('tomorrow')
	})

	it('honours the user week-start when bucketing this-week vs later', () => {
		// NOW is Wednesday 2026-07-22. Sunday 2026-07-26 is +4 days.
		// Sunday-start weeks (0): current week ends Sat 25 → the 26th is 'later'.
		expect(getDueDateUrgency(new Date('2026-07-26T12:00:00'), NOW, 0)).toBe('later')
		// Monday-start weeks (1): current week ends Sun 26 → the 26th is 'this-week'.
		expect(getDueDateUrgency(new Date('2026-07-26T12:00:00'), NOW, 1)).toBe('this-week')
	})
})
