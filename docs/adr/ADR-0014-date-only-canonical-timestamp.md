# ADR-0014 — Date-only mode stores a canonical timestamp, not an all-day flag

**Status:** Accepted (2026-08-18)
**Issue:** [#91](https://github.com/WildernessJ/vikunja/issues/91)

## Context

Tasks on this fork are day-scoped in practice. Every entry path auto-fills a clock time
(`calculateNearestHours` in the datepicker quick-selects and quick-add magic; flatpickr
`enableTime: true`), and every display path shows it ("due in 3 hours"). We want times
optional and never auto-filled.

Two shapes were considered:

1. **Backend all-day flag** — a real `date_only` column on tasks, all-day CalDAV events,
   time-free API semantics. Correct but touches the models, a migration, both API
   surfaces, and CalDAV — a large permanent fork delta on upstream-active backend code.
2. **Frontend-only canonical timestamp** — a `frontendSettings.dateOnly` toggle; dates
   entered without an explicit time store **23:59:59.999 local** for due/end dates and
   **00:00:00.000** for start dates, and the UI hides/drops the time. Backend untouched.

## Decision

Option 2. The `frontend_settings` blob is a backend passthrough, so the feature is a pure
frontend delta. 23:59 end-of-day matches "a day task is not overdue until the day ends"
and the existing Gantt boundary helper (`roundToNaturalDayBoundary`); the same helper
supplies both canonical values.

## Consequences

- No migration, no API change, minimal upstream-sync surface (three frontend files that
  upstream also touches).
- Backend reminder emails for "task due" fire at the stored 23:59 (near-midnight).
  Accepted; a `-1d` default reminder is a possible follow-up.
- CalDAV/ICS exports show 23:59, not a true all-day event.
- **Data is not self-describing:** a stored 23:59:59.999 cannot later be distinguished
  from a deliberately chosen 23:59. If a real all-day flag is ever adopted (upstream or
  here), migrating old rows is heuristic. This is the price of the small delta.
- Existing task timestamps are never rewritten; the toggle changes entry defaults and
  display only.
