import type {DateKebab} from '@/types/DateKebab'

/**
 * Builds the filter query matching every task that intersects a [dateFrom, dateTo]
 * window: tasks whose start, end or due date falls inside the window, plus ranged
 * tasks that fully span it. Shared by the Gantt and Calendar views so both windowed
 * fetches stay in sync — a shorter expression would drop tasks that only have a
 * start_date inside the window.
 */
export function buildDateWindowFilterQuery(dateFrom: DateKebab, dateTo: DateKebab): string {
	return '(' +
		'(start_date >= "' + dateFrom + '" && start_date <= "' + dateTo + '") || ' +
		'(end_date >= "' + dateFrom + '" && end_date <= "' + dateTo + '") || ' +
		'(due_date >= "' + dateFrom + '" && due_date <= "' + dateTo + '") || ' +
		'(start_date <= "' + dateFrom + '" && end_date >= "' + dateTo + '")' +
		')'
}
