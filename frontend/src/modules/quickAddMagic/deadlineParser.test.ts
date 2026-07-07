import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {parseTaskText, PrefixMode} from '.'
import {parseDate} from './dateParser'

describe('Parse deadline from {…} syntax', () => {
	beforeEach(() => {
		// A Monday, so "next friday" resolves deterministically.
		vi.useFakeTimers()
		vi.setSystemTime(new Date(2024, 0, 1, 12, 0, 0))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('parses {next friday} into the deadline in default (vikunja) mode', () => {
		const now = new Date()
		const expected = parseDate('next friday', now).date

		const result = parseTaskText('file taxes {next friday}', PrefixMode.Default)

		expect(result.deadline).not.toBeNull()
		expect(result.deadline?.getTime()).toBe(expected?.getTime())
	})

	it('parses {next friday} into the deadline in todoist mode', () => {
		const now = new Date()
		const expected = parseDate('next friday', now).date

		const result = parseTaskText('file taxes {next friday}', PrefixMode.Todoist)

		expect(result.deadline).not.toBeNull()
		expect(result.deadline?.getTime()).toBe(expected?.getTime())
	})

	it('strips the braced deadline text from the title, keeping the due date separate', () => {
		const result = parseTaskText('file taxes tomorrow {next friday}')

		expect(result.text).toBe('file taxes')

		// Due date comes from the un-braced "tomorrow"
		expect(result.date).not.toBeNull()
		const tomorrow = new Date(2024, 0, 2)
		expect(result.date?.getFullYear()).toBe(tomorrow.getFullYear())
		expect(result.date?.getMonth()).toBe(tomorrow.getMonth())
		expect(result.date?.getDate()).toBe(tomorrow.getDate())

		// Deadline comes from the braced "next friday"
		const expectedDeadline = parseDate('next friday', new Date()).date
		expect(result.deadline?.getTime()).toBe(expectedDeadline?.getTime())
	})

	it('leaves the deadline null when there are no braces', () => {
		const result = parseTaskText('file taxes tomorrow')

		expect(result.deadline).toBeNull()
	})
})
