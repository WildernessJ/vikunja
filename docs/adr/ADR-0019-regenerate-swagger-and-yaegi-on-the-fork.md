---
status: Accepted
date: 2026-10-02
deciders: Jason
phase: —
---

# ADR-0019: The fork regenerates its swagger docs and yaegi symbols

## Context

`pkg/swagger/` and `pkg/yaegi_symbols/` are generated files. Upstream regenerates them in the
`generate-swagger-and-yaegi` job of its release workflow, and its contributor docs say "CI
regenerates" and "never edit". That job does not run on the fork. The files drifted from the
fork's code: the fork's Backup and WebPush config, activity verbs, error codes and task fields
were missing. `mage check:gotSwag` and `mage check:yaegiSymbols` failed, so `mage check:all`
was red on `main` (#113). The fork's CI runs no test workflows, so `check:all` is a local
gate only.

## Decision

The fork runs the generators itself. After a change to API annotations or to an exported
symbol in a package that yaegi extracts, run `mage generate:swagger-docs` and
`mage generate:yaegi-symbols`, and commit the output unchanged. Hand edits to these files
stay forbidden.

## Alternatives considered

- **A — Exclude the two checks from `check:all` on the fork:** less work per change, but the
  published swagger docs and the plugin symbol tables keep drifting from the fork's API.
- **B — Run upstream's regeneration job in fork CI:** automatic, but it adds a CI workflow that
  pushes commits, for a fork with one maintainer and no test CI.

## Consequences

- **Positive:** `check:all` is a meaningful local gate again. The swagger docs describe the
  fork's real API, and plugins see the fork's exported symbols.
- **Negative / trade-offs:** each API change needs one extra local step. A missed step shows
  only when someone runs `check:all`.

## Confirmation

`mage check:all` exits 0 on `main`. `check:gotSwag` and `check:yaegiSymbols` fail when the
committed files differ from the generator output.

## Links

- Issue: #113. Commit: `29fd2cf46`.
- Related ADRs: ADR-0017 (upstream syncs stopped).
