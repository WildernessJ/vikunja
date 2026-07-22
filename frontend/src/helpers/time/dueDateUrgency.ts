import dayjs from 'dayjs'

export type DueDateUrgency = 'overdue' | 'today' | 'tomorrow' | 'this-week' | 'later'

/**
 * Bucket a due date into one of five urgency tiers for colour-coding list rows.
 * Buckets are calendar-day based in the browser's local timezone, matching how
 * the rest of SingleTaskInProject reads due dates (plain local Date math) — a
 * task due at 2pm today reads "today" even after 2pm, never "overdue".
 * Returns null when there is no meaningful due date (unset, or the epoch zero
 * value the models use as "no date").
 *
 * `weekStart` (0 = Sunday … 6 = Saturday) is the user's "Week starts on" setting
 * so the this-week boundary matches the calendar/flatpickr rather than dayjs's
 * locale default. The week end is derived manually because dayjs core's
 * `isSame(…, 'week')` keys off the locale, not this setting.
 */
export function getDueDateUrgency(dueDate: Date | null | undefined, now: Date = new Date(), weekStart = 0): DueDateUrgency | null {
	if (!dueDate || dueDate.getTime() <= 0) {
		return null
	}

	const due = dayjs(dueDate)
	const today = dayjs(now)

	if (due.isBefore(today, 'day')) {
		return 'overdue'
	}
	if (due.isSame(today, 'day')) {
		return 'today'
	}
	// Checked before the week bucket so a "tomorrow" that spills into next week
	// (e.g. Saturday → Sunday) still reads as tomorrow, not later.
	if (due.isSame(today.add(1, 'day'), 'day')) {
		return 'tomorrow'
	}
	const offsetIntoWeek = (today.day() - weekStart + 7) % 7
	const lastDayOfWeek = today.add(6 - offsetIntoWeek, 'day')
	return due.isAfter(lastDayOfWeek, 'day') ? 'later' : 'this-week'
}
