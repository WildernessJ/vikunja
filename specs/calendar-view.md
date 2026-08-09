# calendar-view Specification

## Purpose

Projects SHALL offer a fifth view kind, `calendar`, rendering tasks on a month or week grid by their dates, with drag-to-reschedule — the date-grid complement to Gantt's dependency timeline, covering weekly-review and tickler workflows.

## Invariants

- The four existing view kinds MUST keep working unchanged; no migration touches existing views.
- Rescheduling by drag MUST be permission-gated: users without write access (incl. read-only link shares) can view but not move tasks.
- Dragging MUST preserve a task's time-of-day and, for ranged tasks, the start↔end delta — only the date component shifts.
- The view MUST fetch only tasks intersecting the visible date window (no full-project loads).

## Requirements

### Requirement: Calendar view kind

The backend SHALL accept `calendar` as a `ProjectViewKind` (enum value 4, JSON string `"calendar"`), creatable and editable through the existing project-view CRUD on both API versions. It SHALL NOT be added to the default view set of new or existing projects.

#### Scenario: Create calendar view

- **GIVEN** a project owned by the user
- **WHEN** a view with `view_kind: "calendar"` is created via the API
- **THEN** the response is successful and the view lists with kind `"calendar"`

#### Scenario: Edge case: unknown kind still rejected

- **WHEN** a view with `view_kind: "month"` is submitted
- **THEN** the API responds 400

### Requirement: Month grid rendering

The frontend SHALL render a month grid (weeks as rows) placing each task on its due date; tasks with start and end dates SHALL span the covered days. Done tasks render struck-through/dimmed. Days outside the current month are visible but muted. Prev/next/today navigation changes the window and refetches.

#### Scenario: Tasks on their dates

- **GIVEN** a project with task A due 2026-07-10 and task B start 2026-07-13 end 2026-07-15
- **WHEN** the calendar view shows July 2026
- **THEN** A appears in the cell for the 10th
- **AND** B spans the 13th through 15th

#### Scenario: Edge case: task with no dates

- **GIVEN** a task with no due/start/end date
- **WHEN** the month grid renders
- **THEN** the task appears in the "Unscheduled" side panel, not on the grid

### Requirement: Week view

The view SHALL offer a week mode (7 day columns, no hour axis) using the same fetching, rendering, and drag rules as the month grid.

#### Scenario: Toggle to week

- **GIVEN** the calendar view in month mode
- **WHEN** the user switches to week mode
- **THEN** the current week's 7 days render as columns with the same tasks

### Requirement: Drag to reschedule

Dragging a task chip to another day SHALL update its due date to that day (preserving time-of-day); for ranged tasks, start and end shift by the same day delta. Dragging a task from the Unscheduled panel onto a day SHALL set its due date to that day.

#### Scenario: Reschedule preserves time

- **GIVEN** task A due 2026-07-10 14:30
- **WHEN** the user drags A to the cell for 2026-07-21
- **THEN** A's due date becomes 2026-07-21 14:30
- **AND** the change is persisted via the task update API

#### Scenario: Edge case: read-only link share

- **GIVEN** the project is opened through a read-only link share
- **WHEN** the calendar view renders
- **THEN** tasks are visible but not draggable

### Requirement: Quick-create from day cell

Clicking an empty area of a day cell SHALL open inline task creation with that day pre-set as the due date.

#### Scenario: Create on a day

- **GIVEN** the calendar view for July 2026
- **WHEN** the user clicks the 22nd and enters "dentist"
- **THEN** a task "dentist" is created with due date 2026-07-22

## Success Criteria

- **SC-001**: All scenarios pass under `mage test:e2e` / `mage test:web`.
- **SC-002**: Opening a month in a project with 500 tasks issues one windowed collection request (verifiable in the network log), not a full-project fetch.
- **SC-003**: `pnpm typecheck` and both linters pass.

## Non-Goals

- No hour-axis/time-blocking week view and no drag-edge duration editing — revisit after the duration field (feature #8) lands.
- No overlay of external calendars (CalDAV remains the integration path).
- No change to the default view set created for new projects.
- No calendar rendering of the cross-project "Upcoming" page — this is a project view kind only.
- No special handling when dragging a recurring task: the drag shifts its anchor dates like any other task (repeat recalculation only ever happens on completion), with no extra UI distinction.
