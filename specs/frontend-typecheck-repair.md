# Spec: Frontend typecheck repair

## Intent

Repair the three approved frontend typecheck errors at the clean main baseline
`603a122e2f13927e3c7358f963cddbd85ce53197` without changing runtime behavior,
test assertions, dependencies, generated code, configuration, or unrelated
formatting. This file records the already-approved proposal and its execution;
it is not a new planning cycle or an ADR.

## Approval, target, and boundaries

- Approved scope: `frontend/src/client/queries/labels.ts`,
  `frontend/src/components/misc/CreateEdit.vue`, and
  `frontend/src/services/task.test.ts`, plus this execution record.
- Target branch: `fix/frontend-typecheck`, in
  `/Volumes/ext-ssd/Github/coding-workflow/.worktrees/vikunja-frontend-typecheck`.
- Main checkout confirmed through Git: `/Volumes/ext-ssd/Github/vikunja`.
  Its local-only memory spine is `/Volumes/ext-ssd/Github/vikunja/docs/context/`
  (`PROJECT_STATE.md`, `RUN_LOG.md`, and `PITFALLS.md`); this repair does not
  modify it.
- The backend candidate at `23a6545661533f3ff23e6e0e2adfdf516374f071` and its
  worktrees remain unchanged and unmerged.
- Excluded: casts, type suppressions, dependency/config/lockfile changes,
  broad icon refactors, generated-code edits, assertion changes, unrelated
  formatting, backend/toolkit/OMP work, installation, services, merge, push,
  deployment, and any live-project work.

## Recorded red baseline

The supplied failing baseline is preserved byte-for-byte at:

`/Volumes/ext-ssd/Github/coding-workflow/.artifacts/vikunja-timezone-pilot/evidence/frontend-typecheck-correction.{stdout.log,stderr.log,exit,meta}`

It records `cd frontend && pnpm typecheck` exit `2` with six distinct
diagnostics (the output repeats them):

1. `src/client/queries/labels.ts:147:38` — TS2589, excessively deep type
   instantiation from direct `i18n.global.t`.
2. `src/components/misc/CreateEdit.vue:59:15` — TS2590, the `IconProp` union is
   too complex for the component prop type.
3. `src/services/task.test.ts:96-99` — four TS2339 errors because the local
   mock task only declares `title`.

The baseline is evidence, not a ratchet; it is not replaced by this execution.

## Three root causes and implementation

### 1. Labels notification translation typing

`frontend/src/client/queries/labels.ts:12` uses `i18n` for locale selection at
`sortLabelsAlphabetically`, so that import remains. At lines 147 and 154, the
notification messages call the fully typed `i18n.global.t`, unlike the existing
wrapper in `frontend/src/message/index.ts:7-9`. Import `translate` alongside
`success` and replace only those two notification calls with `translate`,
preserving keys, arguments, and `success({message: ...})` behavior.

### 2. CreateEdit icon prop breadth

`frontend/src/components/misc/CreateEdit.vue:55-70` currently imports
`IconProp`, whose complete Font Awesome union triggers TS2590. Before editing,
`rg` confirmed all callers: most omit `primary-icon` and use the default; two
bind explicit `undefined` (`FilterEdit.vue`, `ProjectSettingsEdit.vue`); and
the only literals are `copy` (`ProjectSettingsSaveTemplate.vue`) and `paste`
(`ProjectSettingsDuplicate.vue`). Narrow the prop exactly to
`'plus' | 'copy' | 'paste'`, remove the now-unused `IconProp` import, and
preserve `withDefaults` plus the default `'plus'`.

### 3. Bulk-create test payload shape

`TaskService.toBulkCreatePayload` in `frontend/src/services/task.ts:144-178`
returns an object literal containing the five asserted fields as keys. The
production values are established by `TaskModel` defaults and processing:
`deadline` is normalized by `toISOStringOrNull` to `string | null`, while
`estimated_duration` is a number, `repeat_rrule` is a string, and
`repeat_from_completion` is a boolean. The object literal always includes all
five keys, and `title` is a required task field. Add a local mock-payload task
interface with required `title: string`, `deadline: string | null`,
`estimated_duration: number`, `repeat_rrule: string`, and
`repeat_from_completion: boolean`; use it for `BulkPayload.tasks`. Preserve all
assertions and do not edit production payload construction.

