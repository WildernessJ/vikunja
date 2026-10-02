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
