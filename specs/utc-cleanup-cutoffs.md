# UTC cleanup cutoffs

Status: **approved** on 2026-09-20. Approval covers the draft with SHA-256
`f221227d3985e7186c9c40cb220e97ef7f5ea66184c7655e3608084a999e36ad`, including
attended fixture-based behavior verification instead of browser verification for
this issue.

## Intent

Make stale migration-claim release and expired pending-email-token cleanup compare
against the database's UTC representation regardless of process timezone. Add
`.UTC()` to the existing cutoff expressions at:

- `pkg/modules/migration/migration_status.go:102`, in `releaseStaleClaims`.
- `pkg/user/token.go:132`, in `CleanupOldTokens`.

Preserve strict `<`, configured claim timeout including disabled behavior, 24-hour
token expiry, claim ownership/release semantics, every token-kind and pending-email
predicate, existing one-hour claim and 25-hour token ages, and the tests' 24h/1ms
timeout choices.

No schema, dependency, frontend, production timezone/configuration, fixture-age,
or general date-handling changes. No harness/global test initialization, browser,
cron, production service, real migration/email, toolkit, or launcher work. Do not
reinvestigate the accepted diagnosis or add an ADR.

Application and test edits are limited to:

- `pkg/modules/migration/migration_status.go`
- `pkg/modules/migration/migration_status_test.go`
- `pkg/user/token.go`
- `pkg/user/user_test.go`

Normal records are this spec and execution log, `FORK-CHANGES.md`, and the main
checkout's existing `docs/context/{PROJECT_STATE,RUN_LOG,PITFALLS}.md` where
warranted; no broad memory rewrite. Public records stay free of private paths and
session IDs.

## Baseline

- Integration branch: `main` at approved base
  `603a122e2f13927e3c7358f963cddbd85ce53197`.
- Feature branch: `fix/utc-cleanup-cutoffs`, created at that base in a clean,
  isolated worktree.
- The private checkpoint records absolute worktree, evidence, and main-memory
  paths. Existing diagnosis and baseline logs are approved evidence; do not rerun
  the investigation.
- Dependency preparation is a separate approved handoff after planning: copy only
  existing frontend build assets and dependency tree, preserving symlinks; reuse
  the Go cache without downloads. Do not copy application config, databases, or
  harness settings.

Stop if `main` moves from the approved base, branch/worktree identity changes, or
unexpected work appears. Planned spec and implementation commits on the feature
branch are expected candidate progression, not drift.

## Design

The database's UTC representation must be compared to UTC cutoffs. Normalize only
the two construction sites:

- `time.Now().Add(-claimTimeout).UTC()` for stale migration claims.
- `time.Now().Add(-24 * time.Hour).UTC()` for expired pending-email tokens.

Do not alter query operators, predicates, timeout configuration, fixtures, or
ownership logic. Tests move `time.Local` explicitly between UTC and
`America/New_York`, independent of shell timezone.

Rejected alternatives: changing database/session timezone (operationally broad),
a fixture-age change (hides the defect), a shared helper/global initializer
(unneeded scope), and browser verification (no meaningful browser surface). The
approved attended fixture run exercises both comparison sites directly.

## Implementation plan

1. Recheck identity, branch, ancestry, status, and worktree. Confirm no affected
   test uses parallel/background access that could observe temporary `time.Local`;
   stop if safe isolation requires a broader mechanism.
2. Extend only `migration_status_test.go` and `user_test.go` as necessary. Follow
   existing `testing`, sequential `t.Run`, fixture-reset, and `t.Cleanup`
   conventions. Save/restore `time.Local`; explicitly load UTC and
   `America/New_York`. Missing timezone data fails, never skips.
3. Write regressions before application edits. Retain recent-claim exclusion,
   stale-claim takeover/release, recent-token retention, expired-token deletion,
   registration-confirmation retention, and existing password-reset/account-
   deletion cleanup selection. Add a recent pending-email-token retention control.
