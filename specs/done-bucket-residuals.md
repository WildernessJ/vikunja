# Spec: done-bucket residuals (#106, #107)

## Intent

Two pre-existing defects in done-bucket routing, both in `pkg/models/`, both residue of the
#87/#93 cycle (`specs/repeating-task-residuals.md`):

- **#106** — four sites route a task by `view.DoneBucketID` read raw. #85 validated
  `DefaultBucketID` inside `getDefaultBucketID`; #87 validated the two sites that bypass it.
  No site validates `DoneBucketID`. With a stale nonzero done id, two sites fail loudly
  (`updateTaskBucket` → `getBucketByID` → `ErrBucketDoesNotExist`: a non-repeating task cannot
  be completed on that view, a done task cannot be moved into that project) and two write a
  `task_buckets` row at a dead bucket id with no existence check (silent corruption).
- **#107** — `updateSingleTask` gates `moveTaskToDoneBuckets` on `!t.isRepeating()` and
  `moveTaskToDefaultBuckets` on `!ot.Done && t.Done`. For a repeating task that is done and
  sits in a done bucket, reopening it fires neither: the task stays in the done bucket.
  Reachable today: mark a task done (it moves to the done bucket), add `repeat_after`, reopen.

**Reachability of #106, stated honestly:** the #87 audit established that on current code a
dangling bucket id is not producible by the kind switch, `Bucket.Delete`, or the importer.
A stale `done_bucket_id` is a legacy row from before #85 or a raw DB write. #106 is
hardening against that state, in the same shape as #87. #107 is live.

Both below the v3 floor individually; run as one cycle because both are done-bucket residue
and Jason picked `/flow`.

**Scope beyond the issue text, deliberate:** #106 names two sites. Sites 3 and 4 below are the
other two raw `DoneBucketID` routing reads in `pkg/models/` (grep-complete, verified by the
spec review); the fix is the same one line at each, so the class is closed in one cycle.

**Out of scope:** the three `DoneBucketID` *comparisons* in `updateTaskBucket`
(`kanban_task_bucket.go:240-267`) and `repeatingTaskPassesThroughDoneBucket` (`:170-173`).
They compare a requested or stored bucket id against the done id; with a stale done id no
live bucket can match it, so they are inert. The one case where the `:267` comparison fires —
a row already sitting at the dead id, which site 2 below used to create — is the stranded-row
case that site 1 must keep healing (see Design). The `DefaultBucketID` sibling in
`setTasksInBucketInViews` goes through `getDefaultBucketID` already.

## Design (settled)

**#106 — resolve through `existingBucketID`, stale means "no done bucket".**
`existingBucketID(s, view.ID, view.DoneBucketID)` (`project_view.go:809`) returns the id when
the bucket exists on this view, else 0. Every site already has a `DoneBucketID == 0` branch
that means "this view has no done bucket"; the fix feeds the validated id into that branch.
No new fallback policy is introduced. `getDefaultBucketID`'s leftmost fallback is not a fit:
a done bucket has no "any bucket will do" substitute.

Site 1 — `tasks.go:1797-1830` `moveTaskToDoneBuckets`. Resolve once at the top of the view
loop into `doneBucketID`; replace the **`t.Done` reads only** (`:1809`, `:1819`, `:1820`) with
it. The two `!t.Done` comparisons (`:1814`, `:1824`) keep the raw `view.DoneBucketID`: they
ask "does this task's row sit where the view says done is", and a row stranded at a dead done
id (the corruption site 2 used to write) must still answer yes, so a reopen moves it to the
default bucket and heals it. Resolving there would `continue` past the stranded row and leave
the task invisible on that view for good, with no UI exit (the spec review ran this: on the
clean tree a reopen heals the row to bucket 1; with all five reads resolved it stays at 9999).
`healBucketIDs` repairs the view's ids, never task rows. Control flow is otherwise unchanged.

Site 2 — `kanban_task_bucket.go:135-158` `syncTaskIntoOtherDoneBuckets`. The query keeps its
`done_bucket_id != 0` filter; inside the loop, resolve, `continue` on 0, upsert the resolved id.

