# CLAUDE.md — vikunja (WildernessJ fork)

`AGENTS.md` is upstream's file, imported verbatim below — never edit it on this fork, so
upstream syncs merge clean. Fork guidance for every agent (Claude Code and Codex) lives in
`AGENTS.fork.md`, also imported below. This file adds only what Claude Code alone can act on.

@./AGENTS.md

@./AGENTS.fork.md

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
worktree commands are in `AGENTS.fork.md`.

- **Worktrees:** **all `flowlib` run-state commands must run from the worktree root** —
  `.workflow-run.json` is cwd-relative and both build and review must read the same file.

`specs/` was excluded via `.git/info/exclude` until 2026-08-09, grouped with the harness
run-state files. It is now tracked — v3 needs the spec in the reviewed diff and in the
ledger `/session-audit` compiles, neither of which an excluded file can reach. The v2-era
specs were committed as frozen history in the same change (`661db2ef`). The rest of the
harness run-state (`.workflow.yaml`, `.workflow-run.json`, `.flow-audit.md`, `.flow-verify/`,
`.verified/`) stays excluded by design. Upstream push is `DISABLE`d on this fork, so none of
this can reach an upstream PR.