4. Run focused tests under shell `TZ=UTC` and `TZ=America/New_York`. Before the fix,
   embedded New York cases fail even under shell UTC; embedded UTC controls pass.
5. Apply only the two `.UTC()` edits, then require every focused case to pass under
   both shell zones.
6. Run zoned feature tests, build, backend `mage lint:fix`, and `mage lint`. Inspect
   the fixer diff and stop on unrelated edits. Any source change invalidates and
   requires rerunning affected checks. Do not run frontend fixers.
7. Run unchanged frontend typecheck and compare to accepted diagnostics. Report
   the known failure separately; no ratchet, waiver, or frontend repair.
8. Append commands, results, candidate identity, and evidence to the execution
   log; update only warranted in-scope records. Commit and stop unmerged.

## Execution routing

A fresh installed build session uses one manual executor, with no delegation:

```sh
picode build --spec specs/utc-cleanup-cutoffs.md --go
```

The executor implements, verifies, records, and commits only this scope, then
stops. Separate installed review and verification sessions follow; findings return
to an executor. Cold audit Pass 1 excludes decision context, followed by the same
auditor's ledger-informed Pass 2. Use a pristine review worktree at the committed
candidate; disclose execution-worktree assets/evidence and run verifier rechecks
in the execution worktree so the review worktree stays pristine. Merge requires a
later attended exact-candidate decision.

## Tests

Use fixture-backed sequential subtests.

**Migration claims:** under embedded UTC and `America/New_York`, retain recent
claim exclusion and stale-claim takeover/release with ownership semantics intact.
Preserve disabled cleanup, strict `<`, configured timeout, 24h/1ms timeout cases,
and one-hour claim age.

**Tokens:** under embedded UTC and `America/New_York`, retain recent pending-email
tokens and delete expired ones. Retain registration-confirmation tokens. Keep
password-reset/account-deletion cleanup selection unchanged, preserving existing
tests. Preserve strict `<`, 24-hour expiry, and 25-hour expired fixture age.

For `zone=UTC` and then `zone=America/New_York`, run before and after source edits:

```sh
env TZ="$zone" GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local \
  GOFLAGS='-mod=readonly -count=1' VIKUNJA_TESTS_USE_CONFIG=0 \
  mage -v test:filter '^(TestClaimMigration.*|TestCleanupOldTokens)$'
```

**Red:** embedded New York regressions fail before the fix under both shell zones;
embedded UTC controls pass. Record expected assertions and nonzero status. Any
other failure stops execution.

**Green:** all named tests, timezone cases, and preservation controls pass under
both shell zones. A no-match or short-skipped package is not exercised behavior.

## Verification

Save ordinary stdout, stderr, and actual exit status separately in the checkpoint's
private evidence directory. Each record includes exact command, candidate, phase,
and shell timezone. Read saved output; never rerun an expensive command only to
inspect it differently.

### Attended fixture behavior

Attend the focused green run in both shell zones and inspect assertions for stale
claim takeover/release, recent claim exclusion, expired pending-email deletion,
recent pending-email retention, registration-confirmation retention, and unchanged
password-reset/account-deletion cleanup selection.

Existing in-memory SQLite, `testMigrator`, and fake mail/events exercise these
comparison sites without production services, real migrations, or email. This
proves tested database behavior, not browser, cron scheduling, or production-
backend behavior.

### Broader commands

For both `zone=UTC` and `zone=America/New_York`:

```sh
env TZ="$zone" GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local \
  GOFLAGS='-mod=readonly -count=1' VIKUNJA_TESTS_USE_CONFIG=0 \
  mage -v test:feature
```

Both runs must exercise tests and exit zero. Then run:

```sh
env GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local GOFLAGS='-mod=readonly' mage build
env GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local GOFLAGS='-mod=readonly' mage lint:fix
env GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local GOFLAGS='-mod=readonly' mage lint
```

Inspect `mage lint:fix` changes immediately; stop on unrelated edits. If it changes
source, rerun affected focused, feature, build, and lint checks.

