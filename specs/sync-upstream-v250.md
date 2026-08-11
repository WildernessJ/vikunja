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

Merge ran clean against the dry run: exactly the 3 predicted conflicts, nothing else.
Conflict resolution dispatched to `executor-max` per the routing; the hand-review of the
auto-merged hot files was done by the driver.

**Resolutions.** `go.sum` — took upstream wholesale, then `go mod tidy` (run only after the
`.go` files were marker-free, since tidy parses them). `project_view_test.go` — upstream's
file verbatim plus the fork's `TestProjectView_DefaultEqualsDoneBucketValidation`; no name
collisions, no test edited. `project_view.go` — upstream's structure kept; fork deltas
re-threaded: calendar kind auto-merged untouched, per-project default sort appended to
upstream's always-written `cols` group (not the kanban-only bucket-id group),
`checkBucketConfiguration` unchanged in body.

**Deviation — reviewer read this first.** On update, `checkBucketConfiguration` moved from
before `Update` to *after* `resolveBucketIDs` (`project_view.go:690`), and `updateProjectView`
gained a `validateBucketConfiguration bool` (duplication passes `false`, matching
`createProjectView`'s pre-existing flag convention). Forced: with the check on the raw
request, upstream's `TestProjectView_Update/unchanged_stale_bucket_ids_are_reset_instead_of_rejected`
fails. Evaluated against the "contradictory tests" stop criterion and rejected as one — the
two tests use different inputs (fork: bucket 3, belongs to the view, resolves 3/3, still
rejected; upstream: bucket 4, belongs to view 8, resolves to 0/0, accepted). Both pass on one
implementation. Behavior change: a request echoing a stale/foreign id in *both* fields is now
accepted and persists 0/0 instead of being rejected. The fork's actual invariant — no persisted
view has nonzero `default == done` — is now checked on the values that get persisted, so it is
not weakened. Placement was chosen here, not specified by the spec.

**Semantic conflict git did not flag.** `pkg/models/project_duplicate.go` auto-merged into a
compile error: upstream declares `views` as a `map[int64]*ProjectView` and iterates
`for oldViewID, view := range views`; the fork had replaced it with an ordered slice
(`OrderBy("position asc, id asc")`, for the deterministic default-view redirect). The merge kept
the fork's slice under upstream's map-keyed loop. Fixed by indexing the already-present parallel
`oldViewIDs` slice (`:268-269`), keeping the fork's ordering. It only surfaced because Go is
statically typed — a same-typed collision elsewhere would have been silent. The auto-merged set
is not automatically trustworthy.

**Hand-review of the spec's hot files (driver).** `kanban.ts` — upstream's "drop deleted bucket
from view state" landed beside the fork's code without interaction. `ViewEditForm.vue` — calendar
still offered (`:191`); bucket UI (`:227`, `:262`) and upstream's new manual-mode preselect watcher
(`:97`) are all gated on `viewKind === 'kanban'`, so calendar writes no bucket fields. Link-share
security batch — all guards present post-merge in `webhooks_permissions.go:25`, `webhooks.go:235`,
`teams_permissions.go:26,47,69`, `team_members_permissions.go:34,56`, `bot_users.go:60`,
`bot_users_permissions.go:48`; `GetUserFromClaims` now rejects non-user token types
(`user.go:516`) and `LinkSharing.GetID` returns the negated user id. The fork's own v2 surfaces
for teams/team members/bots/webhooks (`pkg/routes/api/v2/`) all go through `handler.Do*` →
model `Can*`, so they inherit the guards; no fork route reimplements an auth-id comparison.
Migration `20260802162816` is the newest timestamp (fork's last is `20260729154002`) and is
scoped to `builder.Eq{"view_kind": 3}` — Kanban; calendar is 4, untouched. Huma v2.39.1: v2
routes compiled with no change.

**Surfaced, out of scope, for the review phase.** Upstream's `insertTaskBuckets`
(`project_view.go:504-542`) builds a raw `INSERT ... ON CONFLICT` string via `s.Exec` — a direct
violation of this repo's "No raw SQL" rule, now vendored into the fork. Deliberate upstream
(xorm exposes no upsert), but the rule as written has no exemption. Accept as vendored, or file
a follow-up — not a build-phase call.

**Suite.** `mage build` ok · `mage test:web` green · `mage test:feature` green (0 FAIL) ·
`mage lint` 0 issues · `mage test:filter ProjectView` 27/27 · frontend `pnpm lint` 0 errors
(16 pre-existing warnings) · `pnpm test:unit` **1611 passed / 98 files** (union baseline was
1609) · `pnpm typecheck:ratchet` reports only the already-open `src/services/task.test.ts: 0 → 4`
regression carried in from the 2026-08-02 sync — not made worse by this merge.

## Review verdict (2026-08-11) — DO NOT MERGE, hand back to build

Verifier + security agents (both Opus) on the full `main...` diff. The merge is
well-executed — every fork delta survived, the test union is byte-exact, the link-share
security batch landed intact with upstream's tests running (not skipped), suite counts
reproduced. But there is a confirmed BLOCKER regression plus a same-invariant-class second
finding, which under the v3 fix-loop rule is a hand-back-to-build trigger, not a
review-session fix.

**Blocks merge (merge-caused):**

1. **BLOCKER — fork `default != done` bucket invariant regresses.** The relocated
   `checkBucketConfiguration` runs before `Update`, but `syncManualKanbanBuckets` →
   `healBucketIDs` (`pkg/models/project_view.go:744,781`) then writes recomputed
   `default_bucket_id`/`done_bucket_id` with NO re-check. On a list→kanban switch
   (`ViewEditForm.vue:97` now auto-forces manual mode = the `becameManualKanban` branch),
   when one bucket survives and it is the done bucket, `getDefaultBucketID` returns that same
   bucket → `default == done` persists. Verified by running: pre-merge `main` persists 0/0,
   this merge persists 3/3 on identical input. UI-reachable, no test covers it (upstream's
   round-trip test uses a distinct stored pair and passes). The Execution Log's "invariant
   is not weakened" claim is false — it reasoned about `resolveBucketIDs` vs the raw request
   and did not account for the post-`Update` heal write.
   Fix: re-check after heal/seed, or make `getDefaultBucketID` skip the done bucket; add the
   regression test (repro above is the spec).

2. **MINOR, same invariant class — migration `20260802162816`** can itself persist
   `default == done` on odd legacy data (`:129-140,165-171`: `targetBucket` defaults to
   `buckets[0]` by position, then both id columns are written). Same guard needed. Being a
   second finding in the invariant's class is what makes this a build hand-back, not an
   in-session patch.

**Out of scope for this sync — pre-existing upstream v2 code, NOT in this diff — file as
issues:**

3. **MEDIUM — `GET /api/v2/projects/{project}/users/search` is an email oracle for
   link-share tokens** (`pkg/routes/api/v2/user_search.go:99` uses
   `GetUserOrLinkShareUser`; fuzzy match, no discoverability check). Attacker with only the
   public share URL reconstructs every shared-project member's email. Verified with real
   read + write shares. The v1 equivalent returns 401 — **this merge is what closed v1**, so
   v1/v2 now disagree and prod runs v2. Fix: reject `*models.LinkSharing` (swap to
   `user.GetFromAuth`).

4. **LOW–MEDIUM — `GET /api/v2/users?q=` is an instance-wide username oracle for link-share
   tokens** (`user_search.go:69`; emails blanked here). Same root cause and fix.

**Owed at eventual merge (deliver-phase, spec Verification items):** FORK-CHANGES.md sync
entry (prior-sync convention), desktop v0.1.19 (bundle changed), and a recorded decision on
the vendored raw-SQL `insertTaskBuckets` (not injectable per security agent; violates the
no-raw-SQL rule — accept-as-vendored or ADR).

**Structural notes (no gap today):** create-path `checkBucketConfiguration` is now vestigial
(guards a 400, not an invariant, since `createProjectView` zeroes both ids);
`ProjectDuplicate.CanCreate` refuses link shares only 4 frames deep (fails closed);
`handler.DoReadAll` runs no permission check so every `ReadAll` must self-guard (all 23 do —
convention unenforced, `crudable` skill silent on it); `mage check:yaegi-symbols` red on both
branches (pre-existing, CI auto-regenerates, leaves tree dirty when run locally).

`pending_verify` left ARMED — nothing merged, nothing delivered.
