---
status: Enacted
date: 2026-07-17
deciders: fork maintainer
phase: —
---

# ADR-0003: One date-column convention for frontend models, enforced by an auto-enumerating test

## Context

Frontend model classes in `frontend/src/models/` receive API payloads where timestamp columns
(`created`, `updated`, `expiresAt`, …) arrive as ISO **strings**, but the models type them as `Date`.
The correct pattern has two halves, and the well-behaved models do both: declare the field with the
epoch sentinel default `field: Date = new Date(0)`, and convert the incoming value in the constructor
with `this.field = new Date(this.field)`.

Three defaults had drifted apart across ~44 model files:

- `new Date(0)` — the epoch sentinel (correct default).
- `new Date()` / bare `new Date` — "now", which makes an absent column look freshly-created.
- Unconverted string — the field is typed `Date` but holds a raw string at runtime (`#46`,
  `projectView.ts`).

There was no guard, so each new or edited model could silently pick the wrong one. `#46` was one such
instance; a probe found three more (`teamMember`, `teamProject`, `userProject` — subclasses that call
`this.assignData(data)` a second time after `super()`, re-overwriting the base's conversion with the
raw strings) plus a wrong default in `taskRelation`.

## Decision

Adopt the two-part pattern as the single convention, and enforce it with a **runtime convention test**
that auto-enumerates the model directory (`import.meta.glob('./*.ts')`). For every instantiable model,
for every field that is a `Date` on a default (`new Model({})`) instance, the test asserts the default
is the epoch sentinel (`getTime() === 0`) and that constructing with an incoming ISO string yields a
valid `Date`. It lives in `frontend/src/models/modelDefaults.test.ts`.

## Alternatives considered

- **A — Auto-enumerating runtime test** (chosen): checks *behavior*, needs no new deps, and a new
  model is covered the moment it lands (no list to update). Trade-off: only sees non-null `Date`
  fields present on a `new Model({})` instance — optional/nullable date fields are out of its reach.
- **B — Base-model date-normalizer** (rejected): move conversion into `AbstractModel`, driven by a
  per-model `dateFields` array. Touches every model's behavior for 4 violators, and merely relocates
  the footgun ("forgot the conversion line" → "forgot to list the field") with no test to catch the
  new omission.
- **C — Custom ESLint rule** (rejected): enforces the *source shape* at author time, but is more code
  to maintain and is blind to inheritance (a base-class conversion is invisible to the AST), which is
  exactly where the real violators were.

## Consequences

- **Positive:** the convention is now un-forgettable — adding a model with a `new Date()`-defaulted or
  unconverted date column fails a test immediately, with the offending `model.field` named.
- **Negative / trade-offs:** the guard does not cover nullable/optional date fields (absent on a
  `new Model({})` instance), nor date fields on models that can't be constructed with `{}`. A second,
  un-unified convention therefore survives outside the guard: `session.ts` and `caldavToken.ts` declare
  `field!: Date` with a *conditional* `if (this.field) this.field = new Date(this.field)` and no epoch
  default — the guard never enumerates them (they are `undefined` on a default instance), so "single
  convention" holds only for non-null date columns, not literally every model. Folding those into the
  epoch-default pattern was left out of scope. A related pre-existing bug is also left untouched: the
  same double-`assignData` in the three subclasses re-corrupts non-date fields too (e.g. `settings` on
  `TeamMemberModel`); only the date columns were fixed here. Tracked as #51.

## Confirmation

Review checkpoint: `frontend/src/models/modelDefaults.test.ts` runs in the unit suite; a violating
model turns it red. Any PR that adds a `dateFields`-style base normalizer, or an ESLint rule for this,
must revisit this ADR.

## Links

- Source: #46 (bug — `projectView` never converted its dates), #47 (enforce a single convention).
- Related ADRs: —
