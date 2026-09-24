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

Four ordered upstream merge commits on `sync-upstream-2026-09-24`, each independently buildable and verified at its stated gate, followed by closeout documentation. The final candidate contains every commit through `06c451da4`, no unresolved markers, no resurrected compatibility layer for upstream-deleted frontend architecture, and no loss of fork-visible behavior.

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

### Reports

- Planner: this spec; producer `01a0d3a9-f676-7412-9c93-a7ca184f9c4e`.
- Executor/build report: pending; record producer session ID beside the report.
- Reviewer report: pending; record producer session ID beside the report.
- Verifier report: pending; record producer session ID beside the report.
- Cold-audit Pass 1/Pass 2 report: pending; record the same auditor session ID beside both passes.

Report presence never certifies acceptance. Implementation approval, evidence acceptance, and exact-candidate merge approval remain separate decisions.
