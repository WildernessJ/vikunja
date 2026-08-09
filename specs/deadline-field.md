# deadline-field Specification

## Purpose

Tasks SHALL carry an optional `deadline` — a hard cutoff distinct from the do-date (`due_date`) — surfaced in the task detail, filterable, quick-add-settable via `{...}`, and usable as a reminder anchor. This separates "when I plan to work on it" from "when it must be done" (Todoist's Deadlines, ungated here).

## Invariants

- `deadline` is independent of `due_date`/`start_date`/`end_date`; setting or clearing one MUST NOT touch the others.
- On repeat, a set deadline MUST advance off its own prior value using each mode's own advancement mechanism — in ALL FOUR repeat paths: interval addition in default mode, month addition in monthly mode, now-plus-interval in from-current-date mode, and the same due-date delta in the RRULE mode's `updateDone` branch (added by `weekday-ordinal-recurrence`, which builds before this). Independent of whether a due date is set, and never derived from the due date in the three legacy modes (deliberately NOT the start/end mechanic, which recomputes from the new due date in from-current-date mode).
- Existing tasks are unaffected (nullable column, no backfill).

## Requirements

### Requirement: Deadline field

The task model SHALL gain a nullable `deadline` datetime, readable and writable through both API versions on all existing task endpoints, sortable, and included in CalDAV export as a non-destructive extension property (`X-VIKUNJA-DEADLINE`).

#### Scenario: Set and clear

- **GIVEN** a task without a deadline
- **WHEN** it is updated with `deadline: 2026-08-01T17:00:00Z`, then later with `deadline: null`
- **THEN** the field persists after the first update and is empty after the second, with `due_date` untouched both times

### Requirement: Filtering

The filter DSL SHALL accept `deadline` with all existing comparators and datemath (e.g. `deadline < now+7d`, `deadline != null`), in per-view filters and saved filters.

#### Scenario: Deadline window filter

- **GIVEN** tasks A (deadline in 3 days), B (deadline in 30 days), C (no deadline)
- **WHEN** a filter `deadline < now+7d` is applied
- **THEN** only A is returned

### Requirement: Quick-add syntax

Quick-add magic SHALL parse `{<date text>}` into the deadline using the existing date grammar, in both prefix modes.

#### Scenario: Braced deadline

- **WHEN** the user quick-adds "file taxes tomorrow {next friday}"
- **THEN** the task has due date tomorrow and deadline next Friday, title "file taxes"

### Requirement: Reminder anchor

`deadline` SHALL be a valid `relative_to` value for task reminders, alongside due/start/end.

#### Scenario: Remind before deadline

- **GIVEN** a task with a deadline
- **WHEN** a reminder relative to `deadline` with offset −86400s is created
- **THEN** it fires one day before the deadline

### Requirement: Detail UI

The task detail SHALL show Deadline as its own field (picker, clear button) and render an overdue-deadline state (deadline past, task not done) visually distinct from overdue-due-date, including in list/card chips.

#### Scenario: Overdue deadline styling

- **GIVEN** an undone task whose deadline passed yesterday
- **WHEN** it renders in detail and list views
- **THEN** the deadline is marked with the overdue-deadline style (distinct from the due-date overdue style)

## Success Criteria

- **SC-001**: All scenarios pass under `mage test:filter` / `mage test:web` / `mage test:e2e`.
- **SC-002**: Filter docs component lists `deadline`; typecheck and linters pass.
- **SC-003**: Existing date-field tests pass unmodified.

## Non-Goals

- No deadline on the calendar/gantt placement logic (due/start/end stay the placement dates; revisit with feature #2 if wanted).
- No dedicated deadline notifications beyond the reminder anchor (no automatic countdown digest).
- No date-only storage special-casing — it's a datetime like every other Vikunja date.
