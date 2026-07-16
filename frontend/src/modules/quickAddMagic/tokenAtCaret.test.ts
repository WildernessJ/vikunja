import {describe, expect, it} from 'vitest'

import {tokenAtCaret} from './tokenAtCaret'
import {PREFIXES, PrefixMode} from './prefixes'

const vikunja = PREFIXES[PrefixMode.Default]
const todoist = PREFIXES[PrefixMode.Todoist]

describe('tokenAtCaret', () => {
	it('returns null when the prefix set is disabled', () => {
		expect(tokenAtCaret('+project', 8, PREFIXES[PrefixMode.Disabled])).toBeNull()
	})

	it('detects a project token at the start of the string', () => {
		const text = '+MyProject'
		const result = tokenAtCaret(text, text.length, vikunja)

		expect(result).toEqual({
			type: 'project',
			prefix: '+',
			query: 'MyProject',
			start: 0,
			end: text.length,
		})
	})

	it('detects a project token in the middle of the string', () => {
		const text = 'buy milk +MyProj'
		const result = tokenAtCaret(text, text.length, vikunja)

		expect(result).toEqual({
			type: 'project',
			prefix: '+',
			query: 'MyProj',
			start: 9,
			end: text.length,
		})
	})

	it('is active with an empty query right after the prefix character', () => {
		const text = 'buy milk +'
		const result = tokenAtCaret(text, text.length, vikunja)

		expect(result).toMatchObject({type: 'project', query: '', start: 9})
	})

	it('narrows the query to the caret, not the full word, mid-word', () => {
		const text = 'buy +MyProject soon'
		const caret = 'buy +MyPro'.length
		const result = tokenAtCaret(text, caret, vikunja)

		expect(result).toMatchObject({query: 'MyPro', start: 4, end: 14})
	})

	it('returns null once a space separates the prefix from the caret', () => {
		const text = 'buy +MyProject soon'
		const caret = 'buy +MyProject '.length
		const result = tokenAtCaret(text, caret, vikunja)

		expect(result).toBeNull()
	})

	it('returns null when the prefix is immediately followed by whitespace', () => {
		const text = 'buy + milk'
		const result = tokenAtCaret(text, 'buy +'.length, vikunja)

		expect(result).toBeNull()
	})

	it('detects a single-quoted multi-word token', () => {
		const text = 'call +\'My Big Project\''
		const result = tokenAtCaret(text, text.length, vikunja)

		expect(result).toEqual({
			type: 'project',
			prefix: '+',
			query: 'My Big Project',
			start: 5,
			end: text.length,
		})
	})

	it('detects a double-quoted multi-word token', () => {
		const text = 'call +"My Big Project"'
		const result = tokenAtCaret(text, text.length, vikunja)

		expect(result).toEqual({
			type: 'project',
			prefix: '+',
			query: 'My Big Project',
			start: 5,
			end: text.length,
		})
	})

	it('stays active while the caret sits inside an unterminated quote, spaces included', () => {
		const text = 'call +"My Big Pro'
		const result = tokenAtCaret(text, text.length, vikunja)

		expect(result).toMatchObject({query: 'My Big Pro'})
	})

	it('closes once the caret moves past the closing quote and a space', () => {
		const text = 'call +"My Big Project" now'
		const caret = 'call +"My Big Project" '.length
		const result = tokenAtCaret(text, caret, vikunja)

		expect(result).toBeNull()
	})

	it('resolves the label prefix in Vikunja mode (*)', () => {
		const text = '*urgent'
		const result = tokenAtCaret(text, text.length, vikunja)

		expect(result).toMatchObject({type: 'label', prefix: '*', query: 'urgent'})
	})

	it('resolves the assignee prefix in Vikunja mode (@)', () => {
		const text = '@peter'
		const result = tokenAtCaret(text, text.length, vikunja)

		expect(result).toMatchObject({type: 'assignee', prefix: '@', query: 'peter'})
	})

	it('resolves @ as a label prefix in Todoist mode, not assignee', () => {
		const text = '@urgent'
		const result = tokenAtCaret(text, text.length, todoist)

		expect(result).toMatchObject({type: 'label', prefix: '@', query: 'urgent'})
	})

	it('resolves + as an assignee prefix in Todoist mode, not project', () => {
		const text = '+peter'
		const result = tokenAtCaret(text, text.length, todoist)

		expect(result).toMatchObject({type: 'assignee', prefix: '+', query: 'peter'})
	})

	it('never surfaces the priority prefix (out of scope)', () => {
		const text = '!3'
		const result = tokenAtCaret(text, text.length, vikunja)

		expect(result).toBeNull()
	})

	it('ignores a prefix character embedded inside a word', () => {
		const text = 'foo+bar'
		const result = tokenAtCaret(text, text.length, vikunja)

		expect(result).toBeNull()
	})

	it('picks the token nearest the caret when multiple prefixes were typed earlier', () => {
		const text = '+ProjectOne *labelTwo'
		const result = tokenAtCaret(text, text.length, vikunja)

		expect(result).toMatchObject({type: 'label', query: 'labelTwo'})
	})

	it('does not let a prefix char embedded inside an earlier quoted token hijack the token boundary', () => {
		const text = '+"Bob +Co"'
		const result = tokenAtCaret(text, text.length, vikunja)

		expect(result).toEqual({
			type: 'project',
			prefix: '+',
			query: 'Bob +Co',
			start: 0,
			end: text.length,
		})
	})

	it('treats a prefix char inside a single-quoted span as literal too', () => {
		const text = '*\'urgent @home\''
		const result = tokenAtCaret(text, text.length, vikunja)

		expect(result).toEqual({
			type: 'label',
			prefix: '*',
			query: 'urgent @home',
			start: 0,
			end: text.length,
		})
	})

	it('resolves to the quoted project token when the caret sits inside the quoted span, not at the embedded prefix', () => {
		const text = '+"Bob +Co" rest'
		const caret = '+"Bob +C'.length
		const result = tokenAtCaret(text, caret, vikunja)

		expect(result).toMatchObject({type: 'project', start: 0, query: 'Bob +C'})
	})

	it('returns null once the caret moves past the closing quote of a token containing an embedded prefix char', () => {
		const text = '+"Bob +Co" rest'
		const caret = '+"Bob +Co" '.length
		const result = tokenAtCaret(text, caret, vikunja)

		expect(result).toBeNull()
	})
})
