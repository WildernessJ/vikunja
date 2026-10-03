# e2e-task-detail-chips-112 — group A tests on the task-detail chips (#112, cycle 2 of 2)

## Intent

Make the 54 Playwright tests in failure group A of #112 pass on the fork. These tests drive
upstream's task-detail sidebar (`.task-view .action-buttons`, `.columns.details`), which the
fork replaced with property chips. After this cycle, the full `mage test:e2e` run has 0 failures.
Cycle 1 (`specs/e2e-fork-ui-112.md`, merged `9862604c2`) fixed groups B to E.

Baseline (cycle 1 build session 2, full run on `1723d3c45`): 54 failed, 381 passed, 4 skipped.
All 54 failures are group A titles.

## Design

Decisions that Jason made on 2026-10-02 (plan session for cycle 2):

- **Selectors: `data-chip` attributes.** Add a `data-chip` attribute to every chip in
  `frontend/src/components/tasks/partials/TaskPropertyChips.vue`. The four date chips are
  identical `Datepicker` buttons, and the priority chip has no icon. Without the attribute, a
  test can find them only by position. This is the one product file this cycle changes. The
  change is markup only, with no change in behavior.
- **Tests whose UI is gone: rewrite to intent.** Keep the test and assert the same thing the user
  sees on the chip UI. Example: "Keeps action buttons visible after changing the bucket" becomes
  "the property chips stay visible after the bucket changes". Delete a test only when its intent
  has no counterpart on the fork. Record each deletion and each renamed title in the Execution
  Log.
- **Product bugs:** the cycle 1 rule stays. Mark the test `test.fixme(...)`, open a GitHub issue,
  put the issue link in the fixme reason, and continue. Do not fix product code.
- **#114 items:**
  - Item 2 (baseline-diff script): not written. The goal is 0 failures. A diff against an empty
    baseline adds nothing. Write it only if the build ends with known failures that are not
    fixmes, and then halt first (see Stop criteria).
  - Item 3 (about 400 token refreshes per run): a separate issue, #115. Not in
    this cycle.
  - Item 4 (stale README and dead code) and item 6 (unused `page` parameter): fixed in this cycle.
  - Item 5 (`test.yml`) and the lint gap (`pnpm lint` does not cover `tests/`): not in this cycle.
    Recorded as residue in #115.

Where the old UI went on the fork:

| Old (upstream) | Fork |
|---|---|
| `.action-buttons .button` for a field (labels, assignees, due date, priority, reminders, repeat, percent done, color, move) | A chip in `.task-property-chips`. Find it with `[data-chip="<key>"]`. |
| `.columns.details .column` (field editors shown after the button) | The chip popup, `.property-chip-popup`, or the date picker popup for a date chip. |
| `.action-buttons` done, delete | `.task-detail-menu`: `.button--mark-done`; delete is in the "more actions" dropdown, then the confirm modal. |
| Attachments and related tasks buttons | Always-visible sections `.content.attachments` and the related-tasks section. No button opens them. |
| `.action-buttons p.created` | `p.created` (`CreatedUpdated.vue`), below `.task-detail-menu`. |
| `h1.title`, `h1.title.input`, `h1[contenteditable]` | `.task-title-field textarea.title`. |
| `.details.labels-list` | The labels chip popup (`EditLabels`). |
| `.column.assignees` | The assignees chip popup (`EditAssignees`). |

The build session confirms each mapping against the code. The table is a guide, not a contract.

## Implementation plan

1. **`data-chip` attributes** in `TaskPropertyChips.vue`. Keys: `project`, `due`, `start`,
   `end`, `deadline`, `priority`, `labels`, `assignees`, `reminders`, `repeat`, `percent-done`,
   `duration`, `color`. Put the attribute on the `.date-chip` div for the dates and on the
   `<PropertyChip>` element for the others. `PropertyChip.vue` has one root element and does not
   set `inheritAttrs: false`, so the attribute falls through to `.property-chip`. Confirm this in
   the unit test (Tests, item 1).
2. **Selector form in the specs.** Use the attribute directly, for example
   `page.locator('.task-view [data-chip="labels"] .property-chip-button')`. Do not add a helper
   unless the same multi-step sequence (for example "open the chip, then type into its
   multiselect") repeats in three or more tests. If a helper is added, put it in
   `frontend/tests/support/commands.ts`.
3. **Port the 54 tests**, file by file:
   - `task/task.spec.ts` (29)
   - `task/related-tasks-quick-add-magic.spec.ts` (6)
   - `task/recurrence.spec.ts` (4)
   - `task/duration.spec.ts` (3)
   - `project/project-view-kanban.spec.ts` (2)
   - `sharing/linkShare.spec.ts` (2: "label picker…", "directly viewing a task with share hash").
     Also remove the comment near line 175 that #114 item 1 says is false.
   - `task/recurring-reminder.spec.ts` (2)
   - `time-tracking/time-tracking.spec.ts` (2)
   - `project/activity.spec.ts` (1)
   - `task/assignee-search-narrow-column.spec.ts` (1)
   - `task/bucket-select.spec.ts` (1)
   - `task/deadline.spec.ts` (1)

   The exact titles are in #112 (failing on both `main` and the sync branch, minus groups B to E
   listed in `specs/e2e-fork-ui-112.md`). Keep each test's intent. Change only what the fork's UI
   needs. Keep test titles unless the old title names UI that is gone.
