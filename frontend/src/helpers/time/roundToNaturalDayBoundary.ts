// `force` skips the before-noon heuristic: date-only mode needs a canonical end-of-day
// for every date, not one that depends on the wall-clock time it was created at.
export function roundToNaturalDayBoundary(date: Date, isStart = false, force = false): Date {
	const d = new Date(date)
	if (isStart || (!force && d.getHours() < 12)) {
		d.setHours(0, 0, 0, 0)
	} else {
		d.setHours(23, 59, 59, 999)
	}
	return d
}
