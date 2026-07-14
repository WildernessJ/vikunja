import {REPEAT_TYPES, type IRepeatType} from '@/types/IRepeatAfter'
import {TASK_REPEAT_MODES} from '@/types/IRepeatMode'

import {getDateFromText} from './dateParser'
import type {IRepeatAfter} from '@/types/IRepeatAfter'
import type {repeatParsedResult} from './types'

const WEEKDAYS: Record<string, string> = {
	monday: 'MO', mon: 'MO',
	tuesday: 'TU', tue: 'TU', tues: 'TU',
	wednesday: 'WE', wed: 'WE',
	thursday: 'TH', thu: 'TH', thur: 'TH', thurs: 'TH',
	friday: 'FR', fri: 'FR',
	saturday: 'SA', sat: 'SA',
	sunday: 'SU', sun: 'SU',
}

const ORDINALS: Record<string, number> = {
	first: 1, '1st': 1,
	second: 2, '2nd': 2,
	third: 3, '3rd': 3,
	fourth: 4, '4th': 4,
	fifth: 5, '5th': 5,
	last: -1,
}

// Spelled-out interval counts, mirroring the words getIntervalRepeats accepts
// ("every three months …") so the combined "on <pattern>" form stays consistent.
const CARDINALS: Record<string, number> = {
	one: 1, two: 2, three: 3, four: 4, five: 5,
	six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}

export const getRepeats = (text: string, now: Date = new Date()): repeatParsedResult => {
	// A unit + "on <pattern>" ("every 3 months on the last saturday") is a calendar
	// pattern repeating every Nth period — must be tried before the legacy interval
	// mode below, whose regex would otherwise swallow "every 3 months" and drop the
	// pattern.
	const intervalPattern = getIntervalRRuleRepeat(text, now)
	if (intervalPattern !== null) {
		return intervalPattern
	}

	// Legacy fixed-interval mode takes precedence: "every 2 weeks", "every month",
	// "monthly", … keep producing an IRepeatAfter, never a calendar pattern.
	const interval = getIntervalRepeats(text)
	if (interval.repeats !== null) {
		return {...interval, rruleRepeat: null}
	}

	const rruleResult = getRRuleRepeat(text, now)
	if (rruleResult !== null) {
		return rruleResult
	}

	return {
		textWithoutMatched: text,
		repeats: null,
		rruleRepeat: null,
	}
}

function formatUntil(date: Date): string {
	const y = date.getFullYear()
	const mo = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	return `${y}${mo}${d}T000000Z`
}

// parseRRuleCore turns the recurrence body (bounds already stripped) into an
// RRULE string, or null when it is not a recognized calendar pattern.
function parseRRuleCore(clause: string): string | null {
	const c = clause.trim().toLowerCase()
	if (c === '') {
		return null
	}

	if (/^last\s+day$/.test(c)) {
		return 'FREQ=MONTHLY;BYMONTHDAY=-1'
	}
	if (/^last\s+(work\s?day|working\s+day|weekday)$/.test(c)) {
		return 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1'
	}

	const ordMatch = /^(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\s+([a-z]+)$/.exec(c)
	if (ordMatch !== null) {
		const ord = ORDINALS[ordMatch[1]]
		const weekday = WEEKDAYS[ordMatch[2]]
		if (ord !== undefined && weekday !== undefined) {
			return `FREQ=MONTHLY;BYDAY=${ord}${weekday}`
		}
	}

	const dayTokens = c.split(/[,\s]+/).filter(s => s !== '')
	if (dayTokens.length > 0 && dayTokens.every(s => /^([1-9]|[12][0-9]|3[01])$/.test(s))) {
		return `FREQ=MONTHLY;BYMONTHDAY=${dayTokens.map(Number).join(',')}`
	}

	const weekdayTokens = c.replace(/\band\b/g, ',').split(/[,\s]+/).filter(s => s !== '')
	if (weekdayTokens.length > 0 && weekdayTokens.every(t => WEEKDAYS[t] !== undefined)) {
		return `FREQ=WEEKLY;BYDAY=${weekdayTokens.map(t => WEEKDAYS[t]).join(',')}`
	}

	return null
}

// getIntervalRRuleRepeat handles the combined form "every N <unit> on <pattern>"
// (e.g. "every 3 months on the last saturday"), producing an RRULE whose calendar
// pattern comes from parseRRuleCore and whose repeat period is carried as INTERVAL.
// The pattern's own FREQ wins; the unit word ("months"/"weeks") is for readability.
function getIntervalRRuleRepeat(text: string, now: Date): repeatParsedResult | null {
	const trigger = /(^|\s)(every|each)(!)?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:st|nd|rd|th)?\s+(weeks?|months?)\s+on\s+(.+)$/i.exec(text)
	if (trigger === null) {
		return null
	}

	const before = text.slice(0, trigger.index).trim()
	const fromCompletion = trigger[3] === '!'
	const countToken = trigger[4].toLowerCase()
	const intervalN = CARDINALS[countToken] ?? parseInt(countToken, 10)
	const wantMonthly = trigger[5].toLowerCase().startsWith('month')
	let clause = trigger[6].trim()

	let until: string | null = null
	const untilMatch = /\b(?:until|till|til)\b\s+(.+)$/i.exec(clause)
	if (untilMatch !== null) {
		const {date} = getDateFromText(untilMatch[1], now)
		if (date !== null) {
			until = formatUntil(date)
		}
		clause = clause.slice(0, untilMatch.index).trim()
	}

	let startDate: Date | null = null
	const startMatch = /\b(?:starting|start|from)\b\s+(.+)$/i.exec(clause)
	if (startMatch !== null) {
		const {date} = getDateFromText(startMatch[1], now)
		if (date !== null) {
			startDate = date
		}
		clause = clause.slice(0, startMatch.index).trim()
	}

	// parseRRuleCore expects no leading article: "the last saturday" → "last saturday".
	clause = clause.replace(/^the\s+/i, '').trim()

	const core = parseRRuleCore(clause)
	if (core === null) {
		return null
	}

	// The unit must agree with the frequency the pattern implies; otherwise the
	// input is self-contradictory ("every 6 months on friday" — a bare weekday is
	// weekly, not monthly) and INTERVAL would silently apply to the wrong period.
	if (wantMonthly !== core.startsWith('FREQ=MONTHLY')) {
		return null
	}

	const withInterval = intervalN > 1
		? core.replace(/^(FREQ=[A-Z]+)/, `$1;INTERVAL=${intervalN}`)
		: core
	const rrule = until !== null ? `${withInterval};UNTIL=${until}` : withInterval

	return {
		textWithoutMatched: before,
		repeats: null,
		rruleRepeat: {
			mode: TASK_REPEAT_MODES.REPEAT_MODE_RRULE,
			rrule,
			fromCompletion,
			startDate,
		},
	}
}

