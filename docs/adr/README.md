# Architecture Decision Records — Index

> **Purpose:** the single entry point for *why* the non-trivial calls were made in this fork —
> one row per decision, with status, and how the ADRs relate.

This index complements the project guide (`../../AGENTS.md`, aliased as `CLAUDE.md`), which holds
the **WHAT** (architecture, invariants, scope). The ADRs are the **WHY / point-in-time detail**.
When the guide and an ADR appear to disagree, the guide is the *current rule* and the ADR is the
*historical record* — check the **Status** column first.

**These ADRs are committed to the public fork** (`WildernessJ/vikunja`) — write them public-clean:
no secrets, private paths, internal hostnames/LAN IPs, or personal accounts. Progress and session
history live in the **local-only** (gitignored) memory spine under `../context/` —
`PROJECT_STATE.md`, `RUN_LOG.md`, `PITFALLS.md` — which never enters the public repo.

Format: **MADR** (see [`ADR-TEMPLATE.md`](ADR-TEMPLATE.md)). Records are written only for a decision
that is **hard to reverse, a genuine trade-off, and has lasting consequences** — a structural call,
a tooling commitment, a guardrail, or a deliberate deviation from upstream `go-vikunja`. A handful
per year is the expected rate; routine feature work and bugfixes do **not** earn an ADR — that
history lives in `../context/RUN_LOG.md`. Upstream's own decisions don't need ADRs here.

## Status legend

| Status | Meaning |
|---|---|
| **Proposed** | Written; not yet committed to. |
| **Accepted** | Agreed and binding, but not necessarily in code yet. |
| **Enacted** | Accepted *and* realised in the codebase today. |
| **Superseded by ADR-XXXX** | Replaced by a later decision; kept for history. |
| **Deprecated** | No longer applies, not directly replaced. |

## The index

| ID | Title | Status | Date | Relations |
|---|---|---|---|---|
| [ADR-0001](ADR-0001-api-v2-only-new-routes.md) | New API work goes on `/api/v2` (Huma); v1 frozen | Enacted | 2026-05-30 | — |

## How to add a new ADR

1. **Pick the next number** (never reused, even if an ADR is later superseded) — next is **0002**.
2. **Copy [`ADR-TEMPLATE.md`](ADR-TEMPLATE.md)** to `ADR-NNNN-<short-slug>.md`; fill in front matter + body (MADR).
3. If it **supersedes** an existing ADR, set `supersedes:` here and `superseded-by:` + `status:` on the old one.
4. **Add a row above** and link it from `../context/PROJECT_STATE.md` → References.
