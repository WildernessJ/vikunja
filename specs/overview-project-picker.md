# Overview Project Picker (#19)

## Problem

The overview (Home) task list shows undone tasks across *all* projects, with no
way to narrow it. A scoping control already exists — "Saved filter used on the
overview page" (General.vue) — but it is buried three ways: the create-filter
button lives on the Projects page, the sidebar "Filters" section only renders
once a filter exists, and the setting itself is gated on `hasFilters`. Users who
just want "show me tasks from these 3 projects" never find it. This adds a
direct, discoverable project picker as the common-case shortcut.

## Intended behavior

- New frontend setting `overviewProjectIds: number[]` (persisted in the existing
  free-form `frontend_settings` blob — no backend, no migration).
- General settings gains a project multiselect (reuse `ProjectSearch`, not
  saved-filters-only) under the overview area, mirroring the existing settings-card
  pattern.
- When `overviewProjectIds` is non-empty, `ShowTasks` appends `project in <ids>`
  to its filter string — the same concatenation pattern used today for
  `labels in <ids>` (ShowTasks.vue ~L273-282). The overview task list then shows
  only undone tasks from the selected projects.
- **Coexist, projects win.** The existing `filterIdUsedOnOverview` (saved-filter)
  control stays. Precedence: if `overviewProjectIds` is non-empty, scope by
  `project in <ids>` and ignore the saved-filter projectId path; if it is empty,
  the saved-filter control behaves exactly as today. Setting both is not a
  supported combo — projects win, documented in the setting's help text.
- Default `[]` (empty) → current behavior unchanged (all projects).

## Invariants / gotchas

- **Duplicated defaults:** declare the default in BOTH `models/userSettings.ts`
  and the `loadSettings()` literal in `stores/auth.ts` — the value is `undefined`
  on login otherwise (NULL column). See existing `hiddenNavItems` precedent.
- **Normalize at every read:** `frontend_settings` is tamperable free-form JSON.
  Reuse/mirror `normalizeHiddenNavItems` — `Array.isArray` guard + numeric filter,
  returning a fresh array; never trust the raw value.
- Deleting a selected project leaves a stale id in the list; `project in <ids>`
  with a nonexistent id must not error (backend ignores unknown ids) — but the
  picker should reflect only existing projects.

## Out of scope

Which project *cards* appear on the overview; user-arranged widget layout;
per-widget config; changing the last-viewed section; any backend change.

## Test approach

e2e (frontend-only, live-verify). Scenarios: default overview shows tasks from
all projects; select two projects → only their tasks appear; deselect → back to
all; a set project list wins over a set saved-filter; persists across reload.
Follow the #18 nav-visibility e2e spec structure. Typecheck gate: no net-new
errors over the 1802 baseline.
