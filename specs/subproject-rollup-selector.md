# Spec: Sub-project roll-up — per-project selector + CTE descendant resolution

Extends `subproject-task-rollup.md` (the original all-or-nothing feature). Combines **#66**
(checkbox → selector) and **#60** (O(all-projects) BFS → permission-scoped recursive CTE).

## Problem

1. The List-view sub-project roll-up is **all-or-nothing**: `include_child_projects` is a
   boolean, so the user gets every descendant's tasks or none. They want to include/exclude
   specific descendants.
2. Descendant resolution (`getDescendantProjectsForUser`, `pkg/models/task_collection.go:230`)
   loads the user's **entire** accessible project set (`getRawProjectsForUser`, page:-1) and
   BFS-walks it in Go — O(all accessible projects) per List load with the toggle on.

## Intended behavior

**API (shared `TaskCollection` model → both v1 and v2, same as the existing flag).**
- Add `excluded_project_ids []int64` (`query:"excluded_project_ids"`). Only meaningful when
  `include_child_projects=true`. Default empty ⇒ identical to today's behavior
  (backwards-compatible; existing bool-only callers unchanged).
- Semantics: **per-project** exclusion. Each listed ID is dropped from the resolved
  descendant set; its still-included children remain (a child of an excluded parent still
  shows unless itself excluded). Documented on the field. The parent project itself is never
  excludable.
- Excluded IDs the user can't access or that aren't descendants are ignored (not an error) —
  the roll-up is a view convenience, not an authorization surface.
- Follows the #55 precedent: field on the shared model, not a new route. `/api/v1` policy
  note — this rides the existing shared-model shape the frontend already consumes via v1; no
  new v1 route is added.

**Backend perf (#60).** Replace the load-all-then-BFS with a permission-scoped recursive CTE
seeded at `parentProjectID`, walking `parent_project_id` downward, intersected with the
user's accessible set — reuse the existing pattern in `accessibleProjectIDsSubquery` /
`getUserProjectsStatement` (`pkg/models/project.go:644`). Must preserve today's guarantees:
archived descendants excluded, no project the user can't read ever surfaced, cycle-safe.
Then subtract `excluded_project_ids`.

**Frontend.** Replace the checkbox in `ProjectList.vue` with a multi-select picker of the
current project's descendants (all checked by default). Unchecking a project adds it to the
exclusion set sent as `excluded_project_ids`. Persist the exclusion set in
**namespaced localStorage** — `subprojectRollup:<userId>:<projectId>` — replacing the
non-namespaced `showSubprojectTasks:<id>` key (fixes the #55 shared-browser caveat). Migrate
the old boolean key on read (present-and-true ⇒ enabled, empty exclusions).

## Out of scope

- Server-side / cross-device persistence of the selection (localStorage only; cf. #64).
- Bucketed views — the flag stays List-only in the UI; no behavior change for Kanban.
- Migrating the frontend task-list off v1 to v2 (separate, larger effort per #55).
- Subtree-exclusion semantics (excluding a parent auto-excludes its whole subtree) — deferred;
  per-project exclusion only for now.

## Test approach

- **Backend (webtest + model):** CTE returns the same descendant set the BFS did for existing
  fixtures (characterization — no regression); a 2+-level tree; exclusions drop the right
  projects and only those; an excluded child of an included parent; a non-descendant / no-access
  ID in the exclusion list is ignored; **permission negative — a sibling/unrelated project the
  user can't read is never surfaced by the CTE** (the security-critical case).
- **Frontend (unit):** namespaced-key read/write; legacy `showSubprojectTasks:<id>` migration;
  exclusion set ↔ picker state; `excluded_project_ids` correctly threaded into the request.
- **Live (--auto, browser):** on a project with sub-projects, open the selector, uncheck one,
  confirm its tasks drop from the list and the choice persists across reload.

## Security note

The recursive-CTE rewrite is permission-sensitive (this area carries CVE-2026-55064 history,
`project.go:1194`). A naive CTE on `parent_project_id` alone would leak tasks from
inaccessible descendants. → **`security` agent review required** on the diff, in addition to
`/code-review`.
