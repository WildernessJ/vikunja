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

Verifier loop (plan phase): round 1 (Opus) REFUTED — guard placement, the `-1` table row,
the `CanRead` caller list, `(0,0)` outcome, line cites, `UploadTaskAttachment`. Round 2
(Opus) REFUTED — the round-1 placement fix had not reached step 4 or the commit subject;
`UploadTaskAttachment` missing from the table and error-surface list; the `(other, ≠0)`
cell; the guard comment over-claimed past the admin/saved-filter returns; test 4 pinned a
non-user-directed event. Round 3 (Opus) **SURVIVES** — six cosmetic items (comment length
and count, test-file count, a reversed cite pair, two cite drifts, the helper doc-comment
rename), folded in here.

## Design (settled)

**#104 — reorder, mirror of #89.** In `Webhook.ReadAll` (`pkg/models/webhooks.go:243-258`)
and `Webhook.CanRead` (`pkg/models/webhooks_permissions.go:24-36`): a webhook that names a
project is a project webhook, so the project branch wins.

```go
if w.ProjectID != 0 {
    // project branch: Project.CanRead, listCond = project_id
} else {
    // user branch: w.UserID == a.GetID() (ReadAll: else ErrGenericForbidden), listCond = user_id
}
```

`!= 0`, not `> 0`, so a negative id (favorites `-1`, saved filters `< -1`) reaches
`Project.CanRead` instead of falling into the user branch, where a body `user_id` would
select the caller's own list under a pseudo-project URL — the #104 shape again. Unlike #89's
`CanWrite`, `Project.CanRead` **allows** pseudo projects the caller owns
(`project_permissions.go:96-121`, favorites always; a saved filter if the caller can read it),
so the cell `(UserID=me, ProjectID<0)` becomes "200, empty list" — the same answer that URL
gives with no body today (no webhook row can carry a negative `project_id`; `Create` gates on
`CanWrite`). Accepted: no data, no new reachable state. Cells that change, non-link-share
caller: `(UserID=me, ProjectID≠0)` was "own user list / true", becomes `Project.CanRead`;
`(UserID=other, ProjectID≠0)` was 403 (`other != me`), becomes `Project.CanRead` — on a
readable project that is 200 with the project list, the same list the URL returns with no
body, so nothing new is exposed.
`(0, 0)` (`GET /projects/0/webhooks`): today `Project.CanRead(0)` returns
`ErrProjectDoesNotExist` (404, `project_permissions.go:191-192`); after, the user branch
returns `ErrGenericForbidden` (403). Both deny. The two callers that set `UserID` never set `ProjectID` (v2 `userWebhooksList`,
`user_webhooks.go:107`; v1 `GetUserWebhooks` does not call `ReadAll` at all), so the
user-level lists are untouched. The v2 project list (`webhooks.go:96`) sets only
`ProjectID`; Huma binds no body there.

`CanRead` is still unreachable from any route (no webhook `ReadOne`); it is reordered because
it is the same two lines, in the same file, with the same wrong shape, and the review filed it
under #104.

**#103 — add the scope guard `CanUpdate` already has, but after the project check.** In
`ProjectView.CanRead` (`pkg/models/project_view_permissions.go:24-36`), replace the final
`return pp.CanRead(s, a)` with:

```go
can, maxPerm, err := pp.CanRead(s, a)
if err != nil || !can {
    return can, maxPerm, err
}
// Project readable — now refuse a view outside it, so this branch does not lean on ReadOne's scope (#103).
if _, err := GetProjectViewByIDAndProject(s, pv.ID, pv.ProjectID); err != nil {
    return false, 0, err
}
return true, maxPerm, nil
```

**Guard after `CanRead`, not before as `CanDelete`/`CanUpdate` do** (`:48`, `:66-69`).
Before it, a caller with no access to the path project gets 404 for a view outside it and
403 for a view inside it — a view→project membership oracle across a permission boundary,
and it flips `project_view_v1_test.go:44-50` (user1, URL `project=2, view=4`, asserts 403)
to 404. After it, non-readers keep 403 and readers get the 404 `ReadOne` already gave them.
The oracle shape already exists in `CanUpdate`/`CanDelete`; not touched here (out of scope,
filed as a follow-up only if review wants it).

