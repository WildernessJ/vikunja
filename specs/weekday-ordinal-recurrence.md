# weekday-ordinal-recurrence Specification

## Purpose

Tasks SHALL support calendar-pattern recurrence — weekday sets ("every Mon, Fri"), ordinal weekdays ("every 3rd Friday", "every last workday"), month-day sets ("every 2, 15, 27"), "last day of month", and schedule bounds ("starting Aug 3", "until Dec 1") — in addition to the existing fixed-interval repeat modes. Patterns are stored as an RFC 5545 RRULE string so CalDAV export/import round-trips them losslessly.

## Invariants

- The three existing repeat modes (`TaskRepeatModeDefault`, `TaskRepeatModeMonth`, `TaskRepeatModeFromCurrentDate`) MUST keep working unchanged; existing tasks are untouched by migration.
- Completing a repeating task MUST always produce a next due date strictly in the future (consistent with existing repeat behavior in `updateDone`).
- A stored pattern MUST round-trip: CalDAV export emits the RRULE, and re-importing that VTODO reproduces the same recurrence.
- An invalid or unsupported RRULE string MUST be rejected at task create/update time with a typed error (HTTP 400), never stored.
- All date computation MUST respect the task's existing timezone handling (patterns are evaluated in the user's timezone, not UTC-naive).

## Requirements

### Requirement: RRULE repeat mode

The task model SHALL support a new repeat mode `TaskRepeatModeRRule` with a companion `repeat_rrule` string field holding an RFC 5545 RRULE (RFC-supported subset: `FREQ` of `DAILY|WEEKLY|MONTHLY|YEARLY`, `INTERVAL`, `BYDAY` (with ordinal prefixes incl. negative), `BYMONTHDAY` (incl. `-1`), `BYSETPOS`, `UNTIL`). When a task in this mode is completed, the next due date SHALL be the first occurrence of the rule strictly after the current due date; start/end dates and reminders shift by the same delta, matching existing repeat semantics.

When a task is created or updated into RRULE mode **without a due date**, the due date SHALL be anchored to the first occurrence of the rule strictly after now (so a recurring task is never left dateless and inert — Todoist parity). An existing due date is never overwritten. This applies to RRULE mode only; legacy interval modes are unchanged. If the rule has no future occurrence (e.g. its `UNTIL` bound has already passed), the due date is left empty.

#### Scenario: Created without a due date anchors to first occurrence

- **GIVEN** a task created with `repeat_rrule` `FREQ=WEEKLY;BYDAY=MO,FR` and no due date, on Sunday 2026-07-05
- **WHEN** the task is created
- **THEN** the stored task has due date Monday 2026-07-06 (first occurrence after now), not empty

#### Scenario: Existing due date is not overwritten on create

- **GIVEN** a task created with `repeat_rrule` `FREQ=WEEKLY;BYDAY=MO,FR` and an explicit due date Friday 2026-07-31
- **WHEN** the task is created
- **THEN** the stored due date remains Friday 2026-07-31 (the rule does not override an explicit date)

#### Scenario: Weekday set

- **GIVEN** a task due Monday 2026-07-06 09:00 with `repeat_rrule` `FREQ=WEEKLY;BYDAY=MO,FR`
- **WHEN** the task is marked done
- **THEN** the task is un-done with due date Friday 2026-07-10 09:00

#### Scenario: Ordinal weekday

- **GIVEN** a task due Friday 2026-07-17 (3rd Friday) with `repeat_rrule` `FREQ=MONTHLY;BYDAY=3FR`
- **WHEN** the task is marked done
- **THEN** the next due date is Friday 2026-08-21 (3rd Friday of August)

#### Scenario: Last day of month

- **GIVEN** a task due 2026-07-31 with `repeat_rrule` `FREQ=MONTHLY;BYMONTHDAY=-1`
- **WHEN** the task is marked done
- **THEN** the next due date is 2026-08-31

#### Scenario: Last workday of month

- **GIVEN** a task due 2026-07-31 (a Friday) with `repeat_rrule` `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1`
- **WHEN** the task is marked done
- **THEN** the next due date is 2026-08-31 (a Monday)

#### Scenario: Edge case: UNTIL bound reached

- **GIVEN** a task due 2026-07-06 with `repeat_rrule` `FREQ=WEEKLY;BYDAY=MO;UNTIL=20260710T000000Z`
- **WHEN** the task is marked done
- **THEN** no next occurrence exists and the task stays done (repeat does not fire)

#### Scenario: Edge case: overdue task with multiple missed occurrences

- **GIVEN** a task due Monday 2026-06-01 with `repeat_rrule` `FREQ=WEEKLY;BYDAY=MO` completed on 2026-07-05
- **WHEN** the task is marked done
- **THEN** the next due date is the first occurrence after now (2026-07-06), not 2026-06-08

#### Scenario: Edge case: invalid RRULE rejected