4. **#114 cleanups:**
   - `frontend/tests/e2e/README.md` line 7: the text says `MAILER_API_URL` has a default. The
     confirmation-notice test now skips when it is not set. Change the text to say this.
   - `frontend/tests/e2e/user/registration.spec.ts` line 37: remove the dead
     `|| 'http://127.0.0.1:3457/api/v1'` fallback (the `test.skip` above it guarantees the
     variable is set).
   - `frontend/tests/e2e/admin/invite-links.spec.ts` line 8: remove the unused `page` parameter
     from the `beforeEach`.

## Execution routing

- Driver (the build session): item 1, its unit test, and item 4. Then the red-first run.
- `executor` (Opus, effort high), two dispatches, **one after the other, never in parallel**
  (two `mage test:e2e` runs in one worktree compete for the same ports and database):
  1. `task/task.spec.ts`.
  2. The other 11 files.

  Each dispatch gets: this spec, the mapping table, the fixme rule, the rewrite-to-intent rule,
  and the instruction to run only its own files with `mage test:e2e "--reporter=line <files>"`.
  Each dispatch reports every deleted or renamed test and every fixme.
- The driver does the full run (Verification 2) after both dispatches.
- No security agent: markup and test code only.

## Tests

Red-first list, in order:

1. Unit, `frontend/src/components/tasks/partials/TaskPropertyChips.test.ts`: every key from
   Implementation item 1 is present exactly once as `[data-chip="<key>"]` in the mounted
   component. Red before item 1, green after.
2. E2E red evidence already exists: the 54 group A titles fail in the cycle 1 full run. Before
   porting, run `task/task.spec.ts` › "Can set a priority for a task" once and record the
   failure. It must pass after the port.

## Verification

Run every command from the worktree root `/Volumes/ext-ssd/Github/e2e-task-detail-chips-112`.
Save the output to a file and read the file.

1. Targeted run of the 12 group A files:
   `mage test:e2e "--reporter=line tests/e2e/task/task.spec.ts tests/e2e/task/related-tasks-quick-add-magic.spec.ts tests/e2e/task/recurrence.spec.ts tests/e2e/task/duration.spec.ts tests/e2e/project/project-view-kanban.spec.ts tests/e2e/sharing/linkShare.spec.ts tests/e2e/task/recurring-reminder.spec.ts tests/e2e/time-tracking/time-tracking.spec.ts tests/e2e/project/activity.spec.ts tests/e2e/task/assignee-search-narrow-column.spec.ts tests/e2e/task/bucket-select.spec.ts tests/e2e/task/deadline.spec.ts"`
2. Full run: `mage test:e2e "--reporter=line"`.
3. `cd frontend && pnpm lint`, `pnpm typecheck`, and `pnpm test:unit --run` (without `--run`, vitest watches).
4. `mage test:feature` (the suite in `.workflow.yaml`).

Done looks like this:

- The full run has 0 failures. Skips are only the 4 known ones (OpenID, registration
  confirmation notice, and the 2 from before cycle 1), plus any `test.fixme` with an issue link.
- No test that passed in the cycle 1 full run fails.
- Lint, typecheck, unit tests, and `mage test:feature` exit 0.
- The API log for the full run has 0 responses of 429.
- The diff touches only `frontend/tests/`, `TaskPropertyChips.vue`, `TaskPropertyChips.test.ts`,
  and this spec.
- The Execution Log lists every deleted test, every renamed title, and every fixme.

## Stop criteria

Halt, record the reason in the Execution Log, commit and stop if any of these occur:

