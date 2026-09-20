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

(Build appends commands, evidence, outcomes, candidate commit, and warranted record
updates here.)
