# Spec — #91 Date-only mode (`feat/91-date-only-mode`)

Issue: https://github.com/WildernessJ/vikunja/issues/91
ADR: `docs/adr/ADR-0014-date-only-canonical-timestamp.md`
Scoping plan (local-only, superseded by this spec): `docs/context/plan-91-date-only-mode.md`

## Intent

A `frontendSettings.dateOnly` toggle (default off). When on: dates entered without an
explicit time get a canonical time (due/end **23:59:59.999 local**, start **00:00:00.000
local**) instead of `calculateNearestHours`; the datepicker hides its time controls; task
dates display without a time part, and relative display clamps to day granularity
("today" / "tomorrow" / "in 3 days", never "in 3 hours"). Explicit times — typed in quick
add ("at 3pm", "tonight") or stored before the toggle — are preserved and displayed.
Frontend-only; backend, API, and stored data untouched.

## Design

- **Canonical times** come from `roundToNaturalDayBoundary` (already 00:00 / 23:59:59.999),
  extended with a `force` flag that skips its `hours < 12` heuristic. One helper, one
  canonical pair; entry and Gantt agree.
- **Setting plumbing** mirrors `dateDisplay`: field on `IFrontendSettings`, default in
  `auth.ts loadSettings`, shared composable `useDateOnly()` copying `useDateDisplay`.
- **Per-call-site display opt-in, not blanket.** `formatDisplayDate` serves both task
  dates (due/start/end/deadline) and activity timestamps (comments, created/updated,
  sessions). Date-only applies **only** to task dates: `formatDisplayDate(date, dateOnly)`
  gains an optional flag (default `false`), and only the enumerated task-date call sites
  pass `useDateOnly()`. Activity timestamps keep clock times everywhere.
- **Parser stays store-free.** `parseDate(text, now, dateOnly = false)`; the flag threads
  through `parseTaskText` from its three callers — `useQuickAddComposer.ts`,
  `QuickActions.vue`, and `stores/tasks.ts` `buildTaskFromQuickAddTitle` (line 506, the
  sole store parse site, reached by both `createNewTask` and `createNewTasksBulk`). The
  store parse produces the API payload — the composer parse is only the UI preview;
  missing the store site ships the old auto-filled time. Explicit-time values are
  untouched: the `at/@` match, "tonight" (21:00), and hour-granular "in N hours" keep
  their times.
- **`parseDate`'s two internal siblings split by kind.** `deadlineParser.ts:26`
  (braced `{...}` deadline) parses a task-date → thread `dateOnly` through, same rule as
  the due date. `reminderParser.ts:68` (`~date` reminder syntax) parses an **alarm** —
  a reminder needs a sane fire time, and 23:59 is not one — so it stays on the existing
  default: call `parseDate` with `dateOnly=false` explicitly, with a one-line why
  comment. This is the same task-date-vs-point-in-time split as the picker exemptions.