Run unchanged frontend typecheck once:

```sh
cd frontend && pnpm typecheck
```

The accepted baseline is exit 2: TS2589 at `labels.ts:147`, TS2590 at
`CreateEdit.vue:59`, four TS2339 property errors at `task.test.ts:96-99`, repeated
in the build. If unchanged, report it separately as failed. Do not hide, repair,
waive, or ratchet it; diagnostic drift triggers a stop.

## Stop criteria

Halt, log, and report without a repair loop when:

- `main` moves from the approved base, branch/worktree identity changes, feature
  history no longer descends from that base, or unexpected work appears; planned
  spec/implementation commits are not drift;
- work requires files outside the enumerated application/test scope, or requires
  predicate/operator, timeout, fixture-age, schema, dependency, configuration,
  harness, or global-initialization changes;
- timezone data is unavailable or `time.Local` isolation is unsafe due to
  parallel/background access;
- red fails differently, an embedded UTC control fails, or tests no-match/skip;
- focused green, zoned feature, build, or backend lint fails;
- `mage lint:fix` makes unrelated edits, or changed source cannot be reverified;
- frontend typecheck differs from the accepted diagnostics/status;
- required assets, offline Go cache, evidence location, or baseline evidence are
  unavailable; or
- a role/preflight blocker would require concealed inputs, launcher repair, or a
  non-pristine review candidate.

Keep the known frontend failure visible. Planning/build cannot claim `picheck`
success, audit acceptance, merge readiness, or D1 acceptance.

## Execution Log

### Planning — 2026-09-20

The user approved the source draft verbatim, including attended fixture-based
verification instead of browser verification. Planning materialized it as this
public-clean spec on `fix/utc-cleanup-cutoffs` at the approved base. No
implementation, tests, dependencies, services, toolkit changes, delegation, or
merge occurred.

### Build — 2026-09-20 (stopped)

Recovered the clean feature branch at `7ae7ee4e6d3c755eefef7b1c1c58a7771e3b534a`,
descending from unchanged approved base
`603a122e2f13927e3c7358f963cddbd85ce53197`. The worktree, common Git directory,
spec blob, branch, identity, and approval matched the checkpoint. The affected
tests contain no parallel test execution; the only goroutine-based claim test
waits for all workers before returning.

Added sequential UTC and `America/New_York` cases around stale/recent migration
claims and all existing token-cleanup cases. Added a recent pending-email-token
retention assertion while retaining expired pending-email deletion,
registration-confirmation retention, password-reset/account-deletion selection,
the one-hour and 25-hour fixture ages, and the 24h/1ms timeout choices.

Before application edits, the focused command ran under shell `TZ=UTC` and
`TZ=America/New_York`; both exited 1 exactly as required. In each run, embedded
UTC controls passed, embedded New York stale-claim takeover failed with
`Migration already running: todoist`, and embedded New York expired
pending-email deletion failed because the token remained. Recent-claim,
recent-token, registration-confirmation, password-reset, and account-deletion
controls passed.

Applied only the approved cutoff changes:

- `time.Now().Add(-timeout).UTC()` in `releaseStaleClaims`.
- `time.Now().Add(time.Hour * 24 * -1).UTC()` in `CleanupOldTokens`.

The same focused command then exited 0 under both shell zones, exercising and
passing every named UTC and New York case. `mage -v test:feature` exited 0 under
both shell zones. The offline `mage build` command exited 0.

Execution then stopped at the specified criterion. The offline `mage lint:fix`
command exited 1 with exactly three `gosmopolitan` diagnostics for reading,
assigning, and restoring `time.Local` in
`pkg/modules/migration/migration_status_test.go:73-75`. It made no source
changes; the scoped diff hash remained
`63bc8f815c58adace54e1d952df6d6df2a669395dcb2bff4a1b68bd6f2baab52`.
Per the approved stop rule, no suppression, redesign, retry, plain lint, or
frontend typecheck followed. The historical frontend exit-2 baseline remains
visible but was not reverified in this build.

