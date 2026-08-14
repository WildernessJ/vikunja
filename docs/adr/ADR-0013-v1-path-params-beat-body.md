---
status: Accepted
date: 2026-08-14
deciders: fork maintainer
phase: —
---

# ADR-0013: On `/api/v1`, URL path params beat the request body, enforced at the generic handler layer

## Context

Echo v5's default binder applies sources in order — path params first, then query, then the request
body — and each step may overwrite what the previous step bound. On `/api/v1` this means a body field
whose `param` tag names a segment the route already carries wins the tie against the URL.

That is not merely cosmetic, because model-level permission checks compare against the **bound**
value. A guard that reads "does the bucket's stored view match the view being asked for?" is
answered with a value the caller controls twice: once in the path, once in the body. The URL says one
thing, the check sees another. A guard added in an earlier change (ADR-0012's neighbourhood, issue
\#84) was written on the assumption that the bound value came from the URL, and was therefore
satisfiable by echoing the stored value in the body.

The generic CRUD handlers in `pkg/web/handler/` serve 57 v1 routes that carry path params, so this is
a property of the framing, not of any one model. `/api/v2` (Huma-backed) already forces the URL over
the body per handler, so the two APIs disagreed on precedence.

Notably, the first attempt at this fix scoped it to create only, reasoning that update and delete
were covered because their `Can*` methods compare against a stored record. That reasoning was
inverted — the comparison uses the bound value — and it was disproved by probe, not by argument,
during review. The decision below is the corrected form.

## Decision

Path params win. After binding a v1 request, the generic `CreateWeb`, `UpdateWeb` and `DeleteWeb`
handlers re-apply the URL's path params via `echo.BindPathValues`, so a body value can never contradict
a segment the route names. This is enforced once, in a shared helper (`bindAndForcePathValues` in
`pkg/web/handler/helper.go`), rather than per route or per model — matching the precedence `/api/v2`
already implements, and making the guarantee a property every current and future generic v1 route
inherits.

## Alternatives considered

- **A — Per-route wrapper on the affected endpoints.** Rejected: it fixes the routes someone thought
  to name and leaves every sibling holed. The defect is in the shared framing, so the fix belongs there;
  one guard in the common path is also a smaller diff than a guard in each caller.
- **B — Replace echo's `Binder` wholesale.** Rejected as disproportionate: it changes binding for
  every request to change the order of two steps, and it puts the fork on a divergent binder that must
  be re-reconciled on every upstream echo bump.
- **C — Add the URL-vs-body comparison to each model's `Can*` method.** Rejected: it spreads a framing
  concern across dozens of models and depends on every future model author remembering it — the same
  failure mode that produced the original defect.
- **D — Leave it and validate in each guard.** Rejected: a guard cannot distinguish a body-supplied
  value from a URL-supplied one after binding has flattened them into one field.

## Consequences

- **Positive:** the guarantee holds for all 57 generic v1 write routes at once, including routes added
  later, with no per-model discipline required. The two APIs now agree on precedence. A guard written
  against the bound value is now written against the URL, which is what its author meant.
- **Positive:** it removes a class of same-tenant integrity corruption in which a record could be
  written into a container the caller never named in the path.
- **Negative:** a client that relied on the body correcting its own URL now gets an error instead of a
  silent fixup. One such case shipped: two routes bind their `:user` segment as a username while their
  published annotations wrongly declared a numeric ID. The annotations were corrected here; the
  behavior change is deliberate, because username-in-path is the settled semantics in both the web
  client and `/api/v2`.
- **Negative:** the re-force costs a second reflection pass per request and depends on re-binding
  being idempotent. That holds because every `param`-tagged field is of int64 or string kind; a future
  field with a stateful custom unmarshaler would break it. The invariant is documented at the helper
  and not otherwise enforced.
- **Scope limit, deliberate:** the read handlers (`ReadOneWeb`/`ReadAllWeb`) were left on the old
  binding order and tracked as a follow-up (issue #90) rather than changed without the same review.
  Each read path was walked and none was found to convert into an escalation, because they re-scope to
  the URL-derived parent or authorize against the stored record — but that is a property of today's
  models, not a guarantee the framing provides. Until it lands, "the URL wins" is true of v1 writes,
  not of v1 reads.

## Confirmation

Five webtests in `pkg/webtests/kanban_test.go` pin the behavior on the kanban routes (bucket create,
update, delete, and the v1 task-bucket move); each fails if the re-force is removed, verified by
substituting a no-op implementation and re-running the package.

Two honest limits on that confirmation, recorded rather than glossed: the guard covers the kanban
routes only — the other affected routes have no regression test, so a later narrowing of the re-force
would go unnoticed by the suite — and the test harness sets path values directly rather than routing a
real request, so "only segments present in the matched route are re-applied" is relied upon but not
exercised against the real route table. Both are candidates for a mechanical check (assert over the
route table and the `param` tag inventory) rather than more hand-walking, which was refuted three
times during this change's review.

## Links

- Related ADRs: ADR-0012 (bucket invariant enforced per write-site)
