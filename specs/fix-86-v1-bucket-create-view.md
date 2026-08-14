# fix-86-v1-bucket-create-view — v1 create body must not override the URL's path params

## Intent

**Problem (issue #86):** echo v5's `DefaultBinder.Bind` binds path params first, then the
request body — the body COULD override path-bound values (echo v5.3.1 `bind.go:122-137`).
On `PUT /projects/:project/views/:view/buckets`, a body `project_view_id` therefore
overrides the URL's view, and `Bucket.CanCreate` has no stored bucket to compare against,
so a v1 create can inject a bucket into another view of the same project (probe-verified
in the #84 session). Same-project only — integrity corruption, not privilege escalation.
Downstream: an injected bucket in a list view trips `hasBuckets` in
`syncManualKanbanBuckets`, so a later kanban switch heals instead of creating defaults.

**Out of scope:**
- v1 **update** routes. #84 deliberately chose *reject-on-mismatch* semantics for bucket
  update (`canDoBucket` 404s when body view ≠ stored view); forcing path values there
  would silently revert that to ignore-the-body. Decided with Jason 2026-08-14: leave
  update as-is.
- v2 (already forces URL over body per-handler, e.g. `pkg/routes/api/v2/buckets.go:114-115`).
- #87 (stale default in repeating-task done routing) — separate issue.

## Design

**Settled (Jason picked option B of A/B/C):** fix the class at the shared v1 binding
site, creates only. In `pkg/web/handler/create.go`, after `ctx.Bind(currentStruct)`
succeeds, call `echo.BindPathValues(ctx, currentStruct)` to re-apply path params so the
URL wins over the body — the same semantics v2 implements per-handler.

Why this is safe and sufficient:
- `BindPathValues` only sets fields whose `param` tag matches a segment **present in the
  route's URL** — routes without a `:view` (etc.) segment are untouched, and legit
  clients (the frontend) fill body and URL from the same model, so behavior only changes
  on mismatch, which is exactly the corruption vector.
- Re-running path binding after `Bind` is idempotent for matching values; it's the same
  code path `Bind` already ran first.
- Model-level enforcement is structurally impossible for create: `CanCreate` has no
  stored record and cannot see the raw URL param (issue #86's analysis).

Rejected alternatives: (A) also patching `update.go` — reverts #84 semantics and its
webtests for no probed defect; (C) bucket-route-only wrapper — leaves the same hole open
on ~20 other v1 create routes with path params (tasks, shares, comments, teams, …).

## Implementation plan

- `pkg/web/handler/create.go` (`CreateWeb`, after the `ctx.Bind` error check, before
  `ctx.Validate`): call `echo.BindPathValues(ctx, currentStruct)`; on error, wrap the
  same way the `ctx.Bind` error is wrapped (`models.ErrInvalidModel`). One tight comment
  naming the why (body COULD override path-bound values; URL is authoritative).
- `pkg/webtests/` — repro + guard tests (see Tests). Follow the existing bucket webtest
  setup from the #84 work (`pkg/webtests/api_v1_kanban_test.go` or wherever bucket
  create webtests live; reuse existing fixtures/harness, no new fixtures unless forced).
- No migration, no frontend change, no i18n (no new user-facing string), no v2 change.

Edge cases to keep in mind:
- Validate runs **after** the re-force, so validation sees the effective (URL) values.
- `subscriptions/:entity/:entityID` binds a string param — `BindPathValues` already
  handles it today on first bind; re-run is the same path.
- If any existing webtest fails because it deliberately relied on body-overrides-URL on
  a create route, that is a **stop criterion** (below), not a test to silently rewrite.

## Execution routing

- **Driver implements directly** — one-line handler change + webtests; no subagent
  dispatch warranted, no tier decision beyond driver.
- **Security agent: yes, at review** — the diff touches request binding at a trust
  boundary. Flag for the review phase; nothing to dispatch during build.

## Tests (red-first, in order)

1. **Repro (#86, must fail before the fix):** webtest — authed user,
   `PUT /projects/1/views/4/buckets` with body
   `{"title":"ProbeCrossView","project_view_id":1}` → assert the created bucket's
   `project_view_id` is **4** (the URL's view). Red today: it lands in view 1.
2. **URL-wins on project too:** same route, body carrying a different (same-permission)
   `project_id` → created bucket belongs to the URL's project/view. (Cheap sibling
   assertion; may fold into test 1's response assertions if the harness makes it
   natural.)
3. **No regression on the happy path:** body with matching `project_view_id` (what the
   real frontend sends) still creates in view 4. Likely already covered by existing
   bucket-create webtests — verify by reading, only add if absent.

Suite: existing `mage test:feature` + `mage test:web` stay green with **zero edits to
existing tests**. Any existing test that breaks = stop criterion.

## Verification

From the MAIN checkout's `.workflow.yaml` commands, run in the worktree:

```bash
mage test:feature 2>&1 | tee /tmp/86-feature.log   # 0 failures
mage test:web     2>&1 | tee /tmp/86-web.log        # 0 failures
mage lint                                            # 0 issues
```

Done looks like: red logs for test 1 captured before the fix; all suites green after;
lint clean; the #86 probe request (test 1) creates in the URL's view.

## Stop criteria

- Any **existing** test fails under the re-force in a way that shows a legitimate
  body-overrides-URL use case on a v1 create route → halt, append findings to the
  Execution Log, hand back to plan. Do not rewrite the test to green.
- `BindPathValues` errors on any route's struct during the suite → same halt.
- More than one fix round after a red suite → halt per the bounded-fix rule.

## Execution Log

(appended by the build session)
