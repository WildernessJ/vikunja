import {describe, expect, it} from 'vitest'

import {getRepeats} from './repeatParser'
import {REPEAT_TYPES} from '@/types/IRepeatAfter'
import {TASK_REPEAT_MODES} from '@/types/IRepeatMode'

// Fixed reference date so "starting"/"until" bounds resolve deterministically.
const NOW = new Date(2026, 0, 15, 12, 0, 0)

describe('getRepeats — calendar patterns (RRULE)', () => {
	it('parses a weekday list', () => {
		const result = getRepeats('every mon, fri', NOW)
		expect(result.rruleRepeat?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,FR')
		expect(result.rruleRepeat?.mode).toBe(TASK_REPEAT_MODES.REPEAT_MODE_RRULE)
		expect(result.repeats).toBeNull()
		expect(result.textWithoutMatched.trim()).toBe('')
	})

	it('parses a single full weekday name', () => {
		const result = getRepeats('every monday', NOW)
		expect(result.rruleRepeat?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
		expect(result.repeats).toBeNull()
	})

	it('parses an ordinal weekday', () => {
		const result = getRepeats('every 3rd friday', NOW)
		expect(result.rruleRepeat?.rrule).toBe('FREQ=MONTHLY;BYDAY=3FR')
	})

	it('parses "every last day" as last day of month', () => {
		const result = getRepeats('every last day', NOW)
		expect(result.rruleRepeat?.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=-1')
	})

	it('parses "every last workday" as last workday of month', () => {
		const result = getRepeats('every last workday', NOW)
		expect(result.rruleRepeat?.rrule).toBe('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1')
	})

	it('parses a month-day set', () => {
		const result = getRepeats('every 2, 15, 27', NOW)
		expect(result.rruleRepeat?.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=2,15,27')
	})

	it('parses a "starting" bound into the start date, leaving the rrule clean', () => {
		const result = getRepeats('every mon starting aug 3', NOW)
		expect(result.rruleRepeat?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
		expect(result.rruleRepeat?.startDate).not.toBeNull()
		expect(result.rruleRepeat?.startDate?.getMonth()).toBe(7) // August
		expect(result.rruleRepeat?.startDate?.getDate()).toBe(3)
		expect(result.textWithoutMatched.trim()).toBe('')
	})

	it('parses an "until" bound into the rrule UNTIL component', () => {
		const result = getRepeats('every mon until dec 1', NOW)
		expect(result.rruleRepeat?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261201T000000Z')
		expect(result.textWithoutMatched.trim()).toBe('')
	})

	it('sets fromCompletion for the every! prefix', () => {
		const result = getRepeats('every! mon', NOW)
		expect(result.rruleRepeat?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
		expect(result.rruleRepeat?.fromCompletion).toBe(true)
	})

	it('does not set fromCompletion for a plain every prefix', () => {
		const result = getRepeats('every mon', NOW)
		expect(result.rruleRepeat?.fromCompletion).toBe(false)
	})
})

describe('getRepeats — legacy interval mode unchanged', () => {
	it('keeps "every 2 weeks" as interval mode, not rrule', () => {
		const result = getRepeats('every 2 weeks', NOW)
		expect(result.rruleRepeat).toBeNull()
		expect(result.repeats?.type).toBe(REPEAT_TYPES.Weeks)
		expect(result.repeats?.amount).toBe(2)
	})

	it('keeps "every month" as interval mode, not rrule', () => {
		const result = getRepeats('every month', NOW)
		expect(result.rruleRepeat).toBeNull()
		expect(result.repeats?.type).toBe(REPEAT_TYPES.Months)
		expect(result.repeats?.amount).toBe(1)
	})
})
