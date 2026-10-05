# repeating-followups-122-125 — repeating-task follow-ups (#122, #123, #124, #125)

## Intent

Close the follow-ups of `repeating-create-move-119-120` (merged `fa8e0bb25`).

1. **#122.** `Task.Update` with `done: true` on a repeating task whose rule has no next occurrence
   leaves the task done in the default bucket. `updateSingleTask` routes the bucket before
   `updateDone` runs, so it routes on the requested state, not on the result.
2. **#123.** A month-mode repeating task that completes one iteration on create (#119, #110) gets
   a due date shifted by the zone offset when the client sends a zone other than the service
   zone. `addOneMonthToDate` reads the wall-clock fields of `d` in the zone `d` carries.
3. **#124.** CalDAV create stores a completed repeating VTODO done; CalDAV update completes one
   iteration. Jason chose (b) on 2026-10-04: CalDAV create follows #119, like the API.
4. **#125.** All remaining notes of the `repeating-create-move-119-120` review:
   - `done_at`: the move path stores zero for a reopened iteration; create and update store now.
   - The default-bucket limit on create.
   - The unlocked task read in `updateTaskBucket`.
   - The caller mutation in `completeRepeatingTasksOnCreate`.
   - `//nolint:gocyclo` on `updateTaskBucket`.
   - Six test gaps.
   The frontend note (stale due date in the task modal after a bucket-select move) goes to batch 7,
   not here. #122–#125 close when this cycle merges and is pushed.

Prod has List views only and one user in the service zone, so none of this occurs on prod today.

## Design

Decisions settled with Jason (2026-10-04): #124 option (b); close every other #125 item in this
cycle. The decisions below were made in the plan session.

- **#122: route the bucket on the stored state.** Move both bucket-routing blocks of
  `updateSingleTask` ("When a task was moved between projects…" and "When a task changed its done
  status…") to after the main row write (`s.ID(t.ID).Cols(colsToUpdate...).Update(&ot)`, then
  `*t = ot`). At that point `t.Done` is the final state and the DB row matches it. The routing
  rule for the same-project case becomes:
  - `doneChanged && doneAfter && !t.Done` (a reopened iteration) → `moveTaskToDefaultBuckets`.
  - otherwise, `t.Done != ot.Done` as captured before the write (a plain done toggle, or a
    repeating task that stays done) → `moveTaskToDoneBuckets`.
  The project-move block uses the final `t.Done` the same way. This also fixes the sibling case:
  a repeating task moved to another project and marked done in the same request lands in the
  new project's done bucket today, although it reopens.
  - *Rejected alternative:* move the blocks only past `updateDone`. `updateTaskBucket` then reads
    the not-yet-written DB row and runs `completeOneIteration` a second time on it. That gives the
    same result unless the same request changes the repeat rule or the dates, and then it routes
    on the old rule. Routing after the write removes that case.
  - Consequence: `updateTaskBucket`, called from these blocks, now sees a DB task whose done state
    already matches. Its own done-state branch does not fire, so it only moves the row and checks
    the limit of a done bucket it moves into. It no longer writes `repeatingIterationCols` or
    reminders from this path. `moveTaskToDoneBuckets` already visits every manual Kanban view, so
    the missing `syncTaskIntoOtherDoneBuckets` call loses nothing.
- **#123:** `addOneMonthToDate` converts `d` to `config.GetTimeZone()` first. On the update path
  `d` is already in the service zone, so that path does not change.
- **#124 (b):** delete `CreateTaskForCalDAV`. `listStorageProvider.go` calls `vTask.Create` again.
  `createTask` and `createTasks` keep the `completeDoneRepeating` parameter: import and project
  duplicate still pass false. A CalDAV create of a completed repeating VTODO now completes one
  iteration, as a CalDAV update of the same VTODO does. Regenerate the yaegi symbols (the export
  goes away). A plugin that used it could exist for one day only; none is known.
