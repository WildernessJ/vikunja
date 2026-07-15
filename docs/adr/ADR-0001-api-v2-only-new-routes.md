---
status: Enacted
date: 2026-05-30
deciders: fork maintainer
phase: —
---

# ADR-0001: New API work goes on `/api/v2` (Huma); `/api/v1` is frozen

> Recorded 2026-07-14 as part of adopting the memory spine. This ADR **formalizes a standing
> policy** already documented in `AGENTS.md` (§"API Version Policy"); the decision predates this
> record and is enacted in the codebase today.

## Context

Vikunja historically exposed a single hand-wired REST API under `/api/v1`. This fork adds a
second, Huma-backed API under `/api/v2` (`pkg/routes/api/v2/`) that generates its own OpenAPI
schema and validation from Go types. Running both indefinitely, and letting either grow ad hoc,
would double the surface every new entity has to cover and blur where new work belongs.

## Decision

**Every net-new HTTP route goes on `/api/v2`** — new CRUDable entities, new custom/non-CRUD
endpoints, and new actions on existing resources. `/api/v1` is **frozen**: touch it only to fix a
bug or to port an existing resource to v2, never to add net-new functionality. Models in
`pkg/models/` remain shared by both APIs (a new entity still gets its model + `Can*` permission
methods); only the HTTP surface is v2-only. An unversioned request ("add an endpoint for X")
defaults to v2.

## Alternatives considered

- **A — Keep adding to `/api/v1`:** lowest friction per-change, but entrenches the hand-wired API,
  grows the surface we've decided to retire, and forgoes Huma's generated schema/validation.
- **B — Big-bang migrate all of v1 to v2 first:** clean end state, but a large upfront rewrite of a
  working API with real clients — high risk, no incremental value, blocks feature work.
- **C — Chosen: freeze v1, all new work on v2, port opportunistically.** Incremental; new surface
  gets Huma's guarantees; v1 stays supported for existing clients without growing.

## Consequences

- **Positive:** one obvious home for new endpoints; new routes get generated OpenAPI + validation;
  v1's surface stops growing; shared models mean no data-layer duplication.
- **Negative / trade-offs:** two API styles coexist during the (open-ended) transition; contributors
  must know the split; porting v1 resources to v2 is ongoing background work with no hard deadline.

## Confirmation

Review-checklist item enforced via the **`api-v2-routes` skill**, which must be invoked before
adding any route (it covers both CRUD and non-CRUD shapes). New handlers appearing under
`pkg/routes/api/v1/` for anything other than a bugfix or a v1→v2 port is a review failure.

## Links

- Policy source: `AGENTS.md` §"API Version Policy — new work goes to /api/v2"
- Skill: `.claude/skills/api-v2-routes/SKILL.md`
- Related ADRs: —
