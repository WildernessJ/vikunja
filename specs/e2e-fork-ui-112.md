# e2e-fork-ui-112 — E2E harness and selector fixes (#112, cycle 1 of 2)

## Intent

Make the Playwright tests in failure groups B, C, D and E of #112 pass on the fork, or mark them
`test.fixme` with an issue link when a real product bug causes the failure. This cycle changes test
code only. Group A (about 55 tests that drive upstream's removed `.task-view .action-buttons`
sidebar) is cycle 2, spec `e2e-task-detail-chips-112`, which this cycle does not write.

Baseline (2026-10-02, `main` `f0c5e81be`, full `mage test:e2e ""`): 79 failed, 358 passed,
2 skipped. A second run of the `user/` specs alone gave the same failures, so login rate limiting
does not cause them.

## Design

Decisions that Jason made on 2026-10-02:

- Group A: rewrite to the fork's property chips (cycle 2). Cycle 1 does not delete group A tests.
- A real product bug found by a test: mark the test `test.fixme(...)`, open a GitHub issue, put
  the issue link in the fixme reason, and continue. Do not fix product code in this cycle.
- OpenID: skip the test when no Dex server is configured.
- #112 is split in two cycles. This is cycle 1.

Amendment after build session 1 halted (plan session 2, 2026-10-02, Jason):

- The scope of cycle 1 includes one line in `magefile.go`:
  `VIKUNJA_RATELIMIT_TOKENREFRESHLIMIT=1000` in the `mage test:e2e` API environment. It sits next
  to `VIKUNJA_RATELIMIT_NOAUTHLIMIT=1000`. This is test harness configuration, not product code.
  Reason: the selector fixes remove many 30-second timeouts, so the suite sends more token-refresh
  requests per minute. The default limit of 60 per minute per IP then returns 429 to three tests
  that passed in the baseline. See the Execution Log.
- The registration "confirmation notice" test is skipped when `MAILER_API_URL` is not set. This
  applies the OpenID rule: skip a test when its external server is not there. `mage test:e2e`
  does not start Mailpit.

The failure groups and their diagnosed causes:

| Group | Tests | Cause |
|---|---|---|
| B | 13: `user/login` (5), `user/email-confirmation` (5), `user/password-reset` (2), `user/registration` (1, "confirmation notice") | The specs open `/login`, `/register` and similar pages without `setupApiUrl`. The frontend then uses the relative `window.API_URL = '/api/v1'` from `index.html`. The `vite preview` server has no proxy, so it returns 404. Evidence: the login page shows "Using Vikunja installation at 127.0.0.1:<frontend port>", and the API logs no 404. |
| C | 6: `project/project-view-list` (3), `task/overview` (2), `sharing/team` (1) | `.task-add textarea` matches two elements: the title textarea `.add-task-textarea` and the composer's `.qac-description`. |
| D | 4: `task/quick-add-composer` (2), `project/project-view-calendar` ("chip popups"), `task/quick-add-default-reminders` | The composer chips are `PropertyChip` components. The classes are `.property-chip-button` and `.property-chip-popup`, not `.qac-chip-button` and `.qac-chip-popup`. The default-reminders failure is not diagnosed: the fill succeeds, but no `POST .../tasks/bulk` request follows the `Add` click. |
| E | 2: `misc/menu` (`ControlOrMeta+e` toggle), `user/openid-login` | Menu: not diagnosed. `SHORTCUTS.toggleMenu` is `Mod+KeyE` on `MenuButton.vue`, so the binding looks correct. OpenID: no Dex server in the fork's e2e setup. |

Group A residue inside group D files: `quick-add-composer.spec.ts` asserts on
`.task-view .action-buttons, .task-view .details` for the priority. Port this one assertion to the
task-detail chip in this cycle, because the test cannot pass otherwise.

## Implementation plan

All paths are under `frontend/tests/`.

