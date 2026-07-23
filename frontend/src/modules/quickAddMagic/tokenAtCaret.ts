import type {Prefixes} from './types'

export type TokenType = 'label' | 'project' | 'assignee'

export interface TokenAtCaret {
	type: TokenType,
	prefix: string,
	query: string,
	start: number,
	end: number,
}

// Priority (`!`) is excluded on purpose - out of scope, it's a fixed 5-value enum.
const TOKEN_TYPES: TokenType[] = ['label', 'project', 'assignee']

interface RawToken {
	start: number,
	end: number,
	query: string,
}

interface QuotedSpan {
	start: number,
	end: number,
}

// A same-char quote nested in the content (e.g. the apostrophe in "Bob's") would
// otherwise be mistaken for the closing quote. Heuristic: the span closes at the
// first occurrence of the quote char that is followed by a space or end-of-string;
// an occurrence glued to more content (no trailing space/eol) is treated as literal.
// If no such occurrence exists, the span is unterminated and runs to end-of-string.
export function findQuoteClose(text: string, quoteChar: string, scanFrom: number): number {
	let from = scanFrom
	while (from < text.length) {
		const closing = text.indexOf(quoteChar, from)
		if (closing === -1) {
			return -1
		}
		const afterChar = text[closing + 1]
		if (afterChar === ' ' || closing + 1 === text.length) {
			return closing
		}
		from = closing + 1
	}
	return -1
}

// A quote only opens a span when it immediately follows a prefix char at a word
// boundary (matching getItemsFromPrefix's grammar) - prefix chars found inside an
// already-open span are literal content, not new token boundaries.
function computeQuotedSpans(text: string, prefixChars: string[]): QuotedSpan[] {
	const spans: QuotedSpan[] = []
	let i = 0
	while (i < text.length) {
		const boundary = i === 0 || text[i - 1] === ' '
		const nextChar = text[i + 1]
		if (boundary && prefixChars.includes(text[i]) && (nextChar === '\'' || nextChar === '"')) {
			const closing = findQuoteClose(text, nextChar, i + 2)
			const end = closing === -1 ? text.length : closing + 1
			spans.push({start: i, end})
			i = end
			continue
		}
		i++
	}
	return spans
}

function isInsideQuotedSpan(index: number, spans: QuotedSpan[]): boolean {
	return spans.some(span => index > span.start && index < span.end)
}

// Mirrors getItemsFromPrefix's grammar (word-boundary prefix, quote handling, single
// literal space as the only delimiter) but evaluated incrementally against a caret
// offset instead of extracting all matches from the whole string.
function findTokenForPrefix(text: string, caretOffset: number, prefix: string, quotedSpans: QuotedSpan[]): RawToken | null {
	let start = -1
	for (let i = 0; i < caretOffset; i++) {
		if (text[i] === prefix && (i === 0 || text[i - 1] === ' ') && !isInsideQuotedSpan(i, quotedSpans)) {
			start = i
		}
	}
	if (start === -1) {
		return null
	}

	const contentStart = start + 1
	const nextChar = text[contentStart]
	if (nextChar === ' ') {
		return null
	}

	const quoteChar = nextChar === '\'' || nextChar === '"' ? nextChar : null
	const queryStart = quoteChar !== null ? contentStart + 1 : contentStart

	let end: number
	let queryEnd: number
	if (quoteChar !== null) {
		const closing = findQuoteClose(text, quoteChar, queryStart)
		end = closing === -1 ? text.length : closing + 1
		queryEnd = closing === -1 ? text.length : closing
	} else {
		const space = text.indexOf(' ', contentStart)
		end = space === -1 ? text.length : space
		queryEnd = end
	}

	if (caretOffset < contentStart || caretOffset > end) {
		return null
	}

	return {
		start,
		end,
		query: text.slice(queryStart, Math.max(queryStart, Math.min(caretOffset, queryEnd))),
	}
}

export function tokenAtCaret(text: string, caretOffset: number, prefixSet: Prefixes | undefined): TokenAtCaret | null {
	if (!prefixSet) {
		return null
	}

	const quotedSpans = computeQuotedSpans(text, TOKEN_TYPES.map(type => prefixSet[type]))

	let best: TokenAtCaret | null = null

	for (const type of TOKEN_TYPES) {
		const prefix = prefixSet[type]
		const token = findTokenForPrefix(text, caretOffset, prefix, quotedSpans)
		if (token !== null && (best === null || token.start > best.start)) {
			best = {type, prefix, ...token}
		}
	}

	return best
}
