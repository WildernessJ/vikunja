import {test, expect, describe} from 'vitest'

import {parseDuration, formatDuration} from './duration'

describe('parseDuration', () => {
	test.each([
		['2h', 7200],
		['90m', 5400],
		['1h30m', 5400],
		['2h 30m', 9000],
		['1h', 3600],
		['45m', 2700],
		['  2h30m  ', 9000],
	])('parses %s to %d seconds', (input, expected) => {
		expect(parseDuration(input)).toBe(expected)
	})

	test('parses an empty string as 0 (cleared)', () => {
		expect(parseDuration('')).toBe(0)
		expect(parseDuration('   ')).toBe(0)
	})

	test.each([
		'banana',
		'5',
		'1h30',
		'30s',
		'-1h',
	])('rejects invalid input %s with null', (input) => {
		expect(parseDuration(input)).toBeNull()
	})
})

describe('formatDuration', () => {
	test.each([
		[5400, '1h 30m'],
		[7200, '2h'],
		[3600, '1h'],
		[2700, '45m'],
		[9000, '2h 30m'],
	])('formats %d seconds as %s', (seconds, expected) => {
		expect(formatDuration(seconds)).toBe(expected)
	})

	test('formats 0 as an empty string', () => {
		expect(formatDuration(0)).toBe('')
	})
})
