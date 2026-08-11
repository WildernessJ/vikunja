# Spec: Sync fork with upstream v2.5.0

## Intent

- **Problem:** the fork is 50 commits behind `upstream/main` (merge-base `6f473835f`,
  2026-08-02). The missed commits include the **v2.5.0 release** and a **coordinated
  link-share security batch** (link shares passing principal checks meant for real users at
  the team, bot, and webhook layers; non-user tokens accepted in `GetUserFromClaims`; JWT
  null-claim panic). Prod runs the fork with link shares enabled, so prod is exposed until
  this lands.
- **Deliverable:** `upstream/main` (`9403ed152`) merged into `main`, suite green, delivered
  to prod via `/pb`, desktop rebuilt (v0.1.19) if the frontend bundle changed.
- **Out of scope:** adopting upstream's ParadeDB doctor reporting or paseo dev config beyond
  compiling; any new fork feature work; re-litigating fork deltas upstream touched — fork
  behavior wins unless upstream fixed a real bug in the same lines.

## Design (settled)

- **Merge, not rebase** — matches the three prior syncs (`sync-upstream-2026-07-24`,
  `merge-upstream-v240`, `sync-upstream-2026-08`). Branch: `sync-upstream-v250`.
- Dry-run merge result (verified 2026-08-11): **3 conflicts**, everything else auto-merges.
  - `go.sum` — do not hand-merge; take either side, then `go mod tidy` regenerates it.
  - `pkg/models/project_view.go` — upstream `2d8198e94` refactored `createProjectView`
    into `validateProjectViewFilters` + `normalizeBucketConfigurationMode(OnUpdate)` and
    added bucket seeding/backfill on kind change. Fork deltas in the same region: calendar
    view kind (`4a91aab85`), default==done bucket rules (`c97c6d764`, `23ba60f08`),
    per-project default sort (`ec0c81451`). Resolution rule: **take upstream's structure,
    re-thread the fork deltas through it.** Calendar is a non-kanban kind, so upstream's
    `!= ProjectViewKindKanban` branches already handle it correctly (mode stripped, no
    bucket columns written) — verify, don't assume.
  - `pkg/models/project_view_test.go` — add/add (both sides created it). Resolution:
    union of both files' tests; all must pass unmodified. A fork test contradicting an
    upstream test is a stop criterion, not a judgment call.
- **Auto-merged but semantically hot — review by hand after merge:**
  - `frontend/src/stores/kanban.ts` + `ViewEditForm.vue`: upstream's "preselect manual
    bucket mode" / "drop deleted bucket from view state" vs. fork's calendar kind and
    type-error burndown. Check the view-kind switch UI still offers calendar and doesn't
    write bucket fields for it.
  - `pkg/models/link_sharing.go` / `webhooks.go` / `listeners.go`: upstream's security
    batch vs. fork's save-as-template feature. The fork must not retain any call path that
    reaches team/bot/webhook permission checks with a link-share auth. Grep the fork-only
    code (template library, v2 routes) for `GetFromAuth`/`GetUserFromClaims` callers.
  - Upstream migration `7eeb88da2` (repair kanban views without a bucket mode): confirm
    its timestamp orders after all fork migrations; confirm it doesn't mis-repair views
    the fork's calendar kind created (calendar views legitimately have mode none).
- Huma bump to v2.39.1: fork's v2 routes (`pkg/routes/api/v2/`) must compile untouched;
  if they don't, that's investigation, not silent adaptation.

## Implementation plan

1. In this worktree: `git merge upstream/main`.
2. Resolve the 3 conflicts per the rules above; `go mod tidy`.
3. Hand-review the hot auto-merged files (list above).
4. Build + suite (commands below). Fix only what the merge broke.
5. Commit the merge. Follow-up commits only for defects the review pass finds.

## Execution routing

- Driver: **executor-max** for the merge + `project_view.go` resolution (cross-file
  semantic reconciliation of overlapping state logic). No parallel dispatch — the work is
  one serialized merge.
- No security agent: upstream's security commits come with their own webtests
  (`2b1558e8d`, `4b35f5d7e`); the check that fork code doesn't bypass them is in the
  review phase.

## Tests

No new red-first tests — this is a merge; the test delta is upstream's own new tests plus
the union rule for `project_view_test.go`. Required green, in order:

1. `mage build`
2. `mage test:web` (must include upstream's new link-share HTTP-layer tests passing)
3. `mage test:feature`
4. `cd frontend && pnpm typecheck` — at or below the recorded baseline (known ratchet
   regression is open; do not make it worse)
5. `cd frontend && pnpm lint && pnpm test:unit` — unit baseline is 1609 green; upstream
   adds more, count must not drop below the union

## Verification

- Suite green as above (save outputs to files per repo rules; never re-run to re-read).
- Live-verify (browser, per `.workflow.yaml`): kanban view-kind switch (list→kanban seeds
  buckets; kanban→calendar strips mode and renders), a link share still opens read-only,
  task-detail Back still behaves (fork's returnability work sits near upstream's router
  changes only via deps — quick check, not a full re-verify).
- Deliver: `/pb`, verify prod reports a v2.5.0-based version; `desktop-build` → v0.1.19 if
  the frontend bundle changed.
- FORK-CHANGES.md: prior syncs' convention — check whether they got an entry; follow it.

## Stop criteria

- A fork test and an upstream test in `project_view_test.go` assert contradictory behavior.
- Upstream's bucket seeding/backfill actively mishandles calendar-kind views (writes
  buckets for them or repairs them into kanban) — that needs a design decision, not a patch.
- v2 routes fail to compile against huma v2.39.1 for a non-mechanical reason.
- Any single conflict resolution grows past ~150 lines of hand-written reconciliation.

## Execution Log

_(appended during execution)_
