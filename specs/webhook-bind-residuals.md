# Spec: webhook and project-view binding residuals (#102, #104, #103)

## Intent

Close the three latent findings the `v1-bind-hardening` verifier filed (2026-09-11). None is
exploitable today; each is a permission check that holds only because one downstream lookup
happens to re-check what the permission layer should have. Same class as #89/#90.

- **#102** — the three custom v1 handlers the generic-handler fix could not reach
  (`UpdateUserWebhook`, `DeleteUserWebhook`, `GetTaskAttachment`) bare-bind, so a body `id` /
  `task_id` overrides the URL. Saved by the model's owner check (webhooks) and by
  `TaskAttachment.ReadOne`'s `task_id` scope (attachments).
- **#104** — `Webhook.ReadAll` and `Webhook.CanRead` test `w.UserID > 0` before `w.ProjectID`,
  so a body `user_id` on the project list route selects the user-level list. Saved by the
  `w.UserID != a.GetID()` guard. Same branch-order shape #89 fixed in `canDoWebhook`.
- **#103** — `ProjectView.CanRead` authorizes against `pv.ProjectID` without checking that
  view `pv.ID` belongs to that project; `CanUpdate` and `CanDelete` both do. Saved by
  `ProjectView.ReadOne`'s scoped lookup.

Three commits on one branch, in the order #104 → #103 → #102, each with its own red-first
tests. Backend only. No v2 route changes.

## Design (settled)

**#104 — reorder, mirror of #89.** In `Webhook.ReadAll` (`pkg/models/webhooks.go:243-259`)
and `Webhook.CanRead` (`pkg/models/webhooks_permissions.go:24-37`): a webhook that names a
project is a project webhook, so the project branch wins.

```go
if w.ProjectID != 0 {
    // project branch: Project.CanRead, listCond = project_id
} else {
    // user branch: w.UserID == a.GetID() (ReadAll: else ErrGenericForbidden), listCond = user_id
}
```

`!= 0`, not `> 0`, for the reason the #89 table gives: a negative id (saved-filter pseudo
project) must reach `Project.CanRead`, which denies it. Cells that change, non-link-share
caller: `(UserID=me, ProjectID≠0)` was "own user list / true", becomes `Project.CanRead`.
`(0, 0)` is unchanged in outcome: today `Project.CanRead(0)` → false; after, `0 == a.GetID()`
→ false. The two callers that set `UserID` never set `ProjectID` (v2 `userWebhooksList`,
`user_webhooks.go:107`; v1 `GetUserWebhooks` does not call `ReadAll` at all), so the
user-level lists are untouched. The v2 project list (`webhooks.go:96`) sets only
`ProjectID`; Huma binds no body there.

`CanRead` is still unreachable from any route (no webhook `ReadOne`); it is reordered because
it is the same two lines, in the same file, with the same wrong shape, and the review filed it
under #104.

**#103 — add the scope guard `CanUpdate` already has.** In `ProjectView.CanRead`
(`pkg/models/project_view_permissions.go:24-36`), after the saved-filter early return and
before `pp.CanRead`:

```go
if _, err := GetProjectViewByIDAndProject(s, pv.ID, pv.ProjectID); err != nil {
    return false, 0, err
}
```

Verbatim mirror of `CanUpdate` (`:65-67`), no `pv.ID == 0` skip: `DoReadAll` never calls
`CanRead`, and the three other callers (`kanban.go:128`, `task_position.go:111`,
`bot_users_test.go:95`) pass a view they just fetched by id + project, so `ID` is never 0
on any reachable path. A skip would be a silent bypass waiting for a caller that sets only
`ProjectID`. The favorites pseudo-project (negative view ids under
`FavoritesPseudoProjectID`) is handled inside `GetProjectViewByIDAndProject` (`project_view.go`,
first branch), same as for `CanUpdate`.

Accepted cost: `Bucket.ReadAll` and `TaskPosition` permission paths now run one extra
`SELECT … WHERE id = ? AND project_id = ?` per call, on a view they already hold. Same cost
`CanUpdate` already pays. Not worth a second code path.

HTTP surface is unchanged: `ReadOne` already returned `ErrProjectViewDoesNotExist` (404) for a
mismatched pair; now `CanRead` returns it first. The model test is the meaningful one.

