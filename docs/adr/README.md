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
| [ADR-0002](ADR-0002-no-textarea-overlay-mirror.md) | Quick-add composer uses chips + under-anchored dropdown, no textarea overlay-mirror | Enacted | 2026-07-16 | — |
| [ADR-0003](ADR-0003-model-date-column-convention.md) | One date-column convention for frontend models, enforced by an auto-enumerating test | Enacted | 2026-07-17 | — |
| [ADR-0004](ADR-0004-popup-renders-content-only-when-open.md) | Shared Popup renders content only when open (v-if + Transition), not always-mounted | Enacted | 2026-07-17 | — |
| [ADR-0005](ADR-0005-config-driven-cron-fails-soft.md) | Config-driven cron schedules fail soft (Critical log + disable), not fatal | Enacted | 2026-07-17 | — |
| [ADR-0006](ADR-0006-upstream-sync-via-merge.md) | Sync with upstream via full merge commits, not cherry-picks | Enacted | 2026-07-21 | — |
| [ADR-0007](ADR-0007-quote-close-heuristic.md) | Quoted magic-token spans close on a quote followed by space/end-of-string | Enacted | 2026-07-22 | ADR-0002 |
| [ADR-0008](ADR-0008-reminder-magic-trailing-only.md) | Reminder `~` magic-text tokens parse only from the trailing run | Enacted | 2026-07-23 | ADR-0002, ADR-0007 |

## How to add a new ADR

1. **Pick the next number** (never reused, even if an ADR is later superseded) — next is **0009**.
2. **Copy [`ADR-TEMPLATE.md`](ADR-TEMPLATE.md)** to `ADR-NNNN-<short-slug>.md`; fill in front matter + body (MADR).
3. If it **supersedes** an existing ADR, set `supersedes:` here and `superseded-by:` + `status:` on the old one.
4. **Add a row above** and link it from `../context/PROJECT_STATE.md` → References.
