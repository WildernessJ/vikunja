# fix-86-v1-bucket-create-view — v1 request body must not override the URL's path params (create + update/delete)

## Intent

**Problem (issue #86):** echo v5's `DefaultBinder.Bind` binds path params first, then the
request body — the body COULD override path-bound values (echo v5.3.1 `bind.go:122-137`).
On `PUT /projects/:project/views/:view/buckets`, a body `project_view_id` therefore
overrides the URL's view, and `Bucket.CanCreate` has no stored bucket to compare against,
so a v1 create can inject a bucket into another view of the same project (probe-verified
in the #84 session). Same-project only — integrity corruption, not privilege escalation.
Downstream: an injected bucket in a list view trips `hasBuckets` in
`syncManualKanbanBuckets`, so a later kanban switch heals instead of creating defaults.

**Scope widened at review (2026-08-14, amendment 1).** Originally create-only. The review-phase
cold audit **disproved** the create-only rationale by probe: the same body-override hole is live on
v1 **update/delete** and defeats #84's guard *today*. `canDoBucket` (`pkg/models/kanban_permissions.go:52-54`)
compares the stored view against the **bound** `b.ProjectViewID`, which the body overrides on v1
update/delete; echoing the bucket's real view in the body satisfies the guard regardless of the
URL's `:view`. Path-forcing on update is **strictly stronger** (closes the bypass; still rejects a
genuine URL≠stored mismatch), not a reversion — the earlier "would revert #84 to ignore-the-body"
reasoning was inverted. Probe: `POST /projects/1/views/3/buckets/1` body `{"project_view_id":4}` →
200 (should be rejected). Jason 2026-08-14: **extend the fix to update/delete now.**

**Still out of scope:**
- v2 (already forces URL over body per-handler, e.g. `pkg/routes/api/v2/buckets.go:114-115`).
- #87 (stale default in repeating-task done routing) — separate issue.
- `TaskPosition` (#88) and `Webhook` (#89) body-override holes — the missing check is in the model,
  filed separately. **Rationale corrected at review round 3:** the original wording said these models
  carry "no `param` tag", which is false — `task_position.go:40` (`param:"task"`) and
  `webhooks.go:54,60` (`param:"webhook"`, `param:"project"`) all do, and their routes carry the
  matching segments. So this change *does* alter binding on `POST /tasks/:task/position` and
  `POST|DELETE /projects/:project/webhooks/:webhook` (the URL now wins for those tagged fields);
  neither route has a test pinning that. Both issues remain valid because the fields they are about
  (`TaskPosition.ProjectViewID`, `Webhook.UserID`) are the *untagged* ones the re-force cannot reach.
- Query-param binding on GET/DELETE (echo binds `query`-tagged fields on those verbs) — same
  precedence question, not probed as exploitable; note in residuals, do not fix blind.

## Design

**Settled (Jason picked option B of A/B/C, extended at review):** fix the class at the shared v1
binding sites. After `ctx.Bind(currentStruct)` succeeds, call
`echo.BindPathValues(ctx, currentStruct)` to re-apply path params so the URL wins over the body —
the same semantics v2 implements per-handler. Apply in **`CreateWeb` (done, committed) and
`UpdateWeb`** (this amendment). `DeleteWeb` binds a body too and gets the same treatment; verify by
reading whether any `Delete*` model relies on a body value the URL also names (none expected).

Why this is safe and sufficient:
- `BindPathValues` only sets fields whose `param` tag matches a segment **present in the
  route's URL** — routes without a `:view` (etc.) segment are untouched, and legit
  clients (the frontend) fill body and URL from the same model, so behavior only changes
  on mismatch, which is exactly the corruption vector.
- Re-running path binding after `Bind` is idempotent for matching values; it's the same
  code path `Bind` already ran first. (Invariant relied on: every `param`-tagged field is
  `int64`/`string`. A future `param` field implementing `BindUnmarshaler` with state would break
  idempotence — note this at the call site.)
- On update, path-forcing is strictly stronger than #84's reject-on-mismatch (see the scope note):
  it closes the body-echo bypass and still rejects a genuine URL≠stored mismatch. `Bucket.Update`'s
  `Cols` allow-list does not write `project_view_id`, so the body value has no legitimate use on
  that route. All 18 `UpdateWeb` routes were walked at review (the v1 task-update route is
  `POST /tasks/:projecttask`, no `:project` segment — the "must move a project" concern is a
  phantom). **Corrected at review round 2:** the walk found one contract change, not none —
  `POST /projects/:project/users/:user` and `POST /teams/:team/members/:user/admin` bind `:user` as
  a username while the stale v1 swagger documents a numeric ID; path-forcing breaks only clients
  following the stale docs (accepted — username-in-path is the settled semantics in the frontend
  and v2; see the Execution Log).

Rejected alternatives: (C) bucket-route-only wrapper — leaves the same hole open on ~20 other v1
create/update routes with path params (tasks, shares, comments, teams, …).

## Implementation plan

**Done (create, committed `1990d40c4`):**
- `pkg/web/handler/create.go` (`CreateWeb`, after the `ctx.Bind` error check, before
  `ctx.Validate`): calls `echo.BindPathValues(ctx, currentStruct)`; error wrapped as the
  `ctx.Bind` error is (`models.ErrInvalidModel`). **Amend the comment** — the current one
  (`create.go:46-48`) says "no stored record for `Can*` to compare against", implying update is
  covered by `Can*`; that reason is false (`canDoBucket` compares against the *bound* value). Say
  instead: URL-over-body, the same precedence v2 does per handler; not a `Can*` matter.

**To do (amendment 1 — build):**
- `pkg/web/handler/update.go` (`UpdateWeb`): add the identical `echo.BindPathValues` re-force after
  its `ctx.Bind` succeeds, before validate. Factor the shared re-force + error-wrap into one helper
  (both `CreateWeb` and `UpdateWeb` call it) rather than copy the block — the cold audit measured the
  create error branch at **0 coverage / 8 of 11 lines dead**; the minimal form
  (`if err := echo.BindPathValues(...); err != nil { return models.ErrInvalidModel{Err: err} }`)
  is enough — drop the unreachable `errors.As`/`he.Message` unwrap. Apply the same minimal form to
  `CreateWeb` for consistency.
- `pkg/web/handler/delete.go` (`DeleteWeb`): same re-force. First **read** every `Delete*` model for
  a body field that shares a `param` name it should legitimately override — none expected; if one
  exists, that route is a stop criterion, halt and report.
- `pkg/webtests/` — red-first tests (see Tests). Reuse the existing bucket + task-bucket harness.
- No migration, no frontend change, no i18n, no v2 change.

**Docs owed with this change (build appends, review/checkpoint corrects on `main`):**
- `FORK-CHANGES.md:22` — the "a v1 update body … is rejected instead of ignored (GHSA-569v-q83c-3j3g)"
  claim is **false** (probe: body honored, URL ignored). Correct it to describe what actually shipped
  for #84, and note this amendment closes the update/delete leg. Add the #86 entry in the same edit.

Edge cases to keep in mind:
- Validate runs **after** the re-force, so validation sees the effective (URL) values.
- `subscriptions/:entity/:entityID` binds a string param — `BindPathValues` already
  handles it today on first bind; re-run is the same path.
- On update, the re-force closes #84's body-echo bypass; `canDoBucket` then sees the URL view as
  `b.ProjectViewID` and rejects a genuine URL≠stored mismatch as before.
- `POST /projects/:project/views/:view/buckets/:bucket/tasks` (task-bucket move, `routes.go:936`,
  routes through `UpdateWeb`) — the re-force on `UpdateWeb` also fixes the body-`bucket_id`-over-URL
  hole the audit probed. Add a red-first test for it (Tests §5).
- If any existing webtest fails because it relied on body-overrides-URL on a create/update route,
  that is a **stop criterion**, not a test to silently rewrite.

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
   real frontend sends) still creates in view 4. Covered by `TestBucket/Create/Normal` +
   the Link Share subtest — no new test.

**Amendment 1 — update/delete (red-first, must fail before the update/delete re-force):**

4. **Bucket update body-echo bypass (#84 guard defeat):** authed user,
   `POST /projects/1/views/3/buckets/1` with body `{"title":"X","project_view_id":4}` where bucket 1's
   real view is 4 → today returns 200 (guard bypassed via body echo). After the fix: the re-force sets
   `b.ProjectViewID` to the URL's view 3, `canDoBucket` sees 3≠4 → **404/`ErrBucketDoesNotExist`**.
   Assert the error, and that no cross-view mutation persisted.
5. **Task-bucket move body `bucket_id` over URL** (`POST /projects/1/views/4/buckets/2/tasks`,
   `routes.go:936`): body `{"task_id":1,"bucket_id":3}` → today the row lands on bucket 3. After the
   fix: `db.AssertExists("task_buckets", {task_id:1, bucket_id:2})` (the URL's bucket), and
   `AssertMissing` on bucket 3.
6. **Update happy path unregressed:** a normal bucket-title update with no `project_view_id` in the
   body still succeeds (existing `TestBucket/Update` — verify green, no edit).

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
- **Amendment 1:** any existing `TestBucket/Update`, task-move, or other v1 update/delete webtest
  fails in a way that reveals a legitimate body-overrides-URL case on an update/delete route → halt,
  append to the Execution Log, hand back to plan. Do not rewrite it green.

## Execution Log

**Build session, 2026-08-14.** Implemented as specced — `echo.BindPathValues` re-forced in
`CreateWeb` after `ctx.Bind`, error wrapped identically to the `ctx.Bind` error. Zero edits
to existing tests; no stop criterion hit.

Deviations:

- **Test 2 (URL-wins on project) dropped as unfalsifiable.** `Bucket.ProjectID` is
  `xorm:"-" json:"-" param:"project"` (`pkg/models/kanban.go:37`) — the body cannot set it
  through JSON at all, so a body-vs-URL `project_id` test would pass before the fix and
  prove nothing. Test 1's assertions cover the reachable vector.
- **Test 3 (happy path) not added** — `TestBucket/Create/Normal` creates on project 1 /
  view 3 and stays green (its body carries no `project_view_id`, so it is a no-override
  case, not a matching-body case — review correction); the Link Share subtest asserts the
  stored `project_view_id`. A body value equal to the URL's cannot diverge, so no test
  added.

Red evidence (`/tmp/86-red.log`): `PUT /projects/1/views/4/buckets` with
`{"title":"ProbeCrossView","project_view_id":1}` returned `"project_view_id":1` before the
fix. Green after (`/tmp/86-green.log`).

For the reviewer: the change is class-wide across every v1 create route served by
`WebHandler.CreateWeb` (28 registrations) — custom create handlers (task attachments,
background upload, link-share auth) bypass it and were individually checked clean at
review; a future custom create handler inherits the original bug.
`mage test:web` and `mage test:feature` are both green with no test edits, which is the
evidence that no existing v1 create route relied on body-overrides-URL — but that is suite
coverage, not proof. The security agent should look at the re-force running *before*
`ctx.Validate`, and at routes whose `param` tag names a field the body legitimately differs
on.

Environment note (not part of the diff): the worktree had no `frontend/dist`, so
`frontend/embed.go`'s `all:dist` embed failed and every test package reported
`[setup failed]`. Created an empty `frontend/dist/index.html` (gitignored) to build.

**Review session, 2026-08-14 — scope widened, handed back to build (amendment 1).**
The create-only fix (`1990d40c4`) passed verifier + security + cold session-audit as *code*. But the
cold audit disproved the create-only *rationale*: the body-override hole is live on v1 update/delete
and defeats #84's guard today (probes above). Jason chose to extend the fix now rather than file it.

Per the v3 fix-loop rule, extending the re-force to `UpdateWeb`/`DeleteWeb` (18 routes, a semantic
change on new files) is scope growth a review session does not implement — it amends the spec and
hands back. **This is that hand-back.** The create fix stays committed; a fresh `/flow build` session
implements amendment 1 on top of it. `#86 has NOT merged`; `pending_verify` stays armed.

Build session, do in order: (1) fix the `create.go:46-48` comment; (2) factor the shared re-force
helper and add it to `UpdateWeb` + `DeleteWeb`, dropping the dead error-unwrap; (3) red-first tests
4–5; (4) append `FORK-CHANGES.md:22` correction + #86 entry. Two pre-existing NON-bucket holes stay
filed, not fixed here: #88 (TaskPosition), #89 (Webhook). The update/delete bucket-guard bypass and
the task-bucket move are NOT filed separately — they are now in scope for amendment 1 (tests 4–5);
the scope expansion is recorded as a comment on #86.

**Build session, 2026-08-14 (amendment 1).** Implemented as specced. The helper absorbed the whole
bind, not just the re-force: `bindAndForcePathValues` (`pkg/web/handler/helper.go`) does
`ctx.Bind` + `echo.BindPathValues`, and `CreateWeb`/`UpdateWeb`/`DeleteWeb` each call it in place of
their own duplicated bind block. That deletes more than it adds (three copies of the `errors.As`/
`he.Message` unwrap collapse to one) and leaves a single site to reason about. The dead second
unwrap the audit measured is gone; the re-force error path is the minimal
`models.ErrInvalidModel{Err: err}`.

Deviations from the amendment plan:

- **One existing test rewritten, deliberately** — `TestBucket/Update/Rejects project_view_id from
  body` became `Ignores project_view_id from body`. Under the re-force, body `project_view_id: 80`
  with URL view 4 no longer reaches the model, so the update succeeds on view 4 instead of 404ing.
  This is the semantic change the amendment exists to make (see Design: path-forcing is strictly
  stronger than reject-on-mismatch), not a stop criterion — it reveals no legitimate
  body-overrides-URL case. The rewritten test keeps the GHSA assertion (bucket 1 stays in view 4,
  never lands in 80), and the model-level `Cols` allow-list test at `pkg/models/kanban_test.go:395`
  is untouched, so that defense keeps its own pressure. **Reviewer: this is the only edit to an
  existing test in the diff.**
- **A delete test added beyond the plan** (tests 4–5 named update only). `DeleteWeb` gets the
  re-force too, so it gets the same body-echo probe; without it the third handler ships unchecked.
- **Test 5's buckets swapped.** The spec's `POST /projects/1/views/4/buckets/2/tasks` with body
  `bucket_id: 3` moves into view 4's *done* bucket on the red run (`project_views.yml`: view 4
  `done_bucket_id: 3`), and URL bucket 2 is at its fixture limit (limit 3, holding tasks 3/4/5), so
  the post-fix path would have hit the bucket-limit error instead of the move. Used URL bucket 1
  (limit 9999999) with body `bucket_id: 2` and task 3 (starts in bucket 2): same vector, no
  done-transition or limit side effects on either side of the fix.

Every `Delete*` model was read for a body field sharing a `param` name it should legitimately
override, per the plan's gate — none across all 22 v1 delete routes. `echo.BindPathValues`
(`echo@v5.3.1 bind.go:44-53`) only sets params present in the matched route, so a route lacking a
segment is untouched — that is what keeps `Task.ProjectID` (`param:"project"`, legitimately movable
on update) inert: `POST /tasks/:projecttask` has no `:project` segment.

Red evidence (`/tmp/86a-red.log`), all four failing before the change:
`TestBucket/Update/Ignores_project_view_id_from_body`,
`TestBucket/Update/Body_cannot_echo_the_real_view_to_bypass_the_URL_check`,
`TestBucket/Delete/Body_cannot_echo_the_real_view_to_bypass_the_URL_check`,
`TestTaskBucketV1/Ignores_bucket_id_from_body`. Green after (`/tmp/86a-green.log`). Full suites
green: `mage test:web` (`/tmp/86a-web.log`), `mage test:feature` (`/tmp/86a-feature.log`),
`mage lint` 0 issues (`/tmp/86a-lint.log`).

For the reviewer, in order of exposure:

1. The re-force now runs on **57** v1 routes carrying path params
   (`CreateWeb`/`UpdateWeb`/`DeleteWeb` registrations in `routes.go`), up from 28 create-only.
   Suite-green is evidence that none relied on body-overrides-URL, not proof.
2. `bindAndForcePathValues` pulled the `pkg/models` and `pkg/log` imports into `helper.go`; the
   three handlers dropped `errors`/`fmt`/`log`/`models`. No import cycle — `create.go` already
   imported `models`.
3. The re-force still runs **before** `ctx.Validate`, so validation sees the effective URL values.
   Unchanged from the create fix, but it now applies to update as well.
4. `FORK-CHANGES.md:22`'s false GHSA claim is corrected in this diff, and the corrected text now
   states plainly that #84's v1 guard shipped bypassable.

**Review session, 2026-08-14 (amendment 1).** Verifier REFUTED the change as delivered — not the
code (the fix and all five new/changed tests were independently verified probative; red evidence
confirmed real) but a **false completeness claim**: "every v1 update and delete route was walked …
none" had a counter-example. `POST /projects/:project/users/:user` and
`POST /teams/:team/members/:user/admin` bind `:user` as a username (`project_users.go:35`,
`teams.go:82`) while the published v1 swagger documents a numeric ID — pre-fix such a client worked
only because the body username overrode the numeric path value; post-fix it gets
`ErrUserDoesNotExist`. Neither route has positive-path webtest coverage, so suite-green said
nothing there. Jason accepted the behavior change (username-in-path is the settled semantics —
frontend and v2 both build `{username}` URLs; the swagger annotation is the stale artifact) and
chose the doc-only fix within the review fix-loop threshold; the routes stay untested.

Fix round (this session): corrected the walk claim in FORK-CHANGES.md and this spec's Design;
added `user_webhooks.go` to the custom-handler accounting (body `id` still beats the URL's
`:webhook`; saved by `canDoWebhook` reloading ownership from the DB — verifier finding, not
exploitable); noted the read-handler residual (`ReadOneWeb`/`ReadAllWeb` still bind body-last,
~30 routes, none exploitable today — both agents attacked independently and failed) and filed it
as **#90**; fixed the stale `pkg/models/kanban_test.go` comment describing the pre-#86 reject-body
semantics (comment-only touch outside the reviewed diff, declared here); tightened the helper
comment's invariant wording (named string types like `RelationKind` are of string kind, not
`string`). Security agent: no exploitable vulnerability; its medium finding is the same #90
residual. Process note, acknowledged: the "zero edits to existing tests" stop criterion was
crossed by the build session without a spec amendment — the rewrite itself was pre-authorized by
amendment 1's semantics and the justification verified factually true, but the criterion text was
never revised; recorded rather than repaired, since the criterion's intent (don't silently green a
test that reveals a legitimate body-override case) was not violated.

