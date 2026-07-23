import TaskReminderModel from '@/models/taskReminder'
import type {ITaskReminder} from '@/modelTypes/ITaskReminder'
import {REMINDER_PERIOD_RELATIVE_TO_TYPES} from '@/types/IReminderPeriodRelativeTo'
import {parseDate} from './dateParser'

export interface reminderParseResult {
	textWithoutMatched: string,
	reminders: ITaskReminder[],
}

const UNIT_SECONDS: Record<string, number> = {
	m: 60,
	h: 3600,
	d: 86400,
	w: 604800,
}

// Lower-case units only: an upper-case `~1M` would otherwise fold to `m`
// (minutes) and silently misread a month the grammar doesn't support — leaving
// it literal is the safer failure. `\s*$` anchors the offset to the end of its
// token so it only matches a full trailing `~1d`, never `~2h` inside prose.
const OFFSET_REGEX = /^(\d+)([mhdw])\s*$/

const isWordBoundary = (text: string, tildeIndex: number): boolean =>
	tildeIndex === 0 || /\s/.test(text[tildeIndex - 1])

/**
 * Parses reminder tokens introduced by the `~` prefix (Vikunja mode only) from
 * the CONTIGUOUS TRAILING RUN of the text and strips them, mirroring
 * parseDeadline's "extract, then hand the inner text to the shared date grammar"
 * shape for the absolute form.
 *
 * Trailing-only is deliberate: `~` doubles as "approximately" in prose, so a
 * bare mid-title `~2h` ("Drive ~2h to the coast") would otherwise silently eat
 * the title and attach a phantom reminder. A `~` token counts only when it sits
 * at the end — its content (offset or a date) must consume the whole tail with
 * nothing after it. Scanning right-to-left, the first `~` that fails that test
 * marks the boundary: everything to its left is title. Multiple trailing tokens
 * ("Ship it ~2h ~tomorrow at 8am") each qualify and are kept in title order.
 */
export const getReminders = (text: string, now: Date = new Date()): reminderParseResult => {
	const reminders: ITaskReminder[] = []
	let result = text

	while (true) {
		const tildeIndex = result.lastIndexOf('~')
		if (tildeIndex === -1 || !isWordBoundary(result, tildeIndex)) {
			break
		}

		const afterTilde = result.slice(tildeIndex + 1)

		const offsetMatch = afterTilde.match(OFFSET_REGEX)
		if (offsetMatch !== null) {
			const amount = parseInt(offsetMatch[1], 10)
			const unit = offsetMatch[2].toLowerCase()
			reminders.unshift(new TaskReminderModel({
				reminder: null,
				relativePeriod: -(amount * UNIT_SECONDS[unit]),
				relativeTo: REMINDER_PERIOD_RELATIVE_TO_TYPES.DUEDATE,
			}))
			result = result.slice(0, tildeIndex).trimEnd()
			continue
		}

		// Absolute form: parseDate must consume the ENTIRE tail (no leftover text),
		// otherwise this `~` is prose, not a trailing reminder.
		const {newText, date} = parseDate(afterTilde, now)
		if (date !== null && newText.trim() === '') {
			reminders.unshift(new TaskReminderModel({
				reminder: date,
				relativeTo: null,
			}))
			result = result.slice(0, tildeIndex).trimEnd()
			continue
		}

		break
	}

	// Trailing-only stripping never opens an internal gap, so a plain trim is
	// enough; a reminder-free title is returned untouched.
	return {
		textWithoutMatched: reminders.length > 0 ? result.trim() : result,
		reminders,
	}
}
