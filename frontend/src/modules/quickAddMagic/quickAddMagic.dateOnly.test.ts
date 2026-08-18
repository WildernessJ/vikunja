import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {parseTaskText, PrefixMode} from '.'

const NOW = new Date('2024-03-05T09:00:00')

describe('parseTaskText with dateOnly', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(NOW)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('threads the flag to the due date', () => {
		const {date} = parseTaskText('buy milk tomorrow', PrefixMode.Default, new Date(NOW), true)

		expect(date).toEqual(new Date('2024-03-06T23:59:59.999'))
	})

	it('threads the flag to a braced deadline', () => {
		const {deadline} = parseTaskText('file taxes {tomorrow}', PrefixMode.Default, new Date(NOW), true)

		expect(deadline).toEqual(new Date('2024-03-06T23:59:59.999'))
	})

	it('leaves a ~ reminder on its default time — a reminder is an alarm', () => {
		const withFlag = parseTaskText('call bob ~tomorrow', PrefixMode.Default, new Date(NOW), true)
		const withoutFlag = parseTaskText('call bob ~tomorrow', PrefixMode.Default, new Date(NOW), false)

		expect(withFlag.reminders[0].reminder).toEqual(withoutFlag.reminders[0].reminder)
		expect(withFlag.reminders[0].reminder?.getHours()).toBe(9)
	})

	it('is a no-op when the flag is off', () => {
		const {date} = parseTaskText('buy milk tomorrow', PrefixMode.Default, new Date(NOW), false)

		expect(date?.getHours()).toBe(9)
	})
})
