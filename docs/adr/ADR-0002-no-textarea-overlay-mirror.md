---
status: Enacted
date: 2026-07-16
deciders: fork maintainer
phase: —
---

# ADR-0002: The quick-add composer relies on chips + an under-anchored dropdown, not a textarea overlay-mirror

## Context

The quick-add composer parses "magic" tokens (`+project`, `*label`, `@assignee`, priority, dates)
from a plain `<textarea>`. Two follow-up features wanted richer in-textarea feedback: a
typing-triggered autocomplete dropdown, and inline highlighting that tints recognised tokens inside
the input. Both, done the "nice" way, need the same capability the codebase does **not** have: a way
to map a caret offset (or a token span) to pixel coordinates inside a `<textarea>`. The standard
technique is a hidden mirror `<div>` that duplicates the textarea's exact font, padding, border,
line-height, width and scroll offset, kept in sync on every keystroke/resize/scroll — a notoriously
drift-prone subsystem. The existing TipTap-based autocompletes get caret coordinates from ProseMirror's
`coordsAtPos()`, which has no `<textarea>` equivalent. So the question was whether to build that
mirror subsystem or find feedback that avoids it.

## Decision

Do not introduce a textarea caret/overlay-mirror subsystem for the composer. The autocomplete dropdown
anchors under the textarea element via floating-ui (`bottom-start`, `autoUpdate`); it does not track the
caret's horizontal position. Inline token highlighting is not built at all — the composer's live chips
(project/date/labels/priority/reminders) plus the autocomplete dropdown already answer "was my token
recognised?", so the highlighting's marginal gain does not justify a mirror-div.

## Alternatives considered

- **A — Caret-precise dropdown via a mirror-div** (rejected for now): dropdown follows the caret
  horizontally, IDE-like. Costs the full mirror subsystem and its ongoing fragility; the payoff is
  largest for long/wrapped input, which the composer disables magic parsing for anyway.
- **B — Inline token highlighting via an overlay mirror** (rejected): tints tokens in place. Same
  fragile subsystem; the chips + dropdown already provide recognition feedback.
- **C — Anchor the dropdown under the input** (chosen): reuses floating-ui against a real element,
  robust, no new subsystem. Trade-off: no horizontal caret tracking.

## Consequences

- **Positive:** no mirror-div to keep in sync with fonts/padding/scroll/resize; positioning reuses the
  established floating-ui pattern; less surface to break across themes and browsers.
- **Negative / trade-offs:** the dropdown sits under the input rather than at the caret; genuinely
  caret-precise UX would require revisiting this (tracked as a follow-up). Inline highlighting stays
  unavailable.

## Confirmation

Review checkpoint: any future PR that adds a hidden textarea-mirroring `<div>` or a
`getCaretCoordinates`-style helper for the composer must revisit this ADR first. The autocomplete
dropdown's positioning lives in `frontend/src/components/tasks/AddTask.vue` (floating-ui
`computePosition`/`autoUpdate` against the textarea ref).

## Links

- Source: #49 (quick-add composer follow-ups); deferred caret-precise placement tracked in #50.
- Related ADRs: —