- **Canonicalization provenance lives at `addTimeToDate` call sites.** A blanket
  end-of-day rule inside `addTimeToDate` would clobber "tonight"'s 21:00. Instead
  `addTimeToDate(text, date, previousMatch, defaultToEndOfDay = false)`: when
  `defaultToEndOfDay`, canonicalize the incoming date to end-of-day *before* the `at/@`
  matcher runs (an explicit time still overrides). `addTimeToDate` is a module-level
  sibling of `parseDate` with no scope access to `dateOnly` — so day-granular call
  sites pass `dateOnly` itself (never literal `true`) as the argument (the `getDateFromInterval` branches, next
  month, end of month, `getDateFromWeekday`, `getDayFromText`, `getDateFromText` —
  these currently carry `calculateNearestHours` or `now`'s wall-clock time), `false`
  for intentional times ("tonight", the time-only fallback). `getDateFromTextIn`
  ("in N hours/days") is the one data-dependent site: extend its return value with the
  matched unit (or a `dayGranular` boolean) and derive the flag from it — day-or-coarser
  units → `true`, hour/minute units → `false`.
- **Point-in-time inputs are exempt** (times are their payload): reminders
  (`ReminderDetail`), time tracking (`TimeEntryForm`), recurrence
  (`RecurrencePatternPicker`). `DeferTask` shifts an existing date's day and keeps its
  time — no change needed. Filter date inputs (`DatepickerWithValues`,
  `DatepickerWithRange`) are out of scope.

## Implementation plan

Files (all under `frontend/` except none — backend untouched):

1. **`src/helpers/time/roundToNaturalDayBoundary.ts`** — add `force = false` param:
   `force && !isStart` → always 23:59:59.999 (skip the `hours < 12` heuristic);
   `isStart` behavior unchanged.
2. **`src/modelTypes/IUserSettings.ts`** — `dateOnly: boolean` on `IFrontendSettings`.
3. **`src/stores/auth.ts`** (`loadSettings`, ~line 179 defaults block) —
   `dateOnly: false`.
4. **New `src/composables/useDateOnly.ts`** — copy `useDateDisplay.ts` shape
   (`createSharedComposable`, returns `{store}`).
5. **`src/views/user/settings/General.vue`** — checkbox near the dateDisplay select
   (~line 183); extend the `timeFormat` select's `v-if` (line 192) to also hide when
   `dateOnly` is on. i18n: `user.settings.general.dateOnly` (+ help text) in
   `src/i18n/lang/en.json` only.
6. **`src/components/input/DatepickerInline.vue`** —
   - `flatPickerConfig` (line 117): `enableTime: !dateOnly`, `dateFormat: 'Y-m-d'` when on.
   - `setDate` quick-selects (line 211): when on, canonicalize via
     `roundToNaturalDayBoundary(d, boundary === 'start', true)` instead of
     `calculateNearestHours`.
   - Manual calendar-day click with `dateOnly` on: flatpickr emits a date; canonicalize it
     the same way in the `flatPickrDate` setter path.
   - New prop `boundary: 'start' | 'end'` (default `'end'`); new prop
     `forceTime = false` — when true the component ignores `dateOnly` (for the exempt
     point-in-time consumers).
   - `formatDateToFlatpickrString` (line 127) must format per the active `dateFormat`
     (drop ` H:i` when date-only) — the `flatPickrDate` getter's string is what
     vue-flatpickr-component's v-model diffs against `$el.value`; a mismatched format
     makes `setDate` fire on every reactive pass. `handleFlatpickrInput` (line 182):
     guard for the absent hour/minute inputs when `enableTime` is false.
7. **`src/components/input/Datepicker.vue`** — pass through `boundary` / `forceTime`;
   its trigger label (line 11) uses `formatDisplayDate(date, dateOnly && !forceTime)`.
8. **Picker call sites.** Via the `Datepicker.vue` wrapper: `TaskPropertyChips.vue`
   (due/end → `'end'`, start → `'start'`), `AddTask.vue` (due → `'end'`),
   `TimeEntryForm.vue` and `RecurrencePatternPicker.vue` → `:force-time="true"`.
   Embedding `DatepickerInline` directly (no wrapper): `TaskContextMenu.vue` (lines
   111–112, due → `'end'`) and `ReminderDetail.vue` (line 55, `:force-time="true"`).
9. **`src/modules/quickAddMagic/dateParser.ts`** — `parseDate(text, now, dateOnly)` plus
   the `addTimeToDate` `defaultToEndOfDay` provenance param per the Design section:
   end-of-day for the day-granular default paths (`getDateFromInterval` branches, next
   month, end of month, `getDateFromWeekday`, `getDayFromText`, `getDateFromText`,
   day-or-coarser `getDateFromTextIn`), preserved times for `tonight`, hour-granular
   `getDateFromTextIn`, the time-only fallback, and any `at/@` match (which always wins,
   applied after canonicalization). Siblings per Design: `deadlineParser.ts:26` threads
   `dateOnly` through; `reminderParser.ts:68` passes `dateOnly=false` explicitly
   (reminders are alarms) with a one-line why comment.
10. **`src/modules/quickAddMagic/quickAddMagic.ts`** — thread `dateOnly` through
    `parseTaskText`; its three callers pass it from settings: `useQuickAddComposer.ts`
    (lines 32/34), `QuickActions.vue` (line 407), and `stores/tasks.ts`
    `buildTaskFromQuickAddTitle` (line 506) — the API-payload path, reached by both
    `createNewTask` and `createNewTasksBulk` (see Design).
11. **`src/helpers/time/formatDate.ts`** —
    - `formatDisplayDateFormat(date, format, timeFormat?, dateOnly = false)`: empty
      `timeFormatString` (and trim the format string — no trailing space) and drop
      hour/minute from the two `Intl.DateTimeFormat` branches when on; RELATIVE branch
      → day-granularity relative (below).
    - `formatDisplayDate(date, dateOnly = false)` passes it through.
    - New `formatDateSinceDay(date)` (same file): compare `startOf('day')` against the
      shared `useGlobalNow` tick; same-day → `t('input.datepicker.today')`, +1 →
      `t('input.datepicker.tomorrow')`, else dayjs `.from()` on the day-floored values.
      Add a `yesterday` i18n key if none exists. `formatDateSince` itself is untouched
      (activity timestamps depend on it).
12. **Task-date display call sites** — pass `useDateOnly()`:
    `SingleTaskInProject.vue` (lines 369/385: dueDate, deadline),
    `SingleTaskInlineReadonly.vue` (line 63: dueDate — surfaces in the QuickActions
    command palette's task results), `KanbanCard.vue` (lines 54/67),
    `TaskGlanceTooltip.vue` (line 65 due only — line 74 `created` stays),
    `DateTableCell.vue` gains an optional `dateOnly` prop wired by the table view's
    scheduled-date columns (due/start/end; created/updated/doneAt columns stay —
    doneAt is activity, matching `CreatedUpdated.vue`). Kanban `done` / created
    timestamps stay.

Not touched: anything in `pkg/` (including `pkg/i18n`), Gantt (already day-rounded),
`dueDateUrgency` (already calendar-day), `DeferTask`, filter inputs, stored data.

## Execution routing

Driver implements directly (single execution-model session, `/tdd` at the seams below).
No subagent dispatch — well-specced, single-surface frontend change, no concurrency or
protocol logic. No `security` agent: no trust boundary, no auth surface, no backend.

## Tests (red-first, in this order)

Seams pre-agreed here; write each red before its implementation step.

1. `roundToNaturalDayBoundary.test.ts` (extend): morning date + `force` + end →
   23:59:59.999 (heuristic alone would give 00:00); `force` + start → 00:00:00.000;
   no-`force` behavior unchanged.
2. `dateParser` (extend `quickAddMagic.test.ts` or sibling): with `dateOnly=true` —
   "foo tomorrow" → tomorrow 23:59:59.999 local; "foo tomorrow at 3pm" → 15:00;
   "foo tonight" → 21:00; "foo next week" → end-of-day; "foo monday" (weekday path) →
   end-of-day; "foo 24th" (ordinal path) → end-of-day; "foo in 3 days" → end-of-day;
   "foo in 3 hours" → now+3h (time preserved). With flag off: existing expectations
   byte-identical (no snapshot churn).
3. `parseTaskText` threads the flag (integration cases through `quickAddMagic.ts`):
   due date end-of-day with the flag on; `{tomorrow}` deadline end-of-day;
   `~tomorrow` reminder time UNchanged (alarm exemption). Store path:
   `buildTaskFromQuickAddTitle` is not exposed on the store's returned object
   (`stores/tasks.ts:723-748`) and `createNewTask` hits `TaskService` — so either
   expose `buildTaskFromQuickAddTitle` on the store return (test seam) or `vi.mock`
   `TaskService` and drive `createNewTask`; pick the smaller diff and log the choice
   in the Execution Log. The assertion: toggle on → API-bound `dueDate` is end-of-day.
4. `formatDate.test` (new or extend): `formatDisplayDateFormat` with `dateOnly=true`
   drops the time part for one slash-format and one `Intl` format; `formatDateSinceDay`:
   today → "Today", tomorrow → "Tomorrow", +3 days → "in 3 days", −1 day → yesterday
   string. `formatDateSince` untouched cases still pass.
5. `DatepickerInline` (component test, new): with `dateOnly` on — config has
   `enableTime: false`; quick-select "tomorrow" emits 23:59:59.999; with
   `boundary='start'` emits 00:00; with `forceTime` the time controls stay. If mounting
   flatpickr in vitest proves hostile, fall back to unit-testing the extracted
   `setDate`/config computeds and log the substitution in the Execution Log.
6. Regression guard: full existing frontend unit suite green.

## Verification

- `cd frontend && pnpm test:unit` — all green, including the six seams above.
- `cd frontend && pnpm typecheck` — no NEW errors (known baseline: `CreateEdit.vue`
  TS2590 + the carried `task.test.ts` 0→4 ratchet regression).
- `mage test:web` — green (backend untouched; suite is still the merge gate).
- Live verify (browser, `live_verify_mode: browser`): toggle on in Settings → General;
  quick add "buy milk tomorrow" → chip shows "Tomorrow" (no clock time), API payload
  `due_date` is local 23:59:59.999; datepicker popup has no time row; task list shows
  "due today"-style strings, no "in N hours"; a comment timestamp still shows a clock
  time; toggle off → time controls and clock displays return; a pre-existing task with
  15:00 due still shows 15:00 with the toggle off and "today" with it on.

Done looks like: all of the above, whole change committed on `feat/91-date-only-mode`,
Execution Log appended.

## Stop criteria

- Any change required in `pkg/` (backend, API i18n) → halt, log, back to plan.
- The per-call-site display opt-in turns out to miss a surface that needs a design call
  (a call site that is neither clearly task-date nor clearly activity) → halt and log
  rather than deciding ad hoc.
- flatpickr's `enableTime: false` path needs more than the guard in
  `handleFlatpickrInput` (e.g. rework of the string round-trip) beyond a bounded
  2-attempt fix → halt.
- Test 5's component harness fails after the logged fallback also proves infeasible →
  halt.
- Suite red after a bounded 2-attempt fix at the same tier → halt.

## Execution Log

(build phase appends here)

### Build phase — 2026-08-18

Implemented from the spec with no design deviations. Suite green, no new typecheck errors.

**Choices the spec left open**

- **Test 3 store seam:** used the existing `src/stores/tasks.createNewTask.test.ts`, which
  already mocks `TaskService` and the auth store. Added a hoisted `dateOnly` holder to that
  mock and drove `createNewTask` — no production test seam, `buildTaskFromQuickAddTitle`
  stays unexported. Smaller diff than exposing it on the store return.
- **Test 5 harness:** flatpickr mounts fine under happy-dom, so the component test is real
  (`src/components/input/DatepickerInline.test.ts`) — no fallback to unit-testing computeds
  needed. It asserts on the rendered `input.flatpickr-hour`, not on the config object.
- **New test files** rather than extending `quickAddMagic.test.ts` (1031 lines):
  `dateParser.dateOnly.test.ts`, `quickAddMagic.dateOnly.test.ts`, `formatDate.test.ts`.

**Deviations and additions**

- `src/models/userSettings.ts` also needed `dateOnly: false`. The spec named only
  `stores/auth.ts loadSettings`, but `IFrontendSettings` is a required-field interface and
  `UserSettingsModel`'s literal must satisfy it — typecheck catches it.
- **`useQuickAddComposer.test.ts` needed `setActivePinia`.** Adding `useDateOnly()` to the
  composable gave it its first store dependency; the test had no pinia at all.
- **`DatepickerInline.test.ts` mocks the auth store with a real `ref`, not a plain object.**
  `useDateOnly` is a `createSharedComposable` wrapping a `computed`; a non-reactive mock lets
  the computed cache the first test's value and every later test reads it.
- **`formatDateSinceDay` calls `translate()` from `@/message`, not `i18n.global.t`.** The
  typed `t` raised TS2589 (excessively deep) on the literal keys; `@/message` already exports
  the loosely-typed wrapper for exactly this, with the reason in a comment there.
- **Settings hint is a `<p class="help">` sibling, not a `hint` prop.** `FormCheckbox` has no
  `hint` prop, and the help paragraph is the pattern already used elsewhere in `General.vue`.
- `handleFlatpickrInput` needed **no** new guard: it already dispatches on the target's
  class, so absent hour/minute inputs simply never fire.

**For the reviewer**

- `getDateFromTextIn`'s return type gained `dayGranular`. Additive; its only callers are
  `parseDate` and its own tests.
- `addTimeToDate` reassigns `date` when canonicalizing (`roundToNaturalDayBoundary` returns a
  new Date) instead of mutating in place — the `at/@` matcher below it still mutates and so
  still wins.
- **Known soft edge:** `SingleTaskInProject`'s `dueDateFormatted` / `deadlineFormatted`
  recompute on a 60s interval and on date change, not on the setting change. Toggling
  date-only leaves an already-mounted list stale for up to a minute. Left alone: the setting
  is only reachable from a different route, so returning to a list remounts the component.
- `mage test:web` needs `frontend/dist` (the Go embed). A fresh worktree has none — run
  `pnpm build` in `frontend/` first or the suite fails at setup, not on a real failure.

### Build phase — review fixes

`/code-review high` (6 findings) run against the build commit. Four fixed here — each one
line to a few, in files already in the diff, no design change. Two are spec decisions and
were left for the review session (below).

- **Finding 1 (the real one), `DatepickerInline.vue`:** `enableTime: false` hid the time
  *row*, but `altFormat` stayed `date.altFormatLong` (`"j M Y, H:i"`), and flatpickr's
  `altInput` is the field the user actually sees. Confirmed by mounting: the input read
  `5 Jan 2026, 00:00` for a stored `23:59:59.999` — a clock in the mode that exists to hide
  clocks, showing a time that contradicts what was saved. Now switches to the already-present
  and previously unused `date.altFormatShort` (`"j M Y"`). Regression test asserts the alt
  input carries no `H:i`.
- **Finding 3, long-date tooltips:** `formatDateLong` gained the same `dateOnly` flag
  (`'LL'` instead of `'LLLL'`), threaded at the six task-date tooltips —
  `DateTableCell`, `KanbanCard` (due + deadline), `SingleTaskInProject` (due + deadline —
  the review missed the deadline one), `SingleTaskInlineReadonly`. Hovering a due date no
  longer reveals the synthetic 23:59:59.999. Every remaining `formatDateLong` call site is
  activity (comments, attachments, created/updated/doneAt, notifications, export expiry,
  migration) or the time-tracking display, and stays on the clock format by design.
- **Finding 4, `General.vue`:** the two `formatDisplayDateFormat` preview labels in the
  date-display dropdown now pass `dateOnly`, so the option previews match what tasks render.
- **Finding 5, `getDateFromTextIn`:** the regex is `/…/ig` but the unit `switch` listed only
  lowercase, so "in 3 Hours" fell through — leaving `dayGranular` at its `true` default and
  snapping an explicitly hour-granular expression to end of day. Fixed at the root with
  `parts[2].toLowerCase()`, which also repairs the pre-existing bug where such a match
  produced `now` unchanged.

**Not fixed — these are spec decisions, for the review session to confirm or reopen:**

- **Finding 2:** spec step 5 says to hide the Time format selector when date-only is on, and
  that is what was built. The consequence the review names is real: reminders, time tracking
  and recurrence still render clocks, so a 12-hour user who enables date-only loses the only
  control over their format until they turn it off again. Changing it means dropping
  `&& !dateOnly` from that `v-if` — a spec amendment, not a build fix.
- **Finding 6:** spec's Design lists recurrence under the point-in-time exemptions, so
  `RecurrencePatternPicker`'s end date carries `force-time`. The review's counter-argument is
  fair — that value feeds RRULE `UNTIL=`, a boundary date rather than an alarm — but
  re-deciding an exemption the spec settled is a plan-phase call.

### Review phase — 2026-08-18

The verifier CONFIRMED a missed entry path the spec's caller graph never listed:
`TaskContextMenu.vue`'s `dueDateForInterval` (the "Due Today" / "Due Tomorrow" /
"Due Next Week" flyout buttons) reimplements quick-select with `calculateNearestHours`,
independent of the embedded `DatepickerInline` the spec did cover. With date-only on it
stored a wall-clock time. Fixed in-review (Jason approved crossing the files-in-diff
threshold): red-first test in `TaskContextMenu.test.ts`, then route through
`roundToNaturalDayBoundary(date, false, true)` when `dateOnly` is on. Everything else
the verifier checked survived, including a repo-wide caller audit of the format/parse
helpers and flag-off byte-identical behavior.

Jason resolved the two open spec decisions, reversing both:

- **Finding 2:** the Time format selector shows again with date-only on (dropped
  `&& !dateOnly` from the `v-if`). The format still governs reminders, time tracking,
  recurrence, and activity timestamps — hiding it stranded 12-hour users.
- **Finding 6:** `RecurrencePatternPicker`'s end date dropped `:force-time="true"`.
  The "point-in-time" exemption protected nothing: `formatUntil` serializes only the
  calendar date (hardcoded `T000000Z`), so the time the exempt picker collected never
  reached the stored rule — it only showed a pointless time row and a fake clock label.
