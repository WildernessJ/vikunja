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
  rejects the both-set webhook. The fix closes the class **for `param`-tagged fields on the
  five generic v1 handlers, and for `Webhook.CanCreate` on both API versions**, so a
  refactor of one of those downstream checks cannot silently open it there. Fields without
  a `param` tag (e.g. `Webhook.UserID`) are still body-settable on reads; `Webhook.ReadAll`'s
  own `UserID`-first branch is the one such case found, filed as **#104**.
- **Issues:** #89, #90.
- **Out of scope:**
  - Custom v1 handlers that hand-bind. Two of them carry the #90 shape: `UpdateUserWebhook`
    (`pkg/routes/api/v1/user_webhooks.go:143`) and `DeleteUserWebhook` (`:195`) bare-bind and
    never re-force `w.ID` from the `:webhook` path param, so a body `id` picks the row. Both
    then authorize against the stored row's owner, so no escalation — the URL is silently
    ignored within the caller's own webhooks. `GetTaskAttachment` (`task_attachment.go:113-116`)
    bare-binds on a GET and is saved by `TaskAttachment.ReadOne` re-scoping on `task_id`.
    Filed as **#102**; not this branch.
  - `ProjectView.CanRead`'s missing `GetProjectViewByIDAndProject` scope (noted by #90 as
    fragile; a separate model change). Filed as **#103**.
  - v2 code changes. The model-level #89 fix covers v2 — `pkg/routes/api/v2/webhooks.go:115`
    forces `ProjectID` from the URL but does **not** clear `Body.UserID` (huma is permissive
    about `readOnly` on input), so v2 carries the identical vector today. v2 gets a regression test (Tests, item 5), no route change.

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
// cannot pull a project webhook onto the owner-only branch (#89). `!= 0`, not
// `> 0`: a negative id (saved-filter pseudo project) must still reach
// Project.CanWrite, which denies it — falling through would allow it.
if w.ProjectID != 0 {
    p := &Project{ID: w.ProjectID}
    return p.CanWrite(s, a)
}
// User-level webhook: user owns it or is creating new
return w.UserID == 0 || w.UserID == a.GetID(), nil
```

Truth table over `(UserID, ProjectID)` for a non-link-share caller with `w.ID == 0` (the
`w.ID > 0` reload replaces both fields from the stored row first, so update/delete land in
the same cells with stored values). Three cells change, all in the direction "a webhook that
names a project is authorized by that project":

| UserID | ProjectID | old | new |
|---|---|---|---|
| 0 | 0 | true (create new user-level) | true |
| me | 0 | true | true |
| other | 0 | false | false |
| 0 | >0 | `Project.CanWrite` | `Project.CanWrite` |
| **me** | **>0** | **true (the #89 bypass)** | **`Project.CanWrite`** |
| **other** | **>0** | **false** | **`Project.CanWrite`** — visible only as a status change: a project writer sending a foreign `user_id` now gets `Create`'s both-set 412 instead of 403. Both reject; no row. |
| 0 | <0 | `Project.CanWrite` → false (`project_permissions.go:31-33`, `ID < 1`) | same |
| other | <0 | false (`other == me`) | false (`CanWrite`, `ID < 1`) |
| **me** | **<0** | **true** (`UserID > 0` wins, `CanWrite` never reached) | **false** — `!= 0` sends it to `CanWrite`; `> 0` would fall through and keep the old allow |

The stored-row reload above it (`if w.ID > 0 { … w.UserID = existing.UserID; w.ProjectID =
existing.ProjectID }`) is unchanged: update/delete already authorize against the row. The
user-level routes never enter the project branch: v1 `CreateUserWebhook`
(`user_webhooks.go:88-122`) forces `UserID`/`ProjectID = 0` and calls `w.Create` directly
without `CanCreate`; v2 `user_webhooks.go:130-131` forces both, then `CanCreate` takes the
`(me, 0)` cell. A body `user_id` on the project route still reaches `Create` and is rejected
there by the mutual-exclusivity check — that is correct: the field is documented read-only
and the caller sent it; the change is that the caller now has to be able to write the
project first.

`Webhook.CanRead` (`webhooks_permissions.go:24-37`) has the mirror shape (`if w.UserID > 0`
first) but is unreachable: `DoReadAll` never calls `CanRead`, and neither API has a webhook
`ReadOne` route. The reachable equivalent is `Webhook.ReadAll`'s own branch
(`webhooks.go:243-246`): a body `user_id` on the project `ReadAll` route selects the user-level
list, and a foreign `user_id` there returns `ErrGenericForbidden`. Not a leak; not touched
here — tracked as #104 (same branch-order shape, same file).

No ADR: bugfix, no alternatives with lasting consequences.

## Implementation plan

Backend only, four files plus tests.

1. `pkg/web/handler/read_one.go` — replace the `ctx.Bind` block (lines 38-45) with
   `if err := bindAndForcePathValues(ctx, currentStruct); err != nil { return err }`. Drop
   the now-unused imports (`errors`, `fmt`, `log`, `models`).
2. `pkg/web/handler/read_all.go` — same swap at lines 46-53. `log` stays (used at lines 62
   and 77); drop `errors`, `fmt`, `models` if unused.
3. `pkg/models/webhooks_permissions.go` — reorder `canDoWebhook` as above.
4. `pkg/web/handler/helper.go` — update the helper's doc comment: it says the read handlers
   "can reuse it" and "a fourth time" (line 50); make it say all five generic handlers call
   it.

Edge cases the executor must hold:
- `ReadAllWeb` structs bind query params (`page`, `per_page`, `s`, filter fields) via
  `ctx.Bind`; `BindPathValues` touches only `param`-tagged fields, so query binding is
  unaffected. If a test that passes a query param to a read route goes red, that is the
  stop criterion, not something to work around.
- The helper's documented invariant (every `param`-tagged field is int64 or string kind)
  holds for the read-only structs too. `TaskCollection` (`ReadAllWeb` on `routes.go:661,
  662, 689`), `AdminProjectList` and `adminapi.UserList` (`:954-971`, no path params) were
  outside #86's write-handler audit, so the plan-phase verifier re-audited every `param` tag
  repo-wide — 112 `int64`, 8 `string`, 1 `RelationKind` (named string). `echo@v5.3.1 bind.go:274-284` only recurses into untagged non-pointer
  struct fields, so `ProjectView.Filter *TaskCollection` is not re-bound by the second pass.
  No further audit needed.

## Execution routing

- **Driver-run** (Opus build session), no dispatch: four files, ~30 lines net, no design
  latitude. `executor` tier would be overhead.
- **Invoke the `crudable` skill before editing `webhooks_permissions.go`** (AGENTS.md: any
  changed `Can*` method).
- **`security` agent: not at build.** The change narrows two permission surfaces; the
  review session may dispatch `security` alongside the verifier if it judges the reorder in
  `canDoWebhook` worth an independent adversarial pass. Recorded here so review does not
  have to decide cold.

## Tests (red-first)

Handler tests in `pkg/webtests/`, model test in `pkg/models/`. Run with `mage test:web`
(the whole `pkg/webtests` package; `mage test:feature` runs it under `-short`, which
`main_test.go:25-31` turns into a false green over zero tests) and `mage test:filter <Name>`
(unanchored regex on the top-level `Test*` name). Tests marked **red-first** must fail on
`main` for the stated reason before their fix lands and pass after; record both runs in the
Execution Log. Tests marked **guard** are green on `main` and stay green.

**Global registry:** `availableWebhookEvents` is populated only by `RegisterListeners`,
which the webtests harness never calls. Any test that creates a webhook must first call
`models.RegisterEventForWebhook(&models.TaskUpdatedEvent{})` at the top of its `Test*`
function, as `huma_webhook_test.go:49-52` does — otherwise `Create` rejects the event with
412 and the test only passes when another file happened to run first.

Error assertions: the two `Project.CanRead` / `CanCreate` denials surface differently.
`Webhook.ReadAll` returns `models.ErrGenericForbidden` (`webhooks.go:255`, the project
branch's `CanRead` failure) → assert
`assertHandlerErrorCode(t, err, models.ErrorCodeGenericForbidden)`. The generic handlers'
`DoReadOne` / `DoCreate` return `handler.ErrGenericForbidden` (`core.go:49,89`), whose
`web.HTTPError` has `HTTPCode: 403` and **no** `Code` (`handler/error.go:49-55`) → assert
`assert.Equal(t, http.StatusForbidden, getHTTPErrorCode(err))` (`integrations.go:271`), never
a code of 0 (tautological). `models.ErrCodeForbidden` does not exist.

**#90 — body cannot override the URL on reads.** Fixtures: project 1 is user1's, project 2
is owned by user3 and not shared to user1; view 4 is in project 1; webhook 1 is in project 1.

1. **red-first** — `webhook_test.go` `ReadAll` → new sub-test *"Body cannot re-target the
   URL's project"*: user1, URL `project=2`, body `{"project_id":1}`. The read helpers
   (`testReadAllWithUser`, `testReadOneWithUser`) hard-code an empty payload, so build the
   request by hand and assign the handler first — `ReadAllWeb` has a pointer receiver and
   `getHandler()` returns a value, so `testHandler.getHandler().ReadAllWeb` does not compile:
   ```go
   hndl := testHandler.getHandler()
   _, err := newTestRequestWithUser(t, http.MethodGet, hndl.ReadAllWeb, &testuser1,
       `{"project_id":1}`, nil, map[string]string{"project": "2"})
   ``` **Red on main:** 200 listing project 1's webhook under project 2's URL (bound
   `ProjectID` is 1, `Project.CanRead` passes). **Green:**
   `assertHandlerErrorCode(t, err, models.ErrorCodeGenericForbidden)`.
2. **red-first** — new `pkg/webtests/project_view_v1_test.go`, function
   **`TestProjectViewV1`** (`TestProjectView` is taken by `huma_project_view_test.go:47`),
   harness `webHandlerTest{user: &testuser1, strFunc: func() handler.CObject { return
   &models.ProjectView{} }, t: t}`. `ReadOne` → *"Body cannot re-target the URL's project"*:
   URL `project=2, view=4`, body `{"project_id":1}`, built the same way as test 1 (`hndl :=
   …; hndl.ReadOneWeb`) — `testReadOneWithUser` sends no body and would be green on `main`.
   **Red on main:** 200 with view 4 (bound
   `ProjectID`=1, `CanRead` passes, `GetProjectViewByIDAndProject(4, 1)` finds it).
   **Green:** `getHTTPErrorCode(err) == 403`. Plus a **guard** *"Normal"* sub-test (URL
   `project=1, view=4`, no body → 200, body contains `"title":"Kanban"`).

**#89 — body `user_id` cannot short-circuit `CanCreate`.**

3. `webhook_test.go` → new `Create` group. Add the `RegisterEventForWebhook` call at the
   top of `TestWebhook` first (see Global registry above); without it *"Normal"* fails
   standalone under `mage test:filter TestWebhook`.
   - **guard** *"Normal"*: user1, URL `project=1`, body `{"target_url":"https://example.com/ok",
     "events":["task.updated"]}` → no error, row exists. (Distinct URL from the bypass case
     so `AssertMissing` below cannot be tripped by this row if fixture reload is ever
     hoisted out of the per-request path.)
   - **red-first** *"Body user_id cannot bypass the project permission"*: user1, URL
     `project=2`, body `{"target_url":"https://example.com/x","events":["task.updated"],
     "user_id":1}`. **Red on main:** `canDoWebhook` takes the user branch, `Create` then
     fails with the mutual-exclusivity `ValidationHTTPError` (`Code: ErrCodeInvalidData`,
     HTTP 412) — the gate was passed. Assert `getHTTPErrorCode(err) == 403` (fails on main
     with 412). `db.AssertMissing(t, "webhooks", map[string]interface{}{"target_url":
     "https://example.com/x"})`.
   - **guard** *"Without user_id is forbidden as before"*: same minus `user_id` → 403.
4. **red-first** — `pkg/models/webhooks_permissions_test.go` (does not exist; the only
   model-level `Webhook.Can*` call today is `link_sharing_test.go:466`, `CanRead`'s
   link-share early return). Table over `CanCreate(s, &user1)` with `db.LoadAndAssertFixtures`
   and a session: `{ProjectID: 2, UserID: 1}` → false (red on main: true);
   `{ProjectID: 1, UserID: 1}` → true (project writable; both-set is `Create`'s job);
   `{UserID: 1}` → true; `{UserID: 2}` → false; `{ProjectID: -1}` → false (green on main;
   a `> 0` implementation turns it true); `{ProjectID: -1, UserID: 1}` → false (red on main:
   true, the `UserID > 0` short-circuit; also true under `> 0`). Name the function
   `TestWebhook_Permissions` so `mage test:filter TestWebhook_Permissions` runs it alone. The v2 permission matrix in `huma_webhook_test.go` (webhooks 2–5) and
   `huma_user_webhook_test.go` must stay green untouched.
5. **red-first** — `huma_webhook_test.go` `Create` group → *"Body user_id cannot bypass the
   project permission"*: the `forbidden` harness already bound at `:75` (`on("2")`),
   `forbidden.testCreateWithUser(nil, nil, body-with-user_id-1)`. **Red on main:** v2 forces
   `Body.ProjectID` (`webhooks.go:115`) but not `Body.UserID`, so the same short-circuit
   passes and `Create`'s `InvalidFieldError` surfaces as **422** (v2 maps
   `ValidationHTTPError` to 422, see `:152-155`). **Green:** `assert.Equal(t,
   http.StatusForbidden, getHTTPErrorCode(err))`, the file's idiom at `:148-150`.

## Verification

From the worktree root (`.worktrees/v1-bind-hardening`). `docs/context/PITFALLS.md` and
`.workflow.yaml` (source of `test_command`) are git-excluded and live only in the main
checkout (`../../`).

```bash
mage test:filter TestWebhook_Permissions 2>&1 | tee /tmp/whp.log   # the new model table (name it so)
mage test:web                            2>&1 | tee /tmp/web.log    # all of pkg/webtests, incl. the four handler tests
TZ=UTC mage test:feature                 2>&1 | tee /tmp/feature.log   # test_command; red without TZ=UTC (TestCleanupOldTokens, PITFALLS)
mage lint                                2>&1 | tee /tmp/lint.log      # golangci-lint v2.13.0 built with go 1.27 (PITFALLS)
```

Done looks like: the five red-first tests fail on `main` for the stated reasons and pass on
the branch (record the failing output for each in the Execution Log); `mage test:web` green;
`TZ=UTC mage test:feature` green; `mage lint` 0 issues; `git status --porcelain
--untracked-files=all` empty. No frontend change, so no typecheck / build step. Live-verify:
the classifier will mark this `non-live` (backend-only); a curl differential against dev is
optional evidence, not a gate. `pkg/e2etests` and `pkg/caldavtests` skip under `-short` and
are not run here; their webhook tests insert rows directly and never send a body `user_id`,
so the reorder cannot reach them.

## Stop criteria

- A read route's existing webtest goes red after the `bindAndForcePathValues` swap for a
  reason other than a body override (e.g. a query-bound field lost) → halt, log, back to plan.
- A `param`-tagged field turns out not to be int64/string kind → halt; the helper's invariant
  is wrong and #86 needs revisiting, not this branch.
- The `canDoWebhook` reorder breaks any existing test in `huma_webhook_test.go` /
  `huma_user_webhook_test.go` (run via `mage test:web`, not `test:feature`) → halt; the
  truth table in Design is wrong. (Weak signal — no existing test sends a webhook
  `user_id`, so only the new tests exercise the changed cells; kept as a tripwire.)
- Any fix that wants a new file outside `pkg/web/handler`, `pkg/models/webhooks*`, or
  `pkg/webtests` → halt.
- Any change to a v2 route file → halt; the model fix is supposed to cover v2 without one.

## Execution Log

Build session 2026-09-11 (Opus 5, driver-run, no dispatch; `crudable` loaded before the
permission edit).

**Red on `main` code (tests added, fix not yet applied):**

1. `TestWebhook/ReadAll/Body_cannot_re-target_the_URL's_project`: `Error is nil`. The read
   returned 200 under project 2's URL.
