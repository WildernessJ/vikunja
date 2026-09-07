# date-only-gantt-defer Specification

Issues: [#92](https://github.com/WildernessJ/vikunja/issues/92) (Gantt drag/resize),
[#95](https://github.com/WildernessJ/vikunja/issues/95) (DeferTask). Branch `fix/date-only-gantt-defer`.
Governing decision: [ADR-0014](../docs/adr/ADR-0014-date-only-canonical-timestamp.md) — amended by this change (see plan).

## Intent

Two of the paths that write a due/end date ignore date-only mode's canonical clock value
(23:59:59.999 local for due/end). Both are residuals of #91; both were out of that spec's caller graph.

- **Gantt** (`frontend/src/components/gantt/GanttChart.vue`): `updateGanttTask` calls
  `roundToNaturalDayBoundary(newEnd)` without `force`, so a bar dropped at a before-noon
  interpolated time stores 00:00:00.000 for the due/end date.
- **DeferTask** (`frontend/src/components/tasks/partials/DeferTask.vue`): no `dateOnly` branch at
  all. The popup shows the time row, `deferDays` keeps the task's existing clock time, and a date
  picked in the calendar keeps flatpickr's time.

After this change, with the toggle on, every date these two paths write is the canonical value.
With the toggle off, behaviour is unchanged except for two disclosed deltas (Design 5).

**Out of scope:** start-date handling (00:00 is already canonical, `isStart` path unchanged);
rewriting existing timestamps (ADR-0014: never); the CalDAV/reminder residuals in ADR-0014;
Gantt bar geometry for legacy (pre-toggle) tasks in non-date-only mode; the pre-existing
DST-fall-back `Math.ceil` widening in `computeBarWidth`; `#96` ratchet items.

**Open question for Jason (not blocking build):** `ProjectCalendar.rescheduleTask` (lines ~549-561)
shifts an existing task by whole days with `addDays`, deliberately preserving each date's time of day.
With canonical stored dates this preserves the canonical value, so it only diverges for legacy tasks.
DeferTask's "+N days" is the same gesture and #95 asks it to snap. The fork then has two rules for
"shift by N days" on a legacy task. Either accept (calendar drag stays a pure shift; recorded here) or
extend scope by one line per date in `rescheduleTask`. Default if unanswered: accept, out of scope.

## Design

1. **Force at the write sites, read the toggle via `useDateOnly()`.** Same shape as the Calendar fix
   in #91 (`calendarDueDateForDay`). No new shared helper: `roundToNaturalDayBoundary(d, false, force)`
   already is the helper. `GanttChart.vue` imports it today; `DeferTask.vue` gains the import.
2. **Gantt: write sites AND the end-side display rounding.** `getRoundedDate` (line ~245) rounds a
   task's stored end/due for bar geometry with the same heuristic. If only the write sites force,
   a legacy task due 09:30 renders as ending at 00:00 of its due day (bar excludes the day), then
   grows by one day on the first drag. Forcing the end side in `getRoundedDate` when the toggle is
   on makes display and write agree: in date-only mode a task due on day D covers day D. The
   width/x arithmetic (`computeBarX`, `computeBarWidth`, `GanttRowBars.getDaysDifference`) operates on
   already-rounded bar dates (verified: `ganttBars` is only assigned from `transformTaskToGanttBar`,
   which routes every date through `getRoundedDate`; both rounded values are fixed points of the
   helper) and stays untouched. **Deviation from the issue text:** #92 says "thread into both
   components"; `GanttRowBars.vue` never writes a date and its one call is a no-op on rounded input.
   Accepted residual: the bar watcher keys on `[visibleNodes, filters]`, so flipping the toggle while
   a Gantt view is mounted leaves stale geometry until remount. The toggle lives on another route.
3. **DeferTask: every read of `dueDate.value` goes through one normaliser.** Once `dateFormat` is
   `'Y-m-d'`, vue-flatpickr-component's `onInput` emits the **string** `'YYYY-MM-DD'` into the
   v-model after every pick *and after every `deferDays` click* (flatpickr's `setDate` dispatches an
   `input` event). A bare `new Date('2026-07-03')` is UTC midnight, which is the previous evening
   west of UTC; `deferDays`'s `new Date(dueDate.value)` would then add a day onto the wrong day, the
   normaliser would round it back to the *current* due day, the `lastValue` compare would match, and
   the second "+1 day" click would save nothing. So: `normalise()` is the only place the ref is read,
   it uses `createDateFromString` (the Safari-safe helper `DatepickerInline` uses; `'2026/07/03'`
   parses local), and there must be **zero** bare `new Date(dueDate.value)` left in the file.
4. **Normalise before the `lastValue` compare, and normalise the seed.** `updateDueDate` runs on a
   1 s interval and on unmount. The string `'YYYY-MM-DD'` parses to 00:00, which never equals the
   stored 23:59:59.999, so comparing the raw value would re-save every second. The seed
   (`lastValue.value = value.dueDate` in the `modelValue` watch) is normalised too, so opening the
   popup on a legacy 09:30 task does not save on the first tick. The normaliser accepts `null` and
   returns `null` — the watch is `{immediate: true}` and dateless tasks open this popup.
5. **Toggle-off deltas, disclosed.** (a) `createDateFromString` also fixes Safari's `Invalid Date`
   on `'YYYY-MM-DD HH:mm'` — a side benefit, not byte-identical. (b) The normaliser always returns a
   fresh `Date` (`new Date(createDateFromString(v))`) so the object handed to `taskStore.update` is a
   copy, as today. `getDateWithTime` is **not** used: with the toggle off, deferring must keep the
   task's existing time, not apply `defaultDueTime`.
6. **In-flight guard.** `updateDueDate` returns early while `saving` is true. Pre-existing hole: a
   save slower than 1 s let the next tick issue a second PUT. One line, same file, and the
   live-verify "one PUT" check depends on it.
7. **Picker config mirrors `DatepickerInline`:** `enableTime: !dateOnly`,
   `dateFormat: dateOnly ? 'Y-m-d' : 'Y-m-d H:i'`, `altFormat` short/long (`date.altFormatShort` exists).

## Implementation plan

### `frontend/src/components/gantt/GanttChart.vue`

- `import {useDateOnly} from '@/composables/useDateOnly'`; `const {store: dateOnly} = useDateOnly()`.
- Local `function toEndBoundary(d: Date) { return roundToNaturalDayBoundary(d, false, dateOnly.value) }`.
- `getRoundedDate`: `roundToNaturalDayBoundary(date, isStart, !isStart && dateOnly.value)`.
- `updateGanttTask`: the five `roundToNaturalDayBoundary(newEnd)` calls (endDate ×3, dueDate ×2)
  → `toEndBoundary(newEnd)`. Start-side calls unchanged.

### `frontend/src/components/tasks/partials/DeferTask.vue`

- Imports: `useDateOnly`, `roundToNaturalDayBoundary`, `createDateFromString`.
- `const {store: dateOnly} = useDateOnly()`.
- `const dueDate = ref<Date | string | null>(null)` — flatpickr writes a string; type it honestly.
- `function normalise(value: Date | string | null): Date | null` — `null` → `null`; else
  `new Date(createDateFromString(value))`, then `roundToNaturalDayBoundary(_, false, true)` when
  `dateOnly.value`.
- `modelValue` watch: `lastValue.value = normalise(value.dueDate)`.
- `flatPickerConfig`: per Design 7.
- `deferDays`: `const base = normalise(dueDate.value) ?? new Date()`; add days; assign; call `updateDueDate`.
- `updateDueDate`: `if (saving.value) return`; `const next = normalise(dueDate.value)`; return if
  `next === null || !task.value`; return if `lastValue.value && +next === +lastValue.value`; save
  `dueDate: next`.
- Grep gate before commit: `grep -n 'new Date(dueDate' DeferTask.vue` returns nothing.

### `docs/adr/ADR-0014-date-only-canonical-timestamp.md`

- Replace the "Gantt drag/resize does not apply the canonical times … Deferred — tracked in a
  follow-up issue" consequence with a one-line dated note: closed by #92/#95 on this branch; the
  CalDAV and reminder-email residuals now hold for Gantt-dragged and deferred dates too. The ADR must
  not state a falsehood after merge.

### Edge cases

- Task with no due date, dateOnly on, popup opened: no throw, no save (seed is `null`).
  `deferDays(1)`: `new Date()` + 1 day → normalised to tomorrow 23:59:59.999. Off: keeps wall-clock time.
- Legacy task due 09:30, dateOnly on, opened in DeferTask: display shows the day; no save until the
  user acts (seed normalised to 23:59:59.999 equals the first tick's normalised value).
- `dueDate.value` is the string `'YYYY-MM-DD'` (after any pick/click), dateOnly on, west of UTC,
  `deferDays(1)`: lands on D+1 23:59:59.999, not D.
- Gantt bar for a dateless task (both dates synthesised): end side forced like any other.

## Execution routing

Driver-only. Two components, one ADR edit, two test files, no design ambiguity left. No `security`
agent: pure frontend date arithmetic, no trust boundary.

## Tests (red-first)

All date assertions on **local-time components** (`getFullYear/getMonth/getDate/getHours…`), never
ISO strings. The DeferTask file is run under two zones (see Verification); test 8 is red only west
of UTC, which is exactly why.

`frontend/src/components/gantt/GanttChart.test.ts` (extend; `vi.mock('@/composables/useDateOnly')`
with a hoisted `ref(false)`, the `TaskContextMenu.test.ts` pattern — required, since this file mounts
without pinia and `useDateOnly` reaches the auth store):

1. dateOnly **on**, task with `dueDate` only, `updateGanttTask('1', start, 09:00 on day D)` → emitted
   `update:task` has `dueDate` at D 23:59:59.999. **(red today: 00:00)**
2. dateOnly **off**, same call → `dueDate` at D 00:00:00.000 (heuristic preserved). (regression guard)
3. dateOnly **on**, start+end task → `endDate` forced, `startDate` at 00:00. **(red today)**

`frontend/src/components/tasks/partials/DeferTask.test.ts` (extend; same `useDateOnly` mock; the file
already has pinia for `useTimeFormat`, keep it; `flat-pickr` stays stubbed — the string path is
exercised by assigning `wrapper.vm.dueDate` directly, which VTU's proxy allows):

4. dateOnly **on**, task due 10:00 on D, `deferDays(1)` → `taskStore.update` called with `dueDate`
   D+1 23:59:59.999. **(red today: 10:00)**
5. dateOnly **on**, task due D 23:59:59.999, set `wrapper.vm.dueDate = 'YYYY-MM-DD'` of D, call
   `updateDueDate()` → `taskStore.update` **not** called (the raw compare would have saved). **(red today)**
6. dateOnly **on** → `flatPickerConfig.enableTime === false`; **off** → `true`.
7. dateOnly **off**, `deferDays(1)` from 10:00 → saved `dueDate` is D+1 10:00. (unchanged behaviour)
8. dateOnly **on**, `wrapper.vm.dueDate = 'YYYY-MM-DD'` of D, `deferDays(1)` → saved `dueDate` has
   local date D+1. **(red west of UTC today and with a naive port of the plan; green at UTC — hence the two-zone run)**
9. dateOnly **on**, task with `dueDate: null` mounted → no throw, `taskStore.update` not called after
   `updateDueDate()`. **(red against a null-unsafe normaliser)**

Not tested, by decision: the in-flight guard (Design 6, one line) and the 1 s interval itself.
Test 5 establishes that one `updateDueDate()` with a matching day does not save; it does not exercise
the timer. Live-verify (b) covers the timer.

## Verification

```bash
cd frontend && pnpm install --frozen-lockfile 2>&1 | tail -3          # worktree has no node_modules
cd frontend && TZ=America/Los_Angeles pnpm vitest run src/components/gantt/GanttChart.test.ts src/components/tasks/partials/DeferTask.test.ts 2>&1 | tee /tmp/vitest-la.log
cd frontend && TZ=UTC pnpm vitest run src/components/tasks/partials/DeferTask.test.ts 2>&1 | tee /tmp/vitest-utc.log
cd frontend && pnpm typecheck 2>&1 | tee /tmp/typecheck.log            # ratchet: no new errors in the two touched files
grep -n 'new Date(dueDate' frontend/src/components/tasks/partials/DeferTask.vue   # must print nothing
mage test:feature 2>&1 | tee /tmp/feature.log                          # backend untouched; suite green is the merge gate
```

Done looks like: nine tests green in both zones (1, 3, 4, 5, 8, 9 were red first); grep gate empty;
typecheck ratchet unchanged; lint clean (`pnpm lint:fix`); ADR-0014 consequence replaced.

**Live verify (browser, dev servers via `/dev`, machine zone is west of UTC):** toggle date-only on.
(a) Gantt: drag a due-only bar's end to a new day, then read the row: `select due_date from tasks
where id=…` shows `…23:59:59.999` local. (b) Task detail → Defer: no time row; click "+1 day"
**twice** — the task moves two days and each click issues one PUT; pick a calendar day → that day
23:59:59.999, one PUT, no further PUTs while the popup stays open. Open the popup on a dateless task:
no error, no PUT. (c) Toggle off: defer keeps the task's existing time; Gantt drag stores 00:00 for a
before-noon drop as before.

## Stop criteria

- vue-flatpickr-component emits a `Date` (not a string) in this config → halt and log; tests 5 and 8
  would then exercise a path the UI never takes, and the normaliser's contract needs re-stating.
- A test needs pinia or store wiring **beyond what the two test files already carry plus the
  `useDateOnly` mock** → halt; the seam is wrong, not the test.
- Any need to touch `roundToNaturalDayBoundary`, `getDateWithTime`, `createDateFromString`, or
  `GanttRowBars.vue` → halt; that is a design change.
- Typecheck ratchet regresses in a file outside the two touched ones → halt.
- Test 8 green at UTC but red in Los Angeles **after** the plan is implemented → halt; a bare parse
  survived somewhere (the grep gate should have caught it).

## Execution Log

_(empty — the build phase appends here)_

### Plan-phase review log

- Round 1 (verifier, 2026-09-07): REFUTED. C1 `deferDays` string-parse regression west of UTC;
  C2 null seed crash on mount; C3 tests couldn't catch C1; C4 stop criterion was a false green;
  C5 "byte-identical" false; S1 ADR-0014 left stating a falsehood; S4 stop criterion pre-violated;
  S3 import claim wrong. All addressed above. S2 (calendar `addDays` convention) → open question
  for Jason. C6 (in-flight guard) adopted as Design 6. C7/C8 recorded as accepted residuals.