Site 3 — `tasks.go:1221-1305` `setTasksInBucketInViews` (task create, incl. bulk import).
Resolve **once per view before the task loop** into a `map[int64]int64` keyed by view id; a
plain loop over `views`, no closure. Unlike the lazy `defaultBucketIDs` cache it resolves every
view eagerly, but `existingBucketID` returns without a query when the id is 0, so the cost is
at most one indexed SELECT per manual kanban view per `createTasks` batch. Inside the kanban branch, `doneBucketID :=
doneBucketIDs[view.ID]` replaces the three `view.DoneBucketID` reads. Gocyclo: 23 → 25
(limit 30, measured with golangci-lint v2.13.0 at the spec commit).

Site 4 — `tasks.go:1507-1526` `updateSingleTask`, project-move branch. Resolve into the
existing `bucketID` variable in place of the raw read; the `bucketID == 0 || !t.Done`
default fallback already follows. `updateSingleTask` carries `//nolint:gocyclo`.

`err` handling at sites 3 and 4: both functions have an `err` in scope (`var err error` /
named return); assign with `=`, not `:=`, so no shadow.

**#107 — one gate, two movers.** Replace the two `if` blocks at `tasks.go:1550-1565` with:

```go
if t.ProjectID == ot.ProjectID && t.Done != ot.Done {
    if t.isRepeating() && t.Done {
        err = t.moveTaskToDefaultBuckets(s, a, views)
    } else {
        err = t.moveTaskToDoneBuckets(s, a, views)
    }
    if err != nil {
        return
    }
}
```

The repeating-done branch is the old second block verbatim (`t.Done != ot.Done && t.Done`
is `!ot.Done && t.Done`). The else branch now also covers `isRepeating && ot.Done && !t.Done`,
which `moveTaskToDoneBuckets` already handles for non-repeating tasks: currently in the done
bucket → `getDefaultBucketID`; not in it → no-op. A repeating reopen therefore behaves
exactly like a non-repeating reopen. The #2573 comment moves with the branch.

**Accepted consequence:** a reopen into a default bucket that is at its limit fails the whole
update with `ErrBucketLimitExceeded` (`updateTaskBucket`'s check at
`kanban_task_bucket.go:227-233`; `repeatingTaskPassesThroughDoneBucket` does not relax it on
this path). Today the repeating task reopens and stays in the done column instead. This is
the existing behaviour for every non-repeating reopen; the fix makes repeating tasks match it
rather than inventing a third policy. Not tested here; recorded so the reviewer does not
re-derive it.

No ADR: bug fixes, no design alternative worth recording.

## Implementation plan

Three fix commits, each with its tests:

1. `fix(tasks): resolve done buckets through existingBucketID before routing (#106)` —
   `pkg/models/tasks.go` sites 1, 3, 4 + tests 1, 3, 4, 6 in `tasks_test.go`.
2. `fix(kanban): syncTaskIntoOtherDoneBuckets skips a stale done bucket (#106)` —
   `pkg/models/kanban_task_bucket.go` site 2 + test 2 in `kanban_task_bucket_test.go`.
3. `fix(tasks): reopening a repeating task moves it out of the done bucket (#107)` —
   `pkg/models/tasks.go` gate + test 5 in `tasks_test.go`.

Then `spec(done-bucket-residuals): log the build session` for the Execution Log.

No new files, no new helpers, no frontend, no migration, no i18n. Files outside
`pkg/models/` and `specs/` must not change.

## Execution routing

Driver-run in the build session (Opus). No subagent dispatch: five call-site edits and six
fixture-driven tests. `security` not warranted: no auth surface; the only writes that change
get stricter. `crudable` not needed (no `Can*` change).

## Tests (red-first)

Fixtures: view 4 (project 1, manual kanban, `default_bucket_id: 1`, `done_bucket_id: 3`;
buckets 1, 2, 3). Task 1: open, non-repeating, in bucket 1 on view 4. Task 2: `done: true`,
non-repeating, in bucket 3 on view 4. View 8 (project 2, manual kanban, `default_bucket_id:
40`, `done_bucket_id: 4`). Plant a stale done id the way the #87 tests plant a default:
`s.Where("id = ?", 4).Cols("done_bucket_id").Update(&ProjectView{DoneBucketID: 9999})`.

