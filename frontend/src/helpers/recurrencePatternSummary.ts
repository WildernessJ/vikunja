// Mirrors the phrase logic RecurrencePatternPicker builds from its own form
// state, but works from a standalone RRULE string so other surfaces (e.g. the
// quick-add composer) can show the same wording without re-deriving it.

import {REPEAT_TYPES} from '@/types/IRepeatAfter'
import type {IRepeatAfter} from '@/types/IRepeatAfter'
import type {IRRuleRepeat} from '@/modules/quickAddMagic/types'

export type TranslateFunction = (key: string, params?: Record<string, unknown>) => string

const WEEKDAY_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

function getPart(rule: string, key: string): string | null {
	for (const part of rule.split(';')) {
		const [k, v] = part.split('=')
		if (k === key) {
			return v ?? null
		}
	}
	return null
}

function parseUntil(value: string): Date | null {
	const m = /^(\d{4})(\d{2})(\d{2})/.exec(value)
	if (m === null) {
		return null
	}
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function buildRecurrencePatternSummary(rrule: string, t: TranslateFunction): string {
	if (rrule === '') {
		return ''
	}

	const intervalPart = getPart(rrule, 'INTERVAL')
	const n = intervalPart !== null ? Number(intervalPart) : 1
	const many = Number.isInteger(n) && n > 1

	const freqPart = getPart(rrule, 'FREQ')
	const byday = getPart(rrule, 'BYDAY')
	const bymonthday = getPart(rrule, 'BYMONTHDAY')
	const bysetpos = getPart(rrule, 'BYSETPOS')

	let base: string
	if (freqPart === 'WEEKLY') {
		const weekdays = byday !== null ? byday.split(',') : []
		const days = WEEKDAY_ORDER
			.filter(d => weekdays.includes(d))
			.map(d => t(`task.repeat.weekdayShort.${d.toLowerCase()}`))
			.join(', ')
		base = many
			? t('task.repeat.summaryIntervalWeekly', {n, days})
			: t('task.repeat.summaryWeekly', {days})
	} else if (freqPart === 'MONTHLY' && bymonthday === '-1') {
		base = many
			? t('task.repeat.summaryIntervalMonthlyLastDay', {n})
			: t('task.repeat.onLastDay')
	} else if (freqPart === 'MONTHLY' && bysetpos === '-1' && byday !== null) {
		base = many
			? t('task.repeat.summaryIntervalMonthlyLastWorkday', {n})
			: t('task.repeat.onLastWorkday')
	} else if (freqPart === 'MONTHLY' && byday !== null) {
		const m = /^(-?\d+)([A-Z]{2})$/.exec(byday)
		if (m === null) {
			return ''
		}
		const ordinal = t(`task.repeat.ordinal.${m[1] === '-1' ? 'last' : m[1]}`)
		const weekday = t(`task.repeat.weekdayShort.${m[2].toLowerCase()}`)
		base = many
			? t('task.repeat.summaryIntervalMonthlyNth', {n, ordinal, weekday})
			: t('task.repeat.summaryMonthlyNth', {ordinal, weekday})
	} else if (freqPart === 'MONTHLY' && bymonthday !== null) {
		const day = Number(bymonthday.split(',')[0])
		base = many
			? t('task.repeat.summaryIntervalMonthlyDay', {n, day})
			: t('task.repeat.summaryMonthlyDay', {day})
	} else {
		return ''
	}

	const until = getPart(rrule, 'UNTIL')
	const endDate = until !== null ? parseUntil(until) : null
	if (endDate !== null) {
		base += ` — ${t('task.repeat.endsOn')} ${endDate.toLocaleDateString()}`
	}
	return base
}

// Maps the legacy IRepeatAfter unit to an existing translated noun. Weeks/months
// reuse RecurrencePatternPicker's lowercase, sentence-friendly keys; the rest fall
// back to their standalone (capitalized) labels rather than adding new keys per unit.
const REPEAT_TYPE_LABEL_KEYS: Record<string, string> = {
	[REPEAT_TYPES.Seconds]: 'input.datemathHelp.units.seconds',
	[REPEAT_TYPES.Minutes]: 'input.datemathHelp.units.minutes',
	[REPEAT_TYPES.Hours]: 'task.repeat.hours',
	[REPEAT_TYPES.Days]: 'task.repeat.days',
	[REPEAT_TYPES.Weeks]: 'task.repeat.unitWeeks',
	[REPEAT_TYPES.Months]: 'task.repeat.unitMonths',
	[REPEAT_TYPES.Years]: 'input.datemathHelp.units.years',
}

// buildQuickAddRepeatsLabel turns the quick-add parser's resolved recurrence
// (legacy interval or RRULE, whichever the parser produced) into the human
// phrase shown next to the composer's Date chip.
export function buildQuickAddRepeatsLabel(
	repeats: IRepeatAfter | IRRuleRepeat | null | undefined,
	t: TranslateFunction,
): string | null {
	if (repeats === null || typeof repeats === 'undefined') {
		return null
	}

	if ('rrule' in repeats) {
		const summary = buildRecurrencePatternSummary(repeats.rrule, t)
		return summary === '' ? null : t('task.repeat.patternSummary', {summary})
	}

	const typeLabel = t(REPEAT_TYPE_LABEL_KEYS[repeats.type] ?? 'task.repeat.days')
	return t('task.quickAdd.repeatsEvery', {amount: repeats.amount, type: typeLabel})
}
