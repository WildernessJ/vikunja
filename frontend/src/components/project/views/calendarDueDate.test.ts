import {describe, it, expect} from 'vitest'

import {calendarDueDateForDay} from './calendarDueDate'

describe('calendarDueDateForDay', () => {
	const day = new Date(2026, 7, 18, 9, 30)

	it('defaults to noon, clear of the midnight timezone boundary', () => {
		const due = calendarDueDateForDay(day, false)
		expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([2026, 7, 18])
		expect([due.getHours(), due.getMinutes(), due.getSeconds(), due.getMilliseconds()]).toEqual([12, 0, 0, 0])
	})

	it('snaps to end of day in date-only mode', () => {
		const due = calendarDueDateForDay(day, true)
		expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([2026, 7, 18])
		expect([due.getHours(), due.getMinutes(), due.getSeconds(), due.getMilliseconds()]).toEqual([23, 59, 59, 999])
	})
})
