---
status: Enacted
date: 2026-07-22
deciders: fork maintainer
phase: —
supersedes:
superseded-by:
---

# ADR-0007: Quoted magic-token spans close on a quote followed by space/end-of-string

## Context

The quick-add "magic" parser lets a user quote a multi-word token name: `+"My Project"`,
`*'my label'`. The original grammar closed a quoted span at the **first** occurrence of the
opening quote char. That truncated any name containing the same quote char — the common case
being an apostrophe inside a single-quoted name: `+'Bob's Project'` parsed as `Bob`, and the
autocomplete token ended at the false closing quote (issue #50). Mixed-quote names already
worked (`+"Bob's Project"`, `*'Say "hi"'`) because the inner char differs from the delimiter.
The genuinely broken case — a same quote char nested inside a same-quoted span — is
**inherently ambiguous**: with no escape mechanism, the parser cannot know whether an inner
`'` is literal content or the closing quote. A decision was needed on how to disambiguate,
because the grammar is **shared** by both the live autocomplete (`tokenAtCaret`) and the
actual task-creation parse (`getItemsFromPrefix`), so any change ripples to real parsing.

## Decision

A quoted span closes at the first occurrence of the quote char that is **followed by a space
or the end of the string**; an occurrence glued to more content (no trailing space/eol) is
treated as literal. If no qualifying occurrence exists, the span is unterminated and runs to
end-of-string (preserving the existing in-progress-typing behavior). This single rule lives in
one shared helper, `findQuoteClose` (`frontend/src/modules/quickAddMagic/tokenAtCaret.ts`),
called by `computeQuotedSpans`, `findTokenForPrefix`, and `getItemsFromPrefix` so the two
grammar sites cannot drift.

## Alternatives considered

- **A — Backslash escaping (`\'`):** unambiguous, but net-new grammar with no natural UI
  affordance for a user to type the escape; overkill for the payoff.
- **B — Won't-fix, document the double-quote workaround:** keep the first-quote-closes rule;
  tell users to wrap apostrophe names in double quotes (which already works). Rejected because
  single quotes are the easiest to type and apostrophes in names (Bob's, O'Brien) are common,
  so the trap stays visible.
- **C — Also close on a following prefix char, not just space/eol:** would additionally fix the
  glued-adjacent-token regression below. Deferred — it couples the close-scan to the
  mode-dependent prefix set for an unnatural input; revisit if the regression ever bites.

## Consequences

- **Positive:** `+'Bob's Project'` and the double-quote analog now parse whole; mixed-quote
  cases are unchanged; normally-spaced multi-token input closes at the same positions as before
  (the rule only *extends* past mid-word same-quotes). One shared helper, no drift between the
  autocomplete and the real parse.
- **Negative / trade-offs (accepted regression):** a token glued with **no separating space**
  after a quoted token gets swallowed to end-of-string. E.g. `+'Store'!3` — OLD parsed project
  `Store` + priority `3`; NEW yields project query `Store'!3`, no priority. This requires
  unnatural input (normal magic strings space their tokens) and is pinned by tests so it can't
  silently change. **A future reader must not "fix" the swallow by reverting to
  first-quote-closes** — that reintroduces the #50 truncation. If the regression matters, take
  alternative C.
- Same-quote nesting remains fundamentally unsolvable without escaping; the double-quote
  workaround stays the answer for a name that contains its own quote char.

## Confirmation

`frontend/src/modules/quickAddMagic/tokenAtCaret.test.ts` and `prefixParser.test.ts` pin the
apostrophe fix, the preserved mixed-quote cases, multi-token splitting, unterminated quotes,
and the accepted glued-adjacent-token regression. Any change to `findQuoteClose` that breaks
these must revisit this ADR.

## Links

- Source: #50 (quick-add composer polish); shipped in fix `05d0725ab`, merge `8bb1cd2aa`.
- Related ADRs: ADR-0002 (composer relies on chips + under-anchored dropdown — the same
  parser subsystem).