## Approved validation

Run from `frontend/`, with each command's stdout, stderr, exit status, and
metadata saved separately under the new private directory
`/Volumes/ext-ssd/Github/coding-workflow/.artifacts/vikunja-frontend-typecheck/`:

```text
pnpm test:unit --run src/client/queries/labels.test.ts src/components/misc/CreateEdit.test.ts src/services/task.test.ts
pnpm lint
pnpm typecheck
```

`frontend/package.json` was inspected first: `lint` is the check-only script
`eslint 'src/**/*.{js,ts,vue}'`. Focused tests and lint must exit 0. Plain
typecheck is authoritative and must exit 0 with no diagnostics. Check Git
status/diff after each command; stop if a command modifies anything outside the
approved paths. If `frontend/node_modules` is absent, reuse the main checkout's
existing dependency tree with a preserving local copy, without installation,
download, lockfile edits, or upgrades, and disclose that limitation.

## Stop criteria

Stop and preserve the candidate if complexity errors persist, any new
diagnostics appear, focused tests or lint fail, existing CreateEdit default
behavior tests fail, or a command changes an unapproved path. Do not widen the
scope or try another strategy. Do not run a verifier, reviewer, auditor, merge,
push, install, deployment, or service workflow from this executor session.

## Commit disposition

Commit only the three approved product/test files and this spec using explicit
paths. Confirm the staged name set and absence of unrelated diff. Commit locally
with a conventional `fix:` subject and stop committed but **UNMERGED**.

Commit placeholder: pending execution.

## Execution Log

### Initial inspection — 2026-09-20

- Worktree was clean on `fix/frontend-typecheck` at
  `603a122e2f13927e3c7358f963cddbd85ce53197`; main is the same revision.
- `git pull --ff-only` was attempted as required by repository policy but could
  not run because this local branch has no tracking information; it made no
  changes.
- `git worktree list --porcelain` confirmed the main checkout and the separate
  backend worktrees. Main and both backend worktrees were clean; the backend
  candidate remains at `23a6545661533f3ff23e6e0e2adfdf516374f071`.
- The preserved red baseline was read and not modified.
- `frontend/package.json` confirmed the check-only lint script. The current
  worktree lacks `frontend/node_modules`; the main checkout has an existing
  `frontend/node_modules` tree to copy locally if needed. No install or upgrade
  has run.
- Caller/type evidence and exact execution results will be appended below.

### Validation and closeout

Implementation completed in the three approved product/test files. The exact
commands were run from `frontend/`; each has independent evidence under
`/Volumes/ext-ssd/Github/coding-workflow/.artifacts/vikunja-frontend-typecheck/`.

- `pnpm test:unit --run src/client/queries/labels.test.ts src/components/misc/CreateEdit.test.ts src/services/task.test.ts`
  exited `0`. Evidence: `focused-tests.stdout.log`, `focused-tests.stderr.log`,
  `focused-tests.exit`, and `focused-tests.meta`. Vitest reported 3 files and
  39 tests passed. Stderr contained existing PostCSS/Sass deprecation warnings.
- `pnpm lint` exited `0`. Evidence: `lint.stdout.log`, `lint.stderr.log`,
  `lint.exit`, and `lint.meta`. The check reported 0 errors and 16 warnings;
  all warnings are outside the changed files (existing Vue prop-default and
  axios dependency warnings).
- `pnpm typecheck` exited `2`. Evidence: `typecheck.stdout.log`,
  `typecheck.stderr.log`, `typecheck.exit`, and `typecheck.meta`. The three
  approved diagnostics are gone, but two unrelated new diagnostics appeared,
  each repeated in the output: TS4023 at
  `src/components/input/editor/emoji/emojiExtension.ts:6:14` involving
  `SuggestionProps`, and TS2883 at
  `src/components/input/Multiselect.vue:758:7` involving Vue's `IfAny`.

The new diagnostics trigger the approved stop criterion. No second strategy,
scope expansion, generated-code edit, dependency action, or rerun was attempted.
The candidate is preserved with the three source/test changes and this record
uncommitted; no commit is claimed because the authoritative check did not pass.
The copied `frontend/node_modules/` directory is ignored and was copied from
`/Volumes/ext-ssd/Github/vikunja/frontend/node_modules` solely to run these
checks; no package installation, download, upgrade, lockfile edit, or tracked
dependency change occurred.

