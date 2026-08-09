# Sub-project task roll-up toggle (List view)

## Problem

A parent project's List view shows only tasks whose `project_id` is that parent.
Tasks living in sub-projects are invisible unless you open each child. The task
filter grammar's `project` field is an exact `project_id` match (no recursion),
so there is no way to see "everything under this project" short of manually
enumerating every descendant in a saved filter. Users organising work as a
project tree want a parent view that rolls up its whole subtree.

## Intended behavior

- A toggle in the **List view** header (near the existing filter/sort controls),
  label ~ "Show sub-project tasks". Off by default → today's behavior unchanged.
- **On** → the list also shows tasks from **all descendant projects** (every
  level, not just direct children) that the user has **read** access to.
- **Per-project, remembered client-side.** State stored in `localStorage` keyed
  by project id; read on mount. Turning it on for one project doesn't affect
  others. Empty/absent → off.
- **Origin badge.** Rows whose `task.projectId !== <current parent id>` render the
  existing `showProject` chip on `SingleTaskInProject.vue` (already used by
  filter/search views, with the `belongsToProject` tooltip). The parent's own
  rows stay unlabeled.
- **Write-to-parent.** Quick-add / new-task creation while the toggle is on still
  targets the parent project being viewed — never a sub-project. Read-many,
  write-to-parent.
- **Exclude archived** descendant projects (matches how archived projects are
  hidden elsewhere).

## Implementation seam

- Backend: add `IncludeChildProjects bool` query param to the shared
  `TaskCollection` struct (`pkg/models/task_collection.go:32`). In
  `getRelevantProjectsFromCollection` (`:186`), when the flag is set and
  `ProjectID > 0` (after the existing `CanRead` check), expand the single-element
  slice to **parent + accessible, non-archived descendants**. Intersect the
  recursive-descendant set (CTE already in `project.go`) with the user's
  accessible projects so permissions are preserved for free. Everything
  downstream (`getTasksForProjects`, counts, pagination) already accepts a
  multi-project slice — no other backend change.
- New **field on the shared model**, not a new route → does not trip the
  "new routes → v2" policy; the param flows through the endpoint the frontend
  already calls. Re-confirm against the `api-v2-routes` skill before writing.
- Frontend: thread `include_child_projects` through `useTaskList.ts` →
  `TaskCollectionService`; toggle state in `localStorage`; pass `showProject`
  to rows where `task.projectId !== currentProjectId`.

## Invariants / gotchas

- Saved-filter pseudo-projects (`ProjectID < 0`) and `ProjectID == 0` ignore the
  flag (their branch already returns all accessible projects).
- Permission boundary is load-bearing: a descendant the user cannot read must
  never contribute tasks — assert this with a negative test, not just a positive.
- `totalItems`/pagination must reflect the aggregated set, not the parent alone.
- Deleting/moving a sub-project mid-session leaves the toggle harmless (fewer
  descendants next load); no stale-id error path.

## Out of scope

Kanban/Gantt/Table views (backend param makes them free to add later, but not
wired now); per-task write target / sub-project picker in quick-add; grouping
tasks by origin project; server-side persistence of the toggle (localStorage only).

## Test approach

- Backend feature test (`mage test:feature`): parent with nested descendants
  returns the union when the flag is on; **excludes** a descendant the user
  cannot read; **excludes** archived descendants; flag off → parent-only.
- Frontend unit (Vitest): localStorage persistence keyed by project; "chip only
  on foreign rows" rule. Live-verify in browser (List view is the real surface).
- Typecheck: no net-new errors over baseline 1.
