# task-detail-todoist-chips Specification

## Purpose

The task **detail page** SHALL adopt the same Todoist-style interaction the quick-add
composer already has: a magic-text-parsing title field over a row of interactive
**property chips**, replacing the current vertical stack of property widgets. This unifies
the add and edit surfaces so a task looks and edits the same way whether it is being
created or opened later. (Design approved in-session; no GitHub issue — this is the spec.)

## Design decisions (locked in brainstorming)

- **Presentation-only change.** The detail page's existing widgets already own all
  save / permission / loading logic (each edit calls `taskStore.update`). This change
  re-skins how those widgets are triggered; it does **not** touch save logic, permission
  gating, or the backend.
- **Shared chip shell.** The composer's `qac-chip` (button + popup + clear) is extracted
  into a shared `PropertyChip.vue` used by **both** `AddTask.vue` and the detail page, so
  the two surfaces cannot visually drift. The detail chip row becomes its own
  `TaskPropertyChips.vue`, decomposing the oversized `TaskDetailView.vue` (41 KB).
- **All chips visible** (brainstorm option C). All 13 scalar properties render at once:
  filled when set, ghost/dashed when unset.
- **Single-column composition** (brainstorm option 1). Title → chip row → Description →
  Attachments → Related tasks → Comments → Time tracking, all full width. Non-property
  actions collapse into a `⋯` menu.
- **Title parsing = autocomplete-accept only, prefix tokens only** (brainstorm §3 option b).
  A property is applied only when the user picks an autocomplete item; un-accepted text
  stays literal; there is **no** parse-on-blur. Only the four prefix tokens
  (`+project`, `*label`, `@assignee`, `!priority`) — which have a dropdown — parse in the
  title. Dates / reminders / repeat / start / end / % / duration / color are **chip-only**.

## Invariants

- Existing saved titles MUST NEVER be silently mutated. Blur/Enter saves the literal title
  verbatim; only an explicit dropdown-accept consumes and strips a token.
- No change to the save path, permission checks, or backend. Read-only tasks (`!canWrite`)
  MUST render chips disabled and the title non-editable — the same gate the fields use today.
- Every property currently editable on the detail page MUST remain editable after the
  redesign (no capability lost when a field becomes a chip).
- No new magic tokens are introduced; the title parses exactly the four prefixes the
  composer already supports.

## Requirements

### Requirement: Shared property chip

`PropertyChip.vue` SHALL render a chip (icon + label, set/unset state) that opens an
arbitrary editor widget in a popup and offers a clear affordance when set. `AddTask.vue`
and the detail chip row both consume it.

#### Scenario: Composer and detail render the same chip
- **GIVEN** the same property (e.g. Priority) set to the same value
- **THEN** the chip renders identically on the composer and the detail page

### Requirement: All-13 chip row on the detail page

Under the title, `TaskPropertyChips.vue` SHALL render chips for Project, Due, Start, End,
Deadline, Priority, Labels, Assignees, Reminders, Repeat, % Done, Duration, Color — each
opening the existing widget in a popup. Set chips show the value; unset chips show a ghost
placeholder.

#### Scenario: Edit a property via its chip
- **GIVEN** a task open on the detail page
- **WHEN** the user clicks the Priority chip and picks P2
- **THEN** the task's priority persists via the existing `taskStore.update` path
- **AND** the chip reflects P2 without a reload

#### Scenario: Read-only task
- **GIVEN** a task the user has only read access to
- **THEN** the chips render disabled and the title is not editable

### Requirement: Magic-text title with autocomplete-accept

The detail title SHALL open the composer's autocomplete dropdown on a prefix token and,
on accept, apply the property and strip the token. Without an accept the text is saved
literally.

#### Scenario: Accept applies and strips
- **GIVEN** the title reads `Ship it +Web`
- **WHEN** the user picks project "Website" from the dropdown
- **THEN** the task's project becomes Website **AND** the title becomes `Ship it`

#### Scenario: Literal title is never mangled
- **GIVEN** a task titled `Buy milk @ the store`
- **WHEN** the user edits nearby text and blurs without accepting any dropdown item
- **THEN** the saved title still contains `@ the store` verbatim

## Out of scope
- Any backend / API change; any new migration.
- New magic tokens for start / end / deadline / % done / duration / color / date / reminder /
  repeat (these stay chip-only).
- Inline smart-date underline in the title (brainstorm §3 option a — rejected).
- Changes to the Description / Attachments / Comments / Related / Time-tracking panels
  themselves (they only move position, not behavior).
- The quick-add composer's own behavior (it only gains the extracted shared chip).

## Test approach
- Unit: `PropertyChip.vue` (set/unset render, popup open, clear) and `TaskPropertyChips.vue`
  (all 13 render, click routes to the right widget).
- Component: detail title autocomplete mirroring `AddTask.autocomplete.test.ts` — accept
  applies + strips; no-accept saves literal; blur never parses.
- Existing detail-widget save tests remain green unchanged (logic untouched).
- Live-verify in the browser (Claude-in-Chrome): chips edit + persist, title accept vs
  literal, read-only gating, single-column layout.
