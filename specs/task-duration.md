# task-duration Specification

## Purpose

Tasks SHALL carry an optional estimated duration ("2h", "30m", "1h30m"), editable in the detail view, filterable and sortable — the planning-side complement to the license-gated time-tracking feature, and the groundwork for calendar time-blocking later.

## Invariants

- Duration is a pure estimate: independent of time-tracking entries, dates, and repeat (it does not shift or reset on repeat — it carries over unchanged, including through bulk edits that don't name the field).
- Existing tasks are unaffected. 0 = unset; the field is always serialized as an explicit `0` (matching every sibling numeric task field — no `omitempty`).
- This feature MUST NOT touch the license checks around time tracking (`FeatureTimeTracking`).

## Requirements

### Requirement: Duration field

The task model SHALL gain `estimated_duration` (seconds, int, 0 = unset, max 90 days — a typo/sanity bound only; a task estimated beyond a quarter isn't an estimate), readable/writable on all task endpoints, sortable, and filterable with numeric comparators (`estimatedDuration > 3600` in the filter language).

#### Scenario: Set and persist

- **GIVEN** a task
- **WHEN** it is updated with `estimated_duration: 9000`
- **THEN** reads return 9000 and the task sorts accordingly on that column

#### Scenario: Edge case: negative or oversized rejected

- **WHEN** a task is updated with `estimated_duration: -60` or > 90 days
- **THEN** the API responds 400

#### Scenario: Edge case: bulk edit without the field preserves it

- **GIVEN** a task with `estimated_duration: 3600`
- **WHEN** a bulk edit updates other fields without naming `estimated_duration`
- **THEN** the task still has `estimated_duration: 3600`

### Requirement: Duration editing UI

The task detail SHALL show a Duration field accepting "2h", "90m", "1h30m", "2h 30m" style input (and rendering back in the same compact form), with a clear action. A duration chip renders on list/card views when set.

#### Scenario: Human input parsed

- **GIVEN** a task open in detail view
- **WHEN** the user enters "1h30m" in Duration and saves
- **THEN** the task stores 5400 seconds and the field renders "1h 30m"

#### Scenario: Edge case: garbage input

- **WHEN** the user enters "banana"
- **THEN** an inline validation error shows and nothing is saved

### Requirement: Repeat carries duration

Completing a repeating task SHALL leave `estimated_duration` unchanged on the next occurrence.

#### Scenario: Duration survives repeat

- **GIVEN** a repeating task with duration 3600
- **WHEN** it is marked done and recurs
- **THEN** the recurred task still has duration 3600

## Success Criteria

- **SC-001**: All scenarios pass under `mage test:filter` / `mage test:web` / `mage test:e2e`.
- **SC-002**: `duration` appears in filter docs; typecheck and linters pass.

## Non-Goals

- No time-blocking rendering in any view (calendar picks this up later).
- No aggregation ("total estimated time in project") — separate surface (#9 candidate).
- No quick-add syntax in v1 (avoid colliding with `weekday-ordinal-recurrence` parser changes; add after both land).
- No interaction with time-tracking entries or their license gate.
