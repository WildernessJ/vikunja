# Spec: Sync fork with upstream through 2026-09-24

## Repository identity

- Integration branch: `main`
- Approved base: `d803c2b42` (rebased from `303f2c88e` on 2026-09-24; see Execution Log)
- Branch start: the approved base plus one or more planning commits that change only this spec and `docs/adr/ADR-0015-native-popover-and-datepicker.md`. The first phase merge goes on top of them.
- Upstream target: `upstream/main` at `06c451da400b3f4ab60353d1921909f8d35664c6`
- Merge base: `b922edc24794a56772096b68687d3fdc96a8ba2c`
- Feature branch: `sync-upstream-2026-09-24`
- Feature worktree: `../sync-upstream-2026-09-24` (sibling of the main checkout)
- Main-checkout memory path: `docs/context/` in the main checkout (local-only)
- Planning session: `01a0d3a9-f676-7412-9c93-a7ca184f9c4e`

Any change to the base SHA, upstream target SHA, or this spec makes approval stale. Fetching a newer `upstream/main` requires a revised spec and approval; execution must not silently widen the range.

## Intent

`main` is 289 commits behind the refreshed `upstream/main` and 410 commits ahead. Merge all 289 incoming commits according to ADR-0006, preserve the fork's observable behavior on top of upstream's new architecture, and produce a reviewed candidate suitable for merging back to `main`.

Incoming scope is large: 717 files, 38,973 insertions, 15,606 deletions. A direct dry-run merge reports 153 conflicted files. The dominant change is upstream's staged removal of legacy frontend models, model types, services, and Pinia domain stores in favor of the generated v2 client and TanStack Query. Other material changes include:

- native Popover API/floating-ui popups, mobile bottom sheets, and a native date picker replacing flatpickr;
- per-project task-index counters and historical task-index aliases;
- admin-managed invite links;
- MCP transport, API-token scopes, and v2 route exposure;
- asynchronous imports with claim heartbeats, persisted outcomes, and stored uploads;
- project/view/background/filter/share/team/user/task/kanban/attachment/reaction/comment/subscription/time-entry query migrations;
- websocket events reconciled through query mutations;
- OIDC email-link fallback, CalDAV UTC parsing, restore fixes, and API pagination limits;
- dependency and translation updates after v2.6.0, with no newer release tag.

### Deliverable

Four ordered upstream merge commits on `sync-upstream-2026-09-24`, each independently buildable and verified at its stated gate, then the Phase E E2E triage commits (added 2026-09-25), then closeout documentation. The final candidate contains every commit through `06c451da4`, no unresolved markers, no resurrected compatibility layer for upstream-deleted frontend architecture, and no loss of fork-visible behavior.

### Exclusions

- No cherry-picking or dropping upstream commits.
- No new fork feature unrelated to preserving an existing fork behavior.
- No redesign of upstream's generated-query architecture.
- No hand edits under `frontend/src/client/generated/` or `pkg/swagger/`.
- No compatibility aliases for deleted `models`, `modelTypes`, `services`, or domain stores.
- No translation work outside source English strings.
- No fix for carried issue #101 (DST-sensitive Gantt geometry) unless upstream makes the existing behavior uncompilable; otherwise record any changed exposure as residual risk.
- No push, production deployment, issue closure, desktop rebuild/install, worktree removal, or branch deletion without separate authorization after merge approval.

## Design and alternatives

### Merge strategy

Use full merge commits, not rebase or cherry-picks, per ADR-0006. Split the linear incoming range at upstream's architectural stack boundaries:

| Phase | Target | Commits | Scope | Cumulative dry-run conflicts from current base |
|---|---|---:|---|---:|
| A | `fcae90a3673fca88c194c9b569129e473f26c84c` | 125 | backend features/fixes, task indexes, native popup/date picker, invites, MCP, import pipeline | 34 |
| B | `8fb91c4e10dfb4e933389ad4b6c7f0ebae7869c4` | 92 | generated-query foundation and project/view/background/filter/share/team/user migration | 108 |
| C | `a913bf4793b1687fd7b84a7dc559d039de5bffd7` | 34 | task/kanban generated-query migration and pagination helpers | 144 |
| D | `06c451da400b3f4ab60353d1921909f8d35664c6` | 38 | attachments, reactions, comments, subscriptions, time tracking, websocket reconciliation, latest fixes | 153 |

The cumulative counts are reconnaissance, not estimates of each phase's final conflicts: each earlier resolution changes the next merge base. The split is still required. A single 153-conflict merge would make backend, popup/date, project-query, and task-query decisions inseparable and would prevent meaningful green checkpoints.

### Global resolution rules

1. **Upstream architecture wins; fork behavior is ported.** Resolve standard upstream-owned consumers to the generated client and TanStack Query. Preserve fork behavior by moving it to upstream's new seam, not by retaining the deleted seam.
2. **Clean cutover.** Delete upstream-deleted legacy project/task/kanban/team/share/attachment/comment/reaction/subscription/time-entry models, model types, services, and stores. Migrate every surviving fork caller in the same phase. No aliases or deprecated wrappers.
3. **Generated client is generated.** Resolve backend models/routes first, run `mage generate:frontendClient`, and use the generated snake_case types. Never manually reconcile generated files. `mage check:frontendClient` must prove repeatability.
4. **Fork fields remain first-class.** The combined OpenAPI/client must retain deadline, estimated duration, RRULE recurrence, recurring reminders, template/activity/stats/counts/push routes, roll-up query parameters, view default sort, and all other current fork API fields. Missing generated fields are a backend/schema defect, not a reason to cast or augment generated types locally.
5. **Tests follow observable behavior.** Keep and adapt tests for fork behavior. Delete tests whose only subject is an upstream-deleted model/service/store implementation; do not recreate the implementation to satisfy them. Add tests only at new reconciliation seams where a plausible omission would change behavior.
6. **Dependencies are recomputed.** For `go.sum`, keep the merged Go source and run `go mod tidy`, staging both `go.mod` and `go.sum`. For `pnpm-lock.yaml`, keep the merged manifest and run `pnpm install`; do not hand-merge lockfile entries.
7. **Translations.** Preserve fork English keys in `frontend/src/i18n/lang/en.json` and `pkg/i18n/lang/en.json`; take upstream Crowdin updates for non-English locales.
8. **Agent guidance.** Adopt upstream's progressive-disclosure `AGENTS.md` plus `.agents/docs/` structure. Preserve any fork-only policy that is not represented there once, without duplicating upstream guidance.
9. **Error/fixture collisions.** Upstream owns contested error codes and fixture IDs. Renumber fork values and every reference; `TestErrorCodesAreUnique` and the complete fixture-backed suite must pass.
10. **Migrations.** Keep all incoming migration IDs unchanged. Review the two `20260901*` task-index migrations specifically against an existing database where the fork's `20260908*` closure-table migration is already recorded. The migrations are independent and must work when applied late; do not renumber them merely to make timestamps monotonic.

### Popup and date picker decision

Adopt upstream's native Popover API/floating-ui `Popup`, mobile sheet behavior, and native date picker. Delete flatpickr and `vue-flatpickr-component`. This supersedes ADR-0004's implementation choice because upstream has now paid the previously rejected whole-app migration cost and supplies browser-managed light-dismiss, top-layer clipping avoidance, positioning, and mobile behavior. ADR-0015 records the decision.

The fork's behavioral requirements remain:

- a closed popup is not visible or keyboard-focusable;
- Escape/light-dismiss/trigger-close behavior remains deterministic;
- focus behavior is tested on real consumers;
- consumers needing mount-on-open semantics gate slot content with `v-if="isOpen"` rather than forking `Popup`;
- date-only mode still hides time controls, stores due/end at 23:59:59.999 and start at 00:00:00.000, leaves time-bearing reminders/tracking/recurrence alone, and wins over `defaultDueTime`;
- Gantt create/drag/resize, Defer, calendar create, context-menu quick dates, quick-add, and inline/detail pickers retain ADR-0014 semantics.

### Semantically hot reconciliations