1. **Group B — fixture seam.** In `support/fixtures.ts`, override the built-in `page` fixture so
   that every test calls `setupApiUrl(page)` (from `support/authenticateUser.ts`) before it uses the
   page:
   ```ts
   page: async ({page}, use) => {
   	await setupApiUrl(page)
   	await use(page)
   },
   ```
   `authenticatedPage` depends on `page`, so it gets the call too. `login()` calls `setupApiUrl`
   again. Two `addInitScript` calls that write the same value are harmless; do not remove the call
   from `login()`. Then remove the per-spec `setupApiUrl` calls that the fixture makes redundant
   only if a spec calls it at the start of the test with no other effect. Do not change other
   setup.
   Edge case: `API_URL` from mage ends with `/`. `setupApiUrl` already stores it unchanged for
   the authenticated tests, so keep that behavior.
   After the fixture change, run the group B specs. If a group B test still fails, diagnose it as
   a new cause (for example the registration "confirmation notice" test, which already calls
   `setupApiUrl`).
2. **Group C.** Replace `.task-add textarea` with `.task-add .add-task-textarea` in the three
   spec files. If `sharing/team.spec.ts` still fails after the change, the READ_WRITE team member
   may not see the composer. That is a product bug, and the fixme rule applies.
3. **Group D.** Replace `.qac-chip-button` with `.property-chip-button` and `.qac-chip-popup`
   with `.property-chip-popup` in `quick-add-composer.spec.ts` and
   `project-view-calendar.spec.ts`. Check `.qac-chip-popup-priority` against `PrioritySelect` and
   the `PropertyChip` popup markup, and use the real class. Diagnose
   `quick-add-default-reminders.spec.ts`: find out what the `Add` button locator matches and which
   request the fork sends.
4. **Group E.**
   - `misc/menu.spec.ts`: diagnose with the trace or the headed run. If the shortcut works by
     hand in the browser and the test sends the key to the wrong target, fix the test. If the
     shortcut does not work in the browser, the fixme rule applies.
   - `user/openid-login.spec.ts`: add
     `test.skip(!process.env.VIKUNJA_E2E_DEX, 'needs a Dex OpenID server')` at the start of the
     describe block.

5. **Token-refresh rate limit (amendment).** In `magefile.go`, add
   `"VIKUNJA_RATELIMIT_TOKENREFRESHLIMIT=1000",` on the line after
   `"VIKUNJA_RATELIMIT_NOAUTHLIMIT=1000",` in the `apiCmd` environment. Change nothing else in
   `magefile.go`.

Build session 2 starts from commit `f8dc46f98`. Items 1 to 4 are done there. Do item 5, then run
the Verification section again.

## Execution routing

- Driver (the build session): items 1, 2, 3 (selector replacements) and the OpenID skip. These are
  mechanical changes.
- `executor` (Opus, effort high), one dispatch per undiagnosed failure: the
  default-reminders test, the menu shortcut test, and any group B test that still fails after the
  fixture change. Each dispatch gets the failing test, the baseline error text from this spec, and
  the fixme rule.
- No security agent: the change is test code only.

## Tests

The red tests already exist: they are the failing tests listed in #112, and the baseline log
proves they fail. Red-first list, in order:

1. `user/login.spec.ts` › "Should fail with a bad password" (group B; it is red because the page
   shows "Request failed with status code 404").
2. `project/project-view-list.spec.ts` › "Should create a new task" (group C).
3. `task/quick-add-composer.spec.ts` › "creates a task via chips only when quick add magic is
   disabled" (group D).
4. `misc/menu.spec.ts` › "Can be toggled with keyboard shortcut on desktop" (group E).

Each one must fail before its change and pass after it (or become a fixme with an issue).

Item 5 red-first: the full run of build session 1 is the red evidence. The three tests in the
Execution Log failed with 429 responses. Before the full run, confirm that the item 5 line makes
the API accept more than 60 refresh requests per minute. One way: start the e2e API the way mage
does and send 61 `POST /api/v1/user/token/refresh` requests in one minute. Expect no 429.

## Verification

Run every command from the worktree root `/Volumes/ext-ssd/Github/fix-e2e-fork-ui-112`. Save the
output to a file and read the file.

