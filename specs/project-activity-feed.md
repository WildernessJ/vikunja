# project-activity-feed Specification

## Purpose

Projects SHALL expose a user-facing activity feed — who did what, when, at the action level (task created/completed/updated, comment added, assignee changed, …) — filterable by person and event type, answering "what changed since my last review" without the admin-only audit log.

## Invariants

- Feed visibility follows project read permission; link shares see the feed only if the project is theirs to read.
- Activity capture MUST be asynchronous (event listeners); a failure to record activity MUST NEVER fail or slow the originating operation. Concretely: the listener's handler MUST always return nil (the event bus wraps listeners in retry + poison-queue + Sentry — a returned error means retry-spam, not silence), swallowing and logging internally.
- Entries are immutable once written. Deleting a task or project removes its entries via explicit deletes in the existing manual-cascade paths (`Task.Delete`, `Project.Delete`) — there is no DB-level FK cascade in this codebase to rely on.
- Done-transition detection MUST NOT be inferred from `TaskUpdatedEvent` (it carries only post-state); a dedicated done-transition event dispatched where the transition is actually known is required — and there are TWO such production sites: the normal task-update flow AND the Kanban done-bucket drag, which sets `done` directly without passing through the update flow. Both MUST dispatch.
- This feature MUST NOT touch or depend on the license-gated admin audit log (`pkg/audit/`, `FeatureAuditLogs`) — separate table, separate surface.

## Requirements

### Requirement: Activity capture

Vikunja SHALL persist an activity entry for these existing events: task created / updated / deleted / completed (done transition), assignee added/removed, comment created, attachment added, relation added, project updated. Each entry records actor, verb, task/project reference, a short human-readable summary fragment (e.g. the task title at event time), and timestamp.

#### Scenario: Completion recorded

- **GIVEN** user U and task T in project P
- **WHEN** U marks T done
- **THEN** P's activity feed gains an entry with actor U, verb `task_completed`, and T's title

#### Scenario: Kanban done-bucket drag is also recorded

- **GIVEN** user U and undone task T in a Kanban view with a done bucket
- **WHEN** U drags T into the done bucket
- **THEN** P's activity feed gains a `task_completed` entry with actor U

#### Scenario: Edge case: capture failure is silent

- **GIVEN** the activity listener's internal write fails (driven in a unit test by handing it a closed/erroring session)
- **WHEN** its handler runs
- **THEN** it returns nil (no event-bus retry/poison) and logs the failure

### Requirement: Feed retrieval

A v2 endpoint SHALL return a project's activity, newest first, paginated, filterable by actor and verb, for users with read access. A cross-project "my activity" variant SHALL cover all projects the user can read.

#### Scenario: Filter by actor and verb

- **GIVEN** project P with activity from users U1 and U2
- **WHEN** the feed is requested with actor U2 and verb `task_completed`
- **THEN** only U2's completion entries return

#### Scenario: Edge case: no read access

- **GIVEN** a user without access to P
- **WHEN** they request P's feed
- **THEN** the API responds 403/404 per the existing project permission convention

### Requirement: Retention

A config key SHALL bound retention (default 90 days); a daily cron prunes older entries. Retention `0` disables pruning.

#### Scenario: Old entries pruned

- **GIVEN** retention 90 days and an entry aged 91 days
- **WHEN** the prune cron runs
- **THEN** the entry is gone

### Requirement: Feed UI

The project detail SHALL offer an Activity panel rendering the feed with actor avatar, verb phrase, task link, relative timestamp, filter controls, and infinite scroll/pagination.

#### Scenario: Feed renders

- **GIVEN** a project with 5 activity entries
- **WHEN** the user opens the Activity panel
- **THEN** the 5 entries render newest-first with actor and task link

## Success Criteria

- **SC-001**: All scenarios pass under `mage test:filter` / `mage test:web` / `mage test:e2e`.
- **SC-002**: Task update latency is not measurably increased (capture is async — verified by the listener being on the event bus, not inline).
- **SC-003**: Feed pagination returns stable, non-overlapping pages under concurrent new activity.

## Non-Goals

- No field-level diffs ("changed due date from X to Y") — verb-level entries only in v1; events don't carry before-state.
- No export, no digest emails, no productivity aggregation (that's feature #9's surface).
- No backfill of historical activity — the feed starts at deployment.
- No changes to the admin audit log or its license gating.