| Area | Required outcome |
|---|---|
| `pkg/models/tasks.go` and task-index migrations | Take upstream's row-locked per-project counter, aliases, import index preservation, and batched inserts. Preserve fork task fields, validation, repeating-task bucket routing, done-bucket hardening, completion events, bulk behavior, and permissions. |
| `pkg/models/project_duplicate.go` | Use upstream's batch duplicate/index allocation. Preserve stable view order, template modes/share suppression, parent permission checks, faithful legacy bucket copies, done reset on template instantiation, and RRULE/repeat-from-completion copy. |
| `pkg/modules/migration/migration_status.go` | Take upstream heartbeat, persisted error/outcome, upload ownership, and background execution. Preserve UTC cutoff normalization from `23a654566` in every stale-claim comparison, with UTC and non-UTC tests. Upstream's heartbeat rewrite (`68ac9eaa9`) builds the cutoff as `time.Now().Add(-timeout).In(config.GetTimeZone())`. Replace it with `.UTC()` in both `COALESCE(heartbeat_at, started_at) <` queries: the database stores GMT (`pkg/db/db.go:122-126`) and xorm does not convert `Where` arguments, so the configured-zone cutoff is wrong whenever the configured timezone is not UTC. If an upstream test asserts the configured-zone cutoff, adapt it to the UTC contract; this is a fork divergence, not a contradictory user-visible contract. |
| Admin users and invites | Keep upstream `CreateUserOptions{SkipEmailConfirm: ...}` and invite-link lifecycle. Preserve the fork invariant that a post-commit reload failure cannot report account creation as failed or drop queued creation events. |
| MCP/API tokens/v2 routes | Take upstream routes and token scope model. Review authentication, explicit operation exposure, locked permissions, loopback dispatch, and no accidental exposure of fork-only admin or destructive routes. Invoke the `api-v2-routes`, `crudable`, and `migration` skills before modifying these areas. |
| OIDC email linking | Review the username-miss/email-fallback branch as security-sensitive: only the intended provider/account case links, ambiguous or existing-account cases retain upstream's tested rejection behavior, and no fork auth behavior is weakened. |
| CalDAV/restore | Preserve fork RRULE/deadline/duration semantics while taking upstream UTC parsing and restore conversions. Run uncached CalDAV tests separately because `mage test:feature` can skip that package. |
| Generated client | Regenerate from the merged backend after each backend-affecting phase. Combined types must include every fork field and route; no local interface overlays. |
| Project query migration | Port sidebar nesting, drag rollback, navigation visibility, project counts/badges, overview include/exclude, templates, activity, stats, roll-up controls, default list sort, saved-filter behavior, project colors, and history/returnability to upstream project/view query and mutation seams. |
| Task/kanban query migration | Port quick-add composer/autocomplete/reminder precedence, deadline/duration/RRULE fields, list-row urgency layout, context menu, property-chip task detail, calendar, Gantt, roll-up filters, favorite/reorder rollback, stale-response protection, badge/count refresh, and done/default bucket behavior. Extend upstream task write/query helpers with generated fork fields; do not revive `useTaskStore`. |
| Counts and app badge | Replace the deleted task-store refresh hook with one query-owned counts seam. Task create/update/delete/move/defer/Gantt and websocket changes invalidate/refetch it; navigation and `useAppBadge` consume the same result so sidebar and app badge cannot diverge. |
| Attachments/comments/reactions/subscriptions/time tracking | Take upstream query-owned data, mutation bookkeeping, local drafts, and deletion of legacy layers. Preserve fork task-detail layout and fields while using those query hooks. |
| Websocket | Take upstream stale-connection rejection and mutation-based reconciliation. Verify fork counts/badge and custom task fields update or invalidate correctly rather than maintaining a parallel socket path. |
| Model normalization | Do not preserve `*Model` instance identity after its layer is deleted. Preserve consumer-visible defaults/date parsing at query/helper boundaries; retire implementation-only model-normalization tests. |
| Typecheck | The approved base passes `pnpm typecheck` with zero errors, and the fork deleted its per-file ratchet in `183e0ca86`/`d803c2b42` (upstream never had one). Keep full typecheck green; do not restore a budget or accept new errors. In `.github/workflows/test.yml`, keep the fork's gating `pnpm typecheck` step over upstream's `continue-on-error`. |

## Implementation plan

### Phase A — backend, native popup/date picker, invites, MCP, imports

1. Revalidate base, target, worktree cleanliness, and phase-target ancestry. The approved base must be an ancestor of `HEAD`, and `git diff --name-only <approved base> HEAD` must list only this spec and ADR-0015. Stop if the base, the upstream target, or a phase target differs, or if that diff lists any other file.
2. Invoke `migration`, `crudable`, and `api-v2-routes` skills before touching their governed files.
3. Merge `fcae90a3673fca88c194c9b569129e473f26c84c` with `--no-ff` and no auto-commit.
4. Resolve the 34-file dry-run set using the global rules. Backend conflict files include `admin_user_create.go`, `events.go`, `models.go`, `project_duplicate.go`, `tasks.go`, `migration_status.go`, and its tests. Frontend conflict focus is Popup/native datepicker/date-only plus task-detail consumers.
5. Adopt upstream Popup/native date components and remove flatpickr. Port date-only behavior at the native `DatepickerInline`/date-helper boundary and adapt consumers; no parallel picker.
6. Resolve `go.mod`/`go.sum` via `go mod tidy`; install frontend dependencies via `pnpm install`.
7. Regenerate the frontend client from the combined backend, then run the Phase A gate.
8. Commit one Phase A merge commit only after the gate is green.

### Phase B — project and sharing query cutover

1. Merge `8fb91c4e10dfb4e933389ad4b6c7f0ebae7869c4` with `--no-ff` and no auto-commit.
2. Take upstream query modules for projects, project views, backgrounds, saved filters, link shares, project shares, teams, memberships, and user search.
3. Delete replaced legacy layers. Port all fork project/navigation/template/activity/stats/count/roll-up/default-sort callers to generated types and query mutations.
4. Add the single project-counts query seam used by sidebar counts and `useAppBadge`; do not keep a second Pinia-owned copy of the same server state.
5. Preserve project drag nesting and failure rollback through upstream's project mutation lifecycle. Preserve template exclusion and pseudo-project/saved-filter rules.
6. Regenerate the client if merged backend/schema changes require it, run the Phase B gate, and commit one Phase B merge commit.

### Phase C — task and kanban query cutover

1. Merge `a913bf4793b1687fd7b84a7dc559d039de5bffd7` with `--no-ff` and no auto-commit.
2. Take upstream task/kanban query, cache, mutation, quick-add, pagination, and legacy-layer deletion.
3. Port every fork task surface listed in the hot-reconciliation table. Generated `Task`/`TaskWritable` are the only task DTOs. Extend upstream normalization/write lists with generated fork fields.
4. Route all task mutations through upstream mutation hooks/options. Invalidate counts through the Phase B seam. Preserve board paging rules and avoid refetching boards after ordinary task mutations.
5. Port fork quick-add parsing and override precedence into upstream `useQuickAddTask`/`buildQuickAddTask`; preserve label-failure reporting once, not once per layer.
6. Port Calendar and Gantt to query-owned task lists/mutations, preserving date-only and roll-up behavior. Keep task-detail property chips and context menu as fork UI over upstream query state.
7. Delete obsolete task/project/kanban service/store/model tests; adapt observable behavior tests to real query clients and generated-client mocks.
8. Run the Phase C gate and commit one Phase C merge commit.

### Phase D — remaining query domains and websocket

1. Merge `06c451da400b3f4ab60353d1921909f8d35664c6` with `--no-ff` and no auto-commit.
2. Take upstream attachment, reaction, comment, subscription, time-entry, and websocket query ownership. Port fork task-detail consumers and custom fields without adapters.
3. Review latest API pagination, OIDC, Sentry, error handling, and dependency updates.
4. Search for imports of every upstream-deleted legacy path and remove all survivors. Search for conflict markers and for runtime flatpickr imports, selectors, and dependencies.
5. Regenerate/check the frontend client, run the final automated gate, and commit one Phase D merge commit.

### Phase E — E2E triage (added by the 2026-09-25 plan session)

