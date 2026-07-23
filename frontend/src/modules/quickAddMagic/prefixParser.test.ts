import {describe, expect, it} from 'vitest'

import {getItemsFromPrefix} from './prefixParser'

describe('getItemsFromPrefix', () => {
	it('extracts a single-quoted item containing the same quote char (apostrophe)', () => {
		const items = getItemsFromPrefix("+'Bob's Project'", '+')

		expect(items).toEqual(["Bob's Project"])
	})

	it('extracts two adjacent single-quoted items separated by a space', () => {
		const items = getItemsFromPrefix("+'a' +'b'", '+')

		expect(items).toEqual(['a', 'b'])
	})

	it('extracts a plain single-quoted item', () => {
		const items = getItemsFromPrefix("+'label'", '+')

		expect(items).toEqual(['label'])
	})

	it('extracts an unterminated single-quoted item up to end of string', () => {
		const items = getItemsFromPrefix("+'Bob", '+')

		expect(items).toEqual(['Bob'])
	})

	it('still extracts a double-quoted item containing an apostrophe', () => {
		const items = getItemsFromPrefix('+"Bob\'s Project"', '+')

		expect(items).toEqual(["Bob's Project"])
	})

	it('still extracts a single-quoted item containing a double quote', () => {
		const items = getItemsFromPrefix('*\'Say "hi"\'', '*')

		expect(items).toEqual(['Say "hi"'])
	})

	it('accepted regression: with no separating space, an adjacent token is swallowed into the quoted item', () => {
		const items = getItemsFromPrefix("+'a'*label", '+')

		expect(items).toEqual(["a'*label"])
	})
})
