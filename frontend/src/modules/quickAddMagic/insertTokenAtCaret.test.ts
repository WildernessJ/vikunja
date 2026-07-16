import {describe, expect, it} from 'vitest'

import {insertTokenAtCaret} from './insertTokenAtCaret'
import type {TokenAtCaret} from './tokenAtCaret'

describe('insertTokenAtCaret', () => {
	it('replaces the whole in-progress token with the prefix and the entity name', () => {
		const text = 'buy +MyProj'
		const token: TokenAtCaret = {type: 'project', prefix: '+', query: 'MyProj', start: 4, end: text.length}

		const result = insertTokenAtCaret(text, token, 'MyProject')

		expect(result.text).toBe('buy +MyProject ')
	})

	it('lands the caret immediately after the inserted token', () => {
		const text = 'buy +MyProj'
		const token: TokenAtCaret = {type: 'project', prefix: '+', query: 'MyProj', start: 4, end: text.length}

		const result = insertTokenAtCaret(text, token, 'MyProject')

		expect(result.caret).toBe('buy +MyProject '.length)
	})

	it('quote-wraps a name that contains a space', () => {
		const text = '+MyProj'
		const token: TokenAtCaret = {type: 'project', prefix: '+', query: 'MyProj', start: 0, end: text.length}

		const result = insertTokenAtCaret(text, token, 'My Big Project')

		expect(result.text).toBe('+"My Big Project" ')
		expect(result.caret).toBe('+"My Big Project" '.length)
	})

	it('does not add a second space when one already follows the token', () => {
		const text = 'buy +MyProj tomorrow'
		const token: TokenAtCaret = {type: 'project', prefix: '+', query: 'MyProj', start: 4, end: 11}

		const result = insertTokenAtCaret(text, token, 'MyProject')

		expect(result.text).toBe('buy +MyProject tomorrow')
		expect(result.caret).toBe('buy +MyProject'.length)
	})

	it('replaces a quoted in-progress token, keeping the rest of the text intact', () => {
		const text = 'call +"My Big Pro" now'
		const token: TokenAtCaret = {type: 'project', prefix: '+', query: 'My Big Pro', start: 5, end: 18}

		const result = insertTokenAtCaret(text, token, 'My Big Project')

		expect(result.text).toBe('call +"My Big Project" now')
	})

	it('replaces a label token in place, leaving surrounding text untouched', () => {
		const text = 'file taxes *urg soon'
		const token: TokenAtCaret = {type: 'label', prefix: '*', query: 'urg', start: 11, end: 15}

		const result = insertTokenAtCaret(text, token, 'urgent')

		expect(result.text).toBe('file taxes *urgent soon')
		expect(result.caret).toBe('file taxes *urgent'.length)
	})
})