1. Targeted run of the changed spec files:
   `mage test:e2e "--reporter=line tests/e2e/user tests/e2e/misc/menu.spec.ts tests/e2e/project/project-view-list.spec.ts tests/e2e/project/project-view-calendar.spec.ts tests/e2e/task/overview.spec.ts tests/e2e/task/quick-add-composer.spec.ts tests/e2e/task/quick-add-default-reminders.spec.ts tests/e2e/sharing/team.spec.ts"`
2. Full run: `mage test:e2e "--reporter=line"`.
3. `cd frontend && pnpm lint` and `pnpm typecheck`.

Done looks like this:

- Every test in groups B, C, D and E passes, or is `test.fixme` with an issue link, or (OpenID
  only) is skipped.
- The full run fails only group A tests. Compare by test title against the baseline list in
  #112. The count is about 55.
- No test that passed in the baseline fails.
- Lint and typecheck exit 0.
- The three rate-limit tests in the Execution Log pass in the full run.
- The diff touches only `frontend/tests/`, this spec, and the one item 5 line in `magefile.go`.

## Stop criteria

Halt, record the reason in the Execution Log, commit and stop if any of these occur:

- A fix needs a change outside `frontend/tests/` (product code, `magefile.go`, `vite.config.ts`).
  The one item 5 line in `magefile.go` is the only exception.
- The full run still returns 429 to any test after item 5.
- A test that passed in the baseline fails after the group B fixture change, and a small,
  test-only change does not fix it.
- More than three tests become fixmes for product bugs. That many bugs means the "test-only"
  assumption of this cycle is wrong.
- Two fix attempts on one test fail.

## Execution Log

### Build session 1 (2026-10-02) — HALTED on a stop criterion

**Halt reason.** Stop criterion 2 is met: three tests that passed in the baseline fail in the
full run, and no test-only change fixes them. The fix needs `magefile.go` (stop criterion 1).
The failing tests:

- `user/oauth-authorize.spec.ts` › "Full browser authorization code flow with PKCE"
- `user/oauth-authorize.spec.ts` › "Already-authenticated browser opening the copied login
  redirect runs the authorize flow"
- `user/session-refresh.spec.ts` › "Transparently retries a request and rotates the JWT when a
  401 with code 11 is returned"

Cause: the token-refresh rate limiter. `/api/v1/oauth/token` and `/api/v{1,2}/user/token/refresh`
return 429. `ratelimit.tokenrefreshlimit` defaults to 60 per minute per IP
(`pkg/config/config.go:491`, `pkg/routes/rate_limit.go:126`). `mage test:e2e` overrides only
`VIKUNJA_RATELIMIT_NOAUTHLIMIT=1000` (`magefile.go:568`). The fixes in this cycle remove many
30-second timeouts, so the suite sends more refresh requests per minute. Full run: 408
responses of 429 (403 on `/api/v2/user/token/refresh`). Pre-change targeted run: 75. The three
tests pass in isolation (`oauth-authorize` + `session-refresh` alone: 5 passed, 0 responses
of 429).

Proposed resolution for the plan session: add `VIKUNJA_RATELIMIT_TOKENREFRESHLIMIT=1000` next to
the `NOAUTHLIMIT` line in `magefile.go`. Either widen this cycle's scope to `magefile.go`, or ship
it first as a separate fix. A secondary question: the frontend sends many refresh requests
(about 400 in one run). It can be a product issue, but no evidence shows a bug.

**Full run result** (`mage test:e2e "--reporter=line"`, 32.6 min): 57 failed, 378 passed,
4 skipped. 54 failures are group A titles from #112. The other 3 are the rate-limit failures
above. 27 titles from the #112 list now pass. No other test that passed in the baseline fails.
`pnpm lint` 0 (18 warnings, all in `src/`, all pre-existing); `pnpm typecheck` 0.

**What is done (uncommitted work is now committed on this branch):**

