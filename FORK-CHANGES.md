# Fork Changes

Running log of fixes and additions in this fork (`WildernessJ/vikunja`) that diverge from upstream (`go-vikunja/vikunja`).

Cross-check anytime with:

```bash
git fetch upstream
git log --oneline upstream/main..HEAD
```

## Format

Newest first. One entry per shipped change.

`YYYY-MM-DD` — **type** — short description ([commit/PR](url))

Types: `fix`, `feat`, `chore`, `docs`.

## Changes

- 2026-07-04 — **fix** — guard `GetTokenFromTokenString` against a panic on short/prefix-only API tokens (unauth DoS); covers the main token middleware, CalDAV, and feeds. Reported upstream.

<!-- Add entries here, newest first. Example:
- 2026-07-04 — **feat** — add per-project default reminder time ([abc1234](https://github.com/WildernessJ/vikunja/commit/abc1234))
-->
