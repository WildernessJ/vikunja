# repeating-buckets-110-108 — repeating task created into the done bucket, orphan buckets, #108 test gaps (#110, #108)

## Intent

Batch 4: repeating tasks and Kanban buckets. Three parts.

1. **#110.** A repeating task created with `bucket_id` set to a view's done bucket stays done in the
   done column. After this change, the create completes one iteration. This is the same rule as a
   move into the done bucket (`updateTaskBucket`, #2573). The dates advance, the task is not done,
   and the task goes to the view's default bucket.
2. **Orphan buckets.** `ProjectView.Delete` deletes the view's `task_buckets` and `task_positions`
   rows but not its `buckets` rows. After this change, it deletes them too.
3. **#108 residuals.** Close the test gaps that the review of `40f08be07` (#87, #93) found, and
   record the rest as accepted. Then close #108.

None of these can occur on prod while prod has List views only. Prod has no orphan buckets: the
2026-10-01 cleanup deleted the 55 buckets of the 60 deleted views (RUN_LOG 2026-10-01). No data
migration.

## Design

Decisions that Jason made on 2026-10-04 (plan session):

- **#110 policy: complete one iteration.** The alternatives were "ignore the done bucket" (create
  the task not done in the default bucket, dates unchanged) and "reject with 400". Jason chose
  "complete one iteration" because it gives the create path and the move path the same rule.
- **The sibling trigger is out of scope.** A repeating task created with `done: true` and no
  bucket is stored done. With a Kanban view, it lands in the done bucket. Its dates do not
  advance. The rule for that case belongs in `prepareTasksForCreation`, not in the bucket code,
  so that it also covers List-only projects. Duplicate and import need their own decisions. The
  plan session filed it as #119.
- **Webtests in the gate.** `pkg/webtests` `TestMain` skips the whole package under `-short`, so
  `mage test:feature` does not run any webtest. The plan session changed the local
  `.workflow.yaml` `test_command` to `mage test:feature && mage test:web`. This applies to every
  later `/flow build`.
- **#108 accepted residue (no code):**
  - TOCTOU between `existingBucketID` and `b.upsert`, and no FK on `task_buckets.bucket_id`.
    The fork has one user. The window needs a concurrent bucket delete during a task move.
  - Two policies for a stale default bucket: the task stays in its bucket (`rerouteDoneRepeatingTask`,
    `moveTaskToDefaultBuckets`), and the leftmost bucket is used (`getDefaultBucketID`). The issue
    allows both.
  - The dev DB note is already done: view 12 has `default_bucket_id=7` (checked 2026-10-04).
  - The code-review-graph note is a tool observation. No action.

### #110: where the rule goes

The work happens at two sites in `pkg/models/tasks.go`. Both are reached from `createTasks`, so
single create, bulk create (`bulk_task_create.go`) and duplicate (`task_duplicate.go`) all get the
rule. Import (`CreateTasksForImport`) is not affected: `create_from_structure.go:502` sets
`BucketID = 0` before the create and places buckets later through `TaskBucket` updates, which
already follow #2573. `project_duplicate.go` passes `setBucket=false`.

