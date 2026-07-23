---
status: Enacted
date: 2026-07-23
deciders: WildernessJ
phase: —
supersedes:
superseded-by:
---

# ADR-0008: Reminder magic-text tokens parse only from the trailing run

## Context

The quick-add composer gained a `~` prefix so reminders can be typed like the
other magic fields: `~1d`/`~2h`/`~30m`/`~1w` for a relative-before-due-date
reminder, and `~<date>` (e.g. `~next friday at 9am`) for an absolute one. Unlike
the other prefixes (`+ * ! @`), `~` has a heavy pre-existing meaning in ordinary
prose: it reads as "approximately". A naïve left-to-right parser that fires on
any word-boundary `~<n><unit>` therefore silently corrupts normal task titles —
`Drive ~2h to the coast` loses `~2h` from the title *and* gains an invisible
phantom reminder. A cold audit flagged this as the headline risk, and there is
no escape character in the grammar.

## Decision

Reminder tokens are parsed **only from the contiguous trailing run** of the
title. Scanning right-to-left, a `~` counts as a reminder only when its content
consumes the entire tail with nothing after it — a relative offset must be the
whole token (`~1d` immediately followed by end-of-string/whitespace), and an
absolute date must be fully consumed by the shared date grammar with no leftover
text. The first `~` that fails that test marks the boundary: everything to its
left is title, left untouched. Multiple trailing tokens
(`Ship it ~2h ~tomorrow at 8am`) each qualify and are kept in title order.

## Alternatives considered

- **A — Parse any `~` token anywhere (left-to-right greedy):** simplest, but it
  is exactly the collision above — silent title corruption + phantom reminders on
  common `~`-as-approximately phrasing. Rejected.
- **B — Require a `before` keyword (`~1d before`):** zero collision, fully
  explicit, but verbose and a larger departure from the bare `~1d` syntax that
  was chosen for the offsets.
- **C — Different, less-loaded prefix:** the obvious ASCII prefixes are already
  taken (`+ * ! @`) or equally ambiguous; churning the chosen syntax for a new
  character was not worth it.
- **D — Abandon text parsing, keep reminders chip-only:** discards the feature.

## Consequences

- **Positive:** ordinary titles containing `~2h`/`~1w` as "approximately" are
  never mangled; no phantom reminders. The rule is a single, explainable
  invariant ("reminders go at the end") that also disambiguates multiplicity for
  free.
- **Negative / trade-offs:** a reminder token followed by non-reminder text is
  left literal — `~tomorrow lunch`, or a `~2h` with words after it, will not
  parse. Reminders must be typed as the trailing part of the title. This is a
  behavior users learn, and it is stricter than the other prefixes (which can sit
  mid-title).

## Confirmation

`frontend/src/modules/quickAddMagic/reminderParser.test.ts` pins the boundary:
trailing tokens parse (single, multiple, mixed relative/absolute), while
mid-title cases (`Drive ~2h to the coast`, `Meeting in ~1w though`,
`Ping ~tomorrow lunch`, an earlier `~1d` before a trailing `~2h`) assert **no**
reminder and an unchanged title. The full `quickAddMagic` suite plus a browser
live-verify of the composer confirm end-to-end behavior.

## Links

- Source PR: quick-add reminder magic (#50 item #1)
- Related ADRs: ADR-0002 (quick-add composer shape), ADR-0007 (quote-close heuristic)
