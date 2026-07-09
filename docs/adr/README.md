# Architecture Decision Records

One file per decision, numbered: `NNNN-short-slug.md`. An ADR is written only when a
decision is **hard to reverse, surprising, and a genuine trade-off** — not for routine
choices. A handful per year is the expected rate; if every feature produces one, the
threshold is wrong.

Template:

```markdown
# NNNN. Title (a decision, stated as a sentence)

Date: YYYY-MM-DD
Status: accepted | superseded by NNNN

## Context
What forced the decision. The constraint, not the history.

## Decision
What we do, stated plainly.

## Consequences
What this makes easier, what it makes harder, what it forbids.
```

Fork-specific candidates: API-v2-only policy for new work, deviations from upstream
Vikunja conventions. Upstream's own decisions don't need ADRs here.
