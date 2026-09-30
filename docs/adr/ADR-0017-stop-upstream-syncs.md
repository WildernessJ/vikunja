---
status: Accepted
date: 2026-09-30
deciders: Jason
phase: —
supersedes: ADR-0006, ADR-0016
---

# ADR-0017: Stop upstream syncs; port security fixes one at a time

## Context

ADR-0006 sets the sync method: merge `upstream/main` in full. ADR-0016 sets the cadence: merge at
upstream release tags. Both ADRs reject a freeze for the same reason. They say that the fork
would stop getting security fixes for an internet-reachable service.

That reason does not apply to this deployment. The instance is not reachable from the internet,
and it has one user. Most upstream security fixes protect against an attacker who can send
requests to the instance. No such attacker can reach this one from outside the local network.

The cost of a sync is high. The `sync-upstream-2026-09-24` sync had 153 conflicts, four merge
phases, and 309 commits on the sync branch. Upstream is replacing the legacy frontend client
with a generated client, and the fork carries about 31,000 added lines in `pkg/` and
`frontend/src`. Three days after that sync, `main` was 127 commits behind `upstream/main` again.

The benefit of a sync is low. The maintainer uses task lists and does not use most other
upstream features. New upstream features have little value for this deployment.

## Decision

The fork stops merging from upstream. `06c451da4` is the last upstream commit that `main`
contains through a merge. The fork does not sync at release tags, and it does not do off-cycle
merges.

The fork takes an upstream security fix as a cherry-pick. If the cherry-pick does not apply,
port the fix by hand. These rules apply:

- Take the fix when upstream publishes a GHSA advisory with severity high or critical. For an
  advisory below high severity, the maintainer decides. The question is whether the attack can
  reach an instance that is not on the internet.
- Before the cherry-pick, find the upstream commits that the fix depends on (migrations, test
  factories, refactors near the fix). Take them too, or port the fix without them.
- Take the upstream tests for the fix together with the fix.
- Name the advisory and the upstream commit in the commit message.
- Run the full verification bar: `mage test:feature`, `pnpm typecheck`, lint, and live
  verification.

For a dependency alert, update the dependency in the fork. This does not need upstream.

The fork is now a permanent fork. Rules that existed only to keep merges clean no longer bind.
ADR-0006's supporting conventions (upstream owns contested fixture IDs, fork tests adapt to
upstream semantics) are history.

## Alternatives considered

- **A — Keep ADR-0016 (sync at release tags):** each sync pays the conflict cost for features
  and fixes that this deployment does not need.
- **B — Sync on demand, when upstream ships a wanted feature:** the cost of a sync grows with
  the distance from upstream. A sync that is always possible later becomes too expensive to do,
  but the fork still obeys the merge-clean rules in the meantime.
- **C — Stop syncing and take no upstream fixes:** a compromised device on the local network
  can still reach the instance. A high-severity fix is worth the cost of one cherry-pick.

## Consequences

- **Positive:** no more sync work. The fork can change or remove upstream code and structure
  without a merge cost.
- **Positive:** cherry-picks do not cause later merge conflicts, because there is no later merge.
  That was ADR-0006's main objection to cherry-picks.
- **Negative / trade-offs:** this decision is hard to reverse. After upstream finishes its
  frontend rewrite, a return to syncing is a port of the fork onto a different codebase, not a
  merge.
- **Negative / trade-offs:** a cherry-pick can miss a commit that the fix depends on and not
  show an error. ADR-0006 and ADR-0016 named this risk. The dependency check and the upstream
  tests reduce it. They do not remove it.
- **Negative / trade-offs:** cherry-picks become harder as the fork and upstream diverge. At
  some point each fix is a hand port.
- **Negative / trade-offs:** the fork only learns of fixes that upstream publishes as an
  advisory. Upstream also lands security fixes as ordinary commits. The fork does not get
  those.
- **Negative / trade-offs:** the maintainer owns all dependency and toolchain upgrades (Go,
  Node, libraries). Upstream bug fixes stop arriving.
- **Condition:** this decision depends on the deployment. If the instance becomes reachable from
  the internet, or gets a second user, review this ADR first.

## Confirmation

Manual review. `git merge-base main upstream/main` prints `06c451da4`. If it prints a later
commit, a merge from upstream happened. Each commit that ports an upstream fix names the
advisory and the upstream commit in its message.

This is a convention. No hook or CI rule enforces it.

## Links

- Related ADRs: ADR-0006 (sync method, superseded), ADR-0016 (sync cadence, superseded)
