import dayjs from 'dayjs'

// Whole days between two day boundaries (start or end of a day), as the timeline counts them.
// dayjs's diff removes UTC-offset changes, and rounding absorbs the hour a DST change moves a
// boundary by, e.g. a day whose midnight does not exist and starts at 01:00.
export function daySpan(start: Date, end: Date): number {
	return Math.round(dayjs(end).diff(start, 'day', true))
}