- Group B: `support/fixtures.ts` overrides `page` to call `setupApiUrl`. Redundant per-spec
  calls removed: 6 `beforeEach` blocks in `linkShare.spec.ts`, 1 in `team.spec.ts`, and the
  start-of-test calls in `registration`, `invite-links`, `oauth-authorize` and
  `project-view-calendar`. Calls on pages from new browser contexts stay. The stale comment in
  `linkShare.spec.ts` about the missing API URL is removed.
- Group C: `.task-add textarea` → `.task-add .add-task-textarea`.
- Group D: `.qac-chip-button` → `.property-chip-button`, `.qac-chip-popup` →
  `.property-chip-popup`. `.qac-chip-popup-priority` does not exist; the test uses
  `.property-chip-popup select`.
- OpenID: skipped without `VIKUNJA_E2E_DEX`.

**Deviations for the reviewer (look at these first):**

1. **Registration "confirmation notice" is skipped without `MAILER_API_URL`. The spec did not
   authorize this.** It needs Mailpit and a second API with the mailer on. Upstream CI starts
   both (`.github/workflows/test.yml:528-577`); `mage test:e2e` starts neither. Making it pass
   needs `magefile.go`. The skip applies Jason's OpenID rule by analogy. Reject it if the plan
   prefers starting Mailpit in mage.
2. **Five tests waited for the wrong create request.** Diagnosis: a single quick-add task is
   created with `POST /api/v2/projects/{id}/tasks` (`useQuickAddTask.ts` `createNewTask` →
   `tasksCreate`); only multiline input uses `/tasks/bulk`. `overview.spec.ts` (2) and
   `quick-add-default-reminders.spec.ts` waited for `POST .../tasks/bulk`;
   `quick-add-composer.spec.ts` (2) waited for `PUT`. All five now match the pathname
   `/api/v2/projects/<id>/tasks` with `POST`. The spec listed overview and composer under
   selector fixes only.
3. **Executor dispatches skipped.** The spec routed default-reminders and the menu test to
   `executor`. The build session diagnosed both from the code, so no dispatch was needed.
4. **Menu shortcut: test bug, not product bug.** The `Desktop Chrome` device sends a Windows
   user agent, so `isAppleDevice()` is false and `Mod` binds to Control. Playwright's
   `ControlOrMeta` sends Meta on a macOS host. The test now presses `Control+e`. On Linux CI
   the old test passed by accident.
5. **More group A residue ported than the spec named.** In `quick-add-composer.spec.ts` the
   labels assertion (`.details.labels-list`, no longer rendered) was ported as well as the
   priority assertion. In `quick-add-default-reminders.spec.ts` the reminders assertion
   (`.columns.details .reminder-input`) now opens the "1 reminder" chip and reads its popup.

No product bugs found; no `test.fixme` markers.

**Not done:** `flowlib set suite_green=true` is not recorded, because the gate is not green.

### Build session 2 (2026-10-02) — green

**Item 5 done.** `magefile.go` has `"VIKUNJA_RATELIMIT_TOKENREFRESHLIMIT=1000",` on the line after
`"VIKUNJA_RATELIMIT_NOAUTHLIMIT=1000",`. No other change in `magefile.go`.

**Red-first check.** The `vikunja` binary was started with the `apiCmd` environment from mage,
and 61 `POST /api/v1/user/token/refresh` requests were sent without a token. Without the new
variable: 60 responses of 401 and 1 of 429. With the new variable: 61 responses of 401.

**Targeted run** (Verification command 1): 108 passed, 2 skipped (OpenID, registration
"confirmation notice"), 0 failed.

**Full run** (`mage test:e2e "--reporter=line"`, 32.3 min): 54 failed, 381 passed, 4 skipped.
All 54 failing titles are group A titles from the #112 list (compared by title). No group B–E
title fails. The API log has 0 responses of 429. The three rate-limit tests from build session 1
pass. No test that passed in the baseline fails.

`pnpm lint` 0 (18 warnings, all pre-existing in `src/`); `pnpm typecheck` 0.

No new deviations. Deviations 1–5 from build session 1 stand for the reviewer.