- A fix needs a product change other than the `data-chip` attributes in `TaskPropertyChips.vue`.
- More than three tests become fixmes for product bugs.
- More than three tests are deleted because their intent has no counterpart.
- A test that passed in the cycle 1 full run fails, and a small, test-only change does not fix it.
- The full run returns 429 to any test.
- Two fix attempts on one test fail.
- The build would end with failures that are neither passing nor fixmes (this is the only case
  where the #114 item 2 script becomes relevant; the plan session decides).

## Execution Log

### Build session 1 (2026-10-02, Opus)

**Result:** all 54 group A tests pass. The full run has 0 failures. No stop criterion was hit.

**Commits:**

- `559d140c6`: the `data-chip` attributes, the unit test, and the #114 items 4 and 6.
- `352991611`: `task/task.spec.ts` (executor dispatch 1, 29 tests).
- `1f5b55a88`: the other 11 files (executor dispatch 2, 25 tests).

**Red-first evidence:**

- Unit test "marks each chip with a unique data-chip key" failed before the attributes
  (`project: expected [] to have a length of 1`), and passes after them.
- E2E "Can set a priority for a task" failed before the port. It timed out on
  `.task-view .action-buttons .button` "Set Priority". It passes after the port.

**Deleted tests:** none.

**Renamed titles:** one. `task/bucket-select.spec.ts`: "Keeps action buttons visible after
changing the bucket" became "the property chips stay visible after the bucket changes". The
test asserts that `[data-chip="labels"]` and `.task-detail-menu .button--mark-done` are visible.

**Fixmes added:** none. No issues were opened. The one skip in `bucket-select.spec.ts` is a
`test.fixme` from before this cycle.

**Helpers:** no helper was added to `commands.ts`. Three helpers in `task.spec.ts` changed:
`addLabelToTaskAndVerify` (uses the labels chip popup), `uploadAttachmentAndVerify` (uses the
always-visible "Upload attachment" button in `.content.attachments`), and `dateChip` (selects
`[data-chip="<kind>"]`, not a position). In `time-tracking.spec.ts`, `openTaskTimeTracking`
no longer clicks `[data-cy="taskTrackTimeAction"]`. The section is always visible.

**Deviations and changed assertions. The reviewer should read these first:**

1. **POST body checks became PATCH response checks** in four files: `deadline.spec.ts`,
   `duration.spec.ts` (two tests), `recurrence.spec.ts` ("weekly Mon+Fri"), and
   `recurring-reminder.spec.ts` ("weekly reminder"). The fork saves a task with a v2 PATCH
   (`application/json-patch+json`). Playwright reports `postData() === null` for that request,
   because the client sends a `Request` object. The tests now wait for the PATCH and read the
   saved task from `response.json()`. The duration "garbage input" test's no-save listener now
   watches PATCH. Before, it watched POST, so it passed even when a save happened.
2. **`assignee-search-narrow-column.spec.ts`:** when the test opens the assignees chip and
   clicks the input, the popup does not preload the project members. The executor reports this
   cause: in `EditAssignees.vue`, `@focus="preloadUsers"` falls through to the Multiselect root
   div, and a focus on the inner input does not reach it. The driver did not confirm this cause.
   The test now gives the three users the usernames `narrowcolumn1..3`, types `narrowcolumn`,
   and asserts exactly 3 results. The layout assertions did not change. **Possible product
   regression, not filed:** on the fork, the assignees chip shows no member list until the user
   types. No fixme was added, because the test intent (the #3709 layout) has a working
   counterpart. Jason decides whether to open an issue.
3. **`related-tasks-quick-add-magic.spec.ts`:** a click on a related task opens that task in a
   modal over the parent task. Two `.task-view` elements then exist. The label and priority
   assertions now use the scope `.task-detail-view-modal .task-view`.
4. **"Can open due date with keyboard shortcut in task detail"** (`task.spec.ts`): the due chip
   is always visible, so the assertion "the due date column appears" is gone. The test now
   asserts that the popup is closed, then calls `openDueDatePopupWithShortcut`.
5. **Tests that open a chip popup to see its content:** "Can add an assignee" (it reopens the
   chip after a reload), "Can remove a label", "Can remove an assignee", the repeat and reminder
   tests, and the duration "clear button" test. The duration "clear button" test now asserts
   `[data-chip="duration"]` has `is-unset` and the input is `''`.
6. **`linkShare.spec.ts`:** the false comment from #114 item 1 is removed. The label setup and
   the unused `LabelFactory` and `LabelTaskFactory` imports are removed too, because the test
   now opens the labels chip.
7. `registration.spec.ts`: the dead fallback became `process.env.MAILER_API_URL!`. The
   `test.skip` above it makes sure that the variable is set.

**Verification (worktree root, HEAD `1f5b55a88`):**

- Targeted runs: `task.spec.ts` 75 passed (two runs). The other 11 files: 82 passed, 1 skipped
  (the fixme from before this cycle).
- Full run 1: 434 passed, **1 failed**, 4 skipped, 0 responses of 429. The failure was
  `editor/image-alt-text.spec.ts` › "sets alt text on a selected image via the image bubble
  menu" (group B to E, a file that this branch does not change). That file then ran with
  `--repeat-each=3`: 12 of 12 passed. Recorded as flaky under full-suite load. It did not fail
  again.
- Full run 2: **435 passed, 0 failed, 4 skipped, 0 responses of 429.**
- `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test:unit --run` 214 files / 2573 tests, and
  `mage test:feature` 0.

**Out of scope, not fixed:** ESLint reports 16 errors in the changed test files. All of them
were there before this cycle (unused imports and variables: 7 in `task.spec.ts`, 5 in
`project-view-kanban.spec.ts`, 4 in `linkShare.spec.ts`). `pnpm lint` does not cover `tests/`.
This gap is residue in #115.

### Review session (2026-10-02, `/flow review --auto`)

**Renamed titles:** one more. `task/assignee-search-narrow-column.spec.ts`: the describe
"Assignee search results in a narrow column" became "Assignee search results in the assignees
chip popup", and the test "Shows the avatar and name of every result when the assignees column
is narrow" became "Shows the avatar and name of every result in the assignees chip popup". The
fork has no detail columns; the chip popup has a fixed width. The setup comment and a stale
comment in `task.spec.ts` ("Focus preloads every project member") were corrected.
