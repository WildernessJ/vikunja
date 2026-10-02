import dayjs from 'dayjs'

// Whole calendar days from start to end, a partial day counting as one.
// dayjs's diff corrects for UTC-offset changes, so a 25-hour DST fall-back day counts as one day.
export function daySpan(start: Date, end: Date): number {
	return Math.ceil(dayjs(end).diff(start, 'day', true))
}
