# AGENTS.fork.md — vikunja (WildernessJ fork)

Fork-specific guidance for every coding agent. `AGENTS.md` is upstream's file and stays
verbatim, so upstream syncs merge clean — put fork guidance here, never there.

Claude Code loads this file through `CLAUDE.md`. Codex CLI gets it from the SessionStart hook in
`.codex/hooks.json` (local-only). Codex skips an untrusted hook without a warning — after any edit
to `hooks.json`, trust it again with `/hooks`.

## Corrections to AGENTS.md

- Frontend layout: `src/models/` holds **model classes**; the TypeScript interfaces for
  them live in `src/modelTypes/` (`AGENTS.md` no longer lists either — upstream trimmed its
  layout section in v2.6.0; kept here because the split still trips people up).
- i18n: frontend strings (`frontend/src/i18n/lang`) and API strings (`pkg/i18n/lang`) are
  two independent trees with no shared keys and no cross-check — if a change surfaces text
  on **both** a UI element (toast/label) **and** an API/notification (email), add the
  string to **both** `en.json` files. Nothing flags a miss; the gap only shows as a
  missing string on the surface you forgot.

## Build and test

- **Suite:** `mage test:feature` + `cd frontend && pnpm typecheck`. `mage test:web` is
  `pkg/webtests` only; plain `go test` does NOT work (see Development Commands in `AGENTS.md`).
- **Live-verify** UI and API changes in the browser. A green suite alone is not done.
- **Worktrees:** `mage dev:prepare-worktree <name> ""` creates the worktree in `../`, not
  `.worktrees/`.

## Repo records

- `specs/` is tracked (since 2026-08-09). The 22 v2-era specs are frozen history; new work
  does not go in those files.
- ADRs go in `docs/adr/` (see its README for the threshold).
- `plans/` and `.verified/` are frozen — do not add to them. `.harness.yaml.archived` keeps
  the old feature queue (`email-to-task` was still pending there).
- Upstream push is `DISABLE`d on this fork.
