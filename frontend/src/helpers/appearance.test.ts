import {describe, it, expect} from 'vitest'
import {normalizeFontSize, rootFontSize, normalizeFontFamily, fontFamilyStack} from './appearance'

describe('normalizeFontSize', () => {
	it('falls back to the 100% default for undefined (the on-login value)', () => {
		expect(normalizeFontSize(undefined)).toBe('100')
	})

	it('falls back to the default for unknown / tampered values', () => {
		expect(normalizeFontSize('999')).toBe('100')
		expect(normalizeFontSize(112.5)).toBe('100')
		expect(normalizeFontSize(null)).toBe('100')
		expect(normalizeFontSize({})).toBe('100')
	})

	it('passes a known scale step through unchanged', () => {
		expect(normalizeFontSize('87.5')).toBe('87.5')
		expect(normalizeFontSize('125')).toBe('125')
	})

	it('rejects inherited prototype keys (the `in` operator trap)', () => {
		expect(normalizeFontSize('toString')).toBe('100')
		expect(normalizeFontSize('constructor')).toBe('100')
		expect(normalizeFontSize('valueOf')).toBe('100')
	})
})

describe('rootFontSize', () => {
	it('resolves the default to 100%', () => {
		expect(rootFontSize(undefined)).toBe('100%')
	})

	it('resolves each step to its percentage root value', () => {
		expect(rootFontSize('87.5')).toBe('87.5%')
		expect(rootFontSize('112.5')).toBe('112.5%')
		expect(rootFontSize('125')).toBe('125%')
	})

	it('resolves an invalid value to the default percentage, never a raw string', () => {
		expect(rootFontSize('4px; color:red')).toBe('100%')
	})
})

describe('normalizeFontFamily', () => {
	it('falls back to the system default for undefined (the on-login value)', () => {
		expect(normalizeFontFamily(undefined)).toBe('system')
	})

	it('falls back to the default for unknown / tampered values', () => {
		expect(normalizeFontFamily('comic-sans')).toBe('system')
		expect(normalizeFontFamily(3)).toBe('system')
		expect(normalizeFontFamily(null)).toBe('system')
	})

	it('passes a known font key through unchanged', () => {
		expect(normalizeFontFamily('serif')).toBe('serif')
		expect(normalizeFontFamily('monospace')).toBe('monospace')
		expect(normalizeFontFamily('sansSerif')).toBe('sansSerif')
	})

	it('rejects inherited prototype keys (the `in` operator trap)', () => {
		expect(normalizeFontFamily('toString')).toBe('system')
		expect(normalizeFontFamily('constructor')).toBe('system')
		expect(normalizeFontFamily('hasOwnProperty')).toBe('system')
	})
})

describe('fontFamilyStack', () => {
	it('resolves the default to the Open Sans stack', () => {
		expect(fontFamilyStack(undefined)).toContain('Open Sans')
	})

	it('resolves each key to a non-empty CSS font stack', () => {
		expect(fontFamilyStack('serif')).toContain('serif')
		expect(fontFamilyStack('monospace')).toContain('monospace')
		expect(fontFamilyStack('sansSerif')).toContain('system-ui')
	})

	it('resolves a tampered value to the default stack, never the raw string', () => {
		const malicious = 'x; background:url(evil)'
		expect(fontFamilyStack(malicious)).not.toContain('evil')
		expect(fontFamilyStack(malicious)).toContain('Open Sans')
	})

	it('always returns a string, even for prototype keys (not a function)', () => {
		expect(typeof fontFamilyStack('constructor')).toBe('string')
		expect(fontFamilyStack('constructor')).toContain('Open Sans')
	})
})