No `pv.ID == 0` skip (issue #103 suggests one): the callers are `DoReadOne`
(`pkg/web/handler/core.go:79`, via v1 `routes.go:938` and v2 `project_views.go:126`, both
with a `:view` path param), `Bucket.ReadAll` (`kanban.go:128`, view fetched by id + project)
and `TaskPosition` (`task_position.go:111`, view fetched by id; its own `project_id` is what
is checked). `DoReadAll` never calls `CanRead`. `ID` is never 0 on a reachable path; a skip
would be a silent bypass waiting for a caller that sets only `ProjectID`. The favorites pseudo-project (negative view ids under
`FavoritesPseudoProjectID`) is handled inside `GetProjectViewByIDAndProject` (`project_view.go`,
first branch), same as for `CanUpdate`.

Accepted cost: `Bucket.ReadAll` and `TaskPosition` permission paths now run one extra
`SELECT … WHERE id = ? AND project_id = ?` per call, on a view they already hold. Same cost
`CanUpdate` already pays. Not worth a second code path.

HTTP surface is unchanged for every caller: non-readers still get 403 from `CanRead`;
readers with a mismatched pair still get 404, now from `CanRead` instead of `ReadOne`. The
model test is the meaningful one.

**#102 — export the helper, call it from the four bare-binding handlers.** Rename
`bindAndForcePathValues` → `BindAndForcePathValues` (`pkg/web/handler/helper.go:51`, five
callers in the same package). The three handlers #102 names, plus `UploadTaskAttachment` in `task_attachment.go` (see step 9),
replace their `c.Bind(x)` block with `handler.BindAndForcePathValues(c, x)`.

Rejected alternative: inline `echo.BindPathValues(c, w)` after each existing `c.Bind`. Zero
cross-package churn, but a sixth copy of the bind-then-force pair, and the helper's doc
comment already says an export is the intended route. One place all callers route through.

Error-surface change, accepted: a malformed path param now returns `ErrInvalidModel`
(400, `ErrCodeInvalidModel`) instead of echo's raw bind error (`UpdateUserWebhook`,
`DeleteUserWebhook`) or the hand-written `"No task ID provided"` 400 (`GetTaskAttachment`
`:113-116`, `UploadTaskAttachment` `:47-49`). Same status; the generic handlers already
answer this way. Both attachment handlers drop their `echo.NewHTTPError(...).Wrap(err)`
line.

What the fix does and does not change per handler:

| handler | forced from URL | authorizes against | before | after |
|---|---|---|---|---|
| `UpdateUserWebhook` | `ID` (`:webhook`) | stored row owner via `CanUpdate` reload | body `id` picks the row, URL ignored | URL picks the row |
| `DeleteUserWebhook` | `ID` (`:webhook`) | same | same | same |
| `GetTaskAttachment` | `ID` (`:attachment`), `TaskID` (`:task`) | `Task.CanRead(TaskID)` then `ReadOne` scope | body `task_id` picks the task the permission check runs against | URL picks it |
| `UploadTaskAttachment` | `TaskID` (`:task`) | `CanCreate` inside `UploadTaskAttachments` | multipart cannot set `TaskID` (no `form` tags); a JSON body can, but then `c.MultipartForm()` fails first | no reachable change; the bare-bind shape is gone |

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

**Commit 2 — `fix(project-views): refuse a view outside the path project in CanRead (#103)`**
4. `pkg/models/project_view_permissions.go` `CanRead`: replace the final
   `return pp.CanRead(s, a)` with the block in Design — the guard runs **after**
   `pp.CanRead` returns true, never before it. Use the one-line comment from the Design
   block, not `CanUpdate`'s ("…before authorizing against it" is false at this position).
