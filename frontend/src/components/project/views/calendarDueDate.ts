import {roundToNaturalDayBoundary} from '@/helpers/time/roundToNaturalDayBoundary'

// Noon keeps the date clear of the midnight timezone boundary; date-only mode
// takes the canonical end of day instead, like every other due-date entry path.
export function calendarDueDateForDay(day: Date, dateOnly: boolean): Date {
	if (dateOnly) {
		return roundToNaturalDayBoundary(day, false, true)
	}
	return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0)
}
