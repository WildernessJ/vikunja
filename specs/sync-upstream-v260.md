# Spec: Sync fork with upstream v2.6.0

## Intent

- **Problem:** `main` is 479 commits behind `upstream/main` (merge-base `3acf56bb8`,
  2026-08-17; last sync was the day the base was cut). The gap includes the **v2.6.0
  release** (2026-08-31), a crash-guard sweep across the frontend, the pgx postgres driver,
  a project access memo that replaces recursive CTEs, view locking around task-position
  writes, upstream's own fix for the #88 class (`32b7fdd73`), a `defaultDueTime` user
  setting, a Sentry fingerprint/noise batch, and a **labels migration to a generated v2
  client** (`17f1a7a97`) that deletes modules three fork-only files import.
- **Deliverable:** `upstream/main` merged into `main` as two merge commits on one branch,
  suite green, delivered to prod via `/pb`, desktop rebuilt if the frontend bundle changed.
- **Out of scope:** any new fork feature; migrating other fork services to the v2 client
  (only what the label deletion forces); adopting upstream's new skills (`sentry-triage`,
  `prepare-worktree`, `run-e2e-tests`) beyond letting them land; removing the stale
  `../sync-upstream-v250` worktree (branch is merged; flag it, do not touch it here).

## Design (settled)

**Merge, not rebase**, as in every prior sync. Two merge commits on `sync-upstream-v260`:

1. **Phase A** — merge `17f1a7a97^` (331 commits, everything before the label refactor).
   Dry run 2026-09-06: **41 conflicted files**, listed under Implementation plan.
2. **Phase B** — merge `upstream/main` (the remaining 147 commits, label refactor included).
   Dry run against `main`: 26 further files, four of them delete/modify.

Both phases must be suite-green before the next starts. A single merge is not acceptable:
the label port is design work and must be reviewable apart from the mechanical merge.

### Resolution rules (Jason's calls, 2026-09-06)

