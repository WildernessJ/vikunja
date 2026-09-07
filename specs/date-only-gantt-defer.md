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

**Open question 2 (round 3):** `ProjectGantt.addGanttTask` (lines ~120-133) creates a task whose end
date is hardcoded to `setHours(23, 59, 0, 0)` → 23:59:00.000, ignoring the toggle. 59.999 s off the
canonical value, invisible in the UI, visible to CalDAV/reminder email. Same class, third Gantt write
site, a create path with no existing test. Default if unanswered: out of scope, file a follow-up issue
at review. The ADR replacement text says "Gantt-dragged and deferred dates", which stays true.

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
   The bar watcher keys on `[visibleNodes, filters]`, and `ProjectView` sits inside
   `<keep-alive :include="['project.view']">` (`ContentAuth.vue`), so a Gantt view survives a trip to
   settings and back — the toggle would flip with stale geometry until a hard reload. Add `dateOnly`
   to the watcher's sources so the bars rebuild when the toggle changes. One token.
   Disclosed side effect: `startOnly`/`endOnly` bars synthesise the missing side at ±7 days; with the
   end forced to 23:59:59.999 the span renders as 8 day-widths, not 7. Consistent with "a task on day
   D covers day D"; accepted.
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
6. **No in-flight guard (round-2 reversal).** Round 1 proposed `if (saving.value) return` at the top of
   `updateDueDate`. Round 2 showed it drops a second click deterministically: the buttons are not
   disabled during a save, the guard swallows the click, and the parent's `modelValue` echo then
   resets `dueDate` to the first save's value, so the change is gone with no UI hint. Today's
   behaviour (a second PUT racing the first) is the lesser evil and is pre-existing. Not touched;
   recorded as a residual. A queued re-save after the in-flight one resolves would be the real fix and
   is out of scope.
7. **Picker config takes three keys from `DatepickerInline`, not the whole block:**
   `enableTime: !dateOnly`, `dateFormat: dateOnly ? 'Y-m-d' : 'Y-m-d H:i'`, `altFormat` short/long
   (`date.altFormatShort` exists). Do **not** copy its `defaultHour`/`defaultMinute` spread — that
   would pull `defaultDueTime` into the defer path (Design 5).

## Implementation plan

### `frontend/src/components/gantt/GanttChart.vue`

- `import {useDateOnly} from '@/composables/useDateOnly'`; `const {store: dateOnly} = useDateOnly()`.
- Local `function toEndBoundary(d: Date) { return roundToNaturalDayBoundary(d, false, dateOnly.value) }`.
- `getRoundedDate`: `roundToNaturalDayBoundary(date, isStart, !isStart && dateOnly.value)`.
- Bars watcher (line ~366): `watch([visibleNodes, filters, dateOnly], …)`.
- `updateGanttTask`: the five `roundToNaturalDayBoundary(newEnd)` calls (endDate ×3, dueDate ×2)
  → `toEndBoundary(newEnd)`. Start-side calls unchanged.

### `frontend/src/components/tasks/partials/DeferTask.vue`

- Imports: `useDateOnly`, `roundToNaturalDayBoundary`, `createDateFromString`.
- `const {store: dateOnly} = useDateOnly()`.
- `const dueDate = ref<Date | string | null>(null)` — flatpickr writes a string; type it honestly.
- `function normalise(value: Date | string | null): Date | null` — falsy (`null`, `''`) → `null`; else
  `new Date(createDateFromString(value))`, then `roundToNaturalDayBoundary(_, false, true)` when
  `dateOnly.value`.
- `modelValue` watch: `lastValue.value = normalise(value.dueDate)`.
- `flatPickerConfig`: per Design 7.
- `deferDays`: `const base = normalise(dueDate.value) ?? new Date()`; add days; assign; call `updateDueDate`.
- `updateDueDate`: `const next = normalise(dueDate.value)`; return if
  `next === null || !task.value`; return if `lastValue.value && +next === +lastValue.value`; save
  `dueDate: next`.
- Convention, not enforced: no bare `new Date(...)` on a picker value anywhere in the file
  (`grep -n 'new Date(' DeferTask.vue` should show only `new Date()` for the no-due-date fallback and
  the copy inside `normalise`). The real gate is test 8 in Los Angeles.

