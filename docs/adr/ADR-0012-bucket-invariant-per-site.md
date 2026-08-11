---
status: Accepted
date: 2026-08-11
deciders: fork maintainer
phase: —
supersedes:
superseded-by:
---

# ADR-0012: The `default != done` bucket invariant is enforced per write-site, not by a DB constraint

## Context

The fork holds an invariant: no persisted project view has a nonzero `default_bucket_id`
equal to its `done_bucket_id`. A view where the same bucket is both the default drop target
and the done bucket lets a repeating task land in a bucket whose task limit is never enforced
(fork issue #26). The check lives in `ProjectView.checkBucketConfiguration`.

The v2.5.0 upstream sync added a project-view kind-switch feature. On a list→kanban switch,
`healBucketIDs` recomputes and persists `default_bucket_id`/`done_bucket_id` *after*
`checkBucketConfiguration` has already run, so the check could be satisfied on the request and
then a violating pair written by the heal. That regression was fixed by normalizing (clearing
the default) at each write-site that can produce the collision from clean data — `healBucketIDs`
and the kanban-repair migration.

The obvious stronger enforcement is a database `CHECK` constraint. It is **not available**:
project duplication deliberately makes a *faithful copy* of a source view, calling the update
path with validation disabled so a pre-existing legacy view that already violates the invariant
still duplicates. A test asserts a duplicated legacy view keeps `default == done`. A `CHECK`
constraint would reject that write and break duplication.

## Decision

Enforce the invariant at each write-site that can *originate* a violation from valid data
(create, update, heal, kind-repair migration), not with a single database chokepoint. The
invariant is therefore **inductive, not absolute**: a violating row can be *propagated* by a
faithful copy (duplication), but cannot be *originated* from a clean state. Duplication's remap
is injective (each source bucket maps to exactly one new bucket), so a copy can only carry a
violation forward, never create one.

## Alternatives considered

- **A — DB `CHECK` constraint.** One chokepoint, impossible to bypass. Rejected: it would
  reject the faithful-copy write in project duplication, breaking a legitimate feature and its
  test.
- **B — Reject in `healBucketIDs` (return an error).** Rejected: heal runs mid-flow on a
  kind switch and must produce a *valid* state, not fail; erroring would abort the switch.
- **C — Make `getDefaultBucketID` exclude the done bucket.** Rejected: 8 callers (blast
  radius on runtime task placement) and it misses the collision when the client supplies a
  nonzero default equal to the stored done, since `getDefaultBucketID` is never reached on
  that path.

## Consequences

- **Positive:** duplication keeps upstream's faithful-copy semantics; the fix is a small,
  local normalization at each origination site.
- **Negative / trade-offs:** enforcement is distributed, so a *new* write path to
  `default_bucket_id`/`done_bucket_id` added by a future upstream sync will not inherit the
  guard automatically. A `CHECK` constraint is permanently off the table while duplication
  stays faithful. When the default is cleared on a collision, runtime task placement falls back
  to the leftmost bucket, which is not guaranteed to exclude the done bucket (placement quirk on
  an already-unusual config; the persisted invariant still holds).

## Confirmation

`TestProjectView_HealKeepsDefaultDistinctFromDone` and
`TestRepairKanbanViews20260802162816DefaultEqualsDone` cover the two origination paths the sync
touched. Review-checklist item for future syncs: when upstream adds any write to
`default_bucket_id`/`done_bucket_id`, confirm it normalizes the collision before persisting —
enumerate the write-sites, do not assume a chokepoint.

## Links

- Related ADRs: ADR-0006 (upstream sync via merge)
