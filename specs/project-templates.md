# project-templates Specification

## Purpose

Users SHALL be able to save a project as a named, reusable template and create new projects from their template library — promoting the existing one-shot duplication into repeatable checklists (trip packing, onboarding, releases).

## Invariants

- A template is a frozen snapshot: later edits to the source project MUST NOT change the template, and instantiating MUST NOT change the template.
- Templates MUST NOT appear in user-facing project navigation or task surfaces: the project list/sidebar, task collections (incl. Upcoming and saved filters), and the CalDAV project listing. They MAY remain reachable by direct ID under normal project permissions (same convention as archived projects) and MUST be included in the user's full data export.
- Instantiation MUST reset done state (all tasks not-done, `done_at` cleared); everything duplication already copies (tasks, buckets, labels, relations, attachments, background) carries over. Neither the template snapshot nor the instantiated project gets the duplication title suffix — both use the user-supplied name.
- Templates MUST NOT carry outward-facing surfaces: save-as-template never copies link shares, webhooks, or subscriptions, and creating a link share or webhook on a template project is rejected.
- Template visibility follows existing project permissions — no new sharing model.

## Requirements

### Requirement: Save as template

A project's settings SHALL offer "Save as template" to users with **write** access (persistent snapshot exposure is deliberately gated tighter than one-shot duplicate's read requirement), which snapshots the project (via the duplication path) into a template entity with a user-supplied name and optional description, owned by the acting user. Child projects are not included in the snapshot.

#### Scenario: Snapshot is frozen

- **GIVEN** project P with task "pack socks" saved as template T named "Packing"
- **WHEN** "pack socks" is renamed in P
- **THEN** T still contains a task named "pack socks"
- **AND** T's title is "Packing" (no " - duplicate" suffix)

#### Scenario: Edge case: read-only user cannot save-as-template

- **GIVEN** a user with read-only access to project P
- **WHEN** they attempt save-as-template
- **THEN** the API responds with the standard permission-denied shape

### Requirement: Template library

Users SHALL see their templates (owned + shared-with-them) in a library listing with name, description, and task count, with rename/delete actions. The template-scoped endpoints MUST respond 404 when the target project is not a template (no alternate route onto regular projects).

#### Scenario: Library lists templates

- **GIVEN** user U owns templates T1 and T2
- **WHEN** U opens the template library
- **THEN** T1 and T2 are listed and no regular projects appear

#### Scenario: Edge case: templates hidden from project list

- **GIVEN** user U owns template T1
- **WHEN** U's project list, Upcoming view, or CalDAV project listing loads
- **THEN** T1 does not appear

#### Scenario: Edge case: template endpoints reject non-templates

- **GIVEN** a regular project P
- **WHEN** `DELETE /templates/{P.id}` is called
- **THEN** the API responds 404 and P is unchanged

### Requirement: Instantiate from template

Creating a project SHALL offer "from template": picking a template and a title creates a new regular project at the chosen parent, copying template content with done state reset and the user-supplied title.

#### Scenario: New trip from packing template

- **GIVEN** template "Packing" with 10 tasks, 3 marked done in the snapshot
- **WHEN** the user creates project "Japan trip" from it
- **THEN** "Japan trip" contains 10 tasks, all not-done, titled "Japan trip", and appears as a normal project

### Requirement: No outward surfaces on templates

Link-share and webhook creation SHALL be rejected on template projects, and save-as-template SHALL NOT copy the source's link shares, webhooks, or subscriptions.

#### Scenario: Edge case: link share on template rejected

- **GIVEN** template T
- **WHEN** a link share is created for T
- **THEN** the API responds 400/412 with a typed error

## Success Criteria

- **SC-001**: All scenarios pass under `mage test:filter` / `mage test:web`.
- **SC-002**: E2E: save-as-template → visible in library → instantiate → new project opens with content.
- **SC-003**: Existing duplication behavior is unchanged (its tests pass unmodified).
- **SC-004**: Each of the named listing query paths (user project statement, recursive CTE, task-collection scoping, CalDAV listing) has an explicit test asserting template exclusion; data export has a test asserting template inclusion.

## Non-Goals

- No public/community template gallery and no CSV template import (the CSV migrator exists separately).
- No "setup templates" (multi-project + filters + labels bundles) and no child-project snapshotting.
- No relative-date shifting on instantiation (template dates copy as-is).
- No template awareness in the admin project list (admins manage all projects, templates included).
