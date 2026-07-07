import {
	SECONDS_A_HOUR,
	SECONDS_A_MINUTE,
} from '@/constants/date'

// Anchored so trailing junk ("1h30", "30s") fails to match rather than being
// partially accepted. Both groups are optional to allow "2h" or "90m" alone;
// the empty-string case is handled before the regex so a bare "" can't slip
// through as 0h0m here.
const DURATION_RE = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/i

/**
 * Parse a compact human duration ("2h", "90m", "1h30m", "2h 30m") into seconds.
 * An empty/whitespace string is a valid "cleared" value and returns 0; any
 * other unparseable input returns null so callers can surface a validation error.
 */
export function parseDuration(input: string): number | null {
	const trimmed = input.trim()
	if (trimmed === '') {
		return 0
	}

	const match = DURATION_RE.exec(trimmed)
	if (match === null) {
		return null
	}

	const hours = match[1] ? Number(match[1]) : 0
	const minutes = match[2] ? Number(match[2]) : 0
	return hours * SECONDS_A_HOUR + minutes * SECONDS_A_MINUTE
}

/**
 * Render seconds back into the compact form parseDuration accepts ("1h 30m").
 * Zero or negative input renders as an empty string (0 = unset).
 */
export function formatDuration(seconds: number): string {
	if (!seconds || seconds <= 0) {
		return ''
	}

	const hours = Math.floor(seconds / SECONDS_A_HOUR)
	const minutes = Math.floor((seconds % SECONDS_A_HOUR) / SECONDS_A_MINUTE)

	const parts: string[] = []
	if (hours > 0) {
		parts.push(`${hours}h`)
	}
	if (minutes > 0) {
		parts.push(`${minutes}m`)
	}
	return parts.join(' ')
}
