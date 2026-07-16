import type {TokenAtCaret} from './tokenAtCaret'

export interface TokenInsertResult {
	text: string,
	caret: number,
}

export function insertTokenAtCaret(text: string, token: TokenAtCaret, value: string): TokenInsertResult {
	// Doesn't escape a `"` embedded in the entity name (e.g. `Say "Hi" Team`) - the
	// quick-add-magic grammar itself can't represent embedded quotes, so this matches
	// what the parser can round-trip.
	const quoted = value.includes(' ') ? `"${value}"` : value
	const hasTrailingSpace = text[token.end] === ' '
	const insertion = token.prefix + quoted + (hasTrailingSpace ? '' : ' ')

	return {
		text: text.slice(0, token.start) + insertion + text.slice(token.end),
		caret: token.start + insertion.length,
	}
}
