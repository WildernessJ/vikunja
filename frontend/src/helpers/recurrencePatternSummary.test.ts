import {describe, expect, it} from 'vitest'

import {buildRecurrencePatternSummary, buildQuickAddRepeatsLabel} from '@/helpers/recurrencePatternSummary'
import {REPEAT_TYPES} from '@/types/IRepeatAfter'
import {TASK_REPEAT_MODES} from '@/types/IRepeatMode'

// A minimal stand-in for vue-i18n's t(): interpolates {param} against a fixed
// table of the keys this helper actually uses, mirroring their en.json text.
const MESSAGES: Record<string, string> = {
	'task.repeat.weekdayShort.mo': 'Mon',
	'task.repeat.weekdayShort.tu': 'Tue',
	'task.repeat.weekdayShort.we': 'Wed',
	'task.repeat.weekdayShort.fr': 'Fri',
	'task.repeat.weekdayShort.sa': 'Sat',
	'task.repeat.ordinal.1': 'first',
	'task.repeat.ordinal.last': 'last',
	'task.repeat.summaryWeekly': 'weekly on {days}',
	'task.repeat.summaryIntervalWeekly': 'every {n} weeks on {days}',
	'task.repeat.summaryMonthlyDay': 'monthly on day {day}',
	'task.repeat.summaryMonthlyNth': 'monthly on the {ordinal} {weekday}',
	'task.repeat.summaryIntervalMonthlyNth': 'every {n} months on the {ordinal} {weekday}',
	'task.repeat.onLastDay': 'On the last day of the month',
	'task.repeat.onLastWorkday': 'On the last workday of the month',
	'task.repeat.endsOn': 'Ends on',
	'task.repeat.patternSummary': 'Repeats {summary}',
	'task.repeat.hours': 'Hours',
	'task.repeat.days': 'Days',
	'task.repeat.unitWeeks': 'weeks',
	'task.repeat.unitMonths': 'months',
	'input.datemathHelp.units.years': 'Years',
	'task.quickAdd.repeatsEvery': 'Repeats every {amount} {type}',
}

function t(key: string, params: Record<string, unknown> = {}): string {
	const message = MESSAGES[key]
	if (typeof message === 'undefined') {
		throw new Error(`no test message for key ${key}`)
	}
	return message.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
}

describe('buildRecurrencePatternSummary', () => {
	it('returns an empty string for an empty rule', () => {
		expect(buildRecurrencePatternSummary('', t)).toBe('')
	})

	it('describes a weekly pattern', () => {
		expect(buildRecurrencePatternSummary('FREQ=WEEKLY;BYDAY=MO,WE,FR', t))
			.toBe('weekly on Mon, Wed, Fri')
	})

	it('describes a weekly pattern with an interval', () => {
		expect(buildRecurrencePatternSummary('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', t))
			.toBe('every 2 weeks on Tue')
	})

	it('describes a monthly day-of-month pattern', () => {
		expect(buildRecurrencePatternSummary('FREQ=MONTHLY;BYMONTHDAY=15', t))
			.toBe('monthly on day 15')
	})

	it('describes a monthly nth-weekday pattern', () => {
		expect(buildRecurrencePatternSummary('FREQ=MONTHLY;BYDAY=-1SA', t))
			.toBe('monthly on the last Sat')
	})

	it('describes a monthly nth-weekday pattern with an interval', () => {
		expect(buildRecurrencePatternSummary('FREQ=MONTHLY;INTERVAL=3;BYDAY=1MO', t))
			.toBe('every 3 months on the first Mon')
	})

	it('describes the last day of the month', () => {
		expect(buildRecurrencePatternSummary('FREQ=MONTHLY;BYMONTHDAY=-1', t))
			.toBe('On the last day of the month')
	})

	it('describes the last workday of the month', () => {
		expect(buildRecurrencePatternSummary('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', t))
			.toBe('On the last workday of the month')
	})

	it('appends the end date when the rule has an UNTIL bound', () => {
		const result = buildRecurrencePatternSummary('FREQ=WEEKLY;BYDAY=MO;UNTIL=20260901T000000Z', t)
		expect(result).toContain('weekly on Mon')
		expect(result).toContain('Ends on')
	})
})

describe('buildQuickAddRepeatsLabel', () => {
	it('returns null when there is no recurrence', () => {
		expect(buildQuickAddRepeatsLabel(null, t)).toBeNull()
		expect(buildQuickAddRepeatsLabel(undefined, t)).toBeNull()
	})

	it('wraps an RRULE pattern summary with the "Repeats" phrase', () => {
		const result = buildQuickAddRepeatsLabel({
			mode: TASK_REPEAT_MODES.REPEAT_MODE_RRULE,
			rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
			fromCompletion: false,
			startDate: null,
		}, t)

		expect(result).toBe('Repeats weekly on Mon, Wed, Fri')
	})

	it('describes a legacy interval repeat using a sentence-friendly unit', () => {
		const result = buildQuickAddRepeatsLabel({amount: 2, type: REPEAT_TYPES.Weeks}, t)
		expect(result).toBe('Repeats every 2 weeks')
	})

	it('falls back to the standalone unit label when no lowercase key exists', () => {
		const result = buildQuickAddRepeatsLabel({amount: 3, type: REPEAT_TYPES.Years}, t)
		expect(result).toBe('Repeats every 3 Years')
	})
})