Final status: **STOPPED — UNCOMMITTED, UNMERGED** due to new plain-typecheck
diagnostics outside the approved files. Commit placeholder remains pending.

### Authorized continuation amendment — 2026-09-20

The continuation was authorized after a named planner confirmed that the two
new diagnostics were latent declaration defects: `emojiSuggestion.ts` and
`Multiselect.vue` were byte-identical to baseline `603a122e2f13927e3c7358f963cddbd85ce53197`,
and `frontend/package.json`, `frontend/pnpm-lock.yaml`, and dependencies were
unchanged. The prior diagnostics are preserved in
`amendment-typecheck` evidence: TS4023 at `emojiExtension.ts:6:14` for the
private `SuggestionProps`, and TS2883 at `Multiselect.vue:758:7` for the
generic component declaration's inferred `IfAny` reference.

Approved type-only corrections:

- `emojiSuggestion.ts` now type-imports the public `SuggestionProps` from
  `@tiptap/suggestion` and uses `SuggestionProps<EmojiEntry, EmojiEntry>` for
  `mount`, `onStart`, and `onUpdate`. Runtime statements, exports, command
  behavior, and APIs are unchanged.
- `Multiselect.vue` now declares only the existing `items`, `tag`, and
  `searchResult` slots through `defineSlots`, preserving generic `T` and all
  existing props, defaults, events, template, and runtime statements. The
  macro was placed after `defineEmits` to satisfy the repository's macro-order
  lint rule. Typecheck then showed the template create-option call passes
  Vue's `UnwrapRef<T>` at line 134; the slot's `option` contract was therefore
  corrected to `T | string | UnwrapRef<T>`—the narrow type-only adjustment
  required by the actual template call site. No cast, suppression, dependency,
  config, lockfile, or generated-code change was made.

Continuation evidence, all under
`/Volumes/ext-ssd/Github/coding-workflow/.artifacts/vikunja-frontend-typecheck/`:

- The original focused command exited `0`: 3 files and 39 tests passed.
  Evidence: `amendment-focused-tests.{stdout.log,stderr.log,exit,meta}`.
- The amendment-focused command exited `0`: 2 files and 14 tests passed.
  Evidence: `amendment-component-tests.{stdout.log,stderr.log,exit,meta}`.
- The first post-amendment `pnpm lint` exited `1` only because the new
  `defineSlots` call preceded `defineEmits` (`vue/define-macros-order`), with
  the same 16 pre-existing warnings. Evidence:
  `amendment-lint.{stdout.log,stderr.log,exit,meta}`. After moving the macro,
  `pnpm lint` exited `0` with exactly those 16 warnings and no errors.
  Evidence: `amendment-lint-correction.{stdout.log,stderr.log,exit,meta}`.
- The first post-amendment `pnpm typecheck` exited `2` only on the direct
  `UnwrapRef<T>` slot-call mismatch at `Multiselect.vue:134`; evidence:
  `amendment-typecheck.{stdout.log,stderr.log,exit,meta}`. After the permitted
  slot signature correction, plain typecheck exited `0` with no diagnostics.
  Evidence: `amendment-typecheck-correction.{stdout.log,stderr.log,exit,meta}`.
- `pnpm build` exited `0`: Vite transformed 1798 modules and Workbox copied
  its libraries. Evidence: `amendment-build.{stdout.log,stderr.log,exit,meta}`.
  Build stderr contains existing Sass deprecation, Lightning CSS, and Vite
  option warnings only; no build errors occurred.

Direct browser coverage was not required for these type-only/API-preserving
changes and was not run. Playwright/E2E was not run; repository policy requires
the unavailable `run-e2e-tests` skill for that workflow. Backend suites were
not run. The ignored `frontend/dist/` build output and local copied
`frontend/node_modules/` are ordinary verification artifacts; no tracked
unapproved file changed.

All amendment checks pass after the two permitted type-only corrections. The
candidate is ready for explicit-path staging and local commit, then remains
**UNMERGED**. Final commit identity: pending.
