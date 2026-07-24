---
status: Enacted
date: 2026-07-21
deciders: Jason
phase: —
---

# ADR-0006: Sync with upstream via full merge commits, not cherry-picks

## Context

This fork tracks `go-vikunja/vikunja` while carrying its own features (template
projects, sub-project task roll-up, activity feed, deadline / estimated-duration
fields, quick-add composer, and others). By 2026-07-21 the fork was 159 commits
behind upstream, including a coordinated security release (10 GHSA advisories),
the v2.4.0 release, task soft-delete, and major dependency bumps.

Two ways to take upstream work:

1. **Cherry-pick selected commits** onto the fork (e.g. security fixes only).
2. **Merge `upstream/main` wholesale** and resolve conflicts once per sync.

## Decision

Sync by **merging `upstream/main` in full**, as a single merge commit, taking
every upstream change unless one directly conflicts with the fork's purpose.
Resolution happens in a dedicated worktree branch, is reviewed as the merge
commit's combined diff (`git show --cc` — exactly the manually-resolved lines),
and must pass the full verification bar (both test suites, typecheck ratchet,
lint, production build, live browser verification of the fork's features) before
fast-forwarding `main`.

Supporting conventions established during the first sync:

- **A zero-conflict merge needs a different review artifact.** `git show --cc` shows
  only manually-resolved lines, so a merge with no conflicts produces an *empty*
  combined diff and the removed-behavior audit above has nothing to read — the
  review mechanism is structurally blind exactly when it looks most reassuring.
  In that case, prove the delta is intact mechanically instead:

  ```bash
  diff <(git diff <merge-base> <fork-head-before>) \
       <(git diff upstream/main <merge-commit>)
  ```

  The two fork deltas must differ only in `index <blob>..<blob>` headers and hunk
  offsets — zero `+`/`-` content lines. That establishes
  `merged_tree == upstream/main + fork_delta` by construction, which is stronger
  than sampling FORK-CHANGES entries by hand. Live-verify is still required: it
  remains the only check for upstream behavior changes that land implicitly.
  (Added 2026-07-24 after the second sync merged clean and left ADR-0006's
  designated artifact empty.)
- **Upstream owns contested test-fixture IDs.** When both sides add the same
  fixture ID, the fork's entries are renumbered — upstream's IDs are usually
  load-bearing across many of its tests, the fork's rarely are.
- **Fork tests adapt to upstream semantics**, not the reverse (e.g. fork tests
  updated for task soft-delete and the `ParentProjectID *int64` change).
- Fork guards that upstream restructures around (template exclusions, the
  post-persist position recalc) are re-seated inside upstream's new structure,
  with the removed-behavior audit in review confirming nothing was dropped.

## Consequences

- Good: history stays mergeable — each future sync only resolves new divergence
  instead of re-fighting the same conflicts; security fixes arrive complete
  rather than as a hand-picked subset that can silently miss a dependent commit.
- Good: the fork's delta remains queryable as `git log upstream/main..HEAD`.
- Bad: each sync is a lump of work (this one: 21 conflicted files, ~25 hunks,
  plus test adaptations) and takes dependency major-bumps (Pinia v4, Vite 8)
  whether or not they were wanted that week.
- Bad: upstream behavior changes land implicitly (e.g. deletes became soft
  deletes) and must be caught by the live-verify pass rather than opted into.

## Alternatives considered

- **Cherry-pick security fixes only, defer the rest** — rejected: permanently
  diverging history makes every later sync harder, and upstream's fixes often
  depend on neighboring refactors (the token-hashing fix spans a migration plus
  test factories).
- **Freeze against upstream** — rejected: the fork would stop receiving
  security fixes for an internet-reachable service.