1. **`resolveProvidedBuckets`** (the done bucket is replaced before the limit check). The function
   already loads each requested bucket and its view. For each task where all of these are true:
   `t.isRepeating()`, `!t.Done`, and the requested bucket is `view.DoneBucketID`:
   - Complete one iteration on `t`: `oldTask := *t; t.Done = true; updateDone(&oldTask, t)`.
     This is the same call that `updateTaskBucket` makes (`kanban_task_bucket.go:~254`).
     `updateDone` advances the dates (and shifts reminders, for the modes that do so), sets
     `t.Done` back to `false`, resets the description checklist, and sets `t.DoneAt`.
   - Persist the changed columns on the inserted row: `done`, `due_date`, `start_date`,
     `end_date`, `done_at`, `description`. `createTasks` saves reminders later
     (`t.updateReminders(s, t)`), so no reminder write is needed here.
   - Retarget `t.BucketID` to the destination bucket: `existingBucketID(s, view.ID,
     view.DefaultBucketID)`, or, when that is 0, `getDefaultBucketID(s, view)` (the leftmost
     bucket). The create has no old bucket to fall back to, unlike `rerouteDoneRepeatingTask`, so
     the leftmost bucket takes that role.
   - Batch and limit-check the task under the **destination** bucket, not the done bucket. This
     gives the create the same limit rules as the move: a full done bucket does not block the
     create (#26), and a full destination bucket does (`ErrBucketLimitExceeded`).

   Do the retarget before the existing `batches` grouping, so that the limit loop and
   `taskProvidedBucket` see only destination buckets. The bucket and view lookups and the
   cross-project check (`view.ProjectID != projectID` → `ErrBucketDoesNotExist`) must still run on
   the **requested** bucket first. A foreign done bucket must fail exactly as it does today.
2. **`setTasksInBucketInViews`, done-bucket branch (`tasks.go:~1288`).** Add `!t.isRepeating()` to
   the condition. After step 1, a repeating task reaches this line with `t.BucketID ==
   doneBucketID` only when its destination is the done bucket itself (default bucket equals done
   bucket, or the done bucket is leftmost with no default set). The move path leaves the task not
   done in the done bucket in that case (`TestTaskBucketV2DefaultEqualsDoneBucketLimit`). The
   create path must do the same, and must not set `done = true` again.

The response reports the destination: `t.BucketID` holds the retargeted id, and `t.Done`,
`t.DueDate` etc. hold the advanced values. No `TaskDoneChangedEvent` is sent on create. The
`TaskCreatedEvent` carries the final state. This is a deliberate difference from the move path:
from the client's view, nothing was "completed" on a task that did not exist before.

Known edge, accepted: if the view has no default bucket and the done bucket is leftmost, the task
lands not done in the done bucket. A plain (not repeating, not done) create has the same result
today, because `getDefaultBucketID` returns the leftmost bucket. This is upstream behavior.

### Orphan buckets

`ProjectView.Delete` (`project_view.go:286`) adds
`s.Where("project_view_id = ?", pv.ID).Delete(&Bucket{})` after the existing two deletes. This
is the same call that project delete makes (`project.go:1488`). Keep the comment in
`resolveProvidedBuckets` ("Deleted views leave orphaned buckets behind"). Self-hosted databases
that ran upstream code still have orphans, and the check still protects them.

## Implementation plan

1. `pkg/models/tasks.go`:
   - `resolveProvidedBuckets`: the #110 retarget, as in Design step 1. If the body becomes hard to
     read, put the per-task decision in one helper next to it, for example
     `completeRepeatingTaskInDoneBucket(s *xorm.Session, t *Task, view *ProjectView) error`. Do not
     add a second helper.
   - `setTasksInBucketInViews`: add `&& !t.isRepeating()` to the done-bucket condition. Add a
     one-line comment that names #110 and the default==done case.
2. `pkg/models/project_view.go`: the bucket delete in `ProjectView.Delete`.
3. `pkg/models/task_duplicate_test.go`: replace the dead assertion (Tests, item 4).
4. Tests as listed below. Swagger/yaegi do not change: no annotation and no exported symbol
   changes. If the build adds an exported symbol, run `mage generate:yaegi-symbols` (ADR-0019).

## Execution routing

- **Driver** (the build session) does all of it. The change is small and the design is fixed.
- Order: Tests 1–2 red → Implementation 1 → green. Test 3 red → Implementation 2 → green.
  Tests 4–6 (test-only; they pass on the current code, which is expected for regression pins).
- No executor dispatch, no security agent. The create path keeps its permission and cross-project
  checks unchanged (Design step 1, last paragraph). Test 2 pins the foreign-bucket rejection.

## Tests

Red first means: the test fails on `d94eb5420` for the reason the issue names, and passes after
the fix. Record each red failure message in the Execution Log.

Fixtures: project 1, view 4 (Kanban, manual): default bucket 1, done bucket 3, bucket 2. Task 28
repeats (`repeat_after: 3600`, due `2018-12-02 22:25:24`). Bucket 4 belongs to view 8 (project 2).

1. **#110 model test**, `pkg/models/tasks_test.go`, in `TestTask_Create`: create a task in
   project 1 with `RepeatAfter: 3600`, a due date, and `BucketID: 3`. Assert:
   - `task.Done` is false, and the DB row has `done = false` and the advanced `due_date`.
   - `task_buckets` has `bucket_id = 1` for view 4, and no row with `bucket_id = 3`.
   - `task.BucketID == 1`.
   Red on the old code: the task is done and in bucket 3.
2. **#110 webtest**, `pkg/webtests/huma_task_test.go` (or the existing v2 task-create test file):
   `POST /api/v2/projects/1/tasks` with `{"title":…,"repeat_after":3600,"due_date":…,"bucket_id":3}`.
   Cases:
   - 201/200 as today; the response has `done: false`, `bucket_id: 1`, an advanced due date.
     The DB has the task in bucket 1.
   - Done bucket 3 is full (`setBucketLimit(t, 3, <current count>)`): the create still succeeds.
   - Bucket 1 is full (`setBucketLimit(t, 1, <current count>)`): the create fails with
     `ErrCodeBucketLimitExceeded` and no task row is left.
   - A non-repeating task with `bucket_id: 3`: done, in bucket 3 (unchanged behavior).
   - `bucket_id: 4` (view 8, project 2): rejected exactly as today (pin the current status code
     before the change).
3. **#110 default==done case**, model test: set view 4 `default_bucket_id = 3`, create a
   repeating task with `BucketID: 3`. Assert: not done, dates advanced once (not twice), in
   bucket 3. Red on the old code (done). Add the counterpart after Implementation 1 only if it
   is red without the `!t.isRepeating()` guard. If it is green without the guard, record that in
   the Execution Log and keep the guard anyway (the double-completion path).
4. **#108 dead assertion**, `task_duplicate_test.go` "copies rrule recurrence": the
   `due.Equal(td.Task.DueDate)` assertion cannot fail. Replace it with a subcase in which the
   source task has an rrule and a **zero** due date. Assert that the duplicate gets the anchored
   due date: not zero, after `time.Now()`, and on a Monday in `config.GetTimeZone()`. Keep the
   row assertion. Delete the old `Equal` line.
5. **#108 cross-view default.** In both stale-default tests from `40f08be07`
   (`kanban_task_bucket_test.go` "repeating task done with a stale default bucket stays in its
   bucket", `tasks_test.go` "repeating tasks marked done with a stale default bucket stay in
   their bucket"): make each one a table over `default_bucket_id` ∈ {9999 (missing), 4 (on
   view 8)}. Same assertions for both rows: the task stays in bucket 2 and is never in bucket 4.