5. Tests: item 3 below.

**Commit 3 — `fix(api): force path params in the custom v1 webhook and attachment handlers (#102)`**
6. `pkg/web/handler/helper.go`: rename to `BindAndForcePathValues`, including the identifier
   at the start of the doc comment (`:42`); replace the comment's last two sentences ("All five
   generic handlers call it … needs an export before it can reuse it", `:50-51`) with one
   naming the callers: the five generic handlers and the four custom v1 handlers in
   `user_webhooks.go` / `task_attachment.go`. Lint will not catch a stale comment here
   (`.golangci.yml` disables the exported-comment rules).
7. `pkg/web/handler/{create,update,delete,read_one,read_all}.go`: rename call sites.
8. `pkg/routes/api/v1/user_webhooks.go` `UpdateUserWebhook`, `DeleteUserWebhook`: replace
   `c.Bind(w)` with `handler.BindAndForcePathValues(c, w)`. Add the
   `"code.vikunja.io/api/pkg/web/handler"` import (the file has none today).
9. `pkg/routes/api/v1/task_attachment.go` `GetTaskAttachment`: replace the `c.Bind` block
   (`:113-116`) with the helper call; drop the `http.StatusBadRequest` wrap. Check whether
   `net/http` is still imported elsewhere in the file before removing it.
   Also `UploadTaskAttachment` (`:48`): same bare `c.Bind(&taskAttachment)`, same
   one-line swap. Not exploitable today (multipart binds only tagged fields, so `TaskID`
   never comes from the form; a JSON body fails at `c.MultipartForm()` first), so no
   red-first test exists for it — it is the fourth bare bind in a file this commit already
   edits, and leaving it would keep the "saved by a downstream check" shape #102 removes.
   Guard: the existing `task_attachment_upload_test.go` stays green.
10. Tests: items 4–6 below.

Edge cases the executor must hold:
- `Webhook.ID` carries `param:"webhook"` and `TaskAttachment.ID` / `TaskID` carry
  `param:"attachment"` / `param:"task"` (`webhooks.go:54`, `task_attachment.go:43-44`), all
  `int64` — the helper's kind invariant holds; nothing to re-audit.
