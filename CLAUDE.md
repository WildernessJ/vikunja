# CLAUDE.md — vikunja (WildernessJ fork)

Fork-specific guidance lives HERE. `AGENTS.md` is upstream's file, imported verbatim
below — never edit it on this fork, so upstream syncs merge clean.

@./AGENTS.md

## Corrections to the imported doc

- Frontend layout: `src/models/` holds **model classes**; the TypeScript interfaces for
  them live in `src/modelTypes/` (the imported doc conflates the two).
- i18n: frontend strings (`frontend/src/i18n/lang`) and API strings (`pkg/i18n/lang`) are
  two independent trees with no shared keys and no cross-check — if a change surfaces text
  on **both** a UI element (toast/label) **and** an API/notification (email), add the
  string to **both** `en.json` files. Nothing flags a miss; the gap only shows as a
  missing string on the surface you forgot.

## Workflow (v3 — model-per-phase, adopted 2026-08-09; v2 2026-07-09 before it)

The doctrine itself is one canonical doc in `jason-claude-skills`, imported below.
`docs/coding-workflow.md` is a **gitignored symlink** created by that repo's `install.sh` — so in
a fresh clone of this public fork the import silently resolves to nothing, which is fine: it
carries no repo-specific instruction. Edit doctrine there, never here.

@./docs/coding-workflow.md

Repo-specific deviations and config only, from here down.

Per-repo config is `.workflow.yaml` at repo root (local-only, git-excluded): mage-based
build/test commands (plain `go test` does NOT work — see Essential Commands), frontend
typecheck, and `live_verify_mode: browser`.

- **Worktrees:** `mage dev:prepare-worktree <name> ""` still works and creates the worktree in
  `../` rather than `.worktrees/`; either is fine, but **all `flowlib` run-state commands must
  run from the worktree root** — `.workflow-run.json` is cwd-relative and both build and review
  must read the same file.
- **Suite:** `mage test:web` + `pnpm typecheck` (plain `go test` does NOT work — see Essential
  Commands). Live-verify is in the browser.

`specs/` was excluded via `.git/info/exclude` until 2026-08-09, grouped with the harness
run-state files. It is now tracked — v3 needs the spec in the reviewed diff and in the
ledger `/session-audit` compiles, neither of which an excluded file can reach. The 22
v2-era specs were committed as frozen history in the same change (`661db2ef`); they are
closed — no new work goes in those files. The rest of the harness run-state
(`.workflow.yaml`, `.workflow-run.json`, `.flow-audit.md`, `.flow-verify/`, `.verified/`)
stays excluded by design. Upstream push is `DISABLE`d on this fork, so none of this can
reach an upstream PR.

ADRs in `docs/adr/` (see its README for the threshold). `plans/` and `.verified/` stay
frozen — don't add to them. `.harness.yaml.archived` preserves the old feature queue
(NOTE: `email-to-task` was still pending there).