function getRRuleRepeat(text: string, now: Date): repeatParsedResult | null {
	const trigger = /(^|\s)(every|each)(!)?\s+(.+)$/i.exec(text)
	if (trigger === null) {
		return null
	}

	const before = text.slice(0, trigger.index).trim()
	const fromCompletion = trigger[3] === '!'
	let clause = trigger[4].trim()

	let until: string | null = null
	const untilMatch = /\b(?:until|till|til)\b\s+(.+)$/i.exec(clause)
	if (untilMatch !== null) {
		const {date} = getDateFromText(untilMatch[1], now)
		if (date !== null) {
			until = formatUntil(date)
		}
		clause = clause.slice(0, untilMatch.index).trim()
	}

	let startDate: Date | null = null
	const startMatch = /\b(?:starting|start|from)\b\s+(.+)$/i.exec(clause)
	if (startMatch !== null) {
		const {date} = getDateFromText(startMatch[1], now)
		if (date !== null) {
			startDate = date
		}
		clause = clause.slice(0, startMatch.index).trim()
	}

	const core = parseRRuleCore(clause)
	if (core === null) {
		return null
	}

	const rrule = until !== null ? `${core};UNTIL=${until}` : core

	return {
		textWithoutMatched: before,
		repeats: null,
		rruleRepeat: {
			mode: TASK_REPEAT_MODES.REPEAT_MODE_RRULE,
			rrule,
			fromCompletion,
			startDate,
		},
	}
}

function getIntervalRepeats(text: string): {textWithoutMatched: string, repeats: IRepeatAfter | null} {
	const regex = /(^| )(((every|each) (([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten) )?(hours?|days?|weeks?|months?|years?))|(annually|biannually|semiannually|biennially|daily|hourly|monthly|weekly|yearly))($| )/ig
	const results = regex.exec(text)
	if (results === null) {
		return {
			textWithoutMatched: text,
			repeats: null,
		}
	}

	let amount: number
	switch (results[5] ? results[5].trim() : undefined) {
		case 'one':
			amount = 1
			break
		case 'two':
			amount = 2
			break
		case 'three':
			amount = 3
			break
		case 'four':
			amount = 4
			break
		case 'five':
			amount = 5
			break
		case 'six':
			amount = 6
			break
		case 'seven':
			amount = 7
			break
		case 'eight':
			amount = 8
			break
		case 'nine':
			amount = 9
			break
		case 'ten':
			amount = 10
			break
		default:
			amount = results[5] ? parseInt(results[5]) : 1
	}
	let type: IRepeatType = REPEAT_TYPES.Hours

	switch (results[2]) {
		case 'biennially':
			type = REPEAT_TYPES.Years
			amount = 2
			break
		case 'biannually':
		case 'semiannually':
			type = REPEAT_TYPES.Months
			amount = 6
			break
		case 'yearly':
		case 'annually':
			type = REPEAT_TYPES.Years
			break
		case 'daily':
			type = REPEAT_TYPES.Days
			break
		case 'hourly':
			type = REPEAT_TYPES.Hours
			break
		case 'monthly':
			type = REPEAT_TYPES.Months
			break
		case 'weekly':
			type = REPEAT_TYPES.Weeks
			break
		default:
			switch (results[7]) {
				case 'hour':
				case 'hours':
					type = REPEAT_TYPES.Hours
					break
				case 'day':
				case 'days':
					type = REPEAT_TYPES.Days
					break
				case 'week':
				case 'weeks':
					type = REPEAT_TYPES.Weeks
					break
				case 'month':
				case 'months':
					type = REPEAT_TYPES.Months
					break
				case 'year':
				case 'years':
					type = REPEAT_TYPES.Years
					break
			}
	}

	let matchedText = results[0]
	if (matchedText.endsWith(' ')) {
		matchedText = matchedText.substring(0, matchedText.length - 1)
	}

	return {
		textWithoutMatched: text.replace(matchedText, ''),
		repeats: {
			amount,
			type,
		},
	}
}
