---
status: Accepted
date: 2026-10-17
deciders: Jason
phase: —
---

# ADR-0020: Static analysis runs in a pre-push hook and gates the image build

## Context

The fork has golangci-lint, ESLint, Stylelint and vue-tsc, but nothing ran them automatically.
All test and lint workflows are disabled on the fork; only `fork-image` runs. The repository had
no git hooks. The `/flow` gate ran tests but no frontend lint, and lite fixes skip `/flow`.

Static analysis tools find bugs without a language model. Three more tools were added:
type-aware ESLint rules (`recommendedTypeChecked`), knip (unused files, exports and
dependencies) and govulncheck (known vulnerabilities that the code reaches). govulncheck found
12 vulnerabilities in the deployed binary (Go 1.27.1 and `golang.org/x/net` v0.59.0). The
existing findings of each tool were fixed before the gate was turned on.

## Decision

Two mechanisms run the checks:

1. A pre-push hook, `.githooks/pre-push`, runs `mage lint`, `pnpm lint`, `pnpm lint:styles`,
   `pnpm typecheck` and `pnpm knip`. Enable it once per clone with
   `git config core.hooksPath .githooks`.
2. In `.github/workflows/fork-image.yml`, the `build` job needs the `lint-go` and
   `lint-frontend` jobs, which run the same checks. The `Dockerfile` runs govulncheck in the API
   builder stage, with the Go toolchain that builds the release binary. When a check fails, no
   image is built, so `/pb` cannot deploy the change.

## Alternatives considered

- **A — pre-commit hook:** runs on every commit, including merges and small WIP commits, and
  each run takes about a minute. Pre-push gives the same protection at a lower cost.
- **B — `/flow` gate only:** lite fixes skip `/flow`, so changes reach `main` unchecked.
- **C — govulncheck as a CI job with `setup-go`:** the job's Go version and the Dockerfile's
  xgo digest are pinned separately and can drift. Then the job checks a different standard
  library than the one in the binary, and passes while prod is vulnerable.
- **D — Baseline the existing findings and fail only on new ones:** faster, but the backlog
  stays and the baseline file needs upkeep.

## Consequences

- **Positive:** a lint, type or dead-code error cannot reach a deployed image. A reachable
  vulnerability that is known when the image is built cannot reach it either. Problems show
  before the push when the hook is enabled.
- **Negative / trade-offs:**
  - A push waits for about a minute.
  - The hook checks the working tree, not the pushed commits, and `git push --no-verify` skips
    it. The hook is a convention, not enforced. CI is the enforced gate.
  - A new advisory with no fix available blocks every image build until the code stops reaching
    the vulnerable function or the check is changed.
  - govulncheck runs only when its Docker layer is rebuilt. With the GitHub Actions layer cache,
    a rebuild of unchanged source reuses the layer, so an advisory published after the last
    source change is not checked until the next change.
  - typescript-eslint types `.vue` imports as `any`, so typed rules do not see component types.
    `no-redundant-type-constituents` is off for `.vue` files for this reason.

## Confirmation

The `fork-image` run on `main` shows `lint-go` and `lint-frontend` before `build`, and `build`
is skipped when either fails. The Dockerfile build log shows govulncheck output.

## Links

- Branch: `chore/static-analysis`.
- Related ADRs: ADR-0017 (upstream syncs stopped; fork CI runs no test workflows).