### `docs/adr/ADR-0014-date-only-canonical-timestamp.md`

- Replace the "Gantt drag/resize does not apply the canonical times … Deferred — tracked in a
  follow-up issue" consequence with a one-line dated note: closed by #92/#95; the CalDAV and
  reminder-email residuals now hold for Gantt-dragged and deferred dates too. Leave the `**Status:**`
  line and the `docs/adr/README.md` row as "Accepted" — the decision is unchanged, a residual closed.
  (ADR-0014 uses a bold status line, not the template's front matter; pre-existing, not fixed here.)

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

`frontend/src/components/gantt/GanttChart.test.ts` (extend). Mock the **composable module**, not the
auth store, using the mechanism at `TaskContextMenu.test.ts:35-41` (that file targets `@/stores/auth`;
the mechanism is what to copy, not the target). `vi.hoisted` runs above the import bindings, so
`ref` from `vue` is in its temporal dead zone there — `vi.hoisted(() => ref(false))` throws
`ReferenceError` and collects zero tests (verified under vitest 4.1.11). Shape:

```ts
const dateOnlyMock = vi.hoisted((): {ref: {value: boolean}} => ({ref: {value: false}}))
vi.mock('@/composables/useDateOnly', async () => {
	const {ref} = await import('vue')
	dateOnlyMock.ref = ref(false)
	return {useDateOnly: () => ({store: dateOnlyMock.ref})}
})
```

It must be a real `ref`, not a plain `{value}` object: `GanttChart.vue` puts `dateOnly` in a
`watch([...])` source list, and a plain object is an invalid watch source (Vue warns, the third source
is inert, and the toggle-flip path under test is silently disabled). Required because this file mounts
without pinia and the real `useDateOnly` reaches the auth store:

1. dateOnly **on**, task with `dueDate` only, `updateGanttTask('1', start, 09:00 on day D)` → emitted
   `update:task` has `dueDate` at D 23:59:59.999. **(red today: 00:00)**
2. dateOnly **off**, same call → `dueDate` at D 00:00:00.000 (heuristic preserved). (regression guard)
3. dateOnly **on**, start+end task, `newEnd` **09:00** on day D (before noon — an afternoon value
   passes with or without the fix) → `endDate` D 23:59:59.999, `startDate` at 00:00. **(red today)**

`frontend/src/components/tasks/partials/DeferTask.test.ts` (extend; same `useDateOnly` mock; the file
already has pinia for `useTimeFormat`, keep it; `flat-pickr` stays stubbed — the string path is
exercised by assigning `wrapper.vm.dueDate` directly, which VTU's proxy allows). Every mount starts a
1 s `setInterval`; `afterEach` unmounts every wrapper so a slow test cannot get a stray tick.
**Mock-return contract:** `onBeforeUnmount` calls `updateDueDate()`, which reads `newTask.dueDate` off
the store mock's result. `beforeEach` must give `taskStoreUpdateMock` a default
`mockResolvedValue({id: 1, dueDate: <some Date>})` (today it only has `mockReset()`), and tests
must not rely on `mockResolvedValueOnce` alone — a second call returning `undefined` at unmount is an
unhandled rejection that fails the file with every assertion green (verified by running). Tests that
assert the saved value should read it from `taskStoreUpdateMock.mock.calls[0][0].dueDate`, not from
what the mock returns:

4. dateOnly **on**, task due 10:00 on D, `deferDays(1)` → `taskStore.update` called with `dueDate`
   D+1 23:59:59.999. **(red today: 10:00)**
5. dateOnly **on**, task due D 23:59:59.999, set `wrapper.vm.dueDate = 'YYYY-MM-DD'` of D, call
   `updateDueDate()` → `taskStore.update` **not** called (the raw compare would have saved). **(red today)**
6. dateOnly **on** → `flatPickerConfig.enableTime === false`; **off** → `true`. **(red today: hardcoded `true`)**
7. dateOnly **off**, `deferDays(1)` from 10:00 → saved `dueDate` is D+1 10:00. (unchanged behaviour)
8. dateOnly **on**, `wrapper.vm.dueDate = 'YYYY-MM-DD'` of D, `deferDays(1)` → saved `dueDate` has
   local date D+1. **(red west of UTC today and with a naive port of the plan; green at UTC — hence the two-zone run)**
9. dateOnly **on**, task with `dueDate: null` mounted → no throw, `taskStore.update` not called after
   `updateDueDate()`. (green today — the current code never touches a null seed; this guards the
   round-1 C2 defect, which a naive normalised seed would introduce)

Not tested, by decision: the 1 s interval itself. Test 5 establishes that one `updateDueDate()` with a
matching day does not save; it does not exercise the timer. Live-verify (b) covers the timer.

## Verification

```bash
cd frontend && pnpm install --frozen-lockfile 2>&1 | tail -3          # worktree has no node_modules
cd frontend && TZ=America/Los_Angeles pnpm vitest run src/components/gantt/GanttChart.test.ts src/components/tasks/partials/DeferTask.test.ts 2>&1 | tee /tmp/vitest-la.log
cd frontend && TZ=UTC pnpm vitest run src/components/tasks/partials/DeferTask.test.ts 2>&1 | tee /tmp/vitest-utc.log
cd frontend && pnpm typecheck:ratchet 2>&1 | tee /tmp/typecheck.log    # the gate; plain `pnpm typecheck` exits non-zero on ~900 baseline errors. Neither touched file is in typecheck-baseline.json → budget 0
TZ=UTC mage test:feature 2>&1 | tee /tmp/feature.log                   # backend untouched; two upstream tests are TZ-dependent (PITFALLS), hence TZ=UTC
```

Done looks like: nine tests green in both zones (**1, 3, 4, 5, 6, 8 red first**; 2, 7, 9 are guards
that pass today); typecheck ratchet unchanged; lint clean (`pnpm lint:fix`); ADR-0014 consequence
replaced.

**Live verify (browser, dev servers via `/dev`, machine zone is west of UTC):** toggle date-only on.
(a) Gantt: drag a due-only bar's end to a new day, then read the row: `select due_date from tasks
where id=…` shows `…23:59:59.999` local. (b) Task detail → Defer: no time row; click "+1 day"
**twice** — the task moves two days and each click issues one PUT; pick a calendar day → that day
23:59:59.999, one PUT, no further PUTs while the popup stays open. Open the popup on a dateless task:
no error, no PUT. Wait for each save to settle before the next click — the pre-existing race on
overlapping clicks is a residual, not under test; so is the 1 s timer re-issuing an identical PUT
when a save takes longer than a second (pre-existing, `lastValue` advances only after the await). (c) Toggle off: defer keeps the task's existing
time; Gantt drag stores 00:00 for a before-noon drop as before. (d) With Gantt open, go to settings,
flip the toggle, come back: bars redraw without a reload.

## Stop criteria

- vue-flatpickr-component emits a `Date` (not a string) in this config → halt and log; tests 5 and 8
  would then exercise a path the UI never takes, and the normaliser's contract needs re-stating.
- A test needs pinia or store wiring **beyond what the two test files already carry plus the
  `useDateOnly` mock** → halt; the seam is wrong, not the test.
- Any need to touch `roundToNaturalDayBoundary`, `getDateWithTime`, `createDateFromString`, or
  `GanttRowBars.vue` → halt; that is a design change.
- Typecheck ratchet regresses in a file outside the two touched ones → halt.
- Test 8 green at UTC but red in Los Angeles **after** the plan is implemented → halt; a bare parse
  survived somewhere.

## Execution Log

Build phase, 2026-09-07, driver-only as routed. No halt; no stop criterion hit.
`roundToNaturalDayBoundary`, `getDateWithTime`, `createDateFromString` and `GanttRowBars.vue`
are untouched.

**Red-first confirmed.** The nine tests were written before any source change. First run
(`TZ=America/Los_Angeles`): 6 failed, 5 passed — exactly tests 1, 3, 4, 5, 6, 8 red, with 2, 7, 9
and the file's pre-existing routing test green. Test 8 failed with `expected 10 to be 11`, the
UTC-midnight day-shift the spec predicted. After the change: 11/11 green in Los Angeles, 7/7 green
at UTC. `pnpm typecheck:ratchet` holds at 8 errors across 5 files (unchanged). `pnpm lint:fix`:
0 errors, 16 pre-existing warnings, none in the touched files. `TZ=UTC mage test:feature`: no
failures (backend untouched).

**Deviations from the plan (both in the same direction — tighter, not looser):**

1. The test mock is `taskStoreUpdateMock.mockImplementation(async (task) => task)`, not the plan's
   `mockResolvedValue({id: 1, dueDate: <some Date>})`. The echo satisfies the stated contract (the
   result always carries a `dueDate`) and also keeps `lastValue` in step with what was just saved,
   so the `afterEach` unmount tick is a no-op instead of issuing a second `taskStore.update`. The
   assertions still read `mock.calls[0][0].dueDate` per the plan.
2. `updateDueDate` sets `lastValue.value = normalise(newTask.dueDate)`, where the plan left the
   post-save assignment unstated. Normalising the server echo keeps both sides of the `+next ===
   +lastValue` compare in one space; without it, a server value that is not already canonical would
   differ from the next normalised read and the 1 s interval would re-save every tick.

**Open questions: both took their documented defaults.** `ProjectCalendar.rescheduleTask` is out of
scope (calendar drag stays a pure shift). `ProjectGantt.addGanttTask`'s hardcoded
`setHours(23, 59, 0, 0)` is untouched — a third Gantt write site, 59.999 s off canonical; file a
follow-up issue at review.

**Look at first:** (a) `getRoundedDate` now forces the end side when the toggle is on, which changes
bar *geometry* and is covered only by live-verify (d) plus the design argument that `computeBarX` /
`computeBarWidth` see fixed points of the helper — no test asserts bar width. (b) The `dateOnly`
entry in the bars watcher source list is likewise untested; the `GanttChart.test.ts` mock is a real
`ref` precisely so this path is not silently inert, but nothing asserts a redraw. (c) `DeferTask`'s
`normalise` is the single read seam — `grep -n 'new Date(' DeferTask.vue` shows only
`new Date(createDateFromString(value))` inside it and the `new Date()` no-due-date fallback.

### Plan-phase review log

- Round 1 (verifier, 2026-09-07): REFUTED. C1 `deferDays` string-parse regression west of UTC;
  C2 null seed crash on mount; C3 tests couldn't catch C1; C4 stop criterion was a false green;
  C5 "byte-identical" false; S1 ADR-0014 left stating a falsehood; S4 stop criterion pre-violated;
  S3 import claim wrong. All addressed above. S2 (calendar `addDays` convention) → open question
  for Jason. C6 (in-flight guard) adopted as Design 6. C7/C8 recorded as accepted residuals.
- Round 2 (verifier, 2026-09-07): REFUTED. Blocker: the round-1 Design 6 guard drops a second click
  deterministically (parent `modelValue` echo resets the ref) → guard **dropped**, pre-existing race
  kept as residual. Also: `keep-alive` makes the Gantt toggle staleness permanent → `dateOnly` added
  to the bars watcher; `mage test:feature` needs `TZ=UTC`; red-first list corrected (6 red, 9 green);
  mock target clarified (composable module, real `ref`); ADR status/README stay "Accepted";
  `defaultHour` spread excluded explicitly; startOnly/endOnly 8-day width disclosed; grep gate
  demoted to convention. Held under running: `normalise` arithmetic in LA, test 8 red/green split,
  vitest honours `TZ`, flatpickr emits the string, no post-save loop from ms truncation.
- Round 3 (verifier, 2026-09-07): **no blocker**; design held (watcher amendment rebuilds real
  geometry; settings save replaces the store object so the computed fires; keep-alive does not swallow
  the flip — run). Mechanical fixes applied: `vi.hoisted(() => ref())` is a TDZ throw → async mock
  factory pattern spelled out; `afterEach` unmount needs a default mock return → contract stated;
  test 3 pinned to a before-noon `newEnd`; `pnpm typecheck` → `pnpm typecheck:ratchet`; normaliser
  treats `''` as `null`; real-`ref` rationale corrected (watch source, not computed caching); timer
  re-PUT residual noted. New site found: `ProjectGantt.addGanttTask` 23:59:00 → open question 2.
  Loop closed per the stop criterion set at round 1 (no confirmed blocker, or three rounds).