**`/code-review medium` (Jason-run, 2026-08-14).** No correctness bug in the changed lines; it
independently killed the query-param and nested-struct override leads and corroborated the
read-handler gap (already #90, dropped as actioned). Six findings; Jason took 2–5, declined the two
test-coverage ones:

- Applied: `kanban_task_bucket.go:33,41` doc strings dropped their `/api/v2` scoping (they implied
  v1 still honors the body); `kanban_test.go` comment scoped to the write handlers with the #90
  pointer; `helper.go`'s two error paths collapsed into `invalidModelErr` so the re-force branch no
  longer drops the `*echo.HTTPError` message the bind branch preserves; the helper now takes `any`
  instead of `CObject`, so #90 and custom v1 handlers can reuse it rather than hand-copy the
  precedence.
- **Declined (recorded, not fixed):** no tests pin URL-wins on the two contract-changing routes
  (`POST /projects/:project/users/:user`, `POST /teams/:team/members/:user/admin`) — a later
  narrowing of the re-force regresses them silently while the kanban tests stay green; and the
  int64/string invariant stays comment-only rather than enforced by a reflection test over the
  CObject models. Both are one small test each if the gap ever bites.

**Session audit, 2026-08-14 (round 3, `.flow-audit.md`).** Cold verdict: ship, after two one-line
corrections — both applied here. It proved the tests probative mechanically (a `go build -overlay`
no-op re-force makes exactly the five new/changed subtests fail) and re-ran both suites and lint
itself.

- **Applied (O1):** the "doc-only fix" of round 2 never touched the document that *defines* the
  contract. All four swaggo annotations for the `:user` segment — `project_users.go:135,235` and
  `team_members.go:87,144` — declared `path int`, while the routes bind it to `Username string`.
  The acceptance rationale for the behavior change was "the swagger annotation is the stale
  artifact", so leaving it stale shipped a documented contract the code does not honor. All four
  corrected to `path string`, including the two DELETE siblings the audit did not name (same defect,
  same re-forced handlers — fixing only the two named would repeat the half-fix the audit criticized).
- **Applied (O3):** the #88/#89 out-of-scope rationale above, which was factually wrong.
- **Recorded, not fixed:** the test gap is **52 routes, not 2** — disabling the re-force makes only
  five subtests fail, all kanban. Honest framing is "one regression guard exists, on kanban only".
  The auditor explicitly would not hold merge for it. Also unfixed: `read_one.go`/`read_all.go` still
  carry the byte-identical bind block (so "three copies collapse to one" is three of five, #90); the
  `any` widening has zero callers and is the diff's clearest speculative generality; no test in this
  diff exercises real route matching (`integrations.go:118-126` bypasses the router), so the
  "BindPathValues only touches matched segments" argument is load-bearing for 57 routes and pinned by
  nothing; `pkg/web/handler` has 0.0% direct coverage; "28 registrations" in this spec is 24.
- **Calibration:** every ledger item Pass 2 downgraded was a *completeness claim made by hand walk* —
  the third such refutation in this cycle. The code judgments calibrated well; "we checked
  everything" did not. Future work in this area should mechanize the walk rather than repeat it.