1. **`TestTask_Update` "marking a task done with a stale done bucket leaves it in place"**
   (`tasks_test.go`, next to "marking a task as done should move it to the done bucket" at
   `:314`). Plant done 9999 on view 4; `Task{ID: 1, Done: true}.Update(s, u)`; commit.
   **Red today:** `Bucket does not exist [BucketID: 9999]`. **Green:** no error; `tasks` row 1
   `done: true`; `task_buckets` (1, view 4) at bucket 1; missing at 3 and 9999.
2. **`TestTaskBucket_Update` "done sync skips another view's stale done bucket"**
   (`kanban_task_bucket_test.go`, next to "done task already in another view's done bucket"
   at `:333`, which it mirrors). Create a second manual kanban view on project 1 via
   `ProjectView.Create` (auto-creates buckets, backfills existing tasks); plant done 9999 on
   it raw; read task 1's `task_buckets` row on the second view and keep its `bucket_id`;
   `TaskBucket{TaskID: 1, BucketID: 3, ProjectViewID: 4, ProjectID: 1}.Update(s, u)`; commit.
   **Red today:** the `AssertMissing` on (1, secondView, 9999) fails — the upsert wrote the
   row. **Green:** no error; `tb.Task.Done`; (1, view 4) at 3; (1, secondView) still at the
   recorded bucket; no row at 9999.
3. **`TestTask_Create` "done task created with a stale done bucket lands in the default"**
   (`tasks_test.go`, next to "normal" at `:43`). Plant done 9999 on view 4;
   `Task{Title: "done on create", ProjectID: 1, Done: true}.Create(s, usr)`; commit.
   **Red today:** `AssertMissing` on (task.ID, view 4, 9999) fails — `createTasks` inserted the
   row (`tasks.go:1168`, no FK). **Green:** (task.ID, view 4) at bucket 1; none at 9999.
4. **`TestTask_Update` "move done task to another project with a stale done bucket"** (next
   to `:383`, which it mirrors). Plant done 9999 on view 8; `Task{ID: 2, Done: true,
   ProjectID: 2}.Update(s, u)`; commit. **Red today:** `Bucket does not exist [BucketID:
   9999]`. **Green:** `tasks` row 2 `project_id: 2, done: true`; `task_buckets` (2, view 8) at
   bucket 40; none at 4 or 9999.
5. **`TestTask_Update` "reopening a repeating task in the done bucket moves it to the
   default"** (next to the "repeating tasks …" subtests at `:408-640`). Take the issue's own
   route: `Task{ID: 2, Done: true, RepeatAfter: 3600}.Update(s, u)` first (the task stays done
   and in bucket 3 — `updateDone` only reschedules on `!old.Done && new.Done`; assert the row is
   still at 3), then `Task{ID: 2, Done: false, RepeatAfter: 3600}.Update(s, u)`; commit.
   **Red today:** `task_buckets` (2, view 4) still at 3 — the assertion for bucket 1 fails.
   **Green:** `tasks` row 2 `done: false`; (2, view 4) at bucket 1; missing at 3.
6. **`TestTask_Update` "reopening a task stranded at a stale done bucket heals it to the
   default"** (next to test 1). Plant done 9999 on view 4; raw update `task_buckets` (2, view
   4) to `bucket_id: 9999` (task 2 is done); `Task{ID: 2, Done: false}.Update(s, u)`; commit.
   **This test is green today** — it is the characterization guard for the `!t.Done` reads that
   site 1 leaves raw, so the stop criterion "green before its fix" does not apply to it; it must
   stay green after site 1. **Green:** `tasks` row 2 `done: false`; (2, view 4) at bucket 1;
   none at 9999.

Run tests 1-5 once before their fix and record the red in the Execution Log (test name +
error or failed assertion); test 6 is recorded as green before and after. Existing tests that pin the touched sites and must stay green:
`TestTask_Update` "marking a task as done should move it to the done bucket" (`:314`), "move
done task to another project with a done bucket" (`:383`), the "repeating tasks …" subtests
(`:408-640`); `TestTaskBucket_Update` "done task already in another view's done bucket"
(`:333`) and the #87 subtest (`:284`); `TestTaskBucket_Update_RRuleRepeatingTask`
(`task_repeat_rrule_test.go:367`); `TestTask_Create`.