| Area | Rule |
|---|---|
| Default | Fork behavior wins unless upstream fixed a real bug in the same lines. |
| **Task detail actions** (`TaskDetailView.vue`) | **Take upstream's layout** (headed groups, `SHORTCUTS.taskDetail.*` constants). The fork's "more actions" dropdown is dropped. The fork's returnability back-link (`canReturnTo`, `isPlainClick`) and its Apple-aware delete shortcut are separate features and stay. |
| **Popup** (`Popup.vue`) | **Keep the fork's `v-if` + Transition** (ADR-0004). Port upstream's three fixes onto it: Escape closes the popup owning focus (`1e2583e68`); trigger can close its own popup (`cafe1c74b`, the `closedByClickOutside` guard); focus returns to the trigger on close (`dcdd05e59`, without the `inert` pre-flush machinery — unmounting already blurs to body). No `is-open` class, no `:inert`. Upstream's `Popup.test.ts` is kept; a case that asserts closed content is in the DOM is deleted, not made to pass. |
| **Collisions** | **Fork yields.** `ErrCodeProjectViewDefaultBucketEqualsDoneBucket` moves off 3016 to the next free 30xx code. Fork fixture project 44 (`HierarchyGrandchild`) moves to the first free id; project 46 and tasks 54/55 keep their ids unless they collide too. Update `project_test.go` and `task_collection_test.go` references. Upstream's new `TestErrorCodesAreUnique` must pass. |
| **#88 overlap** (`task_position.go`) | **Upstream structure, fork tests must pass.** Take upstream's validation (`32b7fdd73`) and view locking. The fork's six #88 tests and the uniform-404 rule (`ErrProjectViewDoesNotExist` for every denial, no `ErrSavedFilterDoesNotExist` leak) stay unmodified. A fork test that fails against upstream's structure is a stop criterion. |
| **Date-only (#91) vs `defaultDueTime`** | Coexist, date-only wins. Upstream centralized due-time defaulting in `getDateWithTime` / `getDefaultTimeParts`; add the `dateOnly` branch **there** (end-of-day via `roundToNaturalDayBoundary`) and let the fork's per-site `dateOnly` branches collapse onto it where the site is a due-date site. Start/end-date sites that the #91 spec set to start-of-day keep their explicit boundary. When `dateOnly` is on, `defaultDueTime` is ignored; its settings input stays visible (same treatment as the time-format selector, `a58d41401`). Both strings stay in `en.json`. |
| **Labels (Phase B)** | Port the three fork-only importers to upstream's `client/queries/labels.ts` + `useLabels()`: `useQuickAddAutocomplete.ts` (`getLabelsByExactTitles`, `filterLabelsByQuery` exist there as pure functions over `Label[]`), `TaskTitleField.vue` (`labelStore.labels[id]` → `getLabelById`), `useQuickAddComposer.test.ts` (`LabelModel` → plain `Label` literal). Conflicted upstream-migrated files (`stores/tasks.ts`, `EditLabels.vue`, `ShowTasks.vue`, `ViewEditForm.vue`, `highlighter.ts`, `QuickActions.vue`, `ListLabels.vue`, `AddTask.vue`) take upstream's label access and keep the fork's other deltas. The fork's `stores/labels.ts` / `services/label.ts` / `models/label.ts` are deleted, not kept alongside. |
| **`.claude/skills` symlink** | Adopt upstream's layout: `.claude/skills` becomes upstream's symlink to `../.agents/skills`. The fork's tracked `desktop-build` moves to `.agents/skills/desktop-build`. Untracked local skills (`checkpoint`, `pb`, `dev`) move to `.agents/skills/` and the ignore rules follow them (`.gitignore` lines 57/70, `.git/info/exclude` line 15). `git status` must be clean afterwards and each skill must still resolve at its old `.claude/skills/<name>` path through the link. |
| `go.sum` | Take upstream, then `go mod tidy` **after** all `.go` files are marker-free. |
| Fixtures / migrations | Upstream's newest migration `20260906010000` orders after the fork's `20260802162816`; no renumbering. |

### Semantically hot, auto-merged — hand-review after each phase

- `pkg/models/task_collection.go` + fork subproject rollup: upstream now stores a top-level
  project's parent as **null** (`fc78cd3ea`) and resolves access through a **memo**
  (`b6d9e9c9c`, `5a534928d`, `943eac308`). The fork's rollup tests
  (`task_collection_test.go:2333-2447`, `project_test.go:717`) are the check; a failure there is
  investigation, not a fixture tweak.
- `pkg/models/project.go` (4 hunks): upstream's archived-parent cascade and pseudo-project write
  denial vs the fork's template flag (`ErrCodeProjectIsTemplate`) and healing changes.
- Every fork v2 route in `pkg/routes/api/v2/` compiles untouched against the bumped huma; a
  failure there is investigation.
- `frontend/src/stores/tasks.ts` (8 hunks) and `formatDate.ts` (7 hunks): #91's display path vs
  upstream's invalid-date guards (`202caf7dc`, `bc26f4413`, `681076a95`). Guards win; #91's
  `formatDate.test.ts` cases must still pass unmodified.
- `SingleTaskInProject.vue`: the fork's `task-main` layout vs upstream's `Popup`/`DeferTask`
  markup — fork layout, upstream's Popup usage.
- `sentry.ts`: fork's `vueIntegration` + upstream's `denyUrls`, `slowClickTimeout: 0`,
  fingerprinting — union.
- Phase B adds `@tanstack/vue-query` (`VueQueryPlugin` in `main.ts`) and `@hey-api/openapi-ts`
  generated code under `frontend/src/client/generated/` — vendored, never hand-edited.

## Implementation plan

### Phase A — merge `17f1a7a97^`

1. `git merge --no-ff 17f1a7a97^` in this worktree.
2. Resolve the 41 conflicts by the rules above. File list with hunk counts (dry run):
   `pkg/webtests/task_collection_test.go` 15 (present in the full merge; verify in A),
   `go.sum` 9, `stores/tasks.ts` 8, `formatDate.ts` 7, `project.go` 4, `project_test.go` 4,
   `TaskDetailView.vue` 4, `task_position.go` 3, `stores/auth.ts` 3, `services/task.ts` 3,
   `sentry.ts` 3, `dateParser.ts` 3, `ViewEditForm.vue` 3, `Popup.vue` 3,
   `DatepickerInline.vue` 3, `tasks.go` 2, `fixtures/tasks.yml` 2, `ApiTokens.vue` 2,
   `LinkSharingAuth.vue` 2, `ProjectSettingsBackground.vue` 2, `MigrationHandler.vue` 2,
   `projects.test.ts` 2, `abstractService.ts` 2, `notification.ts` 2, `Attachments.vue` 2,
   `QuickActions.vue` 2, `TipTap.vue` 2, and one hunk each in `listStorageProvider_test.go`,
   `task_search.go`, `task_position_test.go`, `task_collection_sort.go`, `error.go`,
   `fixtures/projects.yml`, `magefile.go`, `go.mod`, `TOTP.vue`, `General.vue`,
   `ShowTasks.vue`, `ProjectSettingsArchive.vue`, `services/notification.ts`,
   `abstractMigration.ts`, `services/attachment.ts`, `abstractService.test.ts`,
   `router/index.test.ts` (both sides' describe blocks are kept — different subjects),
   `IUserSettings.ts`, `userSettings.ts`, `models/user.ts` (add `pendingEmail = ''`),
   `message/index.ts` (fork's typed version plus upstream's `|| r` fallback), `main.ts`,
   `en.json`, `fetcher.ts` (both imports), `useTaskList.test.ts` (both describes),
   `ApiTokenForm.vue`, `SingleTaskInProject.vue`, `Description.vue`, `Comments.vue`,
   `AddTask.vue`, `ProjectList.vue` (fork's `isFiltered` argument stays), `highlighter.ts`,
   `config-raw.json` (upstream's comment text plus the fork's `activityretentiondays` key).
3. Popup port (rule above) — red-first, see Tests.
4. `getDateWithTime` date-only branch — red-first, see Tests.
5. Error code + fixture renumber.
6. `go mod tidy`; `pnpm install`.
7. Hand-review the hot list. Build + suite. Commit the merge.

### Phase B — merge `upstream/main`

1. `git merge --no-ff upstream/main`.
2. Label port per the rule. Skills relocation per the rule.
3. `pnpm install` (vue-query, openapi-ts). Build + suite. Commit the merge.
4. Hand-review: `git grep` for any surviving import of `stores/labels`, `services/label`,
   `services/labelTask`, `models/label`, `models/labelTask` — must be zero.

### After both phases

- FORK-CHANGES.md sync entry (prior-sync convention; record the task-detail layout change and
  the #88 reconciliation as fork-visible behavior changes).
- ADR-0004 gets a one-line "Confirmation" note: upstream's 2026-08 inert popup was evaluated and
  not adopted; its Escape/reclose/focus fixes were ported.

## Execution routing

- **executor-max** drives each phase's merge and conflict resolution — cross-file semantic
  reconciliation (access memo, view locking, #91 vs `defaultDueTime`). One serialized dispatch
  per phase; Phase B does not start until Phase A's suite is green and committed.
- **Driver** does the hand-review of the hot list after each phase, and the FORK-CHANGES /
  ADR-0004 notes.
- **No security agent.** Upstream's security-relevant commits (`2dc0eb78d` favorites access,
  `98362b24a` subtask expansion, `fc029c6af` pseudo-project writes, `32b7fdd73`) ship with
  their own tests; the fork's #88 tests cover the overlap.

## Tests

Red-first, written before the resolution they cover:

1. `Popup.test.ts` (upstream's file, adapted): Escape closes the focused popup and calls
   `preventDefault`; Escape already `defaultPrevented` is ignored; clicking the trigger while
   open closes and does not reopen; focus returns to the trigger on close. Any upstream case
   asserting closed content exists in the DOM is deleted.
2. `getDateWithTime.test.ts`: with `dateOnly` on, `getDateWithTime` returns end-of-day
   (23:59:59.999) regardless of `defaultDueTime`; with it off, `defaultDueTime` applies; with
   neither, nearest-hour (upstream's behavior).
3. `useQuickAddAutocomplete` / `TaskTitleField` existing tests pass against the label port
   with no assertion changes.

Required green, in order, after **each** phase (save output to files; never re-run to re-read):

1. `mage build`
2. `mage test:web`
3. `mage test:feature`
4. `mage lint`
5. `cd frontend && pnpm typecheck` — at or below the 5-error baseline
   (`typecheck-baseline.json`; `CreateEdit.vue` TS2590 + `task.test.ts` 0→4 carried)
6. `cd frontend && pnpm lint && pnpm test:unit` — baseline 1650; count must not drop below the
   union of fork + upstream tests
7. `pkg/web` `TestErrorCodesAreUnique` explicitly, and `mage test:filter TaskPosition`

## Verification

- Suite green as above, both phases.
- Live-verify (browser, per `.workflow.yaml`), all on the Phase B result:
  - Date-only on: quick-add "tomorrow" and the inline picker produce 23:59:59; date-only
    off with `defaultDueTime=09:30`: they produce 09:30; both settings visible.
  - Task detail: upstream's grouped actions render; favorite, delete (Backspace on macOS),
    and the back-link to the project behave; keyboard shortcuts from `SHORTCUTS.taskDetail`.
  - Popup: DeferTask on a list row opens, Escape closes it, clicking its trigger again closes
    it, focus lands back on the trigger; the Upcoming view's closed popups add nothing to
    the tab order.
  - Labels: quick-add `*label` autocomplete lists existing labels; the task title field
    resolves a label chip; the Labels page creates and deletes.
  - Kanban drag, task-position reorder in a saved-filter view (#88 surface).
- Deliver: `/pb`; prod reports a v2.6.0-based version; `desktop-build` if the bundle changed.

## Stop criteria

- A fork test and an upstream test assert contradictory behavior (the #88 six, the #91
  `formatDate` cases, the rollup cases).
- The access memo or null-parent change breaks the subproject rollup in a way a fixture edit
  cannot honestly fix.
- A single conflict resolution grows past ~150 lines of hand-written reconciliation.
- The label port needs anything upstream's `client/queries/labels.ts` does not export.
- v2 routes fail to compile against the bumped huma for a non-mechanical reason.
- Upstream's generated client must be hand-edited to compile.

## Execution Log

Built 2026-09-06 across two executor-max dispatches with a verifier round after each.
`ee4c49050` Phase A merge → `cbaabbcf9` Phase A review fixes → `88e94b7ce` Phase B merge → closeout.

### Deviations from this spec — read these first

1. **Task detail (`TaskDetailView.vue`) — the Resolution rule was not executable.** The rule says take
   upstream's grouped-actions layout. Upstream's action column calls 15 functions (`setFieldActive`
   ×13, `openAttachments`, `setRelatedTasksActive`) that the merged script does not define, because
   the fork replaced that column with `TaskPropertyChips` (7 `defineExpose` targets). Adopting the
   layout requires implementing 8 field editors — design work, past this spec's own "~150 lines of
   hand-written reconciliation" stop criterion. Resolved minimally and reversibly in one file: the
   fork's layout and dropdown stay, upstream's `SHORTCUTS.taskDetail.*` constants adopted throughout.
   The fork's local `deleteShortcut`/`reminderShortcut` and its `isAppleDevice` import were deleted as
   redundant — verified, not assumed: `constants/shortcuts.ts:28-29` reproduces the Apple-aware
   bindings exactly, and the 13 `v-shortcut` sites map 1:1 to the fork's pre-merge lines.
2. **`isFilteredView` dropped, against the rule "the fork's `isFiltered` argument stays."** The rule
   rested on a misattribution. `git log --format='%an'` on `useTaskListFiltering.ts` shows both
   commits that touched the parameter (`d895053d2`, `d59b2e1f7`) are `kolaente` — upstream code
   inherited by a prior sync, not a fork feature — and upstream deliberately reversed itself in
   `d59b2e1f7`, inverting its own test case in `useTaskListFiltering.test.ts`. The merge took upstream's
   function and test as-is; the fork has no stake in either. (The build's original note said keeping
   the argument "would not compile" — the old parameter was optional, so that was not the constraint;
   the audit corrected the wording.) Fork-visible effect: subtasks render nested only in saved-filter
   list views, not also as top-level rows.
3. **`magefile.go` `test:filter` taken from upstream, with a known residual.** Upstream runs `-short`
   for everything except `pkg/webtests`, but `pkg/caldavtests` and `pkg/e2etests` carry the same
   `testing.Short()` TestMain guard, so a filter aimed at either **prints `ok` having executed
   nothing** — and without the `[no tests to run]` suffix that marks a genuinely filtered package.
   Not patched: that would be a fork delta in an upstream-owned file to suppress an upstream defect,
   conflicting on every future sync. This spec's own gates were checked and genuinely execute
   (`TaskPosition` 36 subtests; `TestErrorCodesAreUnique` in `pkg/web`). Belongs in PITFALLS.
4. **Typecheck gate settled at 8** (Jason's call, this session). `main`'s `typecheck-baseline.json`
   budgeted 1 error in 1 file (`CreateEdit.vue`); the spec's "5-error baseline" was the plan session's
   count including the carried, unbudgeted `services/task.test.ts` regression. All three extra
   errors are in files byte-identical to `upstream/main` — `client/queries/labels.ts` TS2589, and
   `FilterAutocomplete.ts` TS2345 + `highlighter.ts` TS2322 from upstream's lockfile resolving two
   copies of `prosemirror-view`. The per-file ratchet (`typecheck-baseline.json`) was regenerated;
   this also retires the carried `services/task.test.ts` 0→4 regression by budgeting it, which had
   been failing CI (`.github/workflows/test.yml:415`). Every error the merge itself introduced —
   7 of them — was fixed, not budgeted. Rejected alternatives: `pnpm dedupe` (rewrites an
   upstream-owned lockfile, silently bumps prosemirror-view for three tiptap plugins) and patching
   the three files (fork deltas on brand-new upstream code).

### Regression found in review and fixed before merge

Upstream's project-access memo `getProjectAccessForUser` has no template filter, where the fork's
replaced `getUserProjectsStatement(..., includeTemplates=false)` did. Phase A re-applied it at
`project.go:604-607` and `task_search.go:624-631` but not on the memo path, so template projects
leaked into user stats, time entries, label visibility and notification scoping — breaking the
`GetUserStats`/`GetProjectTaskCounts` mirror invariant that `user_stats.go:69-72` asserts outright.
The verifier proved it by running a probe, not by reading. Fixed once at the seam
(`accessibleProjectIDsCond`, `builder.NotIn` on both branches) rather than at the five call sites,
red-first (`TestUserStatsExcludesTemplateProjects`). All 12 callers were enumerated; two judgment
calls in that fix are recorded in FORK-CHANGES (`checkPermissionsForProjects` deliberately unfiltered;
`fetchAccessibleSubtasks` filtered despite having no pre-merge baseline).

### Assumptions the reviewer should test

- **`EditLabels.vue` diverges from upstream deliberately**: the fork's `hasPersistedTask` branch is
  kept, so `createAndAddLabel` with `taskId === 0` creates a server-side label where upstream now
  returns early. Verifier checked for double-create and orphaning and found neither; orphan-on-cancel
  is the fork's pre-existing #57 behavior.
- **`services/task.ts` `processModel`** was the largest hand-written reconciliation (~45 lines) — the
  fork's object-building shape with upstream's semantics folded in. Verified field-by-field against
  both parents. The fork's `LabelService().processModel(l)` preprocessing is gone by the Labels rule.
- **`pkg/webtests/task_collection_test.go`**, 15 hunks of JSON blobs, was resolved by a mechanical
  rule and verified programmatically both times: stripping the four fork-only fields yields upstream's
  blob byte-for-byte on all 15.
- **`ILabel` was replaced, not aliased**, in 12 files. An alias would have been a one-file diff but
  keeps a fork-only parallel type upstream deleted.

### Not done in the build phase

Live-verify (browser) has not run — it is the review phase's step. The `.claude/skills` symlink
**blocks the merge to `main`**: the main checkout's `.claude/skills/` is a real directory still
holding untracked `checkpoint/`, `dev/` and `pb`, and git cannot replace it with a symlink while they
sit there; move them to `.agents/skills/` first. Note the branch already edited `.git/info/exclude`,
which lives in the shared git common dir, so the main checkout now reports
`?? .claude/skills/dev/SKILL.md` — harmless, and it clears when `dev` moves.

### Review fixes (2026-09-06, `/flow review`)

The verifier found the date-only resolution rule applied in both wrong directions, neither logged.
Fixed in-review, red-first, within the fix threshold (Jason's call):

- `dateParser.ts`: `getDateFromInterval` and the two month sites called `getDateWithTime` without
  the caller's `dateOnly`, so the store setting overrode the `false` that `reminderParser.ts`
  passes on purpose — quick-add reminders landed at 23:59:59.999 with date-only on. The parameter
  is now threaded through. Test: `dateParser.dateOnly.test.ts` "keeps a real time of day when the
  caller opts out".
- `TaskContextMenu.vue`: `dueDateForInterval` is a due-date site and still hand-rolled
  `calculateNearestHours`, so the context menu's quick due dates ignored `defaultDueTime`. It now
  calls `getDateWithTime`, which already carries the date-only branch. Test:
  `TaskContextMenu.test.ts` "gives a quick due date the user's default due time".

The verifier's `.gitignore` finding for `.agents/skills/dev` was refuted: `.git/info/exclude`
line 15 already covers it and `git check-ignore` confirms from both checkouts.

The cold audit (`.flow-audit.md`, preserved at `docs/context/flow-audit-sync-v260.md`) also found the two
backend tests upstream shipped red — `TestClaimMigrationTakesOverStaleClaim` and
`TestCleanupOldTokens/…pending_email_change` — fail only in a non-UTC local zone on SQLite (bound Go
local time vs stored UTC text); both pass with `TZ=UTC`. Upstream CI and the prod container run UTC.
`mage test:web` could not see them because it runs `pkg/webtests` only; `.workflow.yaml` `test_command`
is now `mage test:feature`.
