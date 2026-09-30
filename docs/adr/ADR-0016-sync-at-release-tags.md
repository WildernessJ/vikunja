---
status: Superseded by ADR-0017
date: 2026-09-27
deciders: Jason
phase: —
superseded-by: ADR-0017
---

# ADR-0016: Sync at upstream release tags; merge off-cycle only for high-severity fixes

## Context

ADR-0006 sets the sync method: merge `upstream/main` in full, then verify. It does not set the
sync cadence. Until now, syncs merged an arbitrary `upstream/main` commit whenever the fork chose
to sync.

Upstream is very active: about 1,400 commits between 2026-06-27 and 2026-09-26. The
`sync-upstream-2026-09-24` sync needed four merge phases and 309 commits on the sync branch.
Each sync also has a fixed cost that does not depend on its size: both test suites,
`pnpm typecheck`, lint, a production build, live browser verification, a database backup, and
a deploy.

Upstream publishes security advisories (GHSA) on the day of the release that contains the fix.
The fix commit can be on `upstream/main` for weeks before the advisory is published.

## Decision

Sync at upstream release tags. Merge the tag with the ADR-0006 method and verification bar. The
fork does not sync to an untagged `upstream/main` commit, except for this one case: a
high-severity fix. A fix is high-severity when one of these conditions is true:

- Upstream publishes a GHSA advisory with severity high or critical.
- Dependabot reports a high or critical alert for a dependency that the running instance
  uses.

For a high-severity fix, do an off-cycle merge. Merge `upstream/main` up to the fix commit
(ADR-0006 method, full verification bar). Cherry-pick the fix only if all of these conditions
are true:

- The fix is one commit.
- The fix does not depend on other upstream commits that the fork does not have.
- The merge commit or the cherry-pick commit message names the advisory or the alert.

Fixes below high severity wait for the next release tag.

## Alternatives considered

- **A — Keep syncing at arbitrary `upstream/main` commits:** each sync pays the full fixed cost,
  and it can land on a commit that upstream has not stabilised.
- **B — Cherry-pick all security fixes between releases:** ADR-0006 rejects this. Upstream fixes
  often depend on other commits (the token-hashing fix needed a migration and test-factory
  changes). A cherry-pick can miss such a commit and not show an error.
- **C — Stop syncing:** the fork stops getting security fixes for an internet-reachable
  service, and each skipped month makes a later sync harder.

## Consequences

- **Positive:** fewer syncs, so the fixed per-sync cost occurs less often. Syncs land on commits
  that upstream has tested and released.
- **Positive:** the ADR-0006 method stays unchanged. Off-cycle merges use the same method, so
  history stays mergeable.
- **Negative / trade-offs:** conflict work does not decrease. It depends on how far the fork and
  upstream diverge, not on cadence. Each release sync is a larger single job.
- **Negative / trade-offs:** fixes below high severity arrive only at the next release. A
  high-severity fix without an advisory or a Dependabot alert is not detected until the release
  that publishes its advisory.

## Confirmation

Manual review at each sync. The second parent of each upstream merge commit is a release tag
(`git describe --exact-match --tags <merge>^2` succeeds), or the merge commit message names the
advisory or the alert that caused the off-cycle merge. The same rule applies to a cherry-pick
commit.

## Links

- Related ADRs: ADR-0006 (sync method; this ADR adds the cadence)
