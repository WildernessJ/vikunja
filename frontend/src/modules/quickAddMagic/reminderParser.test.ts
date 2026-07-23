import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {parseTaskText, PrefixMode} from '.'
import {parseDate} from './dateParser'

describe('Parse reminders from ~ syntax', () => {
	beforeEach(() => {
		// A Monday, so "next friday"/"tomorrow" resolve deterministically.
		vi.useFakeTimers()
		vi.setSystemTime(new Date(2024, 0, 1, 12, 0, 0))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('parses ~1d into a relative reminder one day before due', () => {
		const result = parseTaskText('Buy milk +Home ~1d', PrefixMode.Default)

		expect(result.reminders).toHaveLength(1)
		expect(result.reminders[0].relativePeriod).toBe(-86400)
		expect(result.reminders[0].relativeTo).toBe('due_date')
		expect(result.text).toBe('Buy milk')
	})

	it('parses ~2m into a relative reminder in minutes', () => {
		const result = parseTaskText('Ping ~2m', PrefixMode.Default)

		expect(result.reminders).toHaveLength(1)
		expect(result.reminders[0].relativePeriod).toBe(-120)
		expect(result.reminders[0].relativeTo).toBe('due_date')
	})

	it('parses ~3h into a relative reminder in hours', () => {
		const result = parseTaskText('Ping ~3h', PrefixMode.Default)

		expect(result.reminders).toHaveLength(1)
		expect(result.reminders[0].relativePeriod).toBe(-3 * 3600)
		expect(result.reminders[0].relativeTo).toBe('due_date')
	})

	it('parses ~2w into a relative reminder in weeks', () => {
		const result = parseTaskText('Ping ~2w', PrefixMode.Default)

		expect(result.reminders).toHaveLength(1)
		expect(result.reminders[0].relativePeriod).toBe(-2 * 604800)
		expect(result.reminders[0].relativeTo).toBe('due_date')
	})

	it('parses an absolute reminder from ~next friday at 9am', () => {
		const expected = parseDate('next friday at 9am', new Date()).date

		const result = parseTaskText('Call dentist ~next friday at 9am', PrefixMode.Default)

		expect(result.reminders).toHaveLength(1)
		expect(result.reminders[0].relativeTo).toBeNull()
		expect(result.reminders[0].reminder?.getTime()).toBe(expected?.getTime())
		expect(result.text).toBe('Call dentist')
	})

	it('does not also parse the absolute ~ reminder date as the due date', () => {
		const result = parseTaskText('Call dentist ~next friday at 9am', PrefixMode.Default)

		expect(result.date).toBeNull()
	})

	it('parses multiple reminders, mixed relative and absolute, alongside a deadline', () => {
		const expectedAbsolute = parseDate('tomorrow at 8am', new Date()).date

		const result = parseTaskText('Ship it {apr 15} ~2h ~tomorrow at 8am', PrefixMode.Default)

		expect(result.reminders).toHaveLength(2)

		const relative = result.reminders.find(r => r.relativeTo === 'due_date')
		const absolute = result.reminders.find(r => r.relativeTo === null)

		expect(relative?.relativePeriod).toBe(-2 * 3600)
		expect(absolute?.reminder?.getTime()).toBe(expectedAbsolute?.getTime())

		expect(result.deadline).not.toBeNull()
		expect(result.text).toBe('Ship it')
	})

	it('leaves an unparseable ~ token literal in the title with no reminder', () => {
		const result = parseTaskText('Read ~foo', PrefixMode.Default)

		expect(result.reminders).toHaveLength(0)
		expect(result.text).toBe('Read ~foo')
	})

	it('does not treat a mid-title ~2h ("approximately") as a reminder', () => {
		const result = parseTaskText('Drive ~2h to the coast', PrefixMode.Default)

		expect(result.reminders).toHaveLength(0)
		expect(result.text).toBe('Drive ~2h to the coast')
	})

	it('does not treat a mid-title ~1w followed by trailing prose as a reminder', () => {
		const result = parseTaskText('Meeting in ~1w though', PrefixMode.Default)

		expect(result.reminders).toHaveLength(0)
		expect(result.text).toBe('Meeting in ~1w though')
	})

	it('only parses the trailing ~ token, leaving an earlier mid-title ~ literal', () => {
		const result = parseTaskText('Call ~1d mom ~2h', PrefixMode.Default)

		expect(result.reminders).toHaveLength(1)
		expect(result.reminders[0].relativePeriod).toBe(-2 * 3600)
		expect(result.text).toBe('Call ~1d mom')
	})

	it('does not parse an absolute ~ token when non-date prose trails it', () => {
		const result = parseTaskText('Ping ~tomorrow lunch', PrefixMode.Default)

		expect(result.reminders).toHaveLength(0)
		expect(result.text).toBe('Ping ~tomorrow lunch')
	})

	it('does not parse ~ reminders in todoist mode', () => {
		const result = parseTaskText('Buy milk ~1d', PrefixMode.Todoist)

		expect(result.reminders).toHaveLength(0)
	})
})
