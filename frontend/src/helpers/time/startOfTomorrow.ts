import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * Start of the next day in the given IANA timezone, returned as an absolute
 * instant. The Today view uses this as its `due_date < dateTo` upper bound so
 * the client-side cutoff matches the backend counts endpoint, which computes
 * "start of tomorrow" in the account timezone. Falls back to the browser
 * timezone when none is configured.
 */
export function getStartOfTomorrowInTimezone(tz?: string): Date {
	// The `: dayjs()` fallback resolves the boundary in the browser timezone,
	// whereas the backend counts endpoint falls back to the server default
	// (service.timezone), which the frontend has no access to. They diverge only
	// for accounts with an empty saved timezone — a non-normal state, since
	// registration and settings-save both backfill it — so this bounded gap is
	// accepted rather than plumbing the server default through the config API.
	const base = tz ? dayjs().tz(tz) : dayjs()
	return base.add(1, 'day').startOf('day').toDate()
}