- **`done_at` (#125):** a completed iteration gets `done_at = now` on every path. On the move path,
  `done_at` follows `b.doneAfter`: a move into the done bucket sets now (also when the iteration
  reopens), a move out of it sets zero. This matches `updateDone`, which create and update use.
- **Default-bucket limit on create (#125): no behavior change.** The rule is: a create checks the
  limit of a bucket it was asked for. A create with `done: true` and the done bucket asks for a
  bucket; the reroute then checks the default bucket's limit, as the move path does
  (`resolveDestinationBucket`, `isMove`). A create without `bucket_id` asks for no bucket and
  checks no limit, which is the rule for every create. State this in the
  `completeRepeatingTasksOnCreate` doc comment and pin it with a test.
- **Locked task read in `updateTaskBucket` (#125).** Replace `task.ReadOne(s, a)` with a locked
  read that bypasses the session memo: `GetTaskSimple(lockingSession(s), &Task{ID: b.TaskID})`,
  then `addMoreInfoToTasks` for the details `ReadOne` adds. `ReadOne` goes through
  `GetTaskByIDSimple`, which is memoized (`db.Remember`), so it can return the copy that
  `TaskBucket.CanUpdate` → `CanWrite` read before any lock. A write from another transaction
  between that read and the move's write is then lost. When `updateSingleTask` calls in, the row
  is already locked by the same transaction; a second `FOR UPDATE` is harmless. SQLite has no
  row lock (`lockingSession` returns `s`); its writer lock serializes the writes.
- **Caller mutation on create (#125): document, no code.** `createTasks` already changes the
  caller's tasks before it can fail (ID, index, project, rrule anchor). The iteration completion
  adds dates to that list. No caller retries with the same structs, and the transaction rolls
  back the DB. State the contract in the `createTasks` doc comment: on error, the tasks are
  modified and a caller must not retry with them. A snapshot-and-restore is the upgrade path if a
  retrying caller appears.
- **`gocyclo` (#125):** extract the done-state block of `updateTaskBucket` (from "mark task done
  if moved into or out of the done bucket" to the end of `if doneChanged {…}`) into one function
  with a name that says what it does. Remove the `//nolint:gocyclo`. `mage lint` must pass
  without it.

## Implementation plan

1. `pkg/models/tasks.go`, `updateSingleTask`: move both routing blocks after the main write, as in
   Design. `views` is still loaded where it is today (the lock order must not change). Keep
   `doneChanged`/`doneAfter` as they are; they are already captured before `updateDone`. Update
   the comments so they state the new order and why.
2. `pkg/models/tasks.go`, `addOneMonthToDate`: `d = d.In(config.GetTimeZone())` first.
3. `pkg/models/tasks.go`: delete `CreateTaskForCalDAV`. `pkg/routes/caldav/listStorageProvider.go:612`
   calls `vTask.Create(s, vcls.user)`. `mage generate:yaegi-symbols`, commit the output unchanged
   (ADR-0019). No swagger change.
4. `pkg/models/kanban_task_bucket.go`, `updateTaskBucket`:
   - The locked task read (Design).
   - Extract the done-state block; inside it, `done_at` follows `b.doneAfter`.
   - Remove `//nolint:gocyclo`.
5. Doc comments: `createTasks` (caller mutation), `completeRepeatingTasksOnCreate` (limit rule).
6. Tests as listed below.

Edge cases:

- A plain (non-repeating) task marked done or undone through `Task.Update` with manual Kanban
  views: same buckets as today on every view. Existing tests cover this; they must pass unchanged.
- A repeating task marked done whose rule is live: default bucket on every view (unchanged).
- A done bucket that is full, plain task marked done through `Task.Update`: the error is the same
  as today (`ErrBucketLimitExceeded`). The check now runs after the main write; the transaction
  rolls the write back.
- `updateTaskBucket` called for a task with no manual Kanban views: unchanged.

## Execution routing

- **Driver** (the build session) does items 2, 3, 5 and the tests.
- **`executor`** (Opus, effort high) for items 1 and 4 if the driver prefers to dispatch; the
  design is fixed, so no `executor-max`. One executor, sequential, not in parallel: both items
  touch the done-bucket flow.
- No security agent. The locked read narrows a lost-update window; it changes no permission check.
- Order:
  1. Pins first (Tests 8, 9, 13, 14), green on the current code.
  2. #122: Tests 1–3 red → Implementation 1 → green.
  3. #123: Test 4 red → Implementation 2 → green.
  4. #124: Test 5 red (after flipping the existing pin) → Implementation 3 → green.
  5. `done_at`: Test 6 red → Implementation 4 (`done_at` part) → green.
  6. Locked read: Test 7 red → Implementation 4 (read part) → green.
  7. Extraction and `nolint` removal (refactor, all green), then Implementation 5.
  8. Tests 10–12 (gaps): add; record for each whether it was a pin or found a defect. A defect
     found here is a stop criterion, not a fix.

## Tests

Red first means: the test fails on `07c688abb` for the reason the issue names, and passes after
the fix. Record each red failure message in the Execution Log. Pins (green before and after) are
marked.

Fixtures: project 1, view 4 (Kanban, manual): default bucket 1, done bucket 3, bucket 2. Task 28
repeats (`repeat_after: 3600`). Where a test needs a second manual Kanban view with a done bucket,
or a second project with one, create it in the test.

**#122 — `Task.Update`**

1. Model, `TestTask_Update`: the #122 repro. A task in project 1 with
   `repeat_mode = rrule`, `repeat_rrule = FREQ=DAILY;UNTIL=20200102T000000Z`, due 2020-01-01, in
   bucket 2 of view 4. `Task.Update` with `done: true`. Assert: done, `task_buckets` for view 4 is
   bucket 3. Red: bucket 1.
2. Webtest (v2 task update): the same task, done bucket 3 full. Expect the limit error status;
   the DB row is not done. The check now runs after the main write, so only the request's
   transaction rollback keeps the row clean; a model test without a transaction cannot assert
   that. Red or pin: record which.
3. Model: a live repeating task moved to another project (with a manual Kanban view that has a
   done bucket) and `done: true` in one `Task.Update`. Assert: not done, advanced, in the new
   view's default bucket. Red: in the done bucket.

**#123 — month mode**

4. Model, `TestTask_Create`: month mode (`repeat_mode: 1`), `done: true`, due date built in a zone
   that is not the service zone (for example `time.FixedZone("x", -4*3600)`). Assert the stored
   due date equals what `Task.Update` with `done: true` stores for the same task. Red: off by the
   zone offset. If the test config's service zone makes the case unreachable, set the zone in the
   test and record how.

**#124 — CalDAV**

5. `pkg/caldavtests/done_repeating_test.go`: replace `TestCalDAVCreateCompletedRepeatingTaskStaysDone`
   with a test that PUTs a completed repeating VTODO (`STATUS:COMPLETED`, an `RRULE`) to a new URL,
   then PUTs the same VTODO to the same URL again. Assert after the first PUT: not done, one
   iteration later. Assert after the second PUT: not done, one more iteration later. Red: done
   after the first PUT.

**#125**

6. Model, `kanban_task_bucket_test.go`: a live repeating task moved from bucket 2 into done
   bucket 3. Assert DB `done_at` is not zero. Red: zero. Also assert a plain task moved out of
   bucket 3 gets `done_at` zero (pin).
7. Model: the lost update. Session `s` reads task 28 through `GetTaskByIDSimple` (memoized). A
   second session changes task 28's description and closes. `updateTaskBucket` on `s` moves task
   28 into bucket 3. Assert the DB description is the second session's (with the checklist reset
   applied). Red: the old description. If the memo is not active on test sessions, so the test
   cannot be red, stop and record it (stop criterion).
8. Pin: create with `done: true` and `BucketID: 3`, default bucket 1 full. Assert
   `ErrBucketLimitExceeded`. Create with `done: true`, no bucket, default bucket 1 full: succeeds,
   in bucket 1.
9. Pin: a plain task marked done, then undone, through `Task.Update` with two manual Kanban views:
   done bucket on both, then default bucket on both.

**#125 test gaps**

10. Create in done bucket 3 with an ended rule: `done: false` → done, in bucket 3, dates
    unchanged; `done: true` → the same.
11. The done-bucket limit on create when the task stays done (ended rule, done bucket 3 full):
    `ErrBucketLimitExceeded`.
12. Create with `done: true` and a description with a checked checklist item: stored unchecked.
13. Create with `done: true` in a project with no Kanban view: advanced, not done.
14. Default bucket == done bucket, create with `done: true` and that bucket: advanced, not done,
    in that bucket.
15. Ended rule, `done: true`, requested bucket 2 (not the done bucket): done, in bucket 3.

## Verification

Run every command from the worktree root `/Volumes/ext-ssd/Github/repeating-followups-122-125`.
Save the output to a file and read the file.

1. `mage test:feature && mage test:web` (the gate in `.workflow.yaml`).
2. `mage lint` (must pass with the `//nolint:gocyclo` removed).
3. `mage check:all`.
4. Browser verify (`live_verify_mode: browser`), dev servers via `/dev`, a project with a manual
   Kanban view:
   - Mark an ended-rule repeating task done with the task-detail "Done" button: it shows in Done.
   - Mark a live repeating task done the same way: it shows in To-Do with the next date.
   - Mark a plain task done, then undone: Done, then To-Do.

Done looks like: the suite, lint and `check:all` exit 0; the yaegi symbols are regenerated and
committed; the browser checks pass; the Execution Log records each red failure.

## Stop criteria

- If moving the routing blocks after the main write changes the status code, error, or bucket of
  any existing test, stop. The design assumed only the repeating cases change.
- If the routing move needs a change to `moveTaskToDoneBuckets`, `moveTaskToDefaultBuckets` or
  `checkBucketLimit`, stop. That is a design question.
- If the extracted done-state function still needs `//nolint:gocyclo` somewhere, stop and record
  the complexity numbers. Do not split further without a plan session.
- If a red-first test cannot be made red on the old code, stop and record why. Do not weaken the
  test until it passes.
- If a gap test (10–15) finds a defect, stop and record it. Fixing it is new scope.
- Bounded fix: two attempts per failing item, then halt and log.

## Out of scope (recorded)

- The frontend note of #125 (the task modal shows the old due date after a bucket-select move):
  batch 7.
- The create path reads the view config before `lockProjectViewsForPositionUpdate` (#121,
  unchanged).
- TOCTOU between `existingBucketID` and `b.upsert`, and no FK on `task_buckets.bucket_id`
  (accepted in #108).

## Execution Log

_Empty; the build phase appends._
