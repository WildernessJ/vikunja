# Spec: repeating-task residuals (#87, #93)

## Intent

Two pre-existing defects on repeating tasks, both in `pkg/models/`, both small call-site fixes:

- **#87** — marking a repeating task done routes it to `view.DefaultBucketID` at two sites
  that read the stored id raw. With a stale nonzero default (reachable via the kanban→list
  kind switch that #85 documented), `updateTaskBucket` gets a dead bucket id and returns
  `ErrBucketDoesNotExist`: the task cannot be completed on that view at all. The #85 fix
  validated the id inside `getDefaultBucketID`; these two sites never call it.
- **#93** — `TaskDuplicate.Create` copies `RepeatMode` but not `RepeatRRule` or
  `RepeatFromCompletion`. A `repeat_mode=3` copy lands with an empty rule and `createTask`
  rejects it with `ErrInvalidTaskRepeatRRule`. Duplicating any RRULE task fails.

Below the v3 floor individually; run as one cycle because both are repeating-task residue
and Jason picked `/flow`.

## Design (settled)

**#87 — resolve through `existingBucketID`, keep the stay-put fallback.** Both sites keep
their current semantics ("no usable default → the task stays where it is"); only the
staleness check is added. `existingBucketID(s, view.ID, view.DefaultBucketID)`
(`project_view.go:809`) returns the id when the bucket exists *on this view*, else 0. It is
the same helper `getDefaultBucketID` uses first (`kanban.go:89`).

Not `getDefaultBucketID`: that falls back to the leftmost bucket, which would change
behaviour for views with no default (today: stay put), and the issue asks to keep the
stay-put semantics. `existingBucketID` also covers the cross-view case (default pointing
at another view's bucket), the third #85 test.

Site A — `kanban_task_bucket.go:245-249` (`updateTaskBucket`, done-bucket branch).
`updateTaskBucket` has cyclomatic complexity exactly 30 today, the `gocyclo` threshold
(`.golangci.yml` has no override; the package's `//nolint:gocyclo` functions measure 33-100,
except a stale one on `ProjectDuplicate.Create`). An inline fix needs one extra `if` for the error and trips lint. So the
`if/else` is replaced by one call to a small helper, which nets the count back to 30:

```go
// in kanban_task_bucket.go, next to repeatingTaskPassesThroughDoneBucket
func rerouteDoneRepeatingTask(s *xorm.Session, view *ProjectView, fallback int64) (int64, error) {
    target, err := existingBucketID(s, view.ID, view.DefaultBucketID)
    if err != nil || target != 0 {
        return target, err
    }
    return fallback, nil
}

// site A, replacing the if/else at 245-249
b.BucketID, err = rerouteDoneRepeatingTask(s, view, oldTaskBucket.BucketID)
if err != nil {
    return err
}
```

`//nolint:gocyclo` rejected: it would leave the function at the ceiling for the next
edit. The helper is the one new function this spec allows (the stop criterion names it).

Site B — `tasks.go:1864` (`moveTaskToDefaultBuckets`):

```go
target, err := existingBucketID(s, view.ID, view.DefaultBucketID)
if err != nil {
    return err
}
if target != 0 {
    tb := &TaskBucket{BucketID: target, ...}
    updateTaskBucket(...)
}
```

Site A's reroute ends in `b.upsert` (`kanban_task_bucket.go:76-91`), a raw insert with no
view-scope check, and the consistency guard at 202-207 ran against the pre-reroute bucket.
`existingBucketID`'s view check is therefore what keeps the rerouted row on this view, not
only a staleness check. The change only tightens.

**Reviewed and left alone:** `repeatingTaskPassesThroughDoneBucket`
(`kanban_task_bucket.go:168-174`) also reads `DefaultBucketID` raw. With a stale default it
returns true (default ≠ 0, ≠ done), so the done bucket's limit is skipped; the reroute then
lands the task back in its old bucket (`updateBucket = false`, then
`resolveDestinationBucket(..., isMove=false)` runs no limit check), so it never occupies a
done slot. That is the correct answer for that predicate, no change. These three are the
only raw `DefaultBucketID` reads that route without validating; `Bucket.Delete`
(`kanban.go:401, 424`) reads it raw too but its relocation query checks existence and view
inline, and every other consumer goes through `getDefaultBucketID`.

**Out of scope, filed separately:** the same defect class exists for `DoneBucketID`, with
the same kind-switch reachability — `moveTaskToDoneBuckets` (`tasks.go:1819-1821`) hands a
stale done id to `updateTaskBucket` (non-repeating tasks cannot be completed on that view),
and `syncTaskIntoOtherDoneBuckets` (`kanban_task_bucket.go:148-155`) upserts a
`task_buckets` row at a dead bucket id with no existence check. #87 names only
`DefaultBucketID`; the sibling is tracked as #106.

**Known, pre-existing, unchanged:** `updateTaskBucket` discards the `has` bool of its
`Get(oldTaskBucket)` (`kanban_task_bucket.go:179-184`). A task with no `task_buckets` row
on the view has `oldTaskBucket.BucketID == 0`, so the stay-put fallback yields bucket 0 and
`getBucketByID(0)` fails. Today that case fails with `ErrBucketDoesNotExist{9999}`; after,
`{0}`. Both are dead ends; every create path seeds the row and the kind switch backfills
it, so it needs a hand-deleted row. Not widened in any reachable way, not fixed here.

**#93 — copy the two fields.** Add `RepeatRRule` and `RepeatFromCompletion` to the
`newTask` literal in `task_duplicate.go:76-92`. `createTask` then validates a real rule.
The original's `DueDate` is copied too, so when the original has one the RRULE anchoring
in `createTask` (`tasks.go:1090-1094`, fires only on a zero due date,
`task_repeat_rrule.go:32-45`) leaves it alone. An RRULE original with **no** due date gets
its copy anchored to the next occurrence — the same thing creating that task fresh does,
accepted. Test 3 sets a due date on the original and pins that the copy keeps it. The Task
model has exactly four repeat columns (`tasks.go:115-121`); the literal already copies the
other two. `duplicateTasks` in `project_duplicate.go:379-409` reuses the loaded struct
wholesale, so project duplication is not affected.

No ADR: bug fixes, no design alternative worth recording.

## Implementation plan

Three commits, one per site group, each with its test in the same commit:

1. `fix(kanban): route a done repeating task through existingBucketID (#87)` —
   `pkg/models/kanban_task_bucket.go` site A + `rerouteDoneRepeatingTask` + test in
   `kanban_task_bucket_test.go`.
2. `fix(tasks): moveTaskToDefaultBuckets skips a stale default bucket (#87)` —
   `pkg/models/tasks.go` site B + test in `tasks_test.go`.
3. `fix(tasks): duplicate copies repeat_rrule and repeat_from_completion (#93)` —
   `pkg/models/task_duplicate.go` + test in `task_duplicate_test.go`.

Then a fourth commit, `spec(repeating-task-residuals): log the build session`, for the
Execution Log — `specs/` is tracked, so the log cannot ride uncommitted.

No new files, no helper beyond `rerouteDoneRepeatingTask`, no frontend, no migration, no
i18n. Files outside `pkg/models/` and `specs/` must not change.

## Execution routing

Driver-run in the build session (Opus). No subagent dispatch: three call-site edits and
three fixture-driven tests. `security` not warranted: no auth surface changes, and the one
scope-relevant write (site A's upsert) only gets stricter.
Invoke `crudable` only if the build finds it needs a `Can*` change (it should not).

## Tests (red-first)

Fixtures used: task 28 (repeating, `repeat_after: 3600`, project 1, sits in bucket 1 on
view 4); view 4 (kanban, project 1, `default_bucket_id: 1`, `done_bucket_id: 3`; buckets
1, 2, 3); task 1 (project 1, non-repeating). The stale default is planted the way
`kanban_test.go:237-266` does: `s.Where("id = ?", 4).Cols("default_bucket_id").Update(&ProjectView{DefaultBucketID: 9999})`.

1. **`TestTaskBucket_Update` subtest "repeating task done with a stale default bucket stays in its bucket"** (`kanban_task_bucket_test.go`). Plant default 9999 on view 4; pre-position task 28 in bucket 2 with a raw `task_buckets` update (as `tasks_test.go:504-513` does, bypasses limits); `TaskBucket{TaskID: 28, BucketID: 3, ProjectViewID: 4, ProjectID: 1}.Update(s, u)`; commit. **Red today:** `ErrBucketDoesNotExist{BucketID: 9999}`. **Green:** no error; `tb.Task.Done == false`; `tb.Task.DueDate` after the fixture's `2018-12-02 22:25:24` (the recurrence advanced); `tb.BucketID == 2`; `task_buckets` row for (28, view 4) has `bucket_id: 2`; no row at bucket 3 or 9999.
2. **`TestTask_Update` subtest "repeating tasks marked done with a stale default bucket stay in their bucket"** (`tasks_test.go`, next to the existing default-bucket subtests at ~504-560). Plant default 9999 on view 4; pre-position task 28 in bucket 2; `Task{ID: 28, Done: true, RepeatAfter: 3600}.Update(s, u)`; commit. **Red today:** `ErrBucketDoesNotExist`. **Green:** no error; `task.Done == false`; `task.DueDate` after the fixture's `2018-12-02 22:25:24`; `task_buckets` (28, view 4) at bucket 2; missing at 1, 3, 9999.
3. **`TestTaskDuplicate` subtest "copies rrule recurrence"** (`task_duplicate_test.go`). Start with `files.InitTestFileFixtures(t)` like the sibling subtests at lines 33 and 76 — task 1 has attachment fixtures and `Create` copies their bytes; the storage is process-wide, so the subtest passes in a full-package run without it but fails inside the attachment loop when run alone (`-run TestTaskDuplicate/copies_rrule_recurrence`, which is how the red-first evidence is taken) and looks like a failed fix. Task 1 has no `due_date` in the fixtures, so set one: raw update `Cols("repeat_mode", "repeat_rrule", "repeat_from_completion", "due_date")` to mode `TaskRepeatModeRRule`, rule `FREQ=WEEKLY;BYDAY=MO`, from-completion `true`, due `2026-07-06 09:00 UTC` (a Monday, as `task_repeat_rrule_test.go:374` uses); `TaskDuplicate{TaskID: 1}.Create(s, u)`; commit. **Red today:** `ErrInvalidTaskRepeatRRule` (`createTask` unwraps the bulk error, `tasks.go:1011-1015`). **Green:** no error; `db.AssertExists("tasks", {id: td.Task.ID, repeat_mode: 3, repeat_rrule: "FREQ=WEEKLY;BYDAY=MO", repeat_from_completion: true})`; `assert.True(t, due.Equal(td.Task.DueDate))` — anchoring did not fire. Not `assert.Equal`: `td.Task` is re-read from the DB (`task_duplicate.go:173-174`) and comes back in the engine's `GMT` location, so `reflect.DeepEqual` against a `time.UTC` literal is false for the same instant (the sibling at `task_duplicate_test.go:95` uses `.Equal` for this reason).

Run each test once before its fix and record the red in the Execution Log (test name +
error string). Existing tests that pin the fixed sites and must stay green:
`TestTaskBucket_Update_RRuleRepeatingTask` (`task_repeat_rrule_test.go:367`), the
`TestTask_Update` "repeating tasks marked done …" subtests (`tasks_test.go:504-560`), and
`TestTaskDuplicate`.

## Verification

From the worktree root, output to a file, read the file:

```bash
mage test:filter 'TestTaskBucket_Update|TestTask_Update|TestTaskDuplicate|TestGetDefaultBucketID|TestBucket_Delete' 2>&1 | tee /tmp/flow-filter.log
TZ=UTC mage test:feature 2>&1 | tee /tmp/flow-suite.log   # 0 FAIL (two upstream tests need TZ=UTC)
mage lint 2>&1 | tee /tmp/flow-lint.log                    # 0 issues; needs the locally built golangci-lint v2.13.0
git status --porcelain --untracked-files=all               # empty
```

`cd frontend && pnpm typecheck` (the other half of the fork's suite) is skipped: the diff
is `pkg/models/` only. If any frontend file changes, the stop criterion below fires anyway.
Gotchas cited here (TZ, classifier, golangci-lint) are recorded in the main checkout's
gitignored `docs/context/PITFALLS.md`, which a worktree does not have.

Done looks like: the three new subtests green, the listed existing tests green, suite
0 FAIL, lint 0 issues, four commits on `fix/repeating-task-residuals` (three fixes + the
Execution Log). At review, after the merge: the `FORK-CHANGES.md` entry for #87 + #93 on
`main`, as every fix cycle since 2026-08 has done.

Live verify (review phase, `live_verify_mode: browser`): dev servers up; on a kanban view,
plant a stale default with a direct DB update, mark a repeating task done from the board
and from the detail pane, confirm it lands back in its column and the next occurrence is
set; duplicate a task with a weekly RRULE **and a due date** from the task detail menu and
confirm the copy shows the same recurrence and the same due date; duplicate one with no
due date and confirm the copy shows the next occurrence as its due date (the accepted
anchoring case). The classifier will say `live` (any `pkg/` Go file). Red at
live verify → `flow-blocked` issue with evidence, no merge (the protocol's rule).

## Stop criteria

Halt, log, and report if any of these hit:

- A new subtest is **green before its fix** (the red is the repro; a green red means the
  test does not exercise the site).
- Fixing a site requires touching a file outside `pkg/models/` (the Execution Log commit
  under `specs/` excepted), or adding a helper other than `rerouteDoneRepeatingTask`.
- `mage lint` reports `gocyclo` on `updateTaskBucket` after the helper is in place (the
  count did not net to 30; do not add `//nolint`).
- `existingBucketID` cannot be called from `updateTaskBucket` without an import cycle or
  signature change (it is in the same package; this should be impossible).
- An existing test in the Tests list goes red and the cause is not a wrong expectation of
  the new stay-put behaviour.
- Test 3 stays red after the two fields are copied with `ErrInvalidTaskRepeatRRule` (the
  rule reaching `createTask` is not the one planted; find out why before touching
  validation). A failure inside the attachment copy is the missing
  `InitTestFileFixtures` call, not a stop.

## Execution Log

_(empty — the build phase appends)_
