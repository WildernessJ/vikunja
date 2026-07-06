import {parseDate} from './dateParser'

export interface deadlineParseResult {
	newText: string,
	deadline: Date | null,
}

// A deadline is written as braced date text, e.g. "file taxes {next friday}",
// so it can be distinguished from the (unbraced) due date in the same input.
const DEADLINE_REGEX = /\{([^{}]*)\}/

/**
 * Extracts a `{…}` block and delegates the inner text to the shared date grammar
 * (dateParser), so the deadline understands exactly the same expressions as the
 * due date without duplicating any of that logic.
 */
export const parseDeadline = (text: string, now: Date = new Date()): deadlineParseResult => {
	const match = text.match(DEADLINE_REGEX)
	if (match === null) {
		return {
			newText: text,
			deadline: null,
		}
	}

	const {date} = parseDate(match[1], now)

	// Strip the whole braced block even when the inner text did not parse, so a
	// stray `{…}` never leaks into the task title.
	const newText = text.replace(DEADLINE_REGEX, '').replace(/\s{2,}/g, ' ').trim()

	return {
		newText,
		deadline: date,
	}
}
