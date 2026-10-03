# router-cleanup-79-80 — one back-entry reader, no dead route meta, `meta.authPage` (#79, #80)

## Intent

Three frontend router cleanups. None of them changes what a user sees.

1. **#79, part 1.** `closeModal` in `useRouteWithModal.ts` reads the history back entry with a
   raw regex. `TaskDetailView.vue` reads the same entry with `router.resolve()`. After this
   change, both use one shared helper, and the regex and its dead fallback are gone.
2. **#79, part 2.** Remove the route meta keys `showAsModal` (17 routes) and `adminMode` (the
   `/admin` route). No code reads them.
3. **#80.** Replace the hand-kept `AUTH_ROUTE_NAMES` set with a `meta.authPage` flag on the
   auth routes. `App.vue` and the auth guard read the flag. `constants/authRouteNames.ts` is
   deleted.

## Design

Decisions that Jason made on 2026-10-03 (plan session):

- **One cycle for both issues.** Both are small router refactors with no change in behavior.
- **#80: read `meta.authPage` at the call sites. Do not derive a set.** Each of the two readers
  already holds the route (`route` in `App.vue`, `to` in the guard). A set computed from
  `router.getRoutes()` in `constants/authRouteNames.ts` would import the router, and the router
  imports that file, which is an import cycle. The flag on the route is the only list.
- **#79: `closeModal` keeps its behavior exactly.** This is a pure refactor. Unit tests pin the
  current decisions before the refactor (Tests, item 1). `closeModal` does **not** get a
  `canReturnTo()` gate before `router.back()`.

What #80 does and does not close. Before: a route with `returnability: 'no'` that renders
outside the app shell had to be added to a second list by hand, and nothing checked that list.
After: the second list is gone. A new auth route still needs `authPage: true` set by hand.
A test pins the exact set of `authPage` routes and checks that each one has
`returnability: 'no'`. Nothing makes a missed flag impossible. This is a convention, not
an enforced rule.

Facts the build session must keep (confirmed in the plan session against `1b07d1fa4`):

- The regex `\/projects\/\d+\/(\d+)` does not match negative project ids. A back entry for a
  saved filter (`/projects/-2/5`) falls through to `router.back()` today. `router.resolve()`
  names that entry `project.view`, so a name check alone changes behavior.
- `project.view` is `/projects/:projectId/:viewId`, and `:viewId` has no digit constraint.
  `/projects/5/abc` resolves to `project.view`. The regex does not match it.
- When the regex matches, `match[1]` is a non-empty digit string. The `if (!viewId)` branch
  (`useRouteWithModal.ts`, about lines 77-80) cannot run.
- When a task was moved, `closeModal` pushes the old project's `viewId` with the new project's
  id. `ProjectView.vue:55` already sends an unknown view on to a valid one. This is not a bug.
  Do not change it.
- `TaskDetailView.vue` reads `router.options.history.state`. `useRouteWithModal.ts` reads
  `window.history.state`. With `createWebHistory` the two are the same object.

## Implementation plan

1. **Shared helper.** Create `frontend/src/helpers/backRoute.ts`:
   ```ts
   export function resolveBackRoute(router: Router): ReturnType<Router['resolve']> | null
   ```
   Move the body from `TaskDetailView.vue:496-502` without change, including its comment
   (state is not reactive; resolve at call time). `TaskDetailView.vue` imports it and calls
   `resolveBackRoute(router)` at its three call sites. `projectIdOf` stays in
   `TaskDetailView.vue`, because no other file uses it.
2. **`closeModal`.** Replace the regex block with:
   - `const backRoute = resolveBackRoute(router)`
   - The project-view branch runs when `backRoute?.name === 'project.view'`, both
     `backRoute.params.projectId` and `backRoute.params.viewId` are all-digit strings
     (`/^\d+$/`), and `baseStore.currentProjectId !== 0`. This is the regex's match set for
     every path the app produces.
   - `viewId` is `backRoute.params.viewId`. Delete the `if (!viewId)` fallback and the
     `if (viewId)` guard around the push.
   - The rest of `closeModal` (the `router.back()` branch, the backdrop branch and the
     fallbacks) does not change. If `useProjects()`/`projectList` has no reader left in the
     file, remove it.
3. **Dead meta.** Delete every `showAsModal: true` and the `adminMode: true` line in
   `frontend/src/router/index.ts`. Where a `meta: {}` object becomes empty, delete it.
4. **`meta.authPage`.**
   - `frontend/src/types/vue-router.d.ts`: add `authPage?: true` to `RouteMeta`, with a doc
     comment. It renders in the logged-out shell (`App.vue`), and the guard does not send an
     anonymous visitor from it to login. Say that it is a separate question from
     `returnability`: every `authPage` route is `returnability: 'no'`, but not the reverse
     (the 404s, `oauth.authorize`, `migrate.service`).
   - `frontend/src/router/index.ts`: add `authPage: true` to the six routes now in the set:
     `user.login`, `user.register`, `user.password-reset.request`,
     `user.password-reset.reset`, `link-share.auth`, `openid.auth`. The guard line
     (about line 676) becomes `!to.meta.authPage && !hasEmailConfirmToken`. Update the comment
     above it.
   - `frontend/src/App.vue:97,103`: replace `AUTH_ROUTE_NAMES.has(route.name)` with
     `route.meta.authPage`. Keep the `typeof route.name === 'string'` checks. Before the first
     navigation, the route has no name, and both computeds must stay `false` there.
   - Delete `frontend/src/constants/authRouteNames.ts`. Then grep the whole repo (not only
     `src/`) for `AUTH_ROUTE_NAMES` and `authRouteNames`. Expect zero hits outside `specs/`.

