# CLAUDE.md — vikunja (WildernessJ fork)

This file is the primary source of fork guidance. `AGENTS.md` is upstream's file, imported
verbatim below — never edit it on this fork, so upstream syncs merge clean. Put fork guidance
here. Codex CLI gets this file from the SessionStart hook in `.codex/hooks.json` (local-only).
Codex skips an untrusted hook without a warning — after any edit to `hooks.json`, trust it
again with `/hooks`.

@./AGENTS.md

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

## Claude Code only

### Workflow (v3 — model-per-phase, adopted 2026-08-09; v2 2026-07-09 before it)

The doctrine itself is one canonical doc in `jason-claude-skills`, imported below.
`docs/coding-workflow.md` is a **gitignored symlink** created by that repo's `install.sh` — so in
a fresh clone of this public fork the import silently resolves to nothing, which is fine: it
carries no repo-specific instruction. Edit doctrine there, never here. Codex does not get the
doctrine: it names Claude role agents and models, and `/flow` dispatches Claude subagents.

@./docs/coding-workflow.md

Repo-specific deviations and config only, from here down.

Per-repo config is `.workflow.yaml` at repo root (local-only, git-excluded): mage-based
build/test commands, frontend typecheck, and `live_verify_mode: browser`. The suite and
worktree commands are under Build and test above.

- **Worktrees:** **all `flowlib` run-state commands must run from the worktree root** —
  `.workflow-run.json` is cwd-relative and both build and review must read the same file.

`specs/` was excluded via `.git/info/exclude` until 2026-08-09, grouped with the harness
run-state files. It is now tracked — v3 needs the spec in the reviewed diff and in the
ledger `/session-audit` compiles, neither of which an excluded file can reach. The v2-era
specs were committed as frozen history in the same change (`661db2ef`). The rest of the
harness run-state (`.workflow.yaml`, `.workflow-run.json`, `.flow-audit.md`, `.flow-verify/`,
`.verified/`) stays excluded by design. Upstream push is `DISABLE`d on this fork, so none of
this can reach an upstream PR.
