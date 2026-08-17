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

**2026-08-17, build phase.** Driver implemented directly, no dispatch, as routed.

Deviations from the spec, in the order a reviewer should look at them:

1. **Permission order reversed — look here first.** The Design block resolves the view
   before checking write; the implementation checks `Project.CanWrite` on the task's
   project **first**, then resolves the view. Two reasons. (a) The spec's order regressed
   an existing test: `TestTaskPositionV2/read_but_no_write_on_the_task_is_forbidden`
   drives task 32 (project 3) with `project_view_id: 1` (project 1) — itself a
   cross-project pair — and expects 403; view-first turns that into 404. (b) View-first
   creates an existence oracle the old code did not have: a caller with *no* access to
   the task still reaches the view check, so 403-vs-404 tells them whether a given view
   belongs to that task's project. Write-first collapses every no-write caller to the
   same 403 and preserves all six specced outcomes. No existing test was edited.
2. **Test 2 is a v1 webtest**, per the spec's own escape hatch — the model test proves
   denial, so the webtest guards the permission→handler wiring instead. New file
   `pkg/webtests/task_position_test.go`, using the existing `webHandlerTest` seam. It
   asserts 404 + `ErrCodeProjectViewDoesNotExist` and that view 21 still holds exactly
   its one fixture row (task 35, position 0), i.e. the recalc never ran.
3. **Test 6 uses user 3 + task 13, not user 2 + task 1.** User 2 has no write on task 1
   either, so the specced setup would pass for the wrong reason. User 3 owns project 2
   and can write task 13, so the only thing denying is that the filter behind the view
   belongs to user 1 — the branch the test exists to prove.
4. **Saved-filter test seam** is `sf.Create(s, u)` as specced (no fixture added); the
   List view of the filter's pseudo project is used rather than the Kanban one.

Environment note, not part of the diff: the worktree had no `frontend/dist`, so
`pkg/webtests` would not compile (`//go:embed all:dist` in `frontend/embed.go`). Copied
the main checkout's built `dist` in. It is gitignored and absent from the diff.

Verification run in the worktree:

- `mage test:filter "TestTaskPositionCanUpdate|TestTaskPositionForeignViewDoesNotRecalculate"`
  red before the fix (4 failing assertions across 3 subtests + the webtest), green after.
  The two positive-regression subtests passed in the red run, as intended.
- `mage test:web` — ok, 27.3s. `mage test:feature` — ok, `pkg/models` 63.8% coverage.
  `mage lint` — 0 issues. `mage fmt` applied (touched only the new webtest file).
- No frontend change, so `pnpm typecheck` was not run.

Accepted gaps unchanged from the spec: filter-membership is not checked (ownership only),
and pre-existing mis-scoped rows in `task_positions` are left in place.

### Amendment 1 — saved-filter denials also return 404

`/code-review high` found the no-oracle property was only half delivered. The spec fixed
the non-owner saved-filter case as "whatever `canDoFilter` returns today", which is
`(false, nil)` → **403**, while a foreign project view returns **404**. Any authenticated
user with write on one task could therefore walk view ids and learn which are
saved-filter views instance-wide — the exact leak the `filterID == 0` branch claims to
close. Deviating from the spec here, because the alternative was to keep the behavior and
water the comment down to a claim about project views only.

Every denial in the saved-filter branch now returns the same `ErrProjectViewDoesNotExist`
as a foreign project view. That includes link shares: `canDoFilter` refuses them on its
first line, before any lookup, so surfacing `ErrSavedFilterNotAvailableForLinkShare`
(412) would itself identify saved-filter view ids. Genuine errors still propagate.

- Test 6 now asserts the 404 rather than a bare `false` — under the pre-amendment code it
  returned `(false, nil)`, so this is a real red-first delta, not a restatement.
- New subtest, "saved filter view is denied for a link share": link share 2 has write on
  project 2 and so can write task 13, which means it reaches the filter branch rather
  than short-circuiting on `CanWrite`. It asserts the same 404. The test would fail with
  `require.Error` if the write check denied first, so it is self-checking on that point.
- Re-verified: `mage test:web` ok (27.2s), `mage test:feature` ok (`pkg/models` 63.9%),
  `mage lint` 0 issues. `TestTaskPositionV2` still green — the amendment does not touch
  the same-project path.

### Amendment 2 — orphaned saved-filter views also return 404 (review phase)

The review-phase verifier refuted Amendment 1's "every denial in the saved-filter branch
returns the same 404" claim by execution: deleting a saved filter (or its owner) removes
the `saved_filters` row but leaves its `project_views` rows behind, and for such an
orphaned view `canDoFilter` returns `ErrSavedFilterDoesNotExist` (code 11001), which
propagated verbatim. Both API versions serialize the error code into the 404 body, so a
caller could still distinguish "never existed" (3014) from "was a saved-filter view".
Information-only — no write was ever granted.

Fix: `IsErrSavedFilterDoesNotExist` joins the link-share error in mapping to the uniform
`ErrProjectViewDoesNotExist`; other errors still propagate. New red-first subtest
"orphaned saved filter view is denied with the same 404" (red run leaked exactly the
11001 error; green after). Re-verified: `mage lint` 0 issues, `mage test:web` ok (29.6s),
`mage test:feature` ok.

The review agent's second note is **not** fixed and needs one line in the issue close: an
owner can write a position row for a task not in their filter, and `addTaskToFilter`
(`pkg/models/saved_filters.go:378`) only inserts when no row exists, so if that task later
genuinely matches the filter the heal skips it and the arbitrary position wins
permanently. Self-inflicted only — the actor must own the filter.