6. **#108 webtests for #87 and #93:**
   - #87: in `huma_task_bucket_test.go`, `PUT /api/v2/projects/1/views/4/buckets/3/tasks`
     `{"task_id":28}` with view 4 `default_bucket_id = 9999`, task 28 moved to bucket 2 first.
     Expect 200, response bucket 2, task not done, DB row in bucket 2.
   - #93: in `huma_task_duplicate_test.go`, duplicate a task with `repeat_mode` rrule,
     `repeat_rrule`, `repeat_from_completion: true`. Expect the response and the DB row to carry
     all three.
7. **Orphan buckets**, `pkg/models/project_view_test.go`, in the `Delete` tests: delete view 4.
   Assert `buckets` has no rows with `project_view_id = 4`. Red on the old code (buckets 1–3
   remain). Also assert that view 8's bucket 4 is still there.

## Verification

Run every command from the worktree root `/Volumes/ext-ssd/Github/repeating-buckets-110-108`.
Save the output to a file and read the file.

1. `mage test:feature && mage test:web` (the gate in `.workflow.yaml`).
2. `mage lint`.
3. `mage check:all` (swagger/yaegi drift; expect no diff).
4. Live verify in the browser (review phase). The dev DB needs a project with a manual Kanban
   view that has a default bucket and a done bucket:
   - Create a repeating task with a due date directly in the Done column. The column's
     "add task" input sends `bucket_id` (`ProjectKanban.vue:646-650`); Quick Add Magic sets the
     repeat (for example `water plants every day`). After a reload, it shows in the default column,
     not done, with the due date one interval later. Record where the task shows **before** the
     reload. If the frontend leaves it in the Done column until the reload, that is a frontend
     placement gap: note it for a follow-up issue. It does not block this change.
   - Create a non-repeating task in the Done column: it is done and stays in Done.
   - Delete the Kanban view. Check with `sqlite3` that no `buckets` rows have its id.