## Execution routing

- Driver (the build session) does all of it. The change is small and the design is fixed.
  Order: Tests item 1 (green on the old code) → Implementation items 1-2 → Tests item 2 →
  Implementation item 4 → Implementation item 3.
- No executor dispatch, no security agent. The #80 change touches the login predicate, but
  the new test pins the exact route set that the old list held. The verifier at review covers it.

## Tests

1. **Characterization tests, written first and green on the old code**, in a new
   `frontend/src/composables/useRouteWithModal.test.ts`. Use the `TaskDetailView.test.ts`
   setup: `window.history.replaceState(null, '', '/')`, then a `createWebHistory()` router.
   Build the history state with real pushes, or with
   `window.history.replaceState({...state, back, backdropView}, '')`. Spy on `router.push`
   and `router.back`. Cases:
   - back `/projects/5/10`, `currentProjectId` 7, backdropView carries a query → push
     `project.view` `{projectId: 7, viewId: '10'}` with the backdrop's query.
   - back `/projects/5/10`, `currentProjectId` 0 → `router.back()`.
   - back `/projects/-2/5` (saved filter), `currentProjectId` 7 → `router.back()`.
   - back `/projects/5/abc`, `currentProjectId` 7 → `router.back()`.
   - back `/tasks/1`, `currentProjectId` 7 → `router.back()`.
   - no back, backdropView `/projects/5/10` → push the resolved backdrop.
   - no back, no backdropView, `currentProjectId` 7 → push `project.index` `{projectId: 7}`;
     `currentProjectId` 0 → push `home`.
   Commit these tests before the refactor. They must pass on both commits.
2. **`TaskDetailView.test.ts` back-button and breadcrumb suites** must pass unchanged after
   Implementation item 1. They are the existing pin for `resolveBackRoute`.
3. **`router/index.test.ts`:**
   - Replace "flags every auth route" with one test: the set of route names where
     `meta.authPage === true` equals exactly the six names above, and each has
     `returnability: 'no'`.
   - Keep the 404 test at about line 153. Change its first assertion to
     `expect(to.meta.authPage).toBeFalsy()`.
   - Keep the existing `getAuthForRoute` suites unchanged. They pin the login gate.
4. **`App.vue` shell gate:** if an `App.vue` unit test exists, extend it. If none exists,
   do not create one. The live verify covers the gate.

## Verification

Run every command from the worktree root `/Volumes/ext-ssd/Github/router-cleanup-79-80`.
Save the output to a file and read the file.

1. `cd frontend && pnpm vitest run --dir ./src` (not bare `vitest run`: it picks up the
   Playwright files, see PITFALLS), `pnpm typecheck`, `pnpm lint`.
2. `mage test:feature` (the suite in `.workflow.yaml`; the backend does not change, but it is
   the recorded gate).
3. Targeted E2E: `mage test:e2e "--reporter=line tests/e2e/user/login.spec.ts tests/e2e/user/logout.spec.ts tests/e2e/user/registration.spec.ts tests/e2e/user/password-reset.spec.ts tests/e2e/user/oauth-authorize.spec.ts tests/e2e/user/session-refresh.spec.ts tests/e2e/sharing/linkShare.spec.ts tests/e2e/project/project-view-kanban.spec.ts"`.
4. Live verify in the browser (review phase):
   - Logged out: `/login`, `/register`, `/get-password-reset` render in the logged-out shell.
     `/projects/1/1` bounces to `/login`.
   - Logged in: the app shell renders. Log out from a project view: the logged-out shell
     renders, with no app components mounted against a null user.
   - Open a task from a project view, close it with the modal close: back on the same view.
   - Open a task from a project view, move it to another project, close it: the other
     project's view.

Done looks like this:

- All commands above exit 0. The unit count goes up by the new tests only.
- `grep -rn "showAsModal\|adminMode\|AUTH_ROUTE_NAMES\|authRouteNames" frontend/src` returns
  nothing.
- `useRouteWithModal.ts` contains no `RegExp`.
- The diff touches only: `helpers/backRoute.ts`, `composables/useRouteWithModal.ts` and its
  new test, `views/tasks/TaskDetailView.vue`, `router/index.ts`, `router/index.test.ts`,
  `types/vue-router.d.ts`, `App.vue`, the deleted `constants/authRouteNames.ts`, and this spec.

## Stop criteria

Halt, record the reason in the Execution Log, commit and stop if any of these occur:

- A characterization test from Tests item 1 cannot be made green on the old code without
  changing product code. That means the plan's reading of `closeModal` is wrong.
- A characterization test fails after the refactor, and the cause is not an obvious slip in
  the new condition.
- Removing `AUTH_ROUTE_NAMES` needs a change in a file not listed in Done.
- Any targeted E2E test that passes on `main` fails on the branch.
- Two fix attempts on one failure fail.

## Execution Log

_Empty. The build phase appends here._