No webtest: every site is reached through `Task.Create`/`Task.Update`/`TaskBucket.Update`,
which the model tests call directly; the router adds nothing these fixes change (#108 noted
the same gap for #87 as advisory, not a defect).

## Verification

From the worktree root, output to a file, read the file:

```bash
mage test:filter 'TestTask_Create|TestTask_Update|TestTaskBucket_Update' 2>&1 | tee /tmp/flow-filter.log
TZ=UTC mage test:feature 2>&1 | tee /tmp/flow-suite.log   # 0 FAIL (two upstream tests need TZ=UTC; see the badge note)
mage lint 2>&1 | tee /tmp/flow-lint.log                    # 0 issues; locally built golangci-lint v2.13.0
git status --porcelain --untracked-files=all               # empty
```

**Known pre-existing red, not this change:** `TestGetUserBadgeCount` (`pkg/models/push_badge_test.go:246`)
fails on the clean tree whenever the wall clock is between about 00:00 and 07:00 UTC (it plants
tasks around UTC's start-of-tomorrow and asserts a Los Angeles count). The spec review hit it
at the spec commit. A build session in that window records it as pre-existing and moves on; it
is not a stop criterion and must not be "fixed" in this cycle.

`cd frontend && pnpm typecheck` skipped: `pkg/models/` only. Gotchas cited here (TZ,
golangci-lint build) are in the main checkout's gitignored `docs/context/PITFALLS.md`.

Done looks like: six new subtests green, the listed existing tests green, suite 0 FAIL,
lint 0 issues, four commits on `fix/done-bucket-residuals`. At review, after the merge: the
`FORK-CHANGES.md` entry for #106 + #107 on `main`.

Live verify (review phase, `live_verify_mode: browser`; classifier will say `live`):
dev servers up (API built from the worktree, `VIKUNJA_DATABASE_PATH` per PITFALLS).
**#107:** on a kanban view, mark a plain task done from the detail pane (it moves to Done),
set `repeat_after` on it, reopen it from the detail pane; it must move back to the default
column. **#106:** plant `done_bucket_id = 9999` on that view with a direct DB write (the
auto-mode classifier refused the sqlite3 write last cycle; Jason runs it via `!`), then mark
a plain task done from the detail pane (no error, stays in its column, shows done) and drag
a task into another kanban view's Done on the same project (no error, no row at 9999).
Restore the view's done id afterwards. Red at live verify → `flow-blocked` issue with
evidence, no merge.

## Stop criteria

Halt, log, and report if any of these hit:

- A new subtest other than test 6 is **green before its fix**.
- A site needs a file outside `pkg/models/` (the Execution Log commit excepted), a new
  helper, or a `//nolint`.
- `mage lint` reports `gocyclo` on `setTasksInBucketInViews` (expected 25 of 30) or on
  `moveTaskToDoneBuckets`.
- An existing test in the Tests list goes red and the cause is not a wrong expectation of
  the new "stale done id = no done bucket" behaviour.
- Test 5 stays red after the gate change, or errors with `ErrBucketLimitExceeded` (bucket 1
  has no limit in the fixtures, so that would mean the wrong bucket was resolved): the reopen
  reached `moveTaskToDoneBuckets` but the task did not move. That means `getDefaultBucketID` or `updateTaskBucket` refuse the move
  for a done repeating task, which is a design question, not a build fix.

## Execution Log

### Build session (2026-09-12, Opus 5, driver-run)

**Red before the fixes** (one `mage test:filter` run on the spec commit plus the new tests):

1. "marking a task done with a stale done bucket leaves it in place": `Bucket does not exist [BucketID: 9999]`.
2. "done sync skips another view's stale done bucket": `Entries map[bucket_id:41 project_view_id:<second view> task_id:1] do not exist in table task_buckets`.
3. "done task created with a stale done bucket lands in the default": `Entries map[bucket_id:1 project_view_id:4 task_id:56] do not exist in table task_buckets`.
4. "move done task to another project with a stale done bucket": `Bucket does not exist [BucketID: 9999]`.
5. "reopening a repeating task in the done bucket moves it to the default": `Entries map[bucket_id:1 project_view_id:4 task_id:2] do not exist in table task_buckets`.
6. "reopening a task stranded at a stale done bucket heals it to the default": green before (isolated run), green after.

The spec predicted that tests 2 and 3 fail on the `AssertMissing` at 9999. They fail one assertion earlier, on the `AssertExists` for the live bucket. The cause is the same: the row was written at 9999 in place of the live bucket.

**After the fixes:** tests 1-4 and 6 were green after commits 1 and 2, and test 5 was still red. All six were green after commit 3. `mage test:filter 'TestTask_Create|TestTask_Update|TestTaskBucket_Update'` passes. `mage lint` reports 0 issues after each fix. The exact gocyclo count of `setTasksInBucketInViews` was not measured; lint shows it is below 30.

**Suite:** `TZ=UTC mage test:feature` has one FAIL: `TestGetUserBadgeCount` (`push_badge_test.go:246`, expected 6, actual 4, "for a user behind UTC …"). The run started at 00:33 UTC, inside the known 00:00-07:00 UTC window. This is the pre-existing red that the Verification section names. It is not this change. All other packages are `ok`, including `pkg/webtests`. The suite was run again at 00:37 UTC on the final code, after the test-5 amend, with the same single failure.

**Deviations and details for the reviewer:**

- Site 2 and site 4 use `var x int64` followed by `x, err = existingBucketID(...)`. Both functions have a named `err` return, and `:=` would shadow it. Site 1 uses `:=` because `err` is already declared in the same loop scope, so there is no shadow.
- Site 1 has one new comment. It says why the `!t.Done` reads stay raw.
- Test 5 commits after the first `Update` and does the reopen in a new session. `db.AssertExists` reads through the engine, not the test transaction. Without the commit, the "still at 3" check saw only the fixture row and proved nothing about the first update. The spec did not state this; the test now does what the spec asked.
- Commit 1 carries tests 1, 3, 4 and 6 only. Test 5 was held out of `tasks_test.go` until commit 3, so no commit carries a red test.
- No stop criterion hit. No file outside `pkg/models/` and `specs/` changed. No new helper and no `//nolint`.

### Review session (2026-09-13, Fable, `--auto`)

Verifier (Opus): SURVIVES, no BLOCKER, no SHOULD-FIX. Cold audit (Opus, `.flow-audit.md`): ship.
Live verify in Chrome on the branch build (`.flow-verify/`): #107 done → repeat → reopen from the
detail pane lands back in To-Do; #106 with `done_bucket_id = 9999` planted by sqlite3: done-on-create
lands in the default, pane done stays in place with no error, a move into a second view's Done leaves
the stale view's row alone, zero `task_buckets` rows at 9999. Site 4 is suite-only.

Fixed in review (tests only): test 5's first `Update` was a no-op (fixture task 2 is already done in
bucket 3, so `t.Done != ot.Done` was false); removed. Added "reopening a repeating task outside the
done bucket leaves it in place", which fails if the gate is simplified to `if t.isRepeating()`
(mutation-checked).

