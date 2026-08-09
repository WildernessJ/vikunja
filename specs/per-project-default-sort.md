# per-project-default-sort Specification

## Purpose

Each project view SHALL remember a **default sort order** persisted server-side, so a
project's List/Table view opens in the user's preferred order across devices and
sessions — replacing the current hard-coded `SORT_BY_DEFAULT` fallback. (GitHub #64.)

## Design decisions

- **Storage: per-view on `ProjectView`** (not per-project). It reuses the existing v2
  ProjectView CRUD (no new route), sits beside `DefaultBucketID`/`Filter` which are
  already per-view config, and sort is inherently view-specific.
- **Honored on List only** (Table descoped to #68 — its sort is persisted under a single
  global localStorage key, so per-project defaults need a per-view rewrite first).
  Kanban orders by bucket/position, Gantt/Calendar by date — a saved field-sort has no
  meaning there.
- **No new API route.** The two new fields ride the existing v2
  `project-views-update` (PUT/PATCH) operation. `crudable` + `migration` skills apply;
  `api-v2-routes` only in that the fields must serialize through the existing operation.

## Invariants

- Existing views with no saved default MUST behave exactly as today (fall back to
  `SORT_BY_DEFAULT`); the migration MUST NOT set a default on any existing view.
- Setting a default MUST be permission-gated by the existing `ProjectView` admin check —
  no new permission logic, no route-level checks.
- An in-session manual sort (URL `?sort=`) MUST override the stored default for that
  session **without** persisting it. Only the explicit "save as default" action writes.
- The persisted shape MUST mirror the existing `sort_by`/`order_by` API contract
  (parallel string arrays), so no new sort vocabulary is introduced.

## Requirements

### Requirement: Persisted default-sort fields on ProjectView

`ProjectView` SHALL gain `default_sort_by []string` and `default_order_by []string`
(nullable JSON columns, default null). They are readable and writable through the
existing v2 project-view read/update operations. Empty/absent means "no persisted
default".

#### Scenario: Save a default sort

- **GIVEN** a List view of a project the user administers
- **WHEN** the view is updated via v2 with `default_sort_by: ["priority"]`, `default_order_by: ["desc"]`
- **THEN** the response and a subsequent read return those values

#### Scenario: Edge case: non-admin cannot set a default

- **GIVEN** a user with only write (not admin) access to the project
- **WHEN** they attempt to update the view's default sort
- **THEN** the API responds 403 (existing ProjectView permission behavior, unchanged)

#### Scenario: Edge case: existing views untouched

- **WHEN** the migration runs against a DB with existing views
- **THEN** every existing view reads back `default_sort_by`/`default_order_by` as null/empty

### Requirement: List honors the persisted default

On load of a List view, when the URL carries no explicit `?sort=`, the frontend
SHALL apply the view's `default_sort_by`/`default_order_by` as the active sort instead of
`SORT_BY_DEFAULT`. When the URL carries an explicit sort, that wins and the stored default
is ignored (not overwritten). (Table view: descoped to #68.)

#### Scenario: Default applied on fresh load

- **GIVEN** a List view whose saved default is `priority desc`
- **WHEN** the user opens the project with no `?sort=` in the URL
- **THEN** tasks render sorted by priority descending

#### Scenario: Session sort overrides without persisting

- **GIVEN** the same view with saved default `priority desc`
- **WHEN** the user sorts by title in-session (URL gains `?sort=title`)
- **THEN** the list sorts by title
- **AND** the saved default remains `priority desc` on the next fresh load

### Requirement: UI to save the current sort as the default

The List and Table sort control SHALL offer an action to save the current sort as the
project view's default, which calls the v2 project-view update. After saving, a fresh load
with no `?sort=` reflects the new default.

#### Scenario: Set current sort as default

- **GIVEN** a List view sorted by `due_date asc` in-session
- **WHEN** the user invokes "set as default sort"
- **THEN** the view's `default_sort_by`/`default_order_by` persist to `due_date`/`asc`
- **AND** reloading the project with no `?sort=` opens sorted by due date ascending

## Out of scope

- **Table view (deferred to #68)** — needs a per-view sort-persistence rewrite first.
- Kanban / Gantt / Calendar default sort (their ordering is not field-based).
- Per-project (as opposed to per-view) storage.
- Any change to the `/api/v1` surface (frozen).
- A global/account-wide default sort.

## Test approach

- Backend: model/webtest that the two fields round-trip through v2 update+read and that a
  non-admin update is rejected; migration leaves existing views null.
- Frontend: unit tests on the `useTaskList` precedence (URL sort > persisted default >
  `SORT_BY_DEFAULT`) and on the save action calling the view update; live-verify List +
  Table in the browser (default applies on load, session sort overrides, save persists).