- **GIVEN** a task update setting `repeat_rrule` to `FREQ=BOGUS`
- **WHEN** the update is submitted
- **THEN** the API responds 400 with a typed invalid-rrule error and the task is unchanged

### Requirement: From-completion evaluation

A boolean `repeat_from_completion` flag SHALL, when set on an RRULE-mode task, evaluate the next occurrence from the completion timestamp instead of the previous due date (Todoist's `every!` semantic).

#### Scenario: Completion-anchored weekday

- **GIVEN** a task due Monday 2026-06-29 with `repeat_rrule` `FREQ=WEEKLY;BYDAY=MO` and `repeat_from_completion` true, completed Wednesday 2026-07-01
- **WHEN** the task is marked done
- **THEN** the next due date is Monday 2026-07-06 (first Monday after completion)

### Requirement: CalDAV round-trip

CalDAV export SHALL emit the stored RRULE verbatim for RRULE-mode tasks, and CalDAV import (`ParseTaskFromVTODO`) SHALL parse an incoming `RRULE` property into RRULE mode when it uses the supported subset — fixing the current silent drop of recurrence on import. The `repeat_from_completion` flag round-trips via a non-standard `X-VIKUNJA-REPEAT-FROM-COMPLETION` property (RFC 5545 has no equivalent). Interval-mode tasks keep their existing export behavior.

#### Scenario: From-completion flag round-trips

- **GIVEN** an RRULE-mode task with `repeat_from_completion` true
- **WHEN** it is exported via CalDAV and the resulting VTODO is imported back
- **THEN** the imported task has both the same RRULE and `repeat_from_completion` true

#### Scenario: Import preserves recurrence

- **GIVEN** a VTODO with `RRULE:FREQ=WEEKLY;BYDAY=MO,FR` PUT to the CalDAV endpoint
- **WHEN** the task is created
- **THEN** the stored task has repeat mode RRULE and `repeat_rrule` `FREQ=WEEKLY;BYDAY=MO,FR`

#### Scenario: Edge case: unsupported RRULE on import

- **GIVEN** a VTODO with an RRULE outside the supported subset (e.g. `FREQ=HOURLY;BYMINUTE=30`)
- **WHEN** the task is imported
- **THEN** the task is created without recurrence and the response succeeds (import must not hard-fail on exotic rules)

### Requirement: Quick-add magic parsing

The frontend quick-add parser SHALL recognize natural-language pattern phrases and produce the corresponding RRULE: weekday lists ("every mon, fri" / full names), ordinals ("every 3rd friday", "every last day", "every last workday"), month-day sets ("every 2, 15, 27"), and bounds ("… starting aug 3", "… until dec 1"). Existing interval phrases keep producing interval mode. `every!` prefix sets `repeat_from_completion`.

#### Scenario: Weekday list parsed

- **WHEN** the user quick-adds "water plants every mon, fri"
- **THEN** the created task has title "water plants" and `repeat_rrule` `FREQ=WEEKLY;BYDAY=MO,FR`

#### Scenario: Interval phrases unchanged

- **WHEN** the user quick-adds "backup every 2 weeks"
- **THEN** the created task uses the existing interval repeat (mode default, 2-week `repeat_after`), not RRULE mode

### Requirement: Repeat settings UI

The task-detail repeat editor SHALL offer the pattern options (weekday checkboxes; monthly: day-of-month / Nth-weekday / last-day / last-workday; optional end date) and display an existing RRULE-mode task's pattern in human-readable form. Selecting a pattern sets RRULE mode; the existing interval editor remains for the other modes.

#### Scenario: Weekday selection

- **GIVEN** a task open in detail view
- **WHEN** the user picks repeat "Weekly" and checks Mon and Fri and saves
- **THEN** the task is stored with `repeat_rrule` `FREQ=WEEKLY;BYDAY=MO,FR`
- **AND** reopening the editor shows Mon and Fri checked

## Success Criteria

- **SC-001**: All scenarios above pass under `mage test:filter` / `mage test:e2e`.
- **SC-002**: Date-engine unit tests cover every supported RRULE component (table-driven, incl. DST transitions and month-length edges) and pass on MySQL, PostgreSQL, and SQLite fixtures.
- **SC-003**: A VTODO exported from a pattern task and re-imported yields an identical recurrence (round-trip test).
- **SC-004**: Existing repeat-mode tests continue to pass unmodified.

## Non-Goals

- No COUNT-based bounds ("for 3 occurrences") — Todoist's "for 3 weeks" is expressible as UNTIL at parse time; occurrence counting needs state we don't add here.
- No sub-daily patterns (BYHOUR/BYMINUTE) — interval mode already covers "every N hours".
- No mapping of Todoist-importer recurrence strings to RRULE (separate follow-up).
- No changes to reminder recurrence (separate feature, #6 in the queue).
- No natural-language parsing on the backend — parsing stays frontend-only, as today.