Done looks like this:

- All commands above exit 0.
- Each red-first test recorded its failure on the old code in the Execution Log.
- #108 is closed with a comment that lists the accepted residue (Design).

## Stop criteria

- If the retarget in `resolveProvidedBuckets` needs changes outside `tasks.go` (other than the
  tests and `project_view.go`), stop. The design assumed the create path has everything it needs
  in that one function.
- If a red-first test cannot be made red on the old code, stop and record why. Do not weaken the
  test until it passes.
- If the limit cases in Test 2 need a change to `checkBucketLimit` itself, stop. That is a design
  question.
- Bounded fix: two attempts per failing item, then halt and log.

## Out of scope (recorded)

- A repeating task created with `done: true` (no bucket): #119.
- `updateTaskBucket` does not persist `description` after `updateDone` resets the checklist
  (`kanban_task_bucket.go`, the `Cols(…)` list after `doneChanged`). Dragging a repeating task to
  Done does not reset its checklist. Found in this plan session; not filed yet.

## Execution Log

### Build, 2026-10-04 (Opus, driver only)

Commits: `91bd15bad` (#110), `c3279e0ed` (orphan buckets), `6cfe48145` (#108 tests).

Red on the old code (`d94eb5420` plus the new tests):

- Test 1 (`TestTask_Create/repeating_task_created_in_the_done_bucket_completes_one_iteration`):
  `task.Done` true, `BucketID` expected 1 actual 3, due date expected +3600 s actual unchanged;
  the DB row was the same.
- Test 2 (`TestHumaTask_CreateInDoneBucket`): case 1 failed as in Test 1. "Full done bucket"
  returned 412 (`code 10004`) instead of 201. "Full default bucket" returned 201 (task done in
  bucket 3) instead of 412. The non-repeating case and the foreign bucket case passed on the old
  code, as expected for pins. The foreign bucket 4 gives 404 with `ErrCodeBucketDoesNotExist`.
- Test 3 (default == done): `task.Done` true and the DB row `done` true, due date not advanced.
  **Guard check:** with Implementation 1 in place and the `!t.isRepeating()` guard removed,
  Test 3 is red (`task.Done` and the DB row are true). Test 3 is therefore the counterpart
  itself; no extra test was added.
- Test 7 (`TestProjectView_Delete`): `buckets` rows with `project_view_id = 4` remained.

Tests 4–6 are regression pins and passed on the first run.

Deviations and notes for the reviewer:

- `resolveProvidedBuckets` now runs in three passes: validate each requested bucket (lookup,
  view, cross-project check), retarget and group by destination, then check the limits. The
  helper `completeRepeatingTaskInDoneBucket` holds the per-task decision. If the destination
  bucket was not requested, it is loaded with `getBucketByID`. The destination is always on the
  same view as the requested done bucket, so the view map lookup is safe.
- Test 1 and Test 3 use a due date 48 h in the future so that one interval advances it exactly
  once (`addRepeatIntervalToTime` steps past now).
- Test 4: I changed the existing "copies rrule recurrence" test instead of adding a sibling. The
  source due date is now zero and the `Equal` line is gone; the row assertion stays.
- Test 6 #93: task 1 has attachments, and the webtest env has no file fixtures (404 code 4034).
  The test uses task 2, as the existing v2 duplicate test does. Task 2 is done; this does not
  affect the rrule field assertions.
- Test 5: the `AssertMissing` loops no longer filter on `project_view_id`, so a row for bucket 4
  on any view fails the test.

Verification (from the worktree root): `mage test:feature && mage test:web` 0, `mage lint`
0 issues, `mage check:all` 0 with no diff. The live browser verify is for the review phase.
