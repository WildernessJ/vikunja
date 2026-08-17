# fix-88-task-position-cross-view — TaskPosition must not accept an arbitrary project_view_id

Issue: #88. Found during the #86 security review; probe-verified.

## Intent

`TaskPosition.CanUpdate` (`pkg/models/task_position.go:61-64`) checks only write access on
the task. `tp.ProjectViewID` comes solely from the body (`POST /tasks/:task/position` has no
`:view` segment; the field has no `param` tag, so #86's URL re-force does not apply) and is
never validated — not for existence, not against the task's project. Any authenticated user
with write on any one task can write a position row into any view instance-wide. With
`position < MinPositionSpacing` and at least *read* access on the victim project,
`RecalculateTaskPositions` runs over the foreign view and destroys its stored ordering
(`RecalculateTaskPositions` reaches a `CanRead` check on the victim project; a zero-access
attacker's recalc attempt errors and the transaction rolls back, upsert included). v2 (`pkg/routes/api/v2/task_position.go`) is affected
identically because the hole is in the model.

After the fix: the view must exist and belong to the task's project, or be a saved-filter
view whose filter the requesting user owns. Everything else is rejected with
`ErrProjectViewDoesNotExist` (404 — same no-oracle shape as #84's `canDoBucket` guard).

## Design

All in `TaskPosition.CanUpdate`. Both APIs route through it; the internal
`moveTaskToDoneBuckets` path passes trusted view IDs and is untouched.

```go
func (tp *TaskPosition) CanUpdate(s *xorm.Session, a web.Auth) (bool, error) {
	t, err := GetTaskByIDSimple(s, tp.TaskID)          // 404 if task missing (unchanged behavior)
	if err != nil { return false, err }

	view, err := GetProjectViewByID(s, tp.ProjectViewID) // 404 if view missing
	if err != nil { return false, err }

	if view.ProjectID != t.ProjectID {
		filterID := GetSavedFilterIDFromProjectID(view.ProjectID)
		if filterID == 0 {
			// Foreign project's view: 404, not 403 — existence must not leak.
			return false, &ErrProjectViewDoesNotExist{ProjectViewID: tp.ProjectViewID}
		}
		sf := &SavedFilter{ID: filterID}
		if can, err := sf.canDoFilter(s, a); err != nil || !can {
			return can, err                              // owner-only; link shares error out inside
		}
	}

	p := &Project{ID: t.ProjectID}
	return p.CanWrite(s, a)
}
```

Notes settled at plan time:

- **Write check via `Project.CanWrite` on the loaded task's project**, not
  `(&Task{ID: …}).CanUpdate` — that would re-load the task we already have
  (`canDoTask` calls `GetTaskByIDSimple` again). `TaskPosition` has no `ProjectID`
  field, so `canDoTask`'s project-move branch can never apply; the semantics are
  identical.
- **Saved-filter branch requires filter ownership only**, not task-in-filter
  membership. The owner corrupting position rows in their own filter's view is
  harmless; a membership check would re-run the filter query per drag. Accepted gap —
  record in the issue close, not guarded.
- **Favorites pseudo views (IDs -1…-3) are not in the DB**, so `GetProjectViewByID`
  404s them. That is correct, not a regression: the frontend disables dragging for
  favorites (`ProjectList.vue` `canWrite` requires `id > 0`), and today such a write
  would store a mis-scoped row keyed to a pseudo view ID.
- **Error shape:** mismatch → `ErrProjectViewDoesNotExist` (404), matching
  `canDoBucket` (#84/ADR precedent). Non-owner saved filter → whatever `canDoFilter`
  returns today (false / `ErrSavedFilterNotAvailableForLinkShare` for link shares).
- No new ADR: no alternative was seriously competitive; precedent is #84 + ADR-0013.

## Implementation plan

- `pkg/models/task_position.go` — replace `CanUpdate` body as above. Invoke the
  `crudable` skill before editing (Can* method change).
- No migration, no route change, no frontend change. Existing mis-scoped rows are
  garbage data in `task_positions` but harmless (positions are read per-view for
  tasks in that view's project; foreign rows never join). Do not write a cleanup
  migration in this change.
- Fixtures: `pkg/db/fixtures/project_views.yml` has no saved-filter views (no negative
  `project_id`). For the saved-filter tests, follow whatever seam
  `saved_filter_positions_test.go` already uses (it creates/loads filter views); add a
  fixture only if that file's pattern already relies on one.

## Execution routing

Driver implements directly — single-function change plus tests; no dispatch. No
security agent: the change is itself the security fix from a reviewed finding, and the
review phase's verifier covers it.

## Tests (red-first — all must fail before the fix)

Model tests in `pkg/models/task_position_test.go` (`TestTaskPositionCanUpdate`),
web tests only if a route-level assertion adds signal beyond the model test:

1. **Cross-project view denied:** user 1 (write on task 1, project 1), body
   `project_view_id: 21` (project 6, user 1 read-only) → `CanUpdate` false,
   `ErrProjectViewDoesNotExist`. This is the probe from the issue.
2. **Recalc wipe blocked:** same setup with `position: 0.001` via the web/v1 handler
   path → 404 and the victim view's position rows unchanged. (If the model test
   already proves denial, implement this as the one webtest; it guards the
   permission→handler wiring.)
3. **Nonexistent view denied:** `project_view_id: 9999` → false, `ErrProjectViewDoesNotExist`.
4. **Same-project view still allowed:** user 1, task 1, a project-1 view → true (regression guard).
5. **Saved-filter view, owner:** a filter view created in-test via `sf.Create(s, u)`
   (auto-creates the filter's views — the seam `saved_filter_positions_test.go` uses;
   no fixture exists or is needed), owner user 1 → true.
6. **Saved-filter view, non-owner:** same view, user 2 → denied.

## Verification

From the worktree root:

- `mage test:filter TestTaskPositionCanUpdate` — red before, green after.
- `mage test:web` green; `mage test:feature` 0 FAILs; `mage lint` 0 issues.
- Done looks like: all six tests green, suite green, no diff outside
  `pkg/models/task_position.go`, its test file, (possibly) one webtest + fixtures.

## Stop criteria

- Any need to touch `updateTaskPosition`, the recalculation paths, or route files →
  stop, back to plan (the fix is permission-layer only by design).
- The saved-filter test seam requires new helper plumbing beyond what
  `saved_filter_positions_test.go` already demonstrates → stop and report.
- Suite regression that is not one of the red-first tests → stop after the bounded
  2-attempt fix rule.

## Execution Log

(build phase appends here)
