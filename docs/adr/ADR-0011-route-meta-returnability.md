---
status: Enacted
date: 2026-08-05
deciders: Jason, Claude
phase: —
---

# ADR-0011: "Can the user be sent back here?" lives in route meta, as one three-valued field

## Context

Three independent definitions of "a route the user must not be sent back to" had accumulated:

1. `AUTH_ROUTE_NAMES` — a name set used by the layout gate (which shell renders) and by the auth
   guard's login-redirect predicate.
2. A local denylist inside the task detail view — `AUTH_ROUTE_NAMES` plus the OAuth authorize route
   plus the two 404 catch-all names — gating the back button.
3. A condition inside the auth guard gating what gets stored as "last visited" for post-login restore.

The memberships differed for real reasons, but the overlap was silent: a newly added one-shot flow
route that nobody thought to add to the right set would reintroduce the bug class the sets exist to
prevent (Back re-fires an already-consumed OAuth code; Back lands on a dead 404 page). Nothing flagged
the omission — the failure surfaces only when a user happens to press Back at the wrong moment.

Two further forces showed up while implementing:

- The **migration callback** is not one question but two. Navigating *back* to it re-fires a code that
  has already been spent. Restoring it *after login* delivers a code that is still fresh — that is the
  behavior that makes a session expiring mid provider round-trip recoverable. A single "don't go here"
  boolean gets one of those two wrong, and the first implementation shipped that regression.
- Encoding the pair as two booleans, where the second overrode the first, put the relationship in a
  comment. A reader checking one flag saw half the rule; a code review found both readers of the field
  disagreeing about how to compare it.

## Decision

Declare returnability on the route record itself as a single three-valued `meta.returnability` field —
`'no'`, `'no-but-restore'`, or absent — and read it only through two named predicates
(`canReturnTo` / `shouldSaveAsLastVisited`) whose rules are expressed as a lookup table keyed on the
field's union type. `AUTH_ROUTE_NAMES` keeps its separate layout/auth-gate meaning; which routes bounce
an anonymous visitor to login is deliberately *not* tied to returnability.

## Alternatives considered

- **A — A fourth shared constant (one name set imported everywhere).** Rejected: it centralises the
  list without changing the failure mode. A new route still has to be remembered and added somewhere
  other than where it is declared. Worth noting the honest limit of what we chose instead: route meta
  trades silent *omission* for silent *misspelling*, because vue-router's `RouteMeta` carries an index
  signature, so a typo'd key type-checks. The lookup table is what buys back real enforcement.
- **B — Two booleans (`nonReturnable` + `restoreAfterLogin`).** Implemented first, then rejected on
  review: the override relationship existed only in prose, and a consumer reading one flag classified
  the migration callback wrongly.
- **C — Fail-closed polarity (routes must opt *in* to being returnable).** Not adopted; recorded here
  because it is the option that would actually *close* the class rather than narrow it. A route added
  during a large upstream sync and never given the flag currently defaults to returnable, so the
  silent-omission failure still exists in one direction. Deferred deliberately: flipping the default
  touches every route record and the layout/auth semantics we were holding out of scope.
- **D — Leave the three definitions alone.** Rejected; that is the reported problem.

## Consequences

- **Positive:** the answer lives next to the route it describes, so adding a route and answering the
  question are the same edit. A third value cannot be introduced without answering both the
  back-navigation and post-login-restore questions — the lookup table fails to compile until it is
  added. The two consumers can no longer drift in how they compare the field.
- **Negative / trade-offs:** the concept now has two homes (`AUTH_ROUTE_NAMES` for shell/auth, meta for
  returnability), and the subset relation between them is enforced by a convention test in one
  direction only — a route carrying the flag but missing from the name set is still unpoliced. Route
  meta is merged from parents, so a future parent-level `returnability` would silently apply to
  children.

## Confirmation

A convention test iterates the real route table and asserts every `AUTH_ROUTE_NAMES` member carries
`returnability: 'no'`, including a count assertion so a typo'd name cannot make it pass vacuously.
Behavioral tests pin each value end-to-end: `'no'` blocks both back-navigation and last-visited saving,
`'no-but-restore'` blocks back-navigation while still restoring after login, and a route that is
unsaveable but outside `AUTH_ROUTE_NAMES` still bounces an anonymous visitor to login (which pins the
deliberate split between the two predicates). The type-level check is the lookup table itself: widening
the union without extending it is a compile error.

## Links

- Issues: #77 (stale project from non-reactive history state), #78 (unify the definitions)
- Follow-ups: #80 (derive the auth-shell set from meta so the subset relation is enforced both ways),
  #79 (a third back-navigation site still using the legacy path-matching idiom)
- Related ADRs: ADR-0001
