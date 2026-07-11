export const FONT_SIZES = {
	'87.5': '87.5%',
	'100': '100%',
	'112.5': '112.5%',
	'125': '125%',
} as const

export type FontSizeKey = keyof typeof FONT_SIZES

export const DEFAULT_FONT_SIZE: FontSizeKey = '100'

export function normalizeFontSize(value: unknown): FontSizeKey {
	// hasOwnProperty, not `in`: `in` matches inherited keys ('toString',
	// 'constructor', …) which would resolve to a prototype function, not a value.
	return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FONT_SIZES, value)
		? value as FontSizeKey
		: DEFAULT_FONT_SIZE
}

export function rootFontSize(value: unknown): string {
	return FONT_SIZES[normalizeFontSize(value)]
}

// System = the app's built-in Open Sans stack (matches $family-sans-serif in
// common-imports.scss). The rest are pure system stacks — no bundled fonts.
export const FONT_FAMILIES = {
	system: '\'Open Sans\', Helvetica, Arial, sans-serif',
	sansSerif: 'system-ui, -apple-system, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif',
	serif: 'Georgia, Cambria, \'Times New Roman\', Times, serif',
	monospace: '\'SFMono-Regular\', Consolas, \'Liberation Mono\', Menlo, monospace',
} as const

export type FontFamilyKey = keyof typeof FONT_FAMILIES

export const DEFAULT_FONT_FAMILY: FontFamilyKey = 'system'

export function normalizeFontFamily(value: unknown): FontFamilyKey {
	return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FONT_FAMILIES, value)
		? value as FontFamilyKey
		: DEFAULT_FONT_FAMILY
}

export function fontFamilyStack(value: unknown): string {
	return FONT_FAMILIES[normalizeFontFamily(value)]
}