2. `TestProjectViewV1/ReadOne/Body_cannot_re-target_the_URL's_project`: `An error is expected
   but got nil`. View 4 was returned under project 2's URL. The guard *Normal* sub-test passed.
3. `TestWebhook/Create/Body_user_id_cannot_bypass_the_project_permission`: `expected: 403,
   actual: 412`. The gate was passed and `Create`'s both-set check rejected. The guards
   *Normal* and *Without user_id is forbidden as before* passed.
4. `TestWebhook_Permissions`: exactly two cells failed, `{ProjectID: 2, UserID: 1}` and
   `{ProjectID: -1, UserID: 1}` (`expected: false, actual: true`). The other four cells
   passed, `{ProjectID: -1}` included.
5. `TestHumaWebhook/Create/Body_user_id_cannot_bypass_the_project_permission`: `expected:
   403, actual: 422`.

**Green after the fix:** `mage test:filter TestWebhook_Permissions` ok; `mage test:web` ok
(the full `pkg/webtests` package, not `-short`, which includes all four handler tests and the
untouched v2 webhook and user-webhook matrices); `TZ=UTC mage test:feature` ok with 0 FAIL;
`mage lint` reported 0 issues.

**Deviations:** none from the implementation plan. `read_all.go` keeps `log` (it is still
used). No stop criterion was hit: no existing read-route test went red, and no v2 route file
changed.

**Notes for review:**

- The *Normal* create guard asserts the row with `db.AssertExists(…, "project_id": 1)`. This
  pins the URL-derived parent, not only that the row exists.
- The two red runs used different `mage test:filter` expressions. The first pass also
  matched `TestWebhook_Permissions`, and its `-short` failure stopped mage before the
  `pkg/webtests` re-run. So the handler tests were run red separately, with
  `'TestWebhook$|TestProjectViewV1|TestHumaWebhook$'`.

**Build-session verifier loop (requested by Jason; capped at 3 rounds, same-class stop).**
This loop does not replace `/flow review`. Round 1 (verifier, HEAD `23503e900`): SURVIVES,
no findings on either axis. The verifier reverted each fix in turn and re-ran the tests.
Only the matching new tests failed, so no new test is tautological. It also confirmed that
`invalidModelErr` is the same mapping as the removed inline blocks, and that no `param` tag
is outside int64/string kind (121 hits). The loop ended at round 1 with no code change.
