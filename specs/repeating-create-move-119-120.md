# repeating-create-move-119-120 — repeating task created done, move into the done bucket (#119, #120, #121)

## Intent

1. **#119.** A repeating task created with `done: true` is stored done. Its dates never advance.
   This differs from the update rule (#2573): marking a repeating task done completes one
   iteration (`updateDone`). With a manual Kanban view, the task also lands in the done bucket.
2. **#120.** The move path (`updateTaskBucket`, `pkg/models/kanban_task_bucket.go`) has two bugs
   when a repeating task moves into the done bucket:
   - A task whose rule has no next occurrence (for example an rrule with `UNTIL` in the past)
     stays done, but goes to the default bucket. It is then done in To-Do on this view and in
     Done on the other views. The done bucket's limit is also skipped for it, because
     `repeatingTaskPassesThroughDoneBucket` runs before `updateDone` and assumes a reroute.
   - The `Cols(...)` list after `updateDone` does not contain `deadline` or `description`. The
     response shows the advanced deadline and the reset checklist; the DB keeps the old values.
3. **#121** (review notes of `repeating-buckets-110-108`). In scope: tests for the repeat modes on
   the create path, and moving the DB write out of `resolveProvidedBuckets`. The other notes are
   accepted (Out of scope). #121 closes when this cycle merges.

None of this is reachable from the fork UI for #119 (no create form sends `done: true`). #120 is
reachable by a drag into the Done column. Prod has List views only, so neither occurs on prod
today.

## Design

Decisions settled with Jason (2026-10-04):

- **One rule, one helper.** "Complete one iteration" is one pure function used by the create
  path and the move path, with one shared column list for the write. The two paths cannot drift
  on columns again.
- **#119 applies to user creates only.** `Task.Create` (v1 and v2 API) and
  `BulkTaskCreation.Create` apply it. These callers keep the done state as sent:
  - Import (`CreateTasksForImport`): an imported done repeating task is history.
  - Project duplicate (`project_duplicate.go`): the copy keeps the project's state. The template
    case already resets `done`.
  - CalDAV create (`listStorageProvider.go:612`): CalDAV clients own their recurrence. A client
    can upload a completed instance as history, and a server that rewrites a PUT diverges from
    the client's copy.
  - Task duplicate already forces `Done: false`, so the rule never triggers there.
- **A create completes at most one iteration.** A task triggers completion when it is
  repeating and either (a) it was sent with `done: true` (user creates only), or (b) it is not
  done and its requested bucket is the done bucket of a manual Kanban view (#110, unchanged).
  `done: true` together with the done bucket is one request to complete, so it advances once.
  After a completion that leaves the task not done, a requested done bucket is replaced by the
  view's default bucket (`getDefaultBucketID`), as #110 does today.
- **A rule with no next occurrence stays done, in the done bucket, on both paths.** On the move
  path the done bucket's limit applies to it (it occupies a done slot), and
  `syncTaskIntoOtherDoneBuckets` runs as for any task that becomes done. This makes the move path
  match the create path (`989ac3563`).
- **The create path decides before the insert.** The completion and the bucket replacement
  happen before `s.Insert`, so the insert writes the final values. No `UPDATE` follows the insert.
  This removes the DB write from `resolveProvidedBuckets` (#121). The bucket and view
  validation that `resolveProvidedBuckets` does today moves before the insert with it, so the
  completion can see the requested bucket's view. The limit check and the `taskProvidedBucket`
  map stay after the insert, because they use task IDs. `checkBucketLimit` counts
  `task_buckets` rows, which the insert does not write, so its result does not depend on the
  order.
- **Events.** A create sends no `TaskDoneChangedEvent`, as #110 decided. The move path keeps its
  event behavior (`b.doneChanged`, `b.doneAfter`).
- **`done_at`.** A completed iteration that ends not done keeps `done_at = now` from `updateDone`
  on the create path, as today. Not unified (Out of scope).

## Implementation plan

1. `pkg/models/tasks.go`, next to `updateDone`:
   - `completeOneIteration(t *Task) (stillDone bool)`: `oldTask := *t; oldTask.Done = false;
     t.Done = true; updateDone(&oldTask, t); return t.Done`. Pure; no DB access.
   - `repeatingIterationCols`: `done, due_date, start_date, end_date, deadline, done_at,
     description`. The move path writes with this list.
2. `pkg/models/tasks.go`, create path:
   - `createTasks` gets one more `bool` parameter, `completeDoneRepeating`. `Task.Create`
     passes true. `createTask` gets the same parameter: `Task.Create` and `task_duplicate.go`
     pass true. `BulkTaskCreation.Create` passes true. `CreateTasksForImport` and
     `project_duplicate.go` pass false.
   - New exported `CreateTaskForCalDAV(s *xorm.Session, t *Task, a web.Auth) error`: the same as
     `Task.Create`, but passes false. `pkg/routes/caldav/listStorageProvider.go:612` calls it
     instead of `vTask.Create`. This adds an exported symbol, so run
     `mage generate:yaegi-symbols` and commit the output unchanged (ADR-0019). No swagger
     change: no annotation changes.
   - Split `resolveProvidedBuckets`:
     - Before the insert loop (after `prepareTasksForCreation`, so `anchorRRuleDueDate` has
       run): validate the requested buckets and views exactly as today (foreign or orphaned
       bucket → `ErrBucketDoesNotExist`), then apply the completion rule from Design to each
       task, then replace a done bucket with the default bucket where the rule says so.
     - After the insert: the batch grouping, the limit check and the `taskProvidedBucket` map,
       as today. No DB writes.
     Name the two parts so that the names say what they do. Delete
     `completeRepeatingTaskInDoneBucket`.
   - `setTasksInBucketInViews`: no change expected. Its `!t.isRepeating()` guard
     (`tasks.go:1331`) still covers the default == done case.
3. `pkg/models/kanban_task_bucket.go`, `updateTaskBucket`:
   - When the task moves into the done bucket, is not done, and repeats: call
     `completeOneIteration` **before** the limit check. Keep the result.
   - Reroute to the default bucket (`rerouteDoneRepeatingTask`) only when the task is not still
     done. When it is still done, it stays in the done bucket, and the code after it treats it as
     any task that became done.
   - The limit skip: replace `repeatingTaskPassesThroughDoneBucket(view, task, b.BucketID)` with
     a check that uses the completion result. The skip applies only when the task was rerouted
     away from the done bucket (not still done, default bucket set, default != done). Keep the
     existing doc comment's reasoning, updated.
   - The `Cols(...)` write after `doneChanged` uses `repeatingIterationCols`. For a non-repeating
     task or a move out of the done bucket, `deadline` and `description` are written back with
     the values `ReadOne` loaded, which is a no-op.
4. Tests as listed below.

Edge cases:

- `done: true`, repeating, rule live, requested bucket 2 (not the done bucket): advances once,
  not done, in bucket 2.
- `done: true`, repeating, rule ended, requested bucket 2: stays done; `setTasksInBucketInViews`
  puts it in the done bucket (today's behavior for a done task).
- `done: true`, repeating, no Kanban view in the project: advances once, not done (List-only
  projects get the rule).
- `done: true`, repeating, default bucket == done bucket, done bucket requested: advances once,
  not done, in the done bucket (the #110 default == done case).

## Execution routing

- **Driver** (the build session) does all of it. The design is fixed and the change is in three
  files plus tests. No executor dispatch.
- No security agent. The bucket validation moves but keeps its checks; Test 5 pins the
  foreign-bucket rejection (`huma_task_test.go:289`, `bucket_id: 4`).
- Order:
  1. Test 11 (mode pins) first, green on the current code. It protects the refactor.
  2. Tests 7–10, 13 red → Implementation 1 and 3 → green.
  3. Tests 1–4, 6, 12 red → Implementation 2 → green. Test 5 (exemption pins) is green before and
     after.
  4. `mage generate:yaegi-symbols`, commit.

## Tests

Red first means: the test fails on `b0aee96bf` for the reason the issue names, and passes after
the fix. Record each red failure message in the Execution Log. Pins (green before and after) are
marked.

Fixtures: project 1, view 4 (Kanban, manual): default bucket 1, done bucket 3, bucket 2. Task 28
repeats (`repeat_after: 3600`, due `2018-12-02 22:25:24`). Bucket 4 belongs to view 8 (project 2).
If project 1 has no second manual Kanban view with a done bucket, create one in the test that
needs it.

**#119 — create**

1. Model, `TestTask_Create`: repeating task (`RepeatAfter: 3600`, a due date), `Done: true`, no
   bucket, project 1. Assert: not done; DB `done = false`, `due_date` one interval later;
   `task_buckets` for view 4 is bucket 1, not 3. Red: done, in bucket 3.
2. Model: the same with `BucketID: 3`. Assert: `due_date` exactly one interval later (not two);
   not done; in bucket 1. Red on the old code: done, in bucket 3. It must also fail against a
   fix that applies #119 and then lets the #110 rule run again (double advance). Record in the
   Execution Log whether that variant was checked.
3. Model: `Done: true` with an rrule that has ended (`FREQ=DAILY;UNTIL=20200102T000000Z`, due
   2020-01-01). Assert: done, dates unchanged, in bucket 3. Pin or red: record which.
4. Model, bulk: `BulkTaskCreation` with a repeating `done: true` task and a plain `done: true`
   task. Assert: the repeating one advanced and not done; the plain one done in bucket 3. Red.
5. Pins, exemptions:
   - `CreateTasksForImport` with a done repeating task: stays done, dates unchanged.
   - Project duplicate (not from a template) of a project with a done repeating task: the copy is
     done with the same dates.
   - CalDAV create (`pkg/routes/caldav`) of a VTODO with `STATUS:COMPLETED` and an `RRULE`:
     stored done, dates unchanged.
   - The existing foreign-bucket rejection test for create (`huma_task_test.go:289`,
     `bucket_id: 4`) still passes unchanged.
6. Webtest, v2 create (`POST /api/v2/projects/1/tasks`) with `{"title":…,"repeat_after":3600,
   "due_date":…,"done":true}`: response `done: false`, advanced due date; DB matches. Red.

**#120 — move**

7. Model, `kanban_task_bucket_test.go`: the #120 repro. Task 28 with `repeat_mode = rrule`,
   `repeat_rrule = FREQ=DAILY;UNTIL=20200102T000000Z`, due 2020-01-01, in bucket 2 of view 4.
   `TaskBucket{BucketID: 3, TaskID: 28, ProjectViewID: 4}.Update`. Assert: done, in bucket 3,
   dates unchanged. Red: done, bucket 1.
8. Model: the same with a second manual Kanban view in project 1 that has a done bucket. Assert:
   the task is in the done bucket on both views. Red (bucket 1 on view 4).
9. Model: the same task, done bucket 3 full (`limit` = current count). Assert:
   `ErrBucketLimitExceeded`; the task is still in bucket 2 and not done. Red: the move succeeds.
10. Model: a live repeating task with a `deadline` and a description with a checked checklist
    item, moved from bucket 2 into bucket 3. Assert the DB row: `deadline` one interval later, the
    checklist item unchecked. Red: old values.

**#121 — create-path modes (pins)**

11. Model, created in done bucket 3, one subtest per mode: month mode, from-current-date mode, a
    live rrule, `repeat_after` with an absolute reminder and a relative reminder. Assert the DB
    dates and reminders per mode (the same values `Task.Update` with `done: true` gives). Green
    on the current code.
12. Model: the same modes with `Done: true` and no bucket. They share the helper, so one table
    can drive both triggers. Red on the current code (stored done).

**Webtest — move**

13. `huma_task_bucket_test.go`: `PUT /api/v2/projects/1/views/4/buckets/3/tasks` `{"task_id":28}`
    with the ended rrule from Test 7. Expect 200, `done: true`, bucket 3 in the response and in
    the DB. Red.

## Verification

Run every command from the worktree root `/Volumes/ext-ssd/Github/repeating-create-move-119-120`.
Save the output to a file and read the file.

1. `mage test:feature && mage test:web` (the gate in `.workflow.yaml`).
2. `mage lint`.
3. `mage check:all`. Expect no drift after the yaegi regeneration is committed.
4. Read the create path in `pkg/models/tasks.go` from the insert loop to
   `setTasksInBucketInViews`: no task row `Update` remains (Design, "decides before the insert").
5. Live verify (review phase), dev DB with a project that has a manual Kanban view with a
   default bucket and a done bucket:
   - Browser: drag a repeating task that has a deadline and a checked checklist item into Done.
     After a reload it is in the default column, not done, deadline one interval later, checklist
     unchecked.
   - Browser: give a task an rrule that has ended (set it through the API or `sqlite3`), drag it
     into Done. Before and after a reload it is done and in Done.
   - API (`curl` against the dev API): create a repeating task with `done: true`. The response
     and a reload show it not done, in the default column, due one interval later.

Done looks like this:

- All commands above exit 0.
- Each red-first test recorded its failure on the old code in the Execution Log.
- #119, #120 and #121 are closed after the merge and push.

## Stop criteria

- If moving the bucket validation before the insert changes the status code or error of any
  existing test, stop. The design assumed the order does not matter to clients.
- If the move-path change needs a change to `resolveDestinationBucket` or `checkBucketLimit`,
  stop. That is a design question.
- If CalDAV create needs more than one new exported function, or a change in `pkg/caldav`, stop.
- If a red-first test cannot be made red on the old code, stop and record why. Do not weaken the
  test until it passes.
- Bounded fix: two attempts per failing item, then halt and log.

## Out of scope (recorded)

- `done_at` differs between paths for a completed iteration that ends not done (create stores
  now, move stores zero, `Task.Update` stores now). Stats filter on `done = true`, so nothing
  reads it. Accepted (#121).
- The create path reads the view config before `lockProjectViewsForPositionUpdate`. Older than
  #110; no failing interleaving found (#121). Unchanged.
- TOCTOU between `existingBucketID` and `b.upsert`, and no FK on `task_buckets.bucket_id`
  (accepted in #108).

## Execution Log

### Build — 2026-10-04 (Opus, driver session)

Commits: `0075fa89e` (code and tests), `0bb4d809a` (yaegi regeneration, unchanged output).

**Gate (on `0bb4d809a`):** `mage test:feature` 0, `mage test:web` 0, `mage lint` 0 issues,
`mage check:all` 0.

**Red-first evidence.** I copied the new test files onto `b0aee96bf` in a temporary worktree and ran them there:

- Test 1: `assert.False(t, task.Done)` failed (stored done).
- Test 2: failed (stored done, not advanced). Double-advance variant **checked**: a mutant that
  applies #119 and then runs the #110 completion again fails Test 2 with the due date one extra
  hour (`expected 1791334877, actual 1791338477`).
- Test 3: **pin**. It passes on the old code (stays done, in bucket 3), as the spec allowed.
- Test 4: failed (the repeating task stored done).
- Test 5: pins. Import, project duplicate (`TestProjectDuplicate_KeepsDoneRepeatingTask`) and
  CalDAV (`TestCalDAVCreateCompletedRepeatingTaskStaysDone`, `pkg/caldavtests`) are green before
  and after. The foreign-bucket rejection test (`bucket_id: 4`) is unchanged and green.
- Test 6: `done` true, due date not advanced (`expected …844, actual …244`).
- Test 7: `expected: 3, actual: 1` (task routed to the default bucket).
- Test 8: view 4 row `bucket_id: 3` missing.
- Test 9: `An error is expected but got nil` (done bucket limit skipped).
- Test 10: deadline `1543789524` (old value), checklist still `data-checked="true"`.
- Test 11: green on the old code in all four modes (pin).
- Test 12: red in all four modes (stored done).
- Test 13: `expected: 3, actual: 1`.

**Deviations and decisions the reviewer should check first:**

1. **Pre-existing month-mode bug on the create path.** It is not fixed here.
   `addOneMonthToDate` (`pkg/models/tasks.go`) builds the new date from the wall-clock fields of
   `d`, in `config.GetTimeZone()`. The update path loads `d` from the DB in that zone, so the
   update path is correct. The create path keeps the client's zone. Test 11, with a due date in
   the test process's local zone (UTC-4), stored the done-bucket month case 4h earlier than
   `Task.Update` did. This affects #110 today and #119 now: a month-repeat task created done,
   with a due date sent in a zone other than the service zone, gets a shifted due date. The
   frontend sends UTC, so this occurs only when the service zone is not UTC. Test 11 now sets
   the due date in the service zone. A likely one-line fix is `d = d.In(config.GetTimeZone())`
   at the start of `addOneMonthToDate`, but it needs its own repro test. Out of scope here;
   recommend a separate issue.
2. **`//nolint:gocyclo` on `updateTaskBucket`.** The completion step took it from 30 or less
   to 36. `updateSingleTask` already uses the same suppression. Another option is to extract
   the done-state block into a function. I did not do that, because it would grow the diff.
3. **Test placement.** Tests 11 and 12 are one table (`TestTask_Create_CompletesOneIteration`)
   that compares each trigger with a reference task completed through `Task.Update`. Tests 7–10
   are in the new `TestTaskBucket_Update_RepeatingIntoDoneBucket`. The model tests share the
   helper `storedTaskWithReminders` (`tasks_test.go`). It reads in a closed fresh session,
   because an unclosed session locked the SQLite tables for the next subtest.
4. **The `b.doneAfter` semantics did not change.** A completion that reopens the task still
   dispatches `TaskDoneChangedEvent{Done: true}`, as before.
5. **Verification step 4.** No task-row `Update` remains between the insert loop and
   `setTasksInBucketInViews`. One older non-repeating write is still inside
   `setTasksInBucketInViews` (`Cols("done")`, the non-repeating done-bucket case). The spec
   says that code does not change.
6. **The other CalDAV create** (`listStorageProvider.go`, the `DUMMY-UID-` placeholder for a
   missing related task) still calls `Task.Create`. The placeholder is never done and never
   repeating, so the rule cannot trigger there.

No stop criterion was hit. The order change for the bucket validation changed no status code
in any existing test.
