# quick-add-reminder-magic Specification

## Purpose

Quick-add magic SHALL parse reminders from task text via a new `~` prefix, closing the last
gap from #49/#50 where reminders were chip-only (project/date/labels/priority all have both a
chip and a text-parse path). Two forms: a **relative** offset before the due date (`~1d`) and an
**absolute** datetime (`~next friday at 9am`) that reuses the existing date grammar. Vikunja
(default) prefix mode only — Todoist mode has no reminder convention.

## Invariants

- The reminder token is stripped from the resulting title, like every other parsed token.
- Chip overrides win over parsed reminders (same present-vs-absent precedence as labels; see
  `resolveOverride`). A reminders chip present ⇒ parsed `~` tokens are ignored for that submit.
- Reminder parsing runs BEFORE deadline/due-date parsing so an absolute `~<date>` span is consumed
  first and the bare due-date parser never re-grabs it as `due_date`.
- A relative reminder is stored regardless of whether a due date is set (it resolves whenever a due
  date exists); no due date at parse time is NOT an error.
- Unparseable `~<token>` is left literal in the title (not stripped, no reminder) — a safe no-op.

## Requirements

### Requirement: Relative offset reminder

`~<n><unit>` with unit ∈ {`m`,`h`,`d`,`w`} SHALL produce a reminder with `relativePeriod` =
−(n × unit-seconds) and `relativeTo = due_date`. Units: m=60, h=3600, d=86400, w=604800. Months are
NOT supported (no fixed second-count).

#### Scenario: One day before due
- **WHEN** the user quick-adds "Buy milk +Home ~1d"
- **THEN** the task has a reminder `relativePeriod −86400`, `relativeTo due_date`, and title "Buy milk"

### Requirement: Absolute datetime reminder

`~<date text>` where the text after `~` parses under the existing quick-add date grammar SHALL
produce a reminder with an absolute `reminder` Date (and `relativeTo = null`). Time-of-day follows
the existing `at`/`@` convention (`~tomorrow at 8am`), inherited from `parseDate`.

#### Scenario: Absolute reminder
- **WHEN** the user quick-adds "Call dentist ~next friday at 9am"
- **THEN** the task has one reminder at the coming Friday 09:00 and title "Call dentist"

### Requirement: Disambiguation and multiplicity

The parser SHALL try the offset grammar first; on no match it feeds the post-`~` text to `parseDate`
for the absolute form; on no date it leaves the token literal. Multiple `~` tokens SHALL yield
multiple reminders.

#### Scenario: Mixed and multiple
- **WHEN** the user quick-adds "Ship it {apr 15} ~2h ~tomorrow at 8am"
- **THEN** the task has two reminders (one relative −7200s/due_date, one absolute tomorrow 08:00),
  deadline apr 15, and title "Ship it"

#### Scenario: Unparseable token is a no-op
- **WHEN** the user quick-adds "Read ~foo"
- **THEN** no reminder is parsed and the title stays "Read ~foo"

### Requirement: Composer wiring

`ParsedTaskText` SHALL gain `reminders: ITaskReminder[]`, and `useQuickAddComposer.effectiveReminders`
SHALL fall back to parsed reminders when no chip override is present (mirroring `effectiveLabels`).

#### Scenario: Chip overrides parse
- **GIVEN** the composer title "x ~1d" AND a reminders chip already set to an absolute reminder
- **THEN** the submitted task carries only the chip's reminder, not the parsed `~1d`

## Success Criteria

- **SC-001**: New `reminderParser.test.ts` covers all scenarios above (offset units, absolute,
  multiple, mixed with deadline/due, no-op); deterministic via `vi.useFakeTimers()`.
- **SC-002**: Existing `quickAddMagic` / `dateParser` / `deadlineParser` tests pass unmodified.
- **SC-003**: `pnpm typecheck` at baseline, `pnpm lint` clean; live-verified in the composer.

## Non-Goals

- No autocomplete for `~` (reminders are not an entity lookup; `tokenAtCaret` is untouched).
- No reminder recurrence (`repeatRrule`) via text.
- No `relativeTo` other than `due_date` from text (start/end/deadline anchors stay chip-only).
- No Todoist-mode `~` prefix.
