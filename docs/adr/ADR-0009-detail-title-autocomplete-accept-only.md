---
status: Enacted
date: 2026-07-23
deciders: Jason (maintainer)
phase: —
supersedes:
superseded-by:
---

# ADR-0009: The task-detail title parses magic-text on autocomplete-accept only

## Context

The task detail page was reworked to mirror the quick-add composer: a magic-text
title field over an always-visible row of property chips. The quick-add composer
parses a *fresh* line typed from scratch and consumes recognized tokens on submit
(parse-and-strip). The detail title is different: it holds an **already-saved,
already-clean** string that the user edits in place. Applying the composer's
parse-and-strip there would re-parse every title edit, so a title that legitimately
contains `+`, `@`, `!`, `~`, or a date word (`Buy milk @ the store`,
`Email boss re: +1 headcount`) would have those fragments silently consumed as
properties and stripped from the title. We needed a rule for how aggressively the
detail title may consume tokens.

## Decision

The detail title parses **only on autocomplete-accept**, and **only the four prefix
tokens** that have a dropdown: `+project`, `*label`, `@assignee`, `!priority`. A
property is applied — and its token stripped — **only when the user actively picks
an item** from the autocomplete dropdown. Blur and Enter save the literal title
verbatim; there is no parse-on-blur. Dates, reminders, repeat, start/end, %-done,
duration, and color are **chip-only** on the detail page (no title parsing). The
invariant: an existing title is never silently mutated.

## Alternatives considered

- **A — Inline smart-date underline (Todoist-style):** detect a date phrase in the
  title and offer a click-to-accept underline. Rejected: real extra UI/logic for a
  single-line surface; the date chip already covers it.
- **B — Full parse-and-strip (mirror quick-add exactly):** on Enter/blur, consume
  any recognized token. Rejected: silently edits titles that legitimately contain
  `+ @ ! ~` or date words — data-corruption foot-gun on an existing string.
- **C (chosen) — Autocomplete-accept only, prefix tokens only.**

## Consequences

- **Positive:** existing titles can never be silently mangled or lost; the accept
  gesture is explicit and reversible; reuses the composer's autocomplete infra
  (`useQuickAddAutocomplete`) without forking it.
- **Negative / trade-offs:** the detail title supports a *narrower* token set than
  the composer (no date/reminder/repeat parsing) — a deliberate asymmetry. This
  creates a drift risk: a new magic token added to the composer will **not** appear
  in the detail title unless wired in separately.

## Confirmation

`TaskTitleField.test.ts` asserts the invariants: accept applies + strips exactly
one property; blur / Enter / Tab-out / click-away save the literal title verbatim
(e.g. `Buy milk @store` is preserved); an unresolvable token aborts without
stripping. Manual review of any future composer-token addition must ask whether it
should also be wired into the detail title.

## Links

- Spec: `specs/task-detail-todoist-chips.md` (local)
- Related ADRs: ADR-0002 (no textarea overlay-mirror in the composer), ADR-0008
  (reminder `~` tokens parse only from the trailing run)
