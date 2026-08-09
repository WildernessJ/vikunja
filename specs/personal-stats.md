# personal-stats Specification

## Purpose

Vikunja SHALL offer a personal productivity page — task completions over time and a per-project open/done/overdue breakdown, computed from existing task data — giving the review-oriented subset of Todoist's Karma/Insights without gamification.

## Invariants

- Stats are computed over tasks in projects the requesting user can read; no cross-user leakage.
- **Honest labeling:** tasks carry no "completed by" column, so completion counts are "completions in your projects", NOT "completions by you" — the UI copy and API field names MUST say so (e.g. `completed_in_projects`). "Created" counts, by contrast, ARE authored counts (`created_by_id = requesting user`). The two scopes are deliberately different and MUST NOT be presented as the same thing.
- Window semantics: completed/created series and totals are bound to the requested window; open and overdue totals are point-in-time snapshots unaffected by the window selector.
- "Overdue" uses the same boundary as the existing project overdue badge (due before start-of-tomorrow in the user's configured timezone, task undone) — the Statistics page and a project's badge MUST NOT disagree.
- Read-only: no new stored state (no streak counters, no denormalized aggregates).

## Requirements

### Requirement: Stats endpoint

A v2 endpoint SHALL return, for a requested window (default 12 weeks, max 52): completions-per-day in readable projects; totals — `completed_in_projects` (window), `created_by_me` (window, authored), `open` (now), `overdue` (now, badge-parity boundary); and a per-project breakdown (open, completed-in-window, overdue) across readable projects.

#### Scenario: Completions per day

- **GIVEN** a user whose readable projects had 2 tasks completed on 2026-07-01 and 1 on 2026-07-03
- **WHEN** stats are requested for a window covering those dates
- **THEN** the per-day series shows 2 on the 1st, 0 on the 2nd, 1 on the 3rd (gaps zero-filled)

#### Scenario: Created counts are authored

- **GIVEN** a shared project where teammate T created 5 tasks and the requesting user created 2 in the window
- **WHEN** stats are requested
- **THEN** `created_by_me` is 2

#### Scenario: Completed counts deliberately include teammates

- **GIVEN** a shared project where teammate T completed 3 tasks in the window and the requesting user completed 1
- **WHEN** stats are requested
- **THEN** `completed_in_projects` is 4 — this is intended behavior, not a bug: the data model has no completed-by column, and the metric is named and labeled accordingly

#### Scenario: Edge case: no readable tasks

- **GIVEN** a fresh user with no projects
- **WHEN** stats are requested
- **THEN** the response is well-formed with zeroed series, not an error

### Requirement: Stats page

A "Statistics" page (user menu) SHALL render the completions-per-day series as a bar chart, the totals as stat tiles (labeled per the honest-labeling invariant), and the per-project breakdown as a table, with a window selector (4/12/26/52 weeks) that visibly affects only the window-bound numbers.

#### Scenario: Page renders

- **GIVEN** a user with completions in the last month
- **WHEN** they open Statistics
- **THEN** the chart, tiles, and project table render with non-zero values matching the endpoint

## Success Criteria

- **SC-001**: All scenarios pass under `mage test:filter` / `mage test:web` / `mage test:e2e`.
- **SC-002**: The endpoint answers in one aggregate query pass per section (no N+1 across projects) — verified by inspection in review.
- **SC-003**: The overdue total for a project on the Statistics page equals that project's existing overdue badge count for the same user at the same moment.

## Non-Goals

- No karma points, levels, streaks, or vacation mode.
- No per-actor completion attribution — the data model has no `done_by` column; revisit only if/when one exists (the activity feed's actor-tracked events are a possible future source, deliberately not used here).
- No team/workspace insights or per-collaborator workload.
- No email digests or scheduled reports.
- No denormalized counters or new tables.
