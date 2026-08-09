# Quick Add Composer (issue #48, Todoist-style)

## Problem
The quick-add box (`frontend/src/components/tasks/AddTask.vue`) is a bare textarea. Magic
tokens (`+project *label !prio @assignee`, dates, recurrence) parse only on submit, with no
feedback and no click affordance. Goal: replicate the Todoist composer — name field,
description field, and an interactive chip row — reusing `parseTaskText`.

## Intended behavior
Rework `AddTask.vue` in place (all call sites inherit the new composer).

**Layout** (card-style, like the Todoist screenshot):
1. Title textarea — auto-height, keeps today's multiline behavior (Shift+Enter = newline;
   indented lines = subtasks; multiple lines = multiple tasks).
2. Description input below the title — plain multiline text, applied to the created task.
3. Chip row: Project chip (defaults to the current route project / default project),
   Date chip, Labels chip, Priority chip · then right-aligned Clear (X) and Submit (↑).

**Live parse reflection:** the title is parsed reactively with `parseTaskText` per the
configured `quickAddMagicMode`. Parsed values render in the matching chips (Date chip shows
the resolved date, Project chip the `+project` match, Labels chip the label names, Priority
chip the level; recurrence shown as a human phrase near the Date chip). Parsing is
non-destructive — the input text is never mutated by the preview.

**Chip pickers:** each chip opens a popup picker (reuse `Datepicker`, `ProjectSearch`,
label multiselect per `EditLabels`, `PrioritySelect`). A picked value is a structured
*override*. Effective value shown in a chip = override ?? text-parsed value. On submit,
overrides win over text-parsed values; matched tokens are still stripped from the title as
today. A chip's clear action removes only the override (text-parsed value reappears).

**Store change:** `taskStore.createNewTask` accepts an optional `overrides` object
(`dueDate`, `priority`, `labels`, `projectId`, `description`) taking precedence over its
internal parse. No behavior change for existing callers.

**Modes:** with `quickAddMagicMode: 'disabled'` no text parsing happens; chips still work
as pure structured pickers. Multiline input (>1 task): description field and chip pickers
are disabled/hidden with a "multiple tasks" hint; submit falls back to today's
multi-create path unchanged.

**Clear (X):** resets title, description, and all overrides.

## Out of scope (follow-ups under #48)
- Reminders chip (no magic syntax, no create-path plumbing yet).
- Inline token highlighting inside the input (overlay-mirror).
- Typing-triggered autocomplete dropdowns for `+ * @` tokens.

## Test approach
- Unit: override-vs-parsed merge logic in a composable (`useQuickAddComposer` or similar);
  extend `AddTask.test.ts` for chip state from parsed text.
- E2E: create a task via chips only (magic disabled) and via mixed text+chip override.
- Live-verify in the browser (list view + kanban) before merge.

## i18n
All new user-facing strings go through `frontend/src/i18n/lang/en.json`.
