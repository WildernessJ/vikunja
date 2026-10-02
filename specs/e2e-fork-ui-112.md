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
- The diff touches only `frontend/tests/` and this spec.

## Stop criteria

Halt, record the reason in the Execution Log, commit and stop if any of these occur:

- A fix needs a change outside `frontend/tests/` (product code, `magefile.go`, `vite.config.ts`).
- A test that passed in the baseline fails after the group B fixture change, and a small,
  test-only change does not fix it.
- More than three tests become fixmes for product bugs. That many bugs means the "test-only"
  assumption of this cycle is wrong.
- Two fix attempts on one test fail.

## Execution Log

(The build phase appends here.)