**#102 — export the helper, call it from the three handlers.** Rename
`bindAndForcePathValues` → `BindAndForcePathValues` (`pkg/web/handler/helper.go:51`, five
callers in the same package). The three custom handlers replace their `c.Bind(x)` block with
`handler.BindAndForcePathValues(c, x)`.

Rejected alternative: inline `echo.BindPathValues(c, w)` after each existing `c.Bind`. Zero
cross-package churn, but a sixth copy of the bind-then-force pair, and the helper's doc
comment already says an export is the intended route. One place all callers route through.

Error-surface change, accepted: a malformed path param now returns `ErrInvalidModel`
(400, `ErrCodeInvalidModel`) instead of echo's raw bind error (`UpdateUserWebhook`,
`DeleteUserWebhook`) or the hand-written `"No task ID provided"` 400 (`GetTaskAttachment`).
Same status; the generic handlers already answer this way. `GetTaskAttachment` drops its
`echo.NewHTTPError(...).Wrap(err)` line.

What the fix does and does not change per handler:

| handler | forced from URL | authorizes against | before | after |
|---|---|---|---|---|
| `UpdateUserWebhook` | `ID` (`:webhook`) | stored row owner via `CanUpdate` reload | body `id` picks the row, URL ignored | URL picks the row |
| `DeleteUserWebhook` | `ID` (`:webhook`) | same | same | same |
| `GetTaskAttachment` | `ID` (`:attachment`), `TaskID` (`:task`) | `Task.CanRead(TaskID)` then `ReadOne` scope | body `task_id` picks the task the permission check runs against | URL picks it |

`CreateUserWebhook` (`user_webhooks.go`) already forces `UserID`/`ProjectID` by hand on a
route with no path params; untouched.

No ADR: three bugfixes, no alternative with lasting consequences.

## Implementation plan

Backend only. Three commits, in this order so each is reviewable alone.

**Commit 1 — `fix(webhooks): check the project branch before the user branch in ReadAll and CanRead (#104)`**
1. `pkg/models/webhooks.go` `ReadAll`: swap the `if w.UserID > 0 { … } else { … }` to
   `if w.ProjectID != 0 { project } else { user }`. Rewrite the comment above it: "A webhook
   that names a project is a project webhook; checked first so a body `user_id` cannot select
   the caller's own user-level list under a project URL (#104)."
2. `pkg/models/webhooks_permissions.go` `CanRead`: same swap. Drop the two "User-level /
   Project-level" what-comments.
3. Tests: items 1–2 below.

**Commit 2 — `fix(project-views): scope CanRead to the path project like CanUpdate (#103)`**
4. `pkg/models/project_view_permissions.go` `CanRead`: insert the guard after the
   saved-filter branch. Reuse `CanUpdate`'s one-line comment.
5. Tests: item 3 below.

