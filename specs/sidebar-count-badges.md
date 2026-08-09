# sidebar-count-badges Specification

## Purpose

The app SHALL surface how many tasks need attention — a "Today" set (overdue plus due-today) and, optionally, per-project counts — as badges in the sidebar navigation, on the macOS desktop dock icon, and on the installed PWA icon, sourced from a single authoritative per-project count endpoint so every surface agrees.

## Invariants

- Counts MUST NEVER include tasks from projects the authenticated user cannot read.
- Counts MUST only consider undone tasks (`done = false`).
- "Due/overdue" MUST mean `due_date <= end-of-today`, computed relative to the authenticated user's configured timezone (the same basis the existing overdue-reminders feature uses). The Today nav badge, the Today view's task list, the app-icon badge, and the per-project `dueOverdue` count MUST all derive from this one definition and agree.
- A badge with a count of `0` MUST render nothing (no empty pill, no `[0]`); the app-icon badge MUST be cleared when the count is `0`.
- The per-project count setting MUST default to `none` (no per-project badges until the user opts in). The Today nav badge is independent of this setting.
- The Today *view's* task-list boundary (end-of-today) MUST be computed from the authenticated user's **configured account timezone**, not the browser's local timezone, so the list and the badge agree even when the two timezones differ.
- Per-project badges apply only to real projects (`id > 0`). Pseudo-project rows (Favorites, `id = -1`) and saved-filter rows MUST NEVER show a per-project count badge, regardless of the setting.

## Requirements

### Requirement: Project counts endpoint

`GET /api/v2/projects/counts` SHALL return, for every project the authenticated user can read, the count of undone tasks (`open`) and the count of undone tasks due on or before end-of-today in the user's timezone (`dueOverdue`), in a single response.

#### Scenario: Counts for readable projects

- **GIVEN** the user can read projects A and B
- **AND** A has 3 undone tasks (1 overdue, 1 due today, 1 due next week) and 1 done task
- **AND** B has 2 undone tasks, none dated
- **WHEN** `GET /api/v2/projects/counts` is called
- **THEN** the response maps A to `{ open: 3, dueOverdue: 2 }`
- **AND** maps B to `{ open: 2, dueOverdue: 0 }`

#### Scenario: Unreadable projects excluded

- **GIVEN** project C exists but the user has no read permission on it
- **WHEN** `GET /api/v2/projects/counts` is called
- **THEN** the response contains no entry for C

#### Scenario: Edge case: task due late today in user timezone

- **GIVEN** the user's timezone is `America/New_York`
- **AND** a task is due today at 23:00 local time
- **WHEN** `GET /api/v2/projects/counts` is called
- **THEN** that task is included in its project's `dueOverdue` count

#### Scenario: Unauthenticated request rejected

- **WHEN** `GET /api/v2/projects/counts` is called without valid authentication
- **THEN** the request is rejected with an unauthorized error and no counts are returned

### Requirement: Today navigation item

The sidebar SHALL show a "Today" navigation entry between "Upcoming" and "Projects" that links to a task view listing every undone task that is overdue or due today, and SHALL display a badge with that count when it is greater than zero.

#### Scenario: Today view lists overdue and due-today tasks

- **GIVEN** the user has 2 overdue and 3 due-today undone tasks across their projects
- **WHEN** the user opens the Today view
- **THEN** exactly those 5 tasks are listed
- **AND** no task due in the future or already done appears

#### Scenario: Today badge equals the global due/overdue total

- **GIVEN** the project counts endpoint reports `dueOverdue` values summing to 5 across readable projects
- **WHEN** the sidebar renders
- **THEN** the Today item shows a badge of `5`

#### Scenario: Edge case: nothing due

- **GIVEN** the user has no overdue or due-today undone tasks
- **WHEN** the sidebar renders
- **THEN** the Today item shows no badge

### Requirement: Per-project count setting

A user setting `frontendSettings.projectSidebarCount` with values `none`, `dueOverdue`, or `all` SHALL control what count badge each project row in the sidebar shows, defaulting to `none`.

#### Scenario: Setting none shows no project badges

