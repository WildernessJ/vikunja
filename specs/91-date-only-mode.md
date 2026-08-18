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
  through `parseTaskText` from its callers. Explicit-time branches are untouched;
  "tonight" (21:00) and "evening" count as explicit.
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
   - `formatDateToFlatpickrString` / `handleFlatpickrInput` (line 182): guard for the
     absent hour/minute inputs when `enableTime` is false.
7. **`src/components/input/Datepicker.vue`** — pass through `boundary` / `forceTime`;
   its trigger label (line 11) uses `formatDisplayDate(date, dateOnly && !forceTime)`.
8. **Datepicker call sites** — `TaskPropertyChips.vue` (due/end → `'end'`, start →
   `'start'`), `TaskContextMenu.vue` (due → `'end'`), `AddTask.vue` (due → `'end'`);
   `ReminderDetail.vue`, `TimeEntryForm.vue`, `RecurrencePatternPicker.vue` →
   `:force-time="true"`.
9. **`src/modules/quickAddMagic/dateParser.ts`** — `parseDate(text, now, dateOnly)`;
   when on, the no-explicit-time default paths (`getDateFromInterval`, the two
   `calculateNearestHours` month branches, `getDateFromText`-shaped results without an
   `at`-match in `addTimeToDate`) canonicalize to end-of-day via the helper. The `at/@`
   matcher result and `tonight` stay as-is. Check `deadlineParser.ts` during build: if it
   defaults a time the same way, apply the same rule; if not, leave it (log either way).
10. **`src/modules/quickAddMagic/quickAddMagic.ts`** — thread `dateOnly` through
    `parseTaskText`; callers `useQuickAddComposer.ts` (line 32/34) and
    `QuickActions.vue` (line 407) pass it from settings.
11. **`src/helpers/time/formatDate.ts`** —
    - `formatDisplayDateFormat(date, format, timeFormat?, dateOnly = false)`: empty
      `timeFormatString` and drop hour/minute from the two `Intl.DateTimeFormat`
      branches when on; RELATIVE branch → day-granularity relative (below).
    - `formatDisplayDate(date, dateOnly = false)` passes it through.
    - New `formatDateSinceDay(date)` (same file): compare `startOf('day')` against the
      shared `useGlobalNow` tick; same-day → `t('input.datepicker.today')`, +1 →
      `t('input.datepicker.tomorrow')`, else dayjs `.from()` on the day-floored values.
      Add a `yesterday` i18n key if none exists. `formatDateSince` itself is untouched
      (activity timestamps depend on it).
12. **Task-date display call sites** — pass `useDateOnly()`:
    `SingleTaskInProject.vue` (lines 369/385: dueDate, deadline),
    `KanbanCard.vue` (lines 54/67), `TaskGlanceTooltip.vue` (line 65 due only — line 74
    `created` stays), `DateTableCell.vue` gains an optional `dateOnly` prop wired by the
    table view's scheduled-date columns (due/start/end; created/updated columns stay).
    Kanban `done` / created timestamps stay.

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
   "foo tonight" → 21:00; "foo next week" → end-of-day. With flag off: existing
   expectations byte-identical (no snapshot churn).
3. `parseTaskText` threads the flag (one integration case through `quickAddMagic.ts`).
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
