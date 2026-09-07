# date-only-gantt-defer Specification

Issues: [#92](https://github.com/WildernessJ/vikunja/issues/92) (Gantt drag/resize),
[#95](https://github.com/WildernessJ/vikunja/issues/95) (DeferTask). Branch `fix/date-only-gantt-defer`.
Governing decision: [ADR-0014](../docs/adr/ADR-0014-date-only-canonical-timestamp.md).

## Intent

Two entry paths still write a due/end date that ignores date-only mode's canonical clock value
(23:59:59.999 local for due/end). Both are residuals of #91; both were out of that spec's caller graph.

- **Gantt** (`frontend/src/components/gantt/GanttChart.vue`): `updateGanttTask` calls
  `roundToNaturalDayBoundary(newEnd)` without `force`, so a bar dropped at a before-noon
  interpolated time stores 00:00:00.000 for the due/end date.
- **DeferTask** (`frontend/src/components/tasks/partials/DeferTask.vue`): no `dateOnly` branch at
  all. The popup shows the time row, `deferDays` keeps the task's existing clock time, and a date
  picked in the calendar keeps flatpickr's time.

After this change, with the toggle on, every date these two paths write is the canonical value.
With the toggle off, behaviour is byte-identical to today.

**Out of scope:** start-date handling (00:00 is already canonical, `isStart` path unchanged);
rewriting existing timestamps (ADR-0014: never); the CalDAV/reminder residuals in ADR-0014;
Gantt bar geometry for legacy (pre-toggle) tasks in non-date-only mode; `#96` ratchet items.

## Design

1. **Force at the write sites, read the toggle via `useDateOnly()`.** Same shape as the Calendar fix
   in #91 (`calendarDueDateForDay`). No new shared helper: `roundToNaturalDayBoundary(d, false, force)`
   already is the helper, and both files import it (or its sibling) today.
2. **Gantt: write sites AND the end-side display rounding.** `getRoundedDate` (line ~245) rounds a
   task's stored end/due for bar geometry with the same heuristic. If only the write sites force,
   a legacy task due 09:30 renders as ending at 00:00 of its due day (bar excludes the day), then
   grows by one day on the first drag. Forcing the end side in `getRoundedDate` when the toggle is
   on makes display and write agree: in date-only mode a task due on day D covers day D. The
   width/x arithmetic (`computeBarX`, `computeBarWidth`, `GanttRowBars.getDaysDifference`) operates on
   already-rounded bar dates and stays untouched. **Deviation from the issue text:** #92 says
   "thread into both components"; `GanttRowBars.vue` never writes a date and its one call is
   idempotent on rounded input, so it is left alone.
3. **DeferTask: normalise once, in `updateDueDate`.** Both entry paths (`deferDays` buttons and the
   flatpickr calendar) funnel into `updateDueDate`, which also runs on a 1 s interval and on unmount.
   The normalised value must be computed *before* the `lastValue` equality check: with
   `dateFormat: 'Y-m-d'` flatpickr hands back a `YYYY-MM-DD` string that parses to 00:00, which never
   equals the stored 23:59:59.999, so comparing the raw value would re-save every second.
   Parse with `createDateFromString` (the existing Safari-safe helper `DatepickerInline` uses); a bare
   `new Date('YYYY-MM-DD')` is UTC midnight and lands on the wrong day west of UTC.
4. **DeferTask picker config mirrors `DatepickerInline`:** `enableTime: !dateOnly`,
   `dateFormat: dateOnly ? 'Y-m-d' : 'Y-m-d H:i'`, `altFormat` short/long. `getDateWithTime` is
   **not** used: with the toggle off, deferring must keep the task's existing time (current
   behaviour), not apply `defaultDueTime`.

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
- `flatPickerConfig`: `altFormat` short when `dateOnly`, `dateFormat` per Design 4, `enableTime: !dateOnly.value`.
- `function normalise(value: Date | string): Date` — `createDateFromString(value)`, then
  `roundToNaturalDayBoundary(_, false, true)` when `dateOnly.value`, else as-is.
- `updateDueDate`: `const next = normalise(dueDate.value)`; compare `+next` to `+lastValue`; save `dueDate: next`.
- `deferDays`: unchanged (its result flows through `updateDueDate`). Widen the `dueDate` ref type to
  `Date | string | null` so the flatpickr string is typed honestly.

### Edge cases

- Task with no due date, dateOnly on, `deferDays(1)`: `new Date()` + 1 day → normalised to tomorrow
  23:59:59.999. Off: keeps wall-clock time (today's behaviour).
- Legacy task due 09:30, dateOnly on, opened in DeferTask: display shows the day; no save happens
  until the user acts (normalised 23:59:59.999 ≠ 09:30 would otherwise trigger a save on the first
  tick — **the `lastValue` seed in the `modelValue` watch must be normalised too**, so the first
  interval tick is a no-op). Red-first test 5 covers this.
- Gantt bar for a dateless task (both dates synthesised): end side forced like any other.

## Execution routing

Driver-only. Two files, two test files, no design ambiguity left. No `security` agent: pure frontend
date arithmetic, no trust boundary.

## Tests (red-first)

`frontend/src/components/gantt/GanttChart.test.ts` (extend; mock `@/composables/useDateOnly` with a
hoisted `ref(false)`, as `TaskContextMenu.test.ts` does for the auth store):

1. dateOnly **on**, task with `dueDate` only, `updateGanttTask('1', start, 09:00 on day D)` → emitted
   `update:task` has `dueDate` at D 23:59:59.999. **(red today: 00:00)**
2. dateOnly **off**, same call → `dueDate` at D 00:00:00.000 (heuristic preserved). (green today; regression guard)
3. dateOnly **on**, start+end task → `endDate` forced, `startDate` at 00:00. **(red today)**

`frontend/src/components/tasks/partials/DeferTask.test.ts` (extend; same `useDateOnly` mock):

4. dateOnly **on**, task due 10:00 on D, `deferDays(1)` → `taskStore.update` called with `dueDate`
   D+1 23:59:59.999. **(red today: 10:00)**
5. dateOnly **on**, task due D 23:59:59.999, flatpickr sets `dueDate` to the string `'YYYY-MM-DD'` of
   D, then `updateDueDate()` → `taskStore.update` **not** called (no save loop). **(red today)**
6. dateOnly **on** → `flatPickerConfig.enableTime === false`; **off** → `true`. (one `it`, two asserts)
7. dateOnly **off**, `deferDays(1)` from 10:00 → saved `dueDate` is D+1 10:00 (unchanged behaviour). (green today)

Assert on local-time components (`getHours()` etc.), not ISO strings — CI and dev run in different
zones (PITFALLS: TZ-dependent upstream tests).

## Verification

```bash
cd frontend && pnpm vitest run src/components/gantt/GanttChart.test.ts src/components/tasks/partials/DeferTask.test.ts 2>&1 | tee /tmp/vitest.log
cd frontend && pnpm typecheck 2>&1 | tee /tmp/typecheck.log     # ratchet: no new errors in the two touched files
mage test:feature 2>&1 | tee /tmp/feature.log                    # backend untouched; suite green is the merge gate anyway
```

Done looks like: seven tests green (1, 3, 4, 5 were red first); typecheck ratchet unchanged; lint
clean (`pnpm lint:fix`).

**Live verify (browser, dev servers via `/dev`):** toggle date-only on. (a) Gantt: drag a due-only
bar's end to a new day, then read the row: `select due_date from tasks where id=…` shows
`…23:59:59.999` local. (b) Task detail → Defer: no time row in the popup; "+1 day" stores
23:59:59.999; picking a calendar day stores that day 23:59:59.999 and the network tab shows **one**
PUT, not one per second. (c) Toggle off: defer keeps the task's existing time; Gantt drag stores
00:00 for a before-noon drop as before.

## Stop criteria

- `flatpickr` in `inline` mode with `dateFormat: 'Y-m-d'` emits something other than a `YYYY-MM-DD`
  string or a `Date` → halt, log what it emits; the normaliser's input contract is wrong.
- A test needs pinia wiring beyond the `useDateOnly` mock → halt; the seam is wrong, not the test.
- Any need to touch `roundToNaturalDayBoundary`, `getDateWithTime`, or `GanttRowBars.vue` → halt;
  that is a design change.
- Typecheck ratchet regresses in a file outside the two touched ones → halt.

## Execution Log

_(empty — the build phase appends here)_