- `readOnly:"true"` on those fields does not stop the body from binding (the prior spec
  verified this; it is why #102 exists).
- `Webhook.Update` writes only `Cols("events")`, so a forced `ID` with a body carrying other
  fields still mutates events only.

## Execution routing

- **Driver-run** (Opus build session), no dispatch: ~40 lines net across eleven source files
  (five of them a mechanical rename) plus five test files, no design latitude. `executor` tier is overhead.
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
   `{ProjectID: -1, UserID: 2}` → true (red on main: false, the `2 != 1` user-branch denial;
   green because favorites `CanRead` is always true — the cell Design accepts, pinned so
   nobody "fixes" it to `> 0` and reopens the user branch for pseudo projects).
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
   `models.RegisterUserDirectedEventForWebhook(&models.TaskOverdueEvent{})` at the top
   (Global-registry rule from the prior spec; `Update` validates events against it). A
   user-directed event, not `task.updated`: `Create` refuses non-user-directed events on a
   user webhook (`huma_user_webhook_test.go:107-113` pins that), so pinning `task.updated`
   on row 7 would assert a state `Create` cannot produce and go red the day `Update` gains
   the same check.
   - *"Update: body id cannot re-target the URL's webhook"*: `apiv1.UpdateUserWebhook`,
     `testuser6`, URL `webhook=7`, body `{"id":6,"events":["task.overdue"]}`. **Red on
     main:** 200 with `"id":6` in the body. **Green:** 200 with `"id":7`, and
     `db.AssertExists(t, "webhooks", map[string]interface{}{"id": 7, "events":
     `["task.overdue"]`}, false)` (match the argument shape other webtests use for
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
  `webhook_test.go`, `huma_project_view_test.go`, `project_view_v1_test.go`,
  `task_attachment_upload_test.go`, `link_sharing_test.go`, or the kanban / task-position
  tests goes red after a reorder or the `CanRead` guard → halt; the Design section's
  "unchanged cells" claim is wrong. In particular `project_view_v1_test.go:44-50` must stay
  at 403 — if it reads 404, the guard landed before `CanRead`.
- The favorites guard case (test 3, third sub-test) behaves differently on `main` and on the
  branch → halt; `GetProjectViewByIDAndProject`'s pseudo-project branch does not cover
  `CanRead`'s callers the way Design assumes.
- The rename in `pkg/web/handler` turns up a caller outside that package and
  `pkg/routes/api/v1` → halt; the "five callers" count is wrong.
- Any change wanted in a v2 route file, or a new file outside `pkg/models`,
  `pkg/web/handler`, `pkg/routes/api/v1`, `pkg/webtests` → halt.

## Execution Log

### Build session (Opus, 2026-09-12)

Commits: `507a542fa` (#104), `107b636e4` (#103), `912cc9c3e` (#102). Driver-run, no dispatch;
`crudable` invoked before the `Can*` edits.

**Red run on unfixed code** (all six new tests written first, run before any source change):

- Test 1, `TestWebhook/ReadAll` new sub-test: `Error is nil` (200, user branch taken).
- Test 2, `TestWebhook_CanRead`: `body user_id on a foreign project` expected false, got true;
  `foreign user_id on the favorites pseudo project` expected true, got false. Other three rows
  green on main, as the spec predicts.
- Test 3, `TestProjectView_CanRead/view outside…`: `Should be false`, and `An error is
  expected but got nil`. Favorites guard sub-test: **`true, nil` on main**, and the same on the
  branch. No stop criterion hit.
- Test 4: Update returned `"id":6`, row 7 not updated, row 6 events changed. Delete removed
  row 6 and left row 7.
- Test 6: `expected: 4011, actual: 1` (403 `ErrGenericForbidden` from `Task.CanRead(34)`).

The model failures stopped `mage test:filter` before its `pkg/webtests` re-run, so the
handler red run was a second filter (`TestWebhook$|TestUserWebhookV1|TestTaskAttachmentIDOR`).

**Green:** each commit's targeted filter passed at that commit, guards included —
commit 1: `TestWebhook|TestHumaWebhook|TestHumaUserWebhook`; commit 2:
`ProjectView|Kanban|Bucket|TaskPosition|LinkShar` (covers `TestProjectViewV1`, so `:44-50`
stays 403); commit 3: `TaskAttachment|UserWebhook` (covers `TestTaskAttachmentUploadSize`).
`mage lint` 0 issues before each commit. At HEAD: `mage test:web` ok, `TZ=UTC mage
test:feature` ok. The full suite ran at HEAD only, not at commits 1 and 2.

**Deviations:**

- Test 5 assertion. The spec says `getHTTPErrorCode(err) == 404`. echo v5's `ErrNotFound` is
  a private `*httpError`, not `*echo.HTTPError`, so the helper returns 0 for it; the test
  failed on main with `expected 404, actual 0` although the handler returned
  `echo.ErrNotFound`. Changed to `require.ErrorIs(t, err, echo.ErrNotFound)`, with a one-line
  comment. The shared helper is unchanged (out of scope). The new assertion was not re-run
  on main.
- `user_webhook_v1_test.go` does not call `db.LoadAndAssertFixtures`: `setupTestEnv`
  reloads fixtures on every request, as in the other webtests.
- `Webhook.CanRead` cell `(UserID=0, ProjectID=0)`: was `Project.CanRead(0)` →
  `ErrProjectDoesNotExist`; is now `false, nil`. Both deny; `CanRead` has no route caller.
  No test pins it.

**Look at first:** the #103 guard placement (after `pp.CanRead`), and the `ReadAll` reorder
(`webhooks.go`), whose user branch is now the `else` for `ProjectID == 0`.
