# drag-nest-project Specification

## Purpose

The sidebar project navigation SHALL let a user set a project's parent by dragging that project onto/into another project, including projects that currently have no children, so nesting no longer requires opening the project's edit settings. This extends the existing sidebar drag (which already reparents a project when it is dropped into an *expanded, non-empty* child list) to cover every eligible project via a drop-zone that appears only while a project is being dragged.

## Invariants

- A nest drop-zone MUST NEVER appear for a pseudo-project (Favorites at id `-1`, saved filters at id `< -1`), an archived project, or a project the user lacks write permission on. These match the projects already excluded from sidebar reordering.
- A nest drop-zone MUST NEVER appear on the dragged project itself or on any of its descendants (both would produce a self/cyclic parent that the API rejects with `ErrProjectCannotBeChildOfItself` / `ErrProjectCannotHaveACyclicRelationship`).
- Revealing a nest drop-zone MUST NEVER force-expand a project's existing (collapsed) child subtree — the zone is a dedicated slot, independent of the project's expand/collapse state and of whether it has children.
- Reparenting MUST reuse the existing persistence path (`projectStore.updateProject` with `parentProjectId`), so all backend permission and cycle checks continue to run unchanged.
- A failed reparent (e.g. the API rejects it) MUST leave the sidebar showing the pre-drag tree — the existing `saveProjectPosition` failure reset already restores the clone from `props.modelValue`.
- The nest drop-zones MUST be visible only during an active project drag; the resting sidebar layout MUST be unchanged.

## Requirements

### Requirement: Reveal nest drop-zones during a project drag

While a project is being dragged in the sidebar, every eligible project SHALL expose a dedicated nest drop-zone beneath its row — a droppable slot distinct from the project's real child list, so it appears uniformly whether the project has children or not and whether it is expanded or collapsed — highlighted with the existing `is-drop-target` affordance and labelled to name the target parent. Revealing the zone MUST NOT expand a collapsed project's existing children.

#### Scenario: Zones appear on drag start and clear on drag end

- **GIVEN** the sidebar shows several top-level projects, at least one with no children
- **WHEN** the user begins dragging a project by its handle
- **THEN** each eligible project displays a nest drop-zone beneath its row
- **AND** when the drag ends (drop or cancel) all nest drop-zones disappear and the resting layout is restored

#### Scenario: Childless project exposes a zone

- **GIVEN** a project "Personal" that has no child projects
- **WHEN** the user drags another project during the drag
- **THEN** "Personal" shows a nest drop-zone even though its child list is empty

#### Scenario: Collapsed parent is not force-expanded

- **GIVEN** a project "Work" that has children and is collapsed
- **WHEN** the user drags another project during the drag
- **THEN** "Work" shows its dedicated nest drop-zone
- **AND** its collapsed children stay hidden (the subtree is not expanded)

#### Scenario: Edge case: ineligible targets show no zone

- **GIVEN** a project drag is in progress
- **WHEN** the sidebar renders drop-zones
- **THEN** no zone appears on the Favorites pseudo-project, on saved filters, on archived projects, on read-only projects, on the dragged project itself, or on any descendant of the dragged project

### Requirement: Drop into a zone reparents the project

Dropping a dragged project into project B's nest drop-zone SHALL set the dragged project's `parentProjectId` to B's id and persist it through `projectStore.updateProject`, reusing the existing Sortable `group="projects"` drop and `saveProjectPosition` parent-from-DOM derivation.

#### Scenario: Nest a top-level project under a childless project

- **GIVEN** a top-level project "Errands" and a childless project "Personal"
- **WHEN** the user drags "Errands" and drops it into "Personal"'s nest drop-zone
- **THEN** "Errands" is persisted with `parentProjectId` equal to "Personal"'s id
- **AND** the sidebar shows "Errands" nested under "Personal"

#### Scenario: Nest under a project that already has children

- **GIVEN** a project "Work" with existing children
- **WHEN** the user drops "Errands" into "Work"'s nest drop-zone
- **THEN** "Errands" is persisted as a child of "Work" alongside the existing children

#### Scenario: Reordering is unchanged

- **WHEN** the user drops a project between two items in the same list (not into a nest drop-zone)
- **THEN** the project is reordered within that list and its parent is unchanged

#### Scenario: Edge case: rejected reparent restores the tree

- **GIVEN** a drop whose reparent the API rejects (the UI prevents self/cycle targets, so this path is exercised in tests by intercepting the update request and forcing a failure response)
- **WHEN** the persistence call fails
- **THEN** an error is surfaced to the user
- **AND** the sidebar tree returns to its pre-drag state

## Success Criteria

- **SC-001**: A user can nest a top-level project under a project that has no existing children entirely by dragging in the sidebar, with no visit to edit settings, and the new parent survives a page reload.
- **SC-002**: Dragging to reorder projects within a list continues to work and does not change any project's parent.
- **SC-003**: All scenarios above pass under the project's Playwright e2e suite (`mage test:e2e`).
- **SC-004**: The resting (non-dragging) sidebar renders identically to before this change — no persistent extra height, spacing, or drop-zone elements.

## Non-Goals

- No new API surface — reparenting reuses the existing project update endpoint and its permission/cycle checks; `/api/v1` and `/api/v2` are untouched.
- No touch / coarse-pointer support — sidebar drag handles are already hidden on coarse pointers, so this is inherently desktop-only.
- No "drop precisely onto the row" hit-testing via `elementsFromPoint`; the nest target is the revealed drop-zone slot, not the row itself.
- No configurable max nesting depth — the backend imposes none today and this feature does not add one.
- No reparenting of saved filters or pseudo-projects.