- **GIVEN** `projectSidebarCount` is `none`
- **WHEN** the sidebar renders the project tree
- **THEN** no project row shows a count badge

#### Scenario: Setting dueOverdue shows due/overdue counts

- **GIVEN** `projectSidebarCount` is `dueOverdue`
- **AND** project A has `dueOverdue` of 2 and B has 0
- **WHEN** the sidebar renders
- **THEN** project A shows a badge of `2`
- **AND** project B shows no badge

#### Scenario: Setting all shows total open counts

- **GIVEN** `projectSidebarCount` is `all`
- **AND** project A has `open` of 3
- **WHEN** the sidebar renders
- **THEN** project A shows a badge of `3`

#### Scenario: Edge case: pseudo-projects and saved filters show no badge

- **GIVEN** `projectSidebarCount` is `dueOverdue` or `all`
- **WHEN** the sidebar renders the Favorites row and any saved-filter row
- **THEN** neither shows a count badge

#### Scenario: Setting is changeable in general settings

- **GIVEN** the user is on Settings → General
- **WHEN** the user selects a different `projectSidebarCount` value and saves
- **THEN** the setting persists
- **AND** the sidebar badges update to reflect the new mode

### Requirement: App-icon badge

The Today count SHALL be reflected on the application icon badge — the macOS dock badge when running in the desktop app, and the installed-PWA icon badge via the Web Badging API elsewhere — and SHALL be cleared when the count is zero.

#### Scenario: macOS desktop dock badge

- **GIVEN** the app is running in the Electron desktop wrapper
- **AND** the Today count is 4
- **WHEN** the count is applied
- **THEN** the macOS dock icon shows a badge of `4` (via `app.setBadgeCount`/`dock.setBadge` over IPC)

#### Scenario: Installed PWA icon badge

- **GIVEN** the app runs in a browser context where `navigator.setAppBadge` is available
- **AND** the Today count is 4
- **WHEN** the count is applied
- **THEN** `navigator.setAppBadge(4)` is invoked

#### Scenario: Badge cleared at zero

- **GIVEN** the Today count transitions to 0
- **WHEN** the count is applied
- **THEN** the desktop dock badge is cleared (empty) and/or `navigator.clearAppBadge()` is invoked

### Requirement: Count freshness

The counts SHALL be fetched when the sidebar mounts and refreshed after task mutations (create, update, mark done/undone) and project load, so badges reflect recent changes without a manual reload.

#### Scenario: Marking a task done updates counts

- **GIVEN** the Today badge shows `5`
- **AND** one of those tasks is due today
- **WHEN** the user marks that task done
- **THEN** the counts are refetched
- **AND** the Today badge shows `4`

## Success Criteria

- **SC-001**: `GET /api/v2/projects/counts` returns correct `open` and `dueOverdue` per readable project in a single request, verified under `mage test:web`.
- **SC-002**: The endpoint excludes projects the user cannot read (negative-auth test passes).
- **SC-003**: The Today view lists exactly the overdue + due-today undone tasks, and its badge equals the summed `dueOverdue`, verified via Playwright.
- **SC-004**: Each `projectSidebarCount` value (`none`/`dueOverdue`/`all`) renders the correct per-project badge (or none), verified via Playwright.
- **SC-005**: In the desktop app the macOS dock shows the Today count and clears at zero; in a Badging-API-capable browser `navigator.setAppBadge`/`clearAppBadge` is called with the Today count.
- **SC-006**: All scenarios above pass under `mage test:web` (backend) and `mage test:e2e` (frontend).

## Non-Goals

- No native iOS/Android app. iOS icon badging is best-effort: it applies only to a PWA installed to the Home Screen on iOS 16.4+ with notification permission granted; plain mobile Safari is unsupported and out of scope.
- No count badge on nav items other than "Today" (Upcoming and the rest stay as-is).
- No real-time/push updates and no optimistic per-task badge deltas — counts refresh on mount, task mutation, and project load; brief staleness is accepted.
- No new per-project total-count storage on the model; counts are computed on request by the endpoint.