**Commit 3 — `fix(api): force path params in the custom v1 webhook and attachment handlers (#102)`**
6. `pkg/web/handler/helper.go`: rename to `BindAndForcePathValues`; update the doc comment's
   last sentence (it currently says "unexported, so a custom v1 handler (#102) needs an export
   before it can reuse it") to name the three v1 callers.
7. `pkg/web/handler/{create,update,delete,read_one,read_all}.go`: rename call sites.
8. `pkg/routes/api/v1/user_webhooks.go` `UpdateUserWebhook`, `DeleteUserWebhook`: replace
   `c.Bind(w)` with `handler.BindAndForcePathValues(c, w)`. Add the
   `"code.vikunja.io/api/pkg/web/handler"` import (the file has none today).
9. `pkg/routes/api/v1/task_attachment.go` `GetTaskAttachment`: replace the `c.Bind` block
   (`:113-116`) with the helper call; drop the `http.StatusBadRequest` wrap. Check whether
   `net/http` is still imported elsewhere in the file before removing it.
10. Tests: items 4–6 below.

Edge cases the executor must hold:
- `Webhook.ID` carries `param:"webhook"` and `TaskAttachment.ID` / `TaskID` carry
  `param:"attachment"` / `param:"task"` (`webhooks.go:53`, `task_attachment.go:43-44`), all
  `int64` — the helper's kind invariant holds; nothing to re-audit.
- `readOnly:"true"` on those fields does not stop the body from binding (the prior spec
  verified this; it is why #102 exists).
- `Webhook.Update` writes only `Cols("events")`, so a forced `ID` with a body carrying other
  fields still mutates events only.

## Execution routing

- **Driver-run** (Opus build session), no dispatch: ~40 lines net across nine files, no design
  latitude. `executor` tier is overhead.
- **Invoke `crudable` before editing `webhooks_permissions.go` and
  `project_view_permissions.go`** (AGENTS.md: any changed `Can*` method).
- **`security` agent: not at build.** Three permission-surface narrowings; the review session
  may dispatch `security` alongside the verifier if it wants an independent pass on the
  `ReadAll` reorder. Recorded so review does not decide cold.

## Tests (red-first)

Handler tests in `pkg/webtests/`, model tests in `pkg/models/`. Run with `mage test:web` for
the whole `pkg/webtests` package (`mage test:feature` runs it under `-short`, which
`main_test.go:25-31` turns into a false green over zero tests) and `mage test:filter <Name>`
for one function (unanchored regex on the top-level `Test*` name). **red-first** tests must
fail on `main` for the stated reason and pass after their commit; record both runs in the
Execution Log. **guard** tests are green on `main` and stay green.

Error assertions, as the prior spec settled them: model-layer `ErrGenericForbidden` →
`assertHandlerErrorCode(t, err, models.ErrorCodeGenericForbidden)`; typed model errors →
their `ErrCode*`; generic-handler `handler.ErrGenericForbidden` carries no code →
`assert.Equal(t, http.StatusForbidden, getHTTPErrorCode(err))`.

Fixtures used: project 1 is user1's; project 2 is user3's, not shared to user1; view 4 is in
project 1; webhook 8 is user1's user-level webhook; webhooks 6 and 7 are user6's user-level
webhooks; attachment 4 belongs to task 34 (project 20, inaccessible to user1); task 1 is
user1's. `testuser6` exists in `integrations.go:78`.

**#104**

1. **red-first** — `pkg/webtests/webhook_test.go` `ReadAll` group → *"Body user_id cannot
   select the user-level list under a project URL"*: user1, URL `project=2`, body
   `{"user_id":1}`, built by hand as the sibling test at `:51-56` does
   (`hndl.ReadAllWeb`). **Red on main:** 200 listing webhook 8 (user branch taken,
   `UserID == a.GetID()`). **Green:**
   `assertHandlerErrorCode(t, err, models.ErrorCodeGenericForbidden)`.
2. **red-first** — `pkg/models/webhooks_permissions_test.go`: add a second table in the same
   file, `TestWebhook_CanRead`, doer `&user.User{ID: 1}`:
   `{ProjectID: 2, UserID: 1}` → false (red on main: true);
   `{ProjectID: 1, UserID: 1}` → true; `{UserID: 1}` → true; `{UserID: 2}` → false;
   `{ProjectID: -1, UserID: 1}` → false (red on main: true).
   **guard:** `huma_user_webhook_test.go` `ReadAll` and `huma_webhook_test.go` stay green
   (run via `mage test:web`).

**#103**

3. **red-first** — new `pkg/models/project_view_permissions_test.go`,
   `TestProjectView_CanRead`, `db.LoadAndAssertFixtures` + session per case:
   - *"view outside the path project is rejected at CanRead"*: `ProjectView{ID: 4,
     ProjectID: 2}.CanRead(s, &user.User{ID: 3})` → `can == false` and
     `var target *ErrProjectViewDoesNotExist; require.ErrorAs(t, err, &target)` (the
     function returns the pointer type). **Red on main:** `true, nil` (user3 owns
     project 2; the view is never checked).
   - **guard** *"view in the path project"*: `{ID: 4, ProjectID: 1}` by user1 → `true, nil`.
   - **guard** *"favorites pseudo project"*: `{ID: FavoritesPseudoProject.Views[0].ID,
     ProjectID: FavoritesPseudoProjectID}` by user1 → same result as on `main` (record it;
     the guard must not change it). If `main` returns an error here, that is a stop
     criterion, not something to assert around.

**#102**

4. **red-first** — new `pkg/webtests/user_webhook_v1_test.go`, `TestUserWebhookV1`, calling
   the custom handlers directly with `newTestRequestWithUser` (`integrations.go:170`; the
   `apiv1` import pattern is `link_share_avatar_test.go:25`). Call
   `models.RegisterEventForWebhook(&models.TaskUpdatedEvent{})` at the top (Global-registry
   rule from the prior spec; `Update` validates events against it).
   - *"Update: body id cannot re-target the URL's webhook"*: `apiv1.UpdateUserWebhook`,
     `testuser6`, URL `webhook=7`, body `{"id":6,"events":["task.updated"]}`. **Red on
     main:** 200 with `"id":6` in the body. **Green:** 200 with `"id":7`, and
     `db.AssertExists(t, "webhooks", map[string]interface{}{"id": 7, "events":
     `["task.updated"]`}, false)` (match the argument shape other webtests use for
     `AssertExists`). Also `db.AssertExists` on `{"id": 6, "events":
     `["task.reminder.fired"]`}` — the fixture literal — so the row the body named is
     untouched.
   - *"Delete: body id cannot re-target the URL's webhook"*: `apiv1.DeleteUserWebhook`,
     `testuser6`, URL `webhook=7`, body `{"id":6}`. **Red on main:** row 6 gone, 7 present.
     **Green:** `db.AssertMissing(t, "webhooks", {"id": 7})`, `db.AssertExists(…{"id": 6}…)`.
5. **guard** — same file, *"Update: another user's webhook is not found"*: `testuser6`, URL
   `webhook=8`, no body → `getHTTPErrorCode(err) == 404` (`echo.ErrNotFound`). Confirms the
   forced id still reaches the owner check.
6. **red-first** — `pkg/webtests/task_attachment_idor_test.go` → new sub-test *"Body task_id
   cannot re-target the URL's task"*: `apiv1.GetTaskAttachment`, `testuser1`, URL `task=1,
   attachment=4`, body `{"task_id":34}`. **Red on main:** bound pair is `(34, 4)`;
   `Task.CanRead(34)` is false for user1 → `ErrGenericForbidden`
   (`assertHandlerErrorCode(…, models.ErrorCodeGenericForbidden)` would pass on main —
   so assert the green code, which fails on main). **Green:** bound pair is `(1, 4)`;
   `CanRead(1)` passes, `ReadOne` finds no attachment 4 on task 1 →
   `assertHandlerErrorCode(t, err, models.ErrCodeTaskAttachmentDoesNotExist)`. No file is
   read on either path, so no file-backend setup is needed.

## Verification

From the worktree root (`.worktrees/webhook-bind-residuals`). `docs/context/PITFALLS.md` and
`.workflow.yaml` are git-excluded and live only in the main checkout (`../../`).

```bash
mage test:filter 'TestWebhook_CanRead|TestProjectView_CanRead' 2>&1 | tee /tmp/model.log
mage test:web                            2>&1 | tee /tmp/web.log       # all of pkg/webtests
TZ=UTC mage test:feature                 2>&1 | tee /tmp/feature.log   # test_command; red without TZ=UTC (PITFALLS)
mage lint                                2>&1 | tee /tmp/lint.log      # golangci-lint v2.13.0 built with go 1.27 (PITFALLS)
```

Done looks like: the six red-first tests fail on `main` for the stated reasons and pass on
the branch (record each failing output in the Execution Log); `mage test:web` green;
`TZ=UTC mage test:feature` green; `mage lint` 0 issues; `git status --porcelain
--untracked-files=all` empty; three commits, each green on its own. No frontend change, so
no typecheck. The classifier will mark this `non-live` (backend-only); a curl differential
against dev is optional evidence, not a gate. `pkg/e2etests` and `pkg/caldavtests` skip
under `-short`; their webhook tests insert rows directly and send no body `user_id` or
`id`, so none of the three changes reaches them.

## Stop criteria

- Any existing test in `huma_webhook_test.go`, `huma_user_webhook_test.go`,
  `webhook_test.go`, `huma_project_view_test.go`, `project_view_v1_test.go`, or the kanban /
  task-position tests goes red after a reorder or the `CanRead` guard → halt; the Design
  section's "unchanged cells" claim is wrong.
- The favorites guard case (test 3, third sub-test) behaves differently on `main` and on the
  branch → halt; `GetProjectViewByIDAndProject`'s pseudo-project branch does not cover
  `CanRead`'s callers the way Design assumes.
- The rename in `pkg/web/handler` turns up a caller outside that package and
  `pkg/routes/api/v1` → halt; the "five callers" count is wrong.
- Any change wanted in a v2 route file, or a new file outside `pkg/models`,
  `pkg/web/handler`, `pkg/routes/api/v1`, `pkg/webtests` → halt.

## Execution Log

(empty — the build phase appends.)
