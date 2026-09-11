# Spec: v1 handler binding hardening (#89, #90)

## Intent

- **Problem.** Two latent, same-class defects left by the #86 review: a request body can
  still set a value the route or the permission model already fixes.
  - **#90** — the generic v1 `ReadOneWeb` / `ReadAllWeb` handlers still use the bare
    `ctx.Bind`. echo v5 binds the body on every method with a non-zero `Content-Length`,
    so a GET carrying a JSON body binds it over the URL's path params on every v1 read
    route. `CreateWeb` / `UpdateWeb` / `DeleteWeb` were fixed in #86 via
    `bindAndForcePathValues`; the read pair was left on the old inline bind.
  - **#89** — `Webhook.canDoWebhook` (`pkg/models/webhooks_permissions.go`) checks the
    user-level branch first: `if w.UserID > 0 || w.ProjectID == 0 { return w.UserID == 0 ||
    w.UserID == a.GetID() }`. `Webhook.UserID` is `json:"user_id"` with no `param` tag, so a
    project-webhook create as a user with no access to the project passes `CanCreate` by
    sending `"user_id": <own id>`. Only `Webhook.Create`'s mutual-exclusivity check
    (`webhooks.go:171-177`) stops the row being written.
- **Not exploitable today** (both issues' verifiers attacked every route): every read model
  re-scopes to the URL parent downstream or authorizes against the stored row, and `Create`
  rejects the both-set webhook. The fix closes the class so a refactor of one of those
  downstream checks cannot silently open it.
- **Issues:** #89, #90.
- **Out of scope:** the custom (non-generic) v1 handlers that hand-bind (`user_webhooks.go`,
  CalDAV, etc. — they already force their fields); `ProjectView.CanRead`'s missing
  `GetProjectViewByIDAndProject` scope (noted by #90 as fragile; a separate model change,
  file an issue only if the build finds it needed); v2, which already forces URL-over-body per
  handler.

## Design (settled)

**#90 — reuse the #86 helper.** `ReadOneWeb` and `ReadAllWeb` call `bindAndForcePathValues`
exactly as `create.go` / `update.go` / `delete.go` do. The helper already takes `any` and its
doc comment names the read handlers as intended callers. The inline `errors.As` /
`ErrInvalidModel` block in both files is deleted — the helper's `invalidModelErr` is the same
mapping. No behavior change for a bodiless GET: `ctx.Bind` still binds path and query params
first, then `BindPathValues` re-applies the path params over whatever the body set. Verified
before filing: no struct in the codebase carries both a `param` and a `query` tag on one
field, so path-over-query changes nothing.

**#89 — fix at the model, not the route.** The issue proposes clearing body `user_id` on the
project-webhook route "before the permission check", copying `user_webhooks.go:99-101`. That
route is the generic `CreateWeb` with no custom handler to put the line in, and AGENTS.md
puts permission logic in the model. The real defect is the branch order in `canDoWebhook`:
**a webhook that names a project is a project webhook**, so the project branch must win.
Reorder:

```go
// Project-level webhook: delegate to project. Checked first so a body user_id
// cannot pull a project webhook onto the owner-only branch (#89).
if w.ProjectID > 0 {
    p := &Project{ID: w.ProjectID}
    return p.CanWrite(s, a)
}
// User-level webhook: user owns it or is creating new
return w.UserID == 0 || w.UserID == a.GetID(), nil
```

The stored-row reload above it (`if w.ID > 0 { … w.UserID = existing.UserID; w.ProjectID =
existing.ProjectID }`) is unchanged: update/delete already authorize against the row. Both
user-level routes (v1 `CreateUserWebhook`, v2 `user_webhooks.go:130-131`) force
`ProjectID = 0` before `CanCreate`, so they never enter the project branch. A body `user_id`
on the project route still reaches `Create` and is rejected there by the mutual-exclusivity
check — that is correct: the field is documented read-only and the caller sent it; the
change is that the caller now has to be able to write the project first.

`CanRead` has the mirror shape (`if w.UserID > 0` first). Reviewed and left alone: on the
project `ReadAll` route a body `user_id` selects the caller's own user-webhook list
(`webhooks.go:239-241`), which is data the caller owns. Not a leak; not touched, to keep
the diff to the reported class.

No ADR: bugfix, no alternatives with lasting consequences.

## Implementation plan

Backend only, four files plus tests.

1. `pkg/web/handler/read_one.go` — replace the `ctx.Bind` block (lines ~38-45) with
   `if err := bindAndForcePathValues(ctx, currentStruct); err != nil { return err }`. Drop
   the now-unused imports (`errors`, `fmt`, `log`, `models`) if nothing else in the file
   uses them.
2. `pkg/web/handler/read_all.go` — same swap at lines ~46-53, same import cleanup.
3. `pkg/models/webhooks_permissions.go` — reorder `canDoWebhook` as above.
4. `pkg/web/handler/helper.go` — update the helper's doc comment: it now says the read
   handlers "can reuse it"; make it say all five generic handlers do.

Edge cases the executor must hold:
- `ReadAllWeb` structs bind query params (`page`, `per_page`, `s`, filter fields) via
  `ctx.Bind`; `BindPathValues` touches only `param`-tagged fields, so query binding is
  unaffected. If a test that passes a query param to a read route goes red, that is the
  stop criterion, not something to work around.
- A `param`-tagged field of a kind other than int64/string would fail the helper's
  documented invariant; #86 already audited this and the read handlers bind the same
  structs, so no new risk. Do not audit again.

## Execution routing

- **Driver-run** (Opus build session), no dispatch: four files, ~30 lines net, no design
  latitude. `executor` tier would be overhead.
- **`security` agent: not at build.** The change narrows two permission surfaces; the
  review session may dispatch `security` alongside the verifier if it judges the reorder in
  `canDoWebhook` worth an independent adversarial pass. Recorded here so review does not
  have to decide cold.

## Tests (red-first)

All in `pkg/webtests/`, run with `mage test:filter <name> 2>&1 | tee /tmp/out.log`. Each
must fail on `main` for the stated reason before its fix lands, and pass after. Record
both runs in the Execution Log.

**#90 — body cannot override the URL on reads.** Fixtures: project 1 is user1's, project 2
is owned by user3 and not shared to user1; view 4 is in project 1; webhook 1 is in project 1.

1. `webhook_test.go` `ReadAll` → new sub-test *"Body cannot re-target the URL's project"*:
   user1, URL `project=2`, body `{"project_id":1}`, via `newTestRequestWithUser(t,
   http.MethodGet, hndl.ReadAllWeb, &testuser1, body, nil, params)` (the
   `testReadAllWithUser` helper takes no payload). **Red on main:** 200 listing project 1's
   webhook under project 2's URL (bound `ProjectID` is 1, `CanRead` passes). **Green:**
   error, `assertHandlerErrorCode(t, err, models.ErrCodeForbidden)` — check the exact code
   `Project.CanRead` surfaces for a no-access user by reading a sibling forbidden test
   (`huma_webhook_test.go` has the v2 matrix) rather than guessing.
2. New `project_view_test.go` (v1 harness, `webHandlerTest{strFunc: &models.ProjectView{}}`)
   `ReadOne` → *"Body cannot re-target the URL's project"*: user1, URL `project=2, view=4`,
   body `{"project_id":1}`. **Red on main:** 200 with view 4 (bound `ProjectID`=1,
   `CanRead` passes, `GetProjectViewByIDAndProject(4, 1)` finds it). **Green:** forbidden.
   Include one *"Normal"* sub-test (URL `project=1, view=4`, no body → 200, body contains
   `"title":"Kanban"`) so the file is not only a negative case.

**#89 — body `user_id` cannot short-circuit `CanCreate`.**

3. `webhook_test.go` → new `Create` group:
   - *"Normal"*: user1, URL `project=1`, body `{"target_url":"https://example.com/x",
     "events":["task.updated"]}` → 201/200, row exists.
   - *"Body user_id cannot bypass the project permission"*: user1, URL `project=2`, body
     `{"target_url":"https://example.com/x","events":["task.updated"],"user_id":1}`.
     **Red on main:** the error is the model's mutual-exclusivity error from `Create`
     (permission gate passed — that is the bug); assert the code is **not** that error
     and **is** forbidden. Pin the exact forbidden code the same way as test 1.
     `db.AssertMissing(t, "webhooks", {"target_url": "https://example.com/x"})`.
   - *"Without user_id is forbidden as before"*: same as above minus `user_id` → forbidden
     (regression guard that the reorder did not loosen the no-body path).
4. `pkg/models/webhooks_permissions_test.go` (create if absent; check first) — unit
   coverage of the reorder against the fixture DB: `(&Webhook{ProjectID: 2, UserID: 1})
   .CanCreate(s, &user1)` → false; `(&Webhook{ProjectID: 1, UserID: 1}).CanCreate` → true
   (project writable, the both-set case is `Create`'s job); `(&Webhook{UserID: 1})
   .CanCreate` → true; `(&Webhook{UserID: 2}).CanCreate(s, &user1)` → false. The v2
   permission matrix in `huma_webhook_test.go` (webhooks 2–5) must stay green untouched.

## Verification

From the worktree root (`.worktrees/v1-bind-hardening`):

```bash
mage test:filter TestWebhook      2>&1 | tee /tmp/wh.log
mage test:filter TestProjectView  2>&1 | tee /tmp/pv.log
mage test:feature                 2>&1 | tee /tmp/feature.log   # test_command
mage lint                         2>&1 | tee /tmp/lint.log      # golangci-lint v2.13.0, see PITFALLS
```

Done looks like: the four new red-first tests fail on `main` for the stated reasons and pass
on the branch; `mage test:feature` green (the two TZ-dependent upstream tests run under
`TZ=UTC`, see PITFALLS); `mage lint` 0 issues; `git status --porcelain --untracked-files=all`
empty. No frontend change, so no typecheck / build step. Live-verify: the classifier will
mark this `non-live` (backend-only); a curl differential against dev is optional evidence,
not a gate.

## Stop criteria

- A read route's existing webtest goes red after the `bindAndForcePathValues` swap for a
  reason other than a body override (e.g. a query-bound field lost) → halt, log, back to plan.
- A `param`-tagged field turns out not to be int64/string kind → halt; the helper's invariant
  is wrong and #86 needs revisiting, not this branch.
- The `canDoWebhook` reorder breaks any test in `huma_webhook_test.go` /
  `huma_user_webhook_test.go` → halt; the user-level routes do not force `ProjectID = 0`
  the way the plan claims.
- Any fix that wants a new file outside `pkg/web/handler`, `pkg/models/webhooks*`, or
  `pkg/webtests` → halt.

## Execution Log

_(build phase appends: assumptions, deviations, red/green evidence per test)_
