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

- 2026-07-20 — **feat** — roll up sub-project tasks in the List view: a per-project "Show sub-project tasks" toggle. A new `include_child_projects` query param on the shared `TaskCollection` (bound on both v1 and v2) expands the project set to the viewed project plus all readable, non-archived descendant projects; borrowed rows show a project-origin chip ([1997ac3](https://github.com/WildernessJ/vikunja/commit/1997ac328845651c45a93e285fc27b38038a409a)).
- 2026-07-04 — **fix** — repair sidebar project drag-and-drop: (1) drop `@mousedown.stop`/`@touchstart.stop` on the drag handle so SortableJS's Safari-only mousedown listener fires; (2) recalculate sibling positions *after* persisting the moved row in `UpdateProject` so a dropped project no longer jumps to the top; (3) restore last-known-good state on a failed `updateProject` instead of flipping `isFavorite`. All three pre-existing upstream.
- 2026-07-04 — **fix** — guard `GetTokenFromTokenString` against a panic on short/prefix-only API tokens (unauth DoS); covers the main token middleware, CalDAV, and feeds. Reported upstream.

<!-- Add entries here, newest first. Example:
- 2026-07-04 — **feat** — add per-project default reminder time ([abc1234](https://github.com/WildernessJ/vikunja/commit/abc1234))
-->