Two corrections to this spec's claims, from the audit:

- **Out of scope, corrected.** There are six raw `DoneBucketID`/`DefaultBucketID` comparisons in
  `updateTaskBucket` and `repeatingTaskPassesThroughDoneBucket`, not three, and "no live bucket can
  match a stale id" is the wrong reason for two of them. `kanban_task_bucket.go:275` compares
  `oldTaskBucket.BucketID`, which is read raw from `task_buckets` and does match a row stranded at
  the dead id — that is the same heal site 1 keeps. `:180-181` are raw *default* reads; a stale
  default makes `repeatingTaskPassesThroughDoneBucket` return true, and it is
  `rerouteDoneRepeatingTask`'s resolve-and-fall-back that keeps the outcome safe, not inertness.
  Anyone refactoring that helper must re-derive this.
- **Residual: TOCTOU at site 2.** `syncTaskIntoOtherDoneBuckets` goes from `existingBucketID` to a
  raw upsert with no re-validation, and `Bucket.Delete` does not take the view lock, so a concurrent
  bucket delete can still strand a row there. Sites 1, 3 and 4 are protected because
  `updateTaskBucket` re-fetches through `getBucketByID`. Pre-existing shape; #106 closes the class
  against already-stale state, not concurrently-becoming-stale state.

Pre-existing, filed separately: creating a repeating task directly into a done bucket keeps it there
(`setTasksInBucketInViews` forces `Done` and calls `moveTaskToDoneBuckets` with no `isRepeating`
check), which contradicts the #2573 rule the `updateSingleTask` gate now enforces.

`TestGetUserBadgeCount` was red again in this session (00:41 UTC) and reproduced on clean `main`.
