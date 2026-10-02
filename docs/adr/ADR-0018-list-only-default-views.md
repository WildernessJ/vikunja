---
status: Accepted
date: 2026-10-01
deciders: Jason
phase: —
---

# ADR-0018: New projects and saved filters get a List view only

## Context

Upstream creates four views for every new project and saved filter: List, Gantt, Table and
Kanban. The fork's user works in List views only. The other three views add tabs to every
project, and the user had to delete them by hand. Views are rows per project, not a global
setting, so a change to the defaults affects only projects created after the change.

## Decision

`CreateProject` and `SavedFilter.Create` create a List view only, through
`createDefaultListView`. The value is in code, not in config. Imports keep all four views
through `CreateDefaultViewsForProject`, because the importer attaches imported buckets to the
Kanban view. A user can still add a Gantt, Table or Kanban view to a project by hand.

## Alternatives considered

- **A — Keep the upstream defaults and delete views by hand:** no code change, but every new
  project needs the same cleanup.
- **B — A config key for the default view kinds:** more flexible, but the fork has one
  instance and one set of defaults. A config key adds parsing, validation and documentation
  for a value that does not change.
- **C — A per-user setting that hides view kinds:** keeps the data and allows a different
  choice per user. It needs a backend setting, a settings UI and changes to the view switcher.
  The fork has one user.
- **D — List only for imports too:** rejected. The importer would drop imported bucket
  assignments, because no Kanban view would exist to hold them.

## Consequences

- **Positive:** new projects open on their List view with no view switcher.
- **Negative / trade-offs:** to go back to the upstream defaults, a code change is necessary.
  Tests that used the default Kanban view as setup must now add one.
- **Side effect:** before this change, the Kanban bucket insert was the only place in project
  creation that loaded the creator from the database. `CreateProject` now loads the creator
  itself, so a token for a user that does not exist cannot create a project.

## Confirmation

`TestProject_CreateOrUpdate/create/normal` and `TestSavedFilter_Create/empty_filter` assert
exactly one view of kind List. `TestProject_CreateOrUpdate/create/nonexistent_owner` guards the
creator lookup.

## Links

- Commit: `aad1e8a87` (merged `9afea04c8`)
- Related ADRs: ADR-0017