The application/test candidate and this execution record remain uncommitted and
unmerged. No review, independent verification, audit, merge-readiness, `picheck`,
or D1 acceptance is claimed.

### Continuation — 2026-09-20 (lint correction and verification)

The preflight was rechecked on `fix/utc-cleanup-cutoffs` at
`7ae7ee4e6d3c755eefef7b1c1c58a7771e3b534a`, with `main` still at the approved
base `603a122e2f13927e3c7358f963cddbd85ce53197`. The common Git directory and
main checkout resolved as recorded in the checkpoint. Git identity remained
`WildernessJ <59486664+WildernessJ@users.noreply.github.com>`, and the dirty
candidate contained only the five expected paths. The required `git pull
--ff-only` was attempted after confirming that the feature branch has no
upstream; it exited 1 with Git's no-tracking-information message and made no
remote contact or worktree change.

The helper isolation was rechecked before the correction. Its three
`time.Local` accesses save, assign, and restore the location through
`t.Cleanup`; its callers are sequential, no affected test uses `t.Parallel`,
and the separate concurrent claim test joins every worker before returning.
There is no background work that can observe the temporary location after the
helper returns.

Added only line-local, explained `//nolint:gosmopolitan` directives for the
deliberate save/assign/restore accesses in the migration timezone helper. The
first corrected `mage lint:fix` run then exposed the same three accesses in
the approved token test (the linter reports three issues at a time); those
were equally sequential and restored by `t.Cleanup`, so the same narrowly
scoped directives were added there. No global lint setting, assertion,
predicate, operator, timeout, fixture age, behavior, frontend file, or
framework changed. The second fixer run reported `0 issues` and made no
unrelated edits; its formatting change was limited to aligning the new inline
comments. The affected checks were rerun after that source change.

The new private evidence prefixes are `lint-fix-correction`,
`lint-fix-correction-2`, `green-correction-focused-utc`,
`green-correction-focused-new-york`, `feature-correction-utc`,
`feature-correction-new-york`, `build-correction`, `lint-correction`, and
`frontend-typecheck-correction`. Existing red/green evidence and
`red-regressions.patch` were preserved. Results:

- `env TZ=UTC GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local GOFLAGS='-mod=readonly -count=1' VIKUNJA_TESTS_USE_CONFIG=0 mage -v test:filter '^(TestClaimMigration.*|TestCleanupOldTokens)$'` exited 0.
- The same focused command with `TZ=America/New_York` exited 0. Output shows both embedded zones for stale-claim takeover/release and recent-claim exclusion, plus expired pending-email deletion, recent pending-email retention, registration-confirmation retention, and unchanged password-reset/account-deletion selection.
- `env TZ=UTC GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local GOFLAGS='-mod=readonly -count=1' VIKUNJA_TESTS_USE_CONFIG=0 mage -v test:feature` exited 0.
- The same feature command with `TZ=America/New_York` exited 0.
- `env GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local GOFLAGS='-mod=readonly' mage build` exited 0.
- `env GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local GOFLAGS='-mod=readonly' mage lint:fix` exited 0 on the corrected candidate, followed by plain `env GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local GOFLAGS='-mod=readonly' mage lint`, which exited 0 with `0 issues`.
- `cd frontend && pnpm typecheck` exited 2. It has exactly the accepted six distinct diagnostics, repeated in the output: TS2589 at `labels.ts:147`, TS2590 at `CreateEdit.vue:59`, and four TS2339 property errors at `task.test.ts:96-99`. No frontend diagnostic was repaired, suppressed, waived, or ratcheted.

The corrected candidate's scoped diff remained limited to the enumerated four
application/test files and this execution log. The known frontend typecheck
failure remains a documented limitation, so this is not an overall-green,
reviewed, audited, merge-ready, picheck, or D1 result. The candidate is to be
committed locally and left unmerged; no live verification, service, deployment,
remote, review, verifier, or auditor work is part of this continuation.