No new upstream merge. Phase E repairs the 27 E2E failures that are new against the `main` baseline. The full list, by bucket, is in the Execution Log entry "Plan — E2E acceptance bar". The 79 failures shared with `main` are out of scope (#112). The three pre-existing `check:all` failures are out of scope (#113).

1. **E1 — tests that passed on `main` (8).** Find the cause of each failure before you change anything.
   - If the test waits for or mocks a v1 request that the frontend now sends to v2, or reads a v1 response shape, rewrite the test for the v2 request and response. Keep every user-visible assertion.
   - If the product behaviour changed, fix the product code. `toolbar-navigation` has no known cause yet. Treat it as a product regression until the evidence shows otherwise.
2. **E2 — upstream-added tests that assert fork-relevant behaviour (9).** The asserted behaviour must work in the fork UI. You can change selectors and navigation to reach the fork controls (property chips, quick-add composer). Do not weaken or delete an assertion. If the behaviour is missing, fix the product code. These tests are the three `task-cache-pseudo-boards` tests, the detail→list/kanban edit and delete tests, the removed-assignee test, `subscription` survives reload, and the two `mobile-bottom-sheet` tests.
3. **E3 — upstream-added tests that drive upstream's task-detail `.action-buttons` sidebar (10).** The fork replaced that sidebar with property chips. The chips open the same native popups (ADR-0015).
   - If the fork has an equivalent control, point the test at it and keep the assertions. This applies to the due-date popup keyboard and focus tests, the start/end date tests, and the keyboard label creation test.
   - If the fork has no equivalent control, mark the test `test.fixme` with a one-line reason that names this spec. Record it as an accepted divergence in the Execution Log and in the closeout `FORK-CHANGES.md` entry. `bucket-select` "above the remove assignee buttons" is the likely case.
   - Do not rebuild the sidebar to make a test pass.
4. Every `test.fixme`, `test.skip`, or deleted test is listed in the Execution Log with its reason. An unlisted skip fails review.
5. Run the Phase E gate and commit. Phase E can be one commit or several; each commit must build.

### Closeout

1. Update ADR-0004 to `Superseded by ADR-0015`; mark ADR-0015 enacted only after the native popup/date stack is merged and verified.
2. Add one `FORK-CHANGES.md` entry describing the upstream target, four-phase merge, architectural cutover, Popup decision, and any fork-visible behavior changes or accepted residuals.
3. Review each merge with `git show --cc <merge>`; this is the manual-resolution artifact. Separately review semantically hot auto-merges named above.
4. Confirm the final ancestry includes the exact upstream target and all four phase targets.
5. Write the build report and manually record its producing session ID beside it. Reports remain evidence inputs; their presence is not acceptance.

## Execution routing

Manual single executor. One executor owns all four phases serially; no parallel conflict resolution, because project/task query seams and generated types are order-dependent. A phase does not begin until the prior phase is committed and its gate is green. Reviewer and verifier are fresh sessions and do not edit product source; findings return to an executor.

## Tests

### Existing tests that must retain pressure

- Backend task creation/import/duplication/index tests, including template duplication and RRULE/repeat-from-completion.
- Bucket default/done invariants, stale bucket IDs, repeating-task routing, task position scoping, and v1 path/body binding tests.
- Migration claim concurrency/staleness tests in UTC, `America/New_York` and `Asia/Tokyo`, including a claim just inside the timeout so a cutoff shifted east of UTC fails. Extend them to the heartbeat path.
- Date-only helper, picker, Gantt, Defer, Calendar, context-menu, quick-add, and display tests.
- Quick-add composer/autocomplete/reminder precedence and label-failure behavior.
- Project roll-up, exclusions, default sort, navigation drag, counts/badge, template/activity/stats, task detail, context menu, and list urgency behavior.
- Upstream query lifecycle/cache tests, websocket stale-connection tests, invite/MCP permission tests, migration tests, OIDC tests, and generated-client check.

### New or materially rewritten regression tests

1. Native `DatepickerInline`: date-only hides `TimeControl`; calendar/shortcut picks emit the correct start/end boundary; `forceTime` consumers retain a real time; `defaultDueTime` loses to date-only.
2. Popup consumer behavior: desktop light-dismiss/Escape/trigger close and mobile sheet; closed content is not visible or focusable. Do not assert incidental DOM presence globally.
3. Combined backend/client task contract: a real API-level create/update round trip retains deadline, estimated duration, RRULE, recurring reminders, and date-only timestamps through generated-client consumers.
4. Task/project mutation integration: create/update/delete/defer/Gantt/websocket changes refresh the one counts result observed by sidebar and app badge; verify the visible count, not callback wiring.
5. Task-index migration/duplication/import: old identifiers resolve after moves/imports, counters never reuse indexes, and template duplication preserves fork recurrence fields.
6. Existing-database migration order: apply outstanding `20260901*`, `20260911*`, and `20260914*` migrations to a database whose `20260908*` migration is already recorded; data and schema remain valid.

Tests that only assert deleted model constructors, service forwarding, Pinia field copies, or mock echoes are removed rather than repinned.

## Verification

Every command saves output on its first run. Read the saved file; do not rerun merely to filter output.

### Phase A gate

```bash
mage generate:frontendClient 2>&1 | tee /tmp/sync-a-generate-client.log
mage check:frontendClient 2>&1 | tee /tmp/sync-a-check-client.log
mage check:golangciFix 2>&1 | tee /tmp/sync-a-go-lint.log
mage build 2>&1 | tee /tmp/sync-a-build.log
GOFLAGS=-count=1 mage test:feature 2>&1 | tee /tmp/sync-a-feature.log
GOFLAGS=-count=1 mage test:caldav 2>&1 | tee /tmp/sync-a-caldav.log
GOFLAGS=-count=1 mage test:e2EApi 2>&1 | tee /tmp/sync-a-api-e2e.log
cd frontend
pnpm lint:fix 2>&1 | tee /tmp/sync-a-lint.log
pnpm lint:styles:fix 2>&1 | tee /tmp/sync-a-stylelint.log
CI=true pnpm typecheck 2>&1 | tee /tmp/sync-a-typecheck.log
CI=true pnpm run test:unit 2>&1 | tee /tmp/sync-a-unit.log
CI=true pnpm build 2>&1 | tee /tmp/sync-a-frontend-build.log
cd ..
```

Expected: all commands exit zero; typecheck reports no TypeScript errors; combined client is reproducible; migration/CalDAV/API suites execute uncached; no conflict markers.

### Phase B gate

```bash
mage check:frontendClient 2>&1 | tee /tmp/sync-b-check-client.log
cd frontend
pnpm lint:fix 2>&1 | tee /tmp/sync-b-lint.log
pnpm lint:styles:fix 2>&1 | tee /tmp/sync-b-stylelint.log
CI=true pnpm typecheck 2>&1 | tee /tmp/sync-b-typecheck.log
CI=true pnpm run test:unit 2>&1 | tee /tmp/sync-b-unit.log
CI=true pnpm build 2>&1 | tee /tmp/sync-b-frontend-build.log
cd ..
mage build 2>&1 | tee /tmp/sync-b-build.log
```

Expected: zero type errors; project/navigation/share/team/filter consumers compile only against generated/query APIs; no deleted legacy import survives; fork project behavior tests pass.

### Phase C gate

```bash
mage check:frontendClient 2>&1 | tee /tmp/sync-c-check-client.log
mage check:golangciFix 2>&1 | tee /tmp/sync-c-go-lint.log
mage build 2>&1 | tee /tmp/sync-c-build.log
GOFLAGS=-count=1 mage test:feature 2>&1 | tee /tmp/sync-c-feature.log
cd frontend
pnpm lint:fix 2>&1 | tee /tmp/sync-c-lint.log
pnpm lint:styles:fix 2>&1 | tee /tmp/sync-c-stylelint.log
CI=true pnpm typecheck 2>&1 | tee /tmp/sync-c-typecheck.log
CI=true pnpm run test:unit 2>&1 | tee /tmp/sync-c-unit.log
CI=true pnpm build 2>&1 | tee /tmp/sync-c-frontend-build.log
cd ..
```

Expected: task/kanban/quick-add/calendar/Gantt/detail tests pass; zero type errors; all fork task fields are generated and round-trip; no task/project/kanban store or service remains as an adapter.

### Final Phase D gate

Invoke the `run-e2e-tests` skill before the Playwright command.

```bash
mage generate:frontendClient 2>&1 | tee /tmp/sync-final-generate-client.log
mage check:frontendClient 2>&1 | tee /tmp/sync-final-check-client.log
mage check:golangciFix 2>&1 | tee /tmp/sync-final-go-lint.log
mage build 2>&1 | tee /tmp/sync-final-build.log
GOFLAGS=-count=1 mage test:feature 2>&1 | tee /tmp/sync-final-feature.log
GOFLAGS=-count=1 mage test:caldav 2>&1 | tee /tmp/sync-final-caldav.log
GOFLAGS=-count=1 mage test:e2EApi 2>&1 | tee /tmp/sync-final-api-e2e.log
mage check:all 2>&1 | tee /tmp/sync-final-check-all.log
cd frontend
pnpm lint:fix 2>&1 | tee /tmp/sync-final-lint.log
pnpm lint:styles:fix 2>&1 | tee /tmp/sync-final-stylelint.log
CI=true pnpm typecheck 2>&1 | tee /tmp/sync-final-typecheck.log
CI=true pnpm run test:unit 2>&1 | tee /tmp/sync-final-unit.log
CI=true pnpm build 2>&1 | tee /tmp/sync-final-frontend-build.log
cd ..
mage test:e2e "" 2>&1 | tee /tmp/sync-final-e2e.log
```

Expected: every command exits zero; no Go test line is accepted as evidence when marked `(cached)`; full frontend typecheck is clean; full unit and E2E suites include both upstream and surviving fork cases; production builds complete.

**Amended 2026-09-25 (plan session):** two exceptions to "every command exits zero". Both are pre-existing on `main`:

- `mage check:all` can fail only on the three checks in #113 (24 dead translation keys, stale swagger, stale yaegi symbols). Any other failing check fails the gate. Restore the files the check rewrites before you commit.
- `mage test:e2e ""` is judged by the Phase E gate, not by its exit code.

### Phase E gate

Invoke the `run-e2e-tests` skill before the Playwright command. Run the full suite once, after the last Phase E commit:

```bash
mage test:e2e "" 2>&1 | tee /tmp/sync-phase-e-e2e.log
```

Extract the failing test titles as `file › describe › title`, without line numbers. PITFALLS: compare by title, because upstream edits move line numbers. Expected: every failing title is in the 79-title list in #112. No other title fails. The 27 titles in the Execution Log entry "Plan — E2E acceptance bar" pass, or are `test.fixme` under the Phase E rule 3 exception. If Phase E changed product code, run the Final Phase D gate's frontend lint, typecheck, unit, and build commands again and read their output.

### Structural checks

- `git merge-base --is-ancestor 06c451da400b3f4ab60353d1921909f8d35664c6 HEAD` exits zero.
- Search returns no unresolved conflict marker.
- Search returns no import of an upstream-deleted legacy model/service/store path.
- Search returns no runtime import, dependency, or selector for `flatpickr` or `vue-flatpickr-component`; historical docs may name the removed stack.
- `git show --cc` for each phase merge is reviewed line-by-line.
- `git status --short --branch` is clean before review handoff.

## Live acceptance check: YES

Rationale: native popovers/mobile sheets, the native date picker, SortableJS drag behavior, focus/light-dismiss behavior, and the fork's custom list/detail/sidebar surfaces are directly observable and not adequately established by automated evidence. PITFALLS records that native SortableJS drag is not reliably Playwright-drivable.

### Human scenario

Use a disposable project containing at least two Kanban buckets and one child project.

1. Turn date-only mode on. Create a task through the quick-add composer with a due date, label, and reminder. Open the native due-date picker from task detail, choose another day, close it with Escape, reopen it, and save.
2. In List view, open the task's right-click menu, change priority, and defer it. Open task detail and change one property chip. Reload the page.
3. Drag the task between Kanban buckets. Reload the board.
4. Drag the child project to a different parent in the sidebar. Reload the page.
5. Narrow the browser to a phone-sized viewport and open the due-date picker once.

### Factual observations requested from the human

- The date picker opens without clipping; in date-only mode it shows no time control; Escape closes it; reopening works.
- The quick-add composer, right-click menu, custom task-detail chips, and urgency-style list row remain present and readable; no raw translation key is visible.
- The changed due date, priority, defer, and property-chip value are still visible after reload.
- The task remains in the destination bucket after reload.
- The child project remains under the destination parent after reload.
- At phone width the picker appears as a usable bottom sheet rather than an off-screen popup.

### Workflow-owned technical checks

The workflow, not the human, verifies API payload timestamps, database persistence, query invalidation, permissions, task-index aliases, migration state, test output, exit status, and technical correctness.

### Plain-English expected behavior

The merged app behaves like the current fork while using upstream's new popup, date, generated-client, query-cache, and websocket implementations. Changes survive reload and interactive overlays remain usable on desktop and phone layouts.

### Plain-English failure behavior

Any missing fork control, lost value after reload, stale count, wrong drag destination, clipped/unusable overlay, visible raw translation key, or date-only picker showing a time control fails acceptance and returns the phase to execution.

## Cold audit: YES

Rationale: 289 commits, 153 direct-merge conflicts, irreversible migrations, security-sensitive auth/API-token/MCP changes, and a frontend state-ownership rewrite can lose behavior while all local conflict markers are resolved. Cold Pass 1 reviews the candidate without this spec or the decision ledger. The same auditor receives the complete reviewer ledger in the next turn for Pass 2. Both Spec-conformance and Correctness judgments remain separate.

## Stop criteria

- Base, upstream target, phase target, or spec revision differs from the approved identity.
- A phase cannot become buildable without retaining or recreating an upstream-deleted legacy domain layer.
- The generated client must be hand-edited, locally augmented, or cast around a missing fork field/route.
- A fork behavior test and upstream behavior test assert genuinely contradictory user-visible contracts.
- An incoming migration cannot safely apply after the already-recorded fork `20260908*` migration, loses data, or requires renumbering upstream history.
- Full `pnpm typecheck` cannot remain at zero errors without a new baseline or suppression.
- One reconciliation requires more than roughly 150 lines of bespoke bridging instead of porting to an existing upstream query/helper seam.
- A fork-visible feature from `FORK-CHANGES.md` is absent and has no explicit accepted replacement.
- A security review finds an MCP, invite, API-token, OIDC, or permission path broader than upstream's documented/tested intent.
- After one correction round, a fresh review finds another omission in the same migration class; revert that phase and split/redesign it rather than layering another patch.
- Live acceptance fails any listed factual observation.
- Phase E: an E1 or E2 behaviour is missing and the product fix needs more than roughly 150 lines, a new file outside `frontend/tests/e2e/`, or a change to upstream's query architecture. Stop, log it, and return it to a plan session.
- Phase E: an E3 test can pass only if you rebuild upstream's `.action-buttons` sidebar or a part of it. Mark it `test.fixme` as accepted divergence (rule 3). Do not stop the build.
- Phase E: the full-suite run shows a failing title that is not in #112 and not in the 27. Fix it if it is one of Phase E's own changes. Otherwise stop and log it.

## Execution Log

### Planning reconnaissance — 2026-09-24

- `git pull --ff-only`: already up to date.
- Refreshed `upstream/main`: `11e414f07` -> `06c451da4`.
- Divergence after fetch: fork 407 ahead / 289 behind.
- Base and intended main worktree were clean; `main` was six commits ahead of `origin/main` at the supplied approved SHA.
- Created branch/worktree through `mage dev:prepare-worktree`: `../sync-upstream-2026-09-24`.
- Direct dry-run merge: 153 conflicted files; aborted cleanly.
- Phase dry runs from the approved base: A 34 conflicts, cumulative B 108, cumulative C 144; each aborted cleanly.
- Incoming delta: 717 files, 38,973 insertions, 15,606 deletions. Upstream deletes 96 files, mainly legacy frontend layers.
- Base `pnpm typecheck` completed with zero errors; output: `/tmp/vikunja-sync-base-typecheck.log`.
- Planning artifacts: this spec and ADR-0015 only.
- Producing planning session: `01a0d3a9-f676-7412-9c93-a7ca184f9c4e`.

### Base rebase — 2026-09-24

- Rebased `sync-upstream-2026-09-24` from `303f2c88e` to `d803c2b42` (fast-forward; the branch had no commits of its own). The three new base commits are `d8022920d` (fold `AGENTS.fork.md` into `CLAUDE.md`), `183e0ca86` and `d803c2b42` (UTC-cutoff test follow-up, typecheck ratchet removal, records). 12 files changed.
- Divergence at the new base: fork 410 ahead / 289 behind; upstream target unchanged at `06c451da4`.
- Direct dry-run merge from the new base: 153 conflicted files, the same as before; aborted cleanly. Phase dry runs from the new base match the earlier ones: A 34, cumulative B 108, cumulative C 144, D 153 (125, 92, 34 and 38 commits); each aborted cleanly.
- `CLAUDE.md` now holds the fork guidance (no `AGENTS.fork.md`). Upstream's `AGENTS.md` split into `.agents/docs/` makes two `CLAUDE.md` lines stale: the pointer to "Development Commands in `AGENTS.md`" and the layout note in "Corrections to AGENTS.md". Update them in this sync.
- Absolute local paths in this spec were replaced with relative ones. The fork is public.

### Build — Phase A (`fcae90a36`) — 2026-09-24

- Identity revalidated: base `d803c2b42` ancestor of HEAD, branch diff = spec + ADR-0015 only, `upstream/main` = `06c451da4`, all four phase targets ancestors of it (125/217/251/289 commits from the merge base).
- Dry-run prediction held: 34 conflicted files.
- Backend resolutions:
  - `admin_user_create.go`: took upstream. `user.CreateUser` now sets the returned status itself (`CreateUserOptions{SkipEmailConfirm}`), so the fork's status-sync block is redundant. The post-commit reload fallback (fork invariant) is untouched.
  - `project_duplicate.go`: upstream batch `createTasks(..., preserveIndexes=true)` plus the fork's template done-reset inside the loop.
  - `tasks.go` `hardDeleteTask`: both deletes (fork activities, upstream task-index aliases).
  - `migration_status.go`: upstream heartbeat structure; `staleBefore` is `.UTC()`, not `.In(config.GetTimeZone())`.
  - **Scope note:** `import_upload.go:cleanupImportUploads` (new upstream code) copied the same configured-zone cutoff. Fixed to `.UTC()` under the spec's "every stale-claim comparison" rule; an early run deletes a live import's upload.
  - **Test-helper change:** `runInCleanupTimezones` now also sets `service.timezone`. Before, tests ran with service zone GMT, so `.In(config.GetTimeZone())` was indistinguishable from `.UTC()`. Heartbeat tests are wrapped in the helper; added `TestClaimMigrationHeartbeatInsideTimeoutIsNotTakenOver` and an upload-cleanup boundary subtest. Mutation check: reverting both cutoffs to `.In(config.GetTimeZone())` fails 6 tests in `Asia/Tokyo`/`America/New_York` (`/tmp/sync-a-tz-mut.log`).
  - `go.sum` via `go mod tidy`.
  - `createTasks` reached gocyclo 31 (fork RRULE validation + upstream `preserveIndexes`); extracted `prepareTasksForCreation`.
- Migrations (spec test 6): **spec correction** — `20260908202544` (project_ancestors) is an *upstream* migration already in the merge base, not a fork one. The late-application concern still holds (upstream added `20260901*` after `20260908` was recorded). Fork migrations since the merge base are all `202607xx` and only add `tasks` columns the upstream migrations do not read. Added `pkg/migration/late_upstream_migrations_test.go`: real `xormigrate` runner, fresh schema, the six upstream migrations rolled back and unrecorded with `20260908202544` recorded, then `Migrate` — all six apply, counters backfill to max index, ancestors untouched. Negative check confirmed it executes.
  - Upstream also edited already-applied `20260720120000` (skips one index on pre-v2.5.0 upgrades). No effect on this database.
- Frontend: adopted upstream native `Popup`, `Datepicker`, `DatepickerInline`, range pickers; deleted `Flatpickr.vue` and `useFlatpickrLanguage` users.
  - Date-only ported into `DatepickerInline` (`boundary`, `forceTime`, `TimeControl` hidden, calendar and shortcut picks snap to day boundary, date-only wins over `defaultDueTime`) and `Datepicker` (props pass-through, date-only display/summary).
  - `PropertyChip`: upstream `Popup` has no `openImperatively`/`hasOverflow`. Ported to `v-model:open` + `v-if="isOpen"` content gating (spec's mount-on-open rule). `has-overflow` removed from its two callers (top layer makes it moot).
  - `Heading.vue`: upstream dropped the second close button (Modal renders its own from tablet up); the fork had already moved the title out, so the conflict resolved to neither side.
  - `TaskDetailView.vue`: fork property-chip layout kept; upstream's hunks only reworked the old field columns the fork removed.
  - `SingleTaskInProject.vue`: fork two-row layout kept; upstream's anchored/sheet due-date popup props applied to the fork's due-date button.
  - `DeferTask.vue`: upstream native picker + debounce; fork task-store routing, `saving` state and date-only normalisation kept.
  - `message/index.ts`: upstream cause lookup ported onto the fork's typed `ErrorLike`.
  - Auto-merge left `faFlagCheckered` imported twice in `Icon.ts` (parse error); deduplicated.
- Regenerated client adds fork types/routes the merged generated files lacked (activity, template instantiation, …). `check:frontendClient` idempotence passed pre-commit; its porcelain check can only pass once the merge is committed, so it is re-run after the commit.
- Typecheck repairs of upstream code (upstream CI runs typecheck with `continue-on-error`): `Multiselect` generic refs (`Ref<T[]>` cast), `highlighter.test.ts` (`Decoration` internal `type`), `labels.ts` TS2589 (`translate`), `auth.ts` typed `register` catch, `MigrationHandler` auth-url cast.
  - **Upstream bug:** `InviteLinksView.vue` fell back to `#{{ link.created_by_id }}`, a field the API never sends (`json:"-"`); it would render `#undefined`. Now renders `—`.
- Tests rewritten for the native picker: `DatepickerInline.test.ts` (10 cases: time control visibility, calendar/shortcut boundaries, `defaultDueTime` precedence, forced time; mutation-checked), `DeferTask.test.ts` (flatpickr-string cases removed; behaviour cases kept). Popover API stubbed in the two chip test files (happy-dom has none; upstream stubs it the same way).
- `CLAUDE.md`: dev-commands pointer now `.agents/docs/testing.md`. The models/modelTypes layout note waits for Phase D.
- Live-verify note: native popover focus return and light dismiss are browser behaviours happy-dom cannot exercise; they are in the human scenario.

### Build — Phase B (`8fb91c4e1`) — 2026-09-24

- 79 conflicted files (49 content, 30 upstream-deleted legacy models/services/stores). Upstream deletes 42 files in this range: project/view/team/share/filter/background models, model types, services, and the project Pinia store.
- Upstream-deleted files: fork deltas in them were typing only, except for five behaviours, all ported: `isTemplate` (backend-filtered, no frontend rule needed), per-view default sort, calendar view kind (added to `constants/projectView.ts`), sidebar drag state (`draggedProjectId` → module ref in `composables/useDraggedProject.ts`, UI state not server state), and the update-failure rollback (upstream's optimistic mutation plus the fork's clone reset in `ProjectsNavigation` on failure).
  - Team `oidcId` was dead: the backend field is `external_id`; upstream's check is correct.
- **Data-loss fix (fork field vs upstream whitelist):** `createProjectViewDraft` whitelists view fields and views are saved with a full PUT. Every upstream view update (done/default bucket toggle, view edit, reorder) would have cleared the fork's `default_sort_by`/`default_order_by`. Added both fields to the draft; regression test in `projectViews.test.ts`.
- Project callers ported to `useProjects()` / `useCurrentProject()` / project and view mutations: Navigation (today badge, template link, hidden nav items kept), ProjectsNavigationItem (nest drop-zone kept), ProjectList (roll-up, default-sort save on `useUpdateProjectViewMutation`), ProjectKanban (fork's `bucketRoleToggleDisabled` guard kept on upstream mutations; helper moved to snake_case), NewProject (template picker kept; instantiate invalidates the project list), General settings (overview project picker kept), ShowTasks (overview scope kept), TaskDetailView (property-chip layout kept; back-navigation pre-set now by id), plus ProjectActivity, ProjectCalendar, AddTask, TaskTitleField, TaskPropertyChips, TaskContextMenu, SubprojectRollupPopup, ProjectSearchMultiple, UserStatistics, quick-add autocomplete (project search + `searchProjectUsers`).
  - `services/template.ts`: the two project-returning helpers use `normalizeProject`; the template-list helpers are unchanged (no deleted type).
  - The pre-set change: the fork skipped pre-setting the current project when the destination was not loaded yet (it had no project object). Upstream's setter takes an id, so the pre-set now always happens. `TaskDetailView.test.ts` case rewritten to assert it.
- **Counts seam (spec step 4):** `stores/projectCounts.ts` deleted. `client/queries/projectCounts.ts` holds one shared query observer (enabled for real users only; link shares get a 403) and `refreshProjectCounts()`. Sidebar per-project badges, the Today badge and `useAppBadge` all read it; the task store invalidates it on create/update/delete/move. New `projectCounts.test.ts`: a task update through the real task store changes the sidebar count, Today count and app badge together (mutation-checked).
- **Silent break found:** upstream's `Subscription` component now only emits `toggle` (the parent calls the API). The fork's task-menu subscription still listened for `update:modelValue`, so subscribing would have done nothing. Rebound to upstream's `toggleSubscription`.
- **Merge damage found:** `ViewEditForm` filter block was half-duplicated by the auto-merge (upstream copy running into the fork's wrapped copy); replaced with upstream's block. `notification.ts`: took upstream whole (fork delta was typing) but restored the fork's `created = new Date(0)` (ADR-0003 date convention; `modelDefaults.test.ts` caught it).
- `EditAssignees`: took upstream. Its user search is keyed by project id, which gives the fork's per-project reset and stale-response guard by construction. The fork's four behaviour tests are kept and point at the query seam; one case now expects the refetch on project change immediately instead of on next focus.
- Typecheck: `i18n` instance now cast to a minimal `I18n` type in `src/i18n/index.ts`. vue-i18n's `t` overloads hit TS2589 ("excessively deep") against the fork's build; the cast lets upstream's `i18n.global.t` calls typecheck unchanged, so the query modules stay byte-identical to upstream (except `projectViews.ts`). `EditableTaskCollection` omits the fork's roll-up listing params (never part of a stored filter). `linkShares.ts` got an explicit return type (TS2883). The fork's typed draggable wrapper is restored in `ProjectSettingsViews`.
- Tests whose only subject was a deleted model were removed (`teamMember.test.ts`, the ProjectModel/ProjectViewModel cases in `modelDefaults.test.ts`). Fixture-only uses of `ProjectModel` became `normalizeProject(...)`. `ProjectList.saveDefaultSort.test.ts` rewritten onto the real query cache and generated-client mocks.
- Test noise: `TaskDetailView.test.ts` logs `ECONNREFUSED localhost:3000` from happy-dom loading page resources (not API calls; no `fetch` is made). Tests pass.

### Build pause after Phase B — 2026-09-24

- Jason asked to stop after Phase B and run `/checkpoint`; Phases C and D run in a new build session. This is a scheduled pause, not a stop criterion.
- State: Phase A merge `a5bd762e1`, Phase B merge `8fc741876`, both gate-green (`/tmp/sync-{a,b}-*.log`, local to this machine). `check:frontendClient` passes on both commits. No `.workflow-run.json` gates are recorded; the build phase is not finished.
- Resume at Phase C: `git merge --no-ff --no-commit a913bf4793b1687fd7b84a7dc559d039de5bffd7` from the worktree root. The merge base has moved, so the dry-run conflict counts (144 cumulative) no longer apply.
- Carry into Phase C:
  - Tasks still hold camelCase `ITask`, with `assignees` already the generated `User[]`. Phase C moves tasks to the generated `Task`/`TaskWritable`.
  - `stores/tasks.ts` calls `refreshProjectCounts()` on create/update/delete/move. When upstream's task mutations replace the store, each mutation must invalidate the counts seam (`client/queries/projectCounts.ts`); `projectCounts.test.ts` must keep passing with the new task path.
  - Check every upstream draft/body builder (`create*Draft`, `*Body`) for whitelists that drop fork task fields (deadline, estimated duration, RRULE, recurring reminders), the same class as the view `default_sort_by` fix.
  - The fork's `translate()` wrapper in `message/index.ts` is now redundant with the i18n cast; left in place (out of scope).
- Build report producer: session `18a66fd6-b0d8-4f19-bf4d-790e540019c4` (Phases A–B).

### Build — Phase C (`a913bf479`) — 2026-09-24

- Identity revalidated: `upstream/main` = `06c451da4`, base ancestor of HEAD, 34 incoming commits. Merge commit `c913e5132`.
- 59 conflicted files: 17 upstream-deleted legacy task/kanban layers (taken as deleted), 42 content.
- **Data-loss fix (same class as the Phase B view whitelist):** `taskWriteBody`'s `writableFields` omitted `deadline`, `estimated_duration`, `repeat_rrule`, `repeat_from_completion`. Every task save (PATCH) and bulk create would have dropped them. Added all four; `deadline: ''` maps to the API zero date like the other dates. Reminder `repeat_rrule` survives through the existing spread. A detail-view test checks `estimated_duration` in the PATCH body (mutation-checked).
- **Counts seam:** `invalidateTaskMembership` (every task mutation's settle step) now also invalidates `projectCountsKey`. That covers create/update/delete/move/labels/assignees/relations in one place. `projectCounts.test.ts` rewritten on the real mutation options: update, create, delete, and bucket move each refresh sidebar count, Today count, and app badge together (mutation-checked: all four fail without the line). Websocket is Phase D.
- **Quick-add:** ported into upstream `useQuickAddTask`/`buildQuickAddTask` (`helpers/task.ts`): chip overrides (`QuickAddOverrides`, tri-state via `resolveOverride`), date-only parse, RRULE → mode 3, parsed deadline, `~` reminders replacing the defaults, the "starting <date>" due anchor, a raw title for pure-magic input with overrides, and a bulk `labels` override. `reminderParser` now emits generated `TaskReminder`. The fork's store test became `useQuickAddTask.overrides.test.ts` (asserts on the `tasksCreate` payload). Label failures are reported once via upstream's `reportSkippedLabels`.
  - **Deviation:** AddTask keeps the fork's single-task `createNewTask` path (so chip overrides apply). Upstream routes every submission through the bulk endpoint.
- Rewritten on upstream queries/mutations, fork UI kept: `SingleTaskInProject` (two-row urgency layout, deadline, duration, project on right, context menu), `TaskDetailView` (property chips, title-field token accepts, breadcrumb/back/leave logic; upstream draft model with `followServerFields` extended to the fork fields), `TaskPropertyChips` (Date↔ISO computed models), `TaskContextMenu`, `ProjectCalendar` (two `useTasks` queries replace the hand-sequenced services; reschedule through the optimistic update mutation), `DeferTask`, `RepeatAfter`/`ReminderDetail` (RRULE pickers), `KanbanCard`/`BucketSelect`/`ProjectTable`/`ShowTasks` (overview scope, date-only).
  - `useTaskList`: upstream query-backed version plus the fork's `defaultSortToSortBy`/`sortByToDefaultArrays`, the sort-default getter, array-safe route params, and the logged-out guard (now `enabled`).
- **Silent breaks found:**
  - `Comments.vue` still takes the camelCase comment model until Phase D. The fork passed `task.comments` as `initialComments`, which would now be raw API objects. Dropped the `comments` expand and the prop, as upstream did. The component loads comments itself.
  - `EditLabels` lost the fork's `update:modelValue` emit after a persisted add. The context menu relies on it; restored.
- Removed as implementation-only tests: the `stores/tasks.*` tests, `useTaskList.requestSequencing`/`authGuard` (covered by upstream's stale-project test and a new logged-out case in `useTaskList.test.ts`), and `runBucketMoveWithCountRevert` plus its test (the upstream move mutation is optimistic and rolls back). The `TaskDetailView.test.ts` add/add conflict: fork tests moved to the generated-client mock, plus upstream's three draft tests adapted to the chip layout.
- Upstream tests adapted to fork UI: `ProjectsNavigation.test` passes the Sortable event (the fork reads the dragged item for nest drop-zones); `ProjectKanban.test` stubs the fork's typed `BucketDraggable`/`TaskDraggable` aliases.
- Client regenerated: one doc-string change on the fork templates-list `per_page` (upstream `ListParams` change).
- Gate (all uncached, exit 0): `check:frontendClient` (post-commit), `check:golangciFix` 0 issues, `mage build`, `test:feature`, `pnpm lint:fix` (0 errors), `lint:styles:fix`, `typecheck` 0 errors, `test:unit` 203 files / 2468 tests, `pnpm build`. Logs `/tmp/sync-c-*.log`.
- Reviewer note: two sidebar drag-state holders now coexist, the fork's `draggedProjectId` (which project, for nest drop-zones) and upstream's `isDraggingProject` (boolean, deferred list patching). They could merge; left as-is.
- Test noise: `ECONNREFUSED localhost:3000` from happy-dom resource loads, as in Phase B.

### Build — Phase D (`06c451da4`) — 2026-09-24

- Identity: 38 incoming commits; merge base `a913bf479` (Phase C target). `git fetch` moved `upstream/main` to `124dcc993` during this session. The approved target `06c451da4` was merged exactly; the range was not widened. Newer upstream commits need a new spec.
- Stale run-state cleared before the merge (`.workflow-run.json`, `.flow-audit.md`, `.flow-verify/` did not exist).
- 10 conflicted files, as the `merge-tree` dry run predicted: 6 upstream-deleted legacy layers, 4 content.
  - Deleted: `models/{file,subscription,taskComment}.ts`, `services/{attachment,reactions,taskComment}.ts`. Fork deltas in them were typing plus the `new Date(0)` default convention, which has no subject once the model classes are gone.
  - `helpers/attachmentPreview.ts` (upstream's rename of `models/attachment.ts`): the fork-side `AttachmentModel` class dropped; the file is byte-identical to upstream.
  - `Comments.vue`: upstream side for both hunks (query-owned comments and upload mutation). The fork delta (`userDisplayName`, `hiddenNavItems`/`overviewProjectIds` normalization on the sort-order save) auto-merged and survives; the file differs from upstream by those lines only.
  - `TaskDetailView.vue`: fork property-chip layout kept, upstream's Phase D delta applied to it. Removed the `attachmentUpload`/`setReactions`/`onAttachmentsUpdated` refetch plumbing (the children no longer take or emit them), subscription via `useSetTaskSubscriptionMutation` (toast moves into the mutation), time tracking hidden for link shares.
- **Reconciliation — quick-add repeating default (`0e0a587c2`):** upstream gives a repeating quick-add task without a date a due date of today at the default due time. Ported into the fork's override chain as `parsed.date ?? rruleRepeat.startDate ?? (parsed.repeats ? getDateWithTime(now) : null)`. RRULE repeats are excluded on purpose: the API already anchors an undated RRULE task on its first occurrence (`pkg/models/task_repeat_rrule.go:32`), and today would be wrong for "every monday" on a Wednesday. `getDateWithTime` honours date-only mode. New test in `helpers/task.test.ts` (mutation-checked: fails when RRULE also gets today). Upstream's two tests pass unchanged.
- OIDC (`06c451da4`, the only backend change besides translations): upstream-only file, no fork delta. Email fallback still requires `provider.EmailFallback` and a verified email; empty candidates are still skipped. New behaviour: with both fallbacks on, a username miss falls through to an email-only lookup. Upstream's intent (#4012) with tests; no fork auth behaviour weakened.
- Websocket (`202d6ec99`, `501861e74`): server events carry timers and comment notifications only, not task changes. They reach the counts seam through `invalidateTaskMembership` whenever a cached collection holds the task. No parallel socket path, no fork change needed. Spec test 4's websocket clause has no task event to exercise.
- Structural sweep: no conflict markers; no import of any of the 96 upstream-deleted files. Three fork tests still `vi.mock`ed the Phase B-deleted `@/stores/projects` (dead mocks); removed. `flatpickr` survives only in upstream's own eslint component-name list and one comment.
- Upstream API change missed by a fork test: `auth.logout.test.ts` mocked `useWebSocket` without `closeStaleConnection`; added, as upstream did in its three auth tests.
- Closeout: ADR-0004 → `Superseded by ADR-0015`. ADR-0015 stays `Proposed` until the merge to `main` and live acceptance. `CLAUDE.md`'s models/modelTypes layout note deleted: upstream's `.agents/docs/api.md:20-23` now states the layout and its legacy status (rule 8).
- Final gate (logs `/tmp/sync-final-*.log`, local to this machine):
  - Green, exit 0: `generate:frontendClient` (no drift), `check:frontendClient` (pre-commit), `check:golangciFix` 0 issues, `mage build`, `test:feature`, `test:caldav`, `test:e2EApi` (all uncached, no `(cached)` line), `pnpm lint:fix` (0 errors, 18 warnings), `lint:styles:fix`, `typecheck` 0 errors, `test:unit` 213 files / 2561 tests, `pnpm build`.
  - **`mage check:all` exit 1, pre-existing, not fixed.** Three checks fail: (1) 24 dead frontend translation keys (`task.detail.actions.*`, `task.detail.remove*`, `organization`/`management`/`move`/`dateAndTime`) — no code references them on `main` `d803c2b42` or at Phase C either; the fork's property-chip layout orphaned them. (2) Swagger docs stale and (3) yaegi symbols stale (missing fork Backup/WebPush config and activity verbs) — both are regenerated by upstream's `release.yml` `generate-swagger-and-yaegi` job, which does not run on the fork; `AGENTS.md` forbids touching `pkg/swagger/`. The check rewrote those files in the tree; the rewrites were restored, not committed.
  - **`mage test:e2e ""` exit 1 — build HALTED here.** The first run failed 425/438 at browser launch (Playwright chromium build 1243 missing from the local cache); `pnpm exec playwright install chromium` fixed that. Rerun: 331 passed, 106 failed, 1 skipped (43 min).
  - Baseline: the 28 failing spec files were run on clean `main` `d803c2b42`: 81 failed, 133 passed. Compared by test title (line numbers ignore upstream edits): 79 of the 106 branch failures also fail on `main`. 27 are new on the branch:
    - 8 tests that existed and passed on `main`: `editor/toolbar-navigation` (roving tabindex, ArrowRight does not move focus), 6 in `project-view-calendar` (drag reschedule ×3 wait for a v1 `POST /tasks/`; the two truncation-banner tests inject v1 `x-pagination-total-pages` into a v1 route while the banners still exist and key off `totalPages`; "Spans a ranged task" calls `.some` on the now-paged v2 body), and `recurrence` quick-add "every mon, fri" (waits for v1 `PUT /projects/1/tasks`). Seven look like test shape from the v1→v2 cutover; toolbar-navigation is unexplained. None was confirmed or fixed.
    - 19 tests that upstream added in the sync range and that fail against fork UI: 13 in `task/task.spec.ts` (keyboard due-date popup, labels, assignees, detail→list/kanban cache updates; most drive upstream's `.action-buttons` sidebar, which the fork's property-chip layout replaced), `task-cache-pseudo-boards` ×3, `mobile-bottom-sheet` ×2, `bucket-select` ×1, `subscription` survives reload ×1. Not triaged. `mobile-bottom-sheet` and `subscription` touch the human live scenario and PITFALLS behaviour; they need a real look, not a selector swap.
- **Halt reason (spec gap, not a listed stop criterion):** the Final Phase D gate expects `mage test:e2e ""` to exit zero. That is unreachable as written: 79 failures pre-exist on `main`, which has no CI E2E gate (PITFALLS "This fork has NO automated test/e2e gate"). A plan session must decide (a) the E2E acceptance bar for this sync (for example "no new failures against the `main` baseline" plus triage of the upstream-added tests), (b) whether repairing the 79 pre-existing failures and the 24 dead keys is in scope, and (c) whether a fork-UI adaptation of upstream's 19 new tests is test work or a signal of lost behaviour. Build does not resolve these.
- Committed despite the red E2E gate, per the halt protocol (append, commit, stop): Phase D merge `1f7eb25ea`. `suite_green` is NOT recorded; no `.workflow-run.json` exists.

### Plan — E2E acceptance bar — 2026-09-25

Plan session (Opus 5.5; Jason: "plan with your recommendations"). It resolves the three questions in the Phase D halt:

- **(a) Bar:** no new E2E failures against the `main` baseline, compared by title. The 27 new failures must pass, or be `test.fixme` as accepted E3 divergence with a stated reason. See Phase E and the Phase E gate.
- **(b) Scope:** the 79 shared failures are out of scope and are filed as #112, with the full title list. The 24 dead keys and the stale swagger and yaegi checks are out of scope and are filed as #113. The Final Phase D gate is amended to allow those three `check:all` failures and no others.
- **(c) Upstream's 19 new tests:** these tests are behaviour checks first. When the fork UI has the behaviour, the test is adapted to reach it. When the behaviour is missing, the product code is fixed. Only tests bound to upstream's sidebar layout, with no fork equivalent, become accepted divergence.
- Title sets were recomputed from `/tmp/sync-final-e2e.log` and `/tmp/main-baseline-e2e.log`: branch 106, `main` 81, shared 79, new 27, `main`-only 2. This matches the build's count.
- The range is not widened. `upstream/main` is 3 commits past `06c451da4`. Those commits belong to the next sync.

The 27 titles, by bucket:

E1 — passed on `main` (8):
- `editor/toolbar-navigation` › roving tabindex: arrow keys move between buttons, Tab leaves the toolbar
- `project/project-view-calendar` › Drag from the unscheduled panel sets a due date
- `project/project-view-calendar` › Drag to another day persists the new due date
- `project/project-view-calendar` › Non-UTC timezone (Pacific/Auckland, UTC+12) › Drag-reschedule lands on the intended local day and persists it
- `project/project-view-calendar` › Shows the unscheduled truncation banner when that fetch is paginated
- `project/project-view-calendar` › Shows the window truncation banner when the windowed fetch is paginated
- `project/project-view-calendar` › Spans a ranged task across the covered days
- `task/recurrence` › quick-add "every mon, fri" creates a calendar-pattern task

E2 — upstream-added, behaviour must hold in fork UI (9):
- `project/task-cache-pseudo-boards` › moving a favourite task to another project keeps it in Favorites and drops it from the source board
- `project/task-cache-pseudo-boards` › persists favorites task edits in its board response
- `project/task-cache-pseudo-boards` › persists saved filter task edits in its board response
- `task/task` › Task Detail View › a task deleted in the detail disappears from the kanban board without a reload
- `task/task` › Task Detail View › an edit in the task detail shows in the list and the kanban board without a reload
- `task/task` › Task Detail View › Keeps a removed assignee unassigned after saving another field
- `task/subscription` › task subscription survives reload and can be removed
- `task/mobile-bottom-sheet` › Locks page scrolling while the sheet is open
- `task/mobile-bottom-sheet` › Opens the due date picker as a sheet and saves the picked day

E3 — upstream-added, bound to upstream's `.action-buttons` sidebar (10):
- `task/task` › Task Detail View › Can create a new label with the keyboard
- `task/task` › Task Detail View › Can reopen the due date popup after confirming or dismissing it
- `task/task` › Task Detail View › Keeps focus on the datepicker trigger after clicking until Tab is pressed
- `task/task` › Task Detail View › Navigates the due date quick-select options with the arrow keys
- `task/task` › Task Detail View › Opens the due date popup via the keyboard shortcut when the task already has a due date
- `task/task` › Task Detail View › Saves a typed due date time immediately when confirming
- `task/task` › Task Detail View › Saves and closes the due date popup when confirming a quick-select option with Enter
- `task/task` › Task Detail View › Tabs into the due date quick-select options after clicking the action button
- `task/task` › Task Detail View › Tabs into the start and end date quick-select options after clicking the actions
- `task/bucket-select` › Renders the bucket dropdown above the remove assignee buttons

The bucket assignment is the planner's reading of the titles and the Phase D notes. If the build finds a test in the wrong bucket, it applies the rule for the correct bucket and logs the move. Routing is unchanged: one Opus executor, driver-run, serial. Next: `/flow build` resumes at Phase E, then closeout, then `/flow review` in a fresh session.

### Build — Phase E (E2E triage) — 2026-09-25

Commits: `260368474` (E1), `f77db4282` (E2), `e52a892ce` (product fixes), `22e6ec550` (E3), then the closeout commit that carries this entry. No bucket moves: every test stayed in its planned bucket.

- **E1 (8), all pass.** Seven were test shape from the v1→v2 cutover, as planned:
  - Calendar drag ×3 waited for a v1 `POST /tasks/`. They now wait for the v2 `PATCH /tasks/{id}` (`patchTasksRead`).
  - Truncation banners ×2 injected a v1 `x-pagination-total-pages` header. v2 carries `total_pages` in the body, so the route rewrites the body. "Spans a ranged task" reads `body.items`.
  - Quick-add "every mon, fri" waited for a v1 `PUT`. It now waits for the v2 `POST /projects/1/tasks`. Its body assertions moved to the response: `src/client/http.ts` re-wraps each request (`new Request(request, {headers})`), which makes the body a stream, and Playwright records no post data for a stream (`postDataJSON()` is `null` for every v2 write). The same fields are asserted on the created task, which is stronger evidence.
  - `toolbar-navigation`: **not a product regression.** It passed 3/3 when run alone. TipTap's `focus()` command runs in `requestAnimationFrame`. Under full-suite load, the editor focus from the Edit click lands after the test focuses the toolbar, so `ArrowRight` goes to the editor. The test now waits for the editor to take focus first. No assertion changed.
- **E2 (9), all pass, no product change.** The behaviour already held in the fork UI. The tests now use the fork controls: title textarea (`.task-title-field textarea.title`), project chip for move, assignee and priority chips, More Actions menu for delete and subscribe, due-date chip for the mobile sheet. No assertion removed.
- **E3 (10): 9 pass, 1 `test.fixme`.**
  - The due, start and end popups open from their date chips; the shortcut helper presses `d` on the page (fork mapping: `openChip('dueDate')`). The keyboard label test uses the labels chip.
  - The shortcut helper waits for the previous popup to drop `is-open` before it presses `d`. A light-dismissed popover reports its close in an async `toggle` event, measured at 10 ms after Escape. A `d` pressed inside that window is lost, because `show` is still `true`. Test-only: no person presses a key within 10 ms.
  - **`test.fixme`, accepted divergence:** `task/bucket-select` › Renders the bucket dropdown above the remove assignee buttons. Fork assignees live in a chip popup, so no remove buttons sit under the bucket dropdown. The fixme reason names this spec. `FORK-CHANGES.md` records it.
- **Product fixes (`e52a892ce`), found by E3, each with a test that was red before the fix:**
  - `RelatedTasks.vue`: the relation search used `v-focus`. The fork always renders the relation form when a task has no relations, so on desktop every task-detail load moved focus into it, and the single-key shortcuts (`d`, `l`, …) typed into the search. **Pre-existing on `main`** (same template and directive). Now the input is focused only when `showNewRelationForm` becomes true; the `r` shortcut path with no relations still focuses it through `focusRelatedTasks`. Repro: new test in `related-tasks-quick-add-magic.spec.ts` (red on the old code, green after).
  - `EditLabels.vue`: creating a label from the chip listed it twice. The fork pushed the new label after `addLabel` had already emitted, and the prop watcher had already added it. It is now pushed before `addLabel`, like a selected label; `addLabel` dedupes by id. Repro: the E3 keyboard-label test (`toHaveCount(1)` got 2).
- Skips added: the one `test.fixme` above. Nothing deleted.
- Frontend gate after the product change (logs `/tmp/sync-phase-e-*.log`): `pnpm lint:fix` 0 errors (18 warnings, as Phase D), `typecheck` 0 errors, `test:unit` 213 files / 2561 tests, `pnpm build` exit 0.
- Structural checks: all four phase targets and `06c451da4` are ancestors of HEAD; no conflict markers; no import of any of the 96 upstream-deleted paths; `flatpickr` only in one comment (`dueDateUrgency.ts:14`).
- **Not done in closeout:** the line-by-line `git show --cc` of the four merges (Closeout 3, Structural checks). This build did not do it. It is owed to review.

**Phase E gate** (`/tmp/sync-phase-e-e2e.log`): 357 passed, 80 failed, 2 skipped. 79 failing titles equal the #112 list exactly. All 27 planned titles pass, except the one `test.fixme`. The 2 skips are that fixme and one skip that was already in the suite.

**HALTED — stop criterion "a failing title that is not in #112 and not in the 27".** One title: `project/project.spec.ts` › Projects › Should upload and remove a project background without stale previews.
- Upstream added it in the Phase B range (`d5c6f40c1`); the fork carries it byte-identical to upstream. It does not exist on `main` (`mage test:e2e` there: "No tests found"), so it was not in the `main` baseline.
- It is flaky: it passed in the Phase D full run, and alone with `--repeat-each 5` it failed 3/5 at HEAD (`/tmp/phaseE-background.log`) and 4/5 with the Phase D frontend source (`/tmp/phaseE-background-phaseD.log`). **Phase E did not cause it.**
- Every failure is `page.reload: net::ERR_ABORTED; maybe frame was detached?` at the second reload, right after the background removal (`project.spec.ts:159`). Probable cause, not verified: a navigation that the app starts after removal (the background settings are a routed modal) races the test's reload.
- Build does not resolve this. A plan session must decide: (a) is it an upstream flake to track and accept under the bar, or (b) is it a fork-UI difference (settings modal close/navigation) to fix. Upstream's CI result for this test is not known.
- `suite_green` is NOT recorded. No `.workflow-run.json` exists.

### Reports

- Planner: this spec; producer `01a0d3a9-f676-7412-9c93-a7ca184f9c4e`.
- Executor/build report: Phases A–B in the Execution Log above; producer `18a66fd6-b0d8-4f19-bf4d-790e540019c4`. Phase C producer `08db9c30-8a45-4f9c-a373-c4a833f13032`. Phase D (halted at the E2E gate) producer `52f29721-9de6-46ab-bb66-cd2524d58fa6`. Phase E (halted at the Phase E gate on one flaky upstream-added test) producer `8ac27ef6-cd87-4aec-b3d2-f53b9bfd7a10`.
- Reviewer report: pending; record producer session ID beside the report.
- Verifier report: pending; record producer session ID beside the report.
- Cold-audit Pass 1/Pass 2 report: pending; record the same auditor session ID beside both passes.

Report presence never certifies acceptance. Implementation approval, evidence acceptance, and exact-candidate merge approval remain separate decisions.
