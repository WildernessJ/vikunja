# recurring-reminders Specification

## Purpose

Task reminders SHALL support their own recurrence schedule, independent of the task's dates and repeat — "nudge me every Tuesday 9am until this is done" — covering recurring follow-ups on long-lived waiting-for items without re-dating the task.

**Depends on:** `weekday-ordinal-recurrence` (reuses its RRULE engine). Build after it.

## Invariants

- A recurring reminder MUST NOT fire while its task is done; deleting the task deletes it. Un-doing the task re-arms it (see scenario).
- Recurrence applies only to absolute reminders; a reminder with `relative_to` set MUST reject a recurrence rule (they keep today's behavior of riding the task's dates).
- Recurring reminders are fully decoupled from the task's own repeat: when a repeating task recurs — in ANY of the four repeat paths, the three legacy `setTaskDates*` modes AND the RRULE-mode branch in `updateDone` (added by `weekday-ordinal-recurrence`) — reminders carrying a recurrence rule MUST be exempt from the bump/shift behavior (they advance only via their own rule). Plain reminders keep being bumped exactly as today in all four paths.
- A reminder's recurrence rule MUST survive any task edit — the task-update path reconstructs reminders and must carry the rule through.
- Existing reminders are untouched by migration and keep firing exactly as before.
- After firing, the next occurrence MUST be computed from the scheduled time (not the delivery time), so a slow cron tick cannot drift the schedule. Recurrence is evaluated in the task creator's timezone (one canonical schedule, regardless of how many recipients view it in other timezones).
- Re-arm is best-effort, not transactional: notification delivery is external I/O and cannot be rolled back; the re-arm row update happens in the same session before commit, and a commit failure may drop future occurrences — acceptable, but the builder must not pretend otherwise.

## Requirements

### Requirement: Reminder recurrence rule

`TaskReminder` SHALL gain an optional `repeat_rrule` (same supported RRULE subset and validation as task recurrence). When set, the reminder's next fire time advances to the rule's next occurrence after each firing, instead of the reminder being one-shot.

#### Scenario: Weekly nudge

- **GIVEN** an undone task with an absolute reminder at Tuesday 2026-07-07 09:00 and reminder rrule `FREQ=WEEKLY;BYDAY=TU`
- **WHEN** the reminder cron fires it
- **THEN** a notification is delivered
- **AND** the reminder's next fire time becomes Tuesday 2026-07-14 09:00

#### Scenario: Stops when done

- **GIVEN** the same reminder
- **WHEN** the task is marked done before the next Tuesday
- **THEN** no further reminder notifications are delivered

#### Scenario: Edge case: relative reminder rejects recurrence

- **GIVEN** a reminder with `relative_to: due_date`
- **WHEN** it is submitted with a `repeat_rrule`
- **THEN** the API responds 400 with a typed error

#### Scenario: Edge case: rule exhausted

- **GIVEN** a recurring reminder whose rrule has `UNTIL` in the past after firing
- **WHEN** the cron processes it
- **THEN** it fires the final occurrence and becomes one-shot-complete (never fires again)

#### Scenario: Edge case: task's own repeat does not double-advance the reminder

- **GIVEN** a task with `repeat_after` 1 week AND an absolute reminder carrying rrule `FREQ=WEEKLY;BYDAY=TU`
- **WHEN** the task is marked done and recurs
- **THEN** the task's dates shift by its repeat as today
- **AND** the recurring reminder's fire time is NOT bumped by the task repeat (it advances only via its own rule)
- **AND** a plain (non-recurring) reminder on the same task IS bumped exactly as today

#### Scenario: Edge case: RRULE-mode task repeat also does not double-advance

- **GIVEN** a task in RRULE repeat mode (`FREQ=MONTHLY;BYDAY=3FR`) AND an absolute reminder carrying its own rrule
- **WHEN** the task is marked done and recurs via the RRULE branch
- **THEN** the recurring reminder's fire time is NOT shifted by the task's due-date delta
- **AND** a plain reminder on the same task IS shifted by that delta

#### Scenario: Edge case: un-doing a task re-arms its recurring reminders

- **GIVEN** a done task whose recurring reminder last fired before completion
- **WHEN** the task is marked not-done again
- **THEN** the reminder's fire time is set to the rule's next occurrence after now

#### Scenario: Edge case: recurrence rule survives task edits

- **GIVEN** a task with a recurring reminder
- **WHEN** the task is updated (e.g. title change) through the normal update endpoint
- **THEN** the reminder still carries its recurrence rule afterward

### Requirement: Reminder editor recurrence

The task-detail reminder editor SHALL offer recurrence for absolute reminders (reusing the pattern picker from task recurrence) and display recurring reminders with their schedule in human-readable form.

#### Scenario: Set weekly reminder in UI

- **GIVEN** a task open in detail view
- **WHEN** the user adds a reminder for Tuesday 09:00 and picks repeat "Weekly on Tuesday"
- **THEN** the reminder persists with rrule `FREQ=WEEKLY;BYDAY=TU` and lists as "Every Tuesday 09:00"

## Success Criteria

- **SC-001**: All scenarios pass under `mage test:filter` / `mage test:e2e`.
- **SC-002**: Existing reminder tests (one-shot, relative, task-repeat bumping of plain reminders) pass unmodified; the task-repeat exemption for recurring reminders is new behavior covered by new tests.
- **SC-003**: A recurring reminder fired 3 times keeps exact schedule times (no drift), verified in a unit test against an extracted, directly-invokable dispatch+re-arm function (not the cron closure).

## Non-Goals

- No recurring reminders detached from tasks (no standalone "nag" objects).
- No per-occurrence delivery-channel overrides.
- No webhook/notification payload changes beyond the existing reminder event.
