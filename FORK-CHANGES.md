# Fork Changes

Running log of fixes and additions in this fork (`WildernessJ/vikunja`) that diverge from upstream (`go-vikunja/vikunja`).

Cross-check anytime with:

```bash
git fetch upstream
git log --oneline upstream/main..HEAD
```

## Format

Newest first. One entry per shipped change.

`YYYY-MM-DD` — **type** — short description ([commit/PR](url))

Types: `fix`, `feat`, `chore`, `docs`.

## Changes

`2026-07-22` — **fix** — Quick-add composer: an apostrophe inside a quoted magic token no longer truncates it (#50). A shared `findQuoteClose` heuristic closes a quoted span only at a quote char followed by a space or end-of-string, so `+'Bob's Project'` parses whole instead of stopping at `Bob`; applied consistently to the live autocomplete (`tokenAtCaret`) and the task-creation parse (`getItemsFromPrefix`). See [ADR-0007](docs/adr/ADR-0007-quote-close-heuristic.md). ([05d0725ab](https://github.com/WildernessJ/vikunja/commit/05d0725ab))

`2026-07-22` — **feat** — Quick-add autocomplete rows show a colour swatch for label suggestions and an avatar for assignee suggestions, reusing the existing `ColorBubble`/`User` components (#50). ([05d0725ab](https://github.com/WildernessJ/vikunja/commit/05d0725ab))

`2026-07-22` — **fix** — Assignee removal now updates the UI without a reload (#61): `EditAssignees.removeAssignee` persisted the removal and spliced its local list but never emitted `update:modelValue`, so a consumer holding a separate copy of the task (e.g. the List-view right-click context menu) kept showing the removed assignee's avatar until reload. Now it emits after the splice, mirroring `addAssignee`. ([d3e149629](https://github.com/WildernessJ/vikunja/commit/d3e149629))

`2026-07-22` — **fix** — List "Set as default sort" no longer leaves a redundant `?sort=` in the URL (#70): saving a sort as the view default now clears the explicit query param once the persisted default catches up (a failed save keeps it so the sort still applies); session-only sort overrides are unaffected. Adds the first `ProjectList` integration test (#69). ([d7ac37c0e](https://github.com/WildernessJ/vikunja/commit/d7ac37c0e))

`2026-07-22` — **feat** — Per-project default sort order for the List view: a view's sort can be saved server-side (`default_sort_by`/`default_order_by` on `ProjectView`) and is applied on load when no explicit `?sort=` is set; "Set as default sort" action in the Sort popup (admin-only). Table view deferred. ([ec0c81451](https://github.com/WildernessJ/vikunja/commit/ec0c81451))

- 2026-07-22 — **feat** — Todoist-style List-view task rows (#65): the project name always renders far-right (consolidating the old before-title colour chip and the separate far-right mode into one presentation), the due date moves onto its own line beneath the title with a calendar icon (replacing the inline "– due in X"), and it is colour-coded by a 5-tier urgency heat gradient (overdue → today → tomorrow → this-week → later) via a new pure `getDueDateUrgency()` helper + `--urgency-*` theme tokens. Buckets are calendar-day based and honour the user's "Week starts on" setting; every tier clears WCAG AA (≥4.5:1) on both the resting row bg and the `--grey-100` hover bg, in light and dark; the due-date `aria-label` is preserved so screen readers keep the "due …" context the visible text drops ([840f421](https://github.com/WildernessJ/vikunja/commit/840f4219e), hover-contrast tuning follow-up).
- 2026-07-21 — **feat** — per-project sub-project roll-up selector + permission-scoped CTE (#66, #60): the List-view "show sub-project tasks" checkbox became a per-project selector — enabling the roll-up lists the parent's descendant projects (all included by default); unchecking one excludes its tasks while its own children keep rolling up. Selection persists in user-namespaced localStorage (`subprojectRollup:<userId>:<projectId>`), migrating the old key. A new `excluded_project_ids` field on the shared `TaskCollection` (bound by v1 + v2, like `include_child_projects`) applies the exclusion. Descendant resolution was rewritten from an O(all-accessible-projects) Go BFS into a permission-scoped recursive CTE seeded at the parent; link-share auth degrades to no descendants (no 500) ([4e16a20](https://github.com/WildernessJ/vikunja/commit/4e16a2021bc5af7969c5d5c8a78df7c9f99eae96)).
- 2026-07-21 — **fix** — surface label-creation failures from the task store (#57): failed label creation during task creation was silently swallowed on the store path (`ensureLabelsExist`) and only surfaced by the quick-add composer, while the same path from QuickActions, Kanban quick-add, and RelatedTasks failed silently. Moved the toast into the shared store `ensureLabelsExist` so all callers surface uniformly; `AddTask` forwards pre-resolved labels as a per-task override so multi-task input doesn't double-toast ([2b09da9](https://github.com/WildernessJ/vikunja/commit/2b09da9ffe5a2883eaad823cbdfc4bbd3562a061)).
- 2026-07-21 — **chore** — sync with upstream v2.4.0 (159 commits): 10 GHSA security fixes (token hashing at rest, cross-project/cross-tenant permission bypasses, OIDC/link-share hardening), task soft-delete with 30-day purge, ParadeDB relevance ranking, CalDAV sync-collection REPORT, large a11y sweep, dep bumps (Pinia v4, vue-router v5, Vite 8, TipTap 3.28, echo v5.3). All fork features preserved through 21 conflict resolutions (templates, roll-up, composer, activity feed, deadline/estimated-duration); fork tests adapted to soft-delete and `ParentProjectID *int64` semantics.
- 2026-07-21 — **fix** — register `faArrowUp` in the FontAwesome library: the quick-add composer's ADD button referenced it unregistered, logging a console error on every page load (pre-existing, surfaced by merge live-verify).
- 2026-07-20 — **fix** — wrap `TeamMemberModel.settings` in a `UserSettingsModel` (#51): the subclass re-runs `assignData()` after `super()` to recover its own fields, which was clobbering the base's wrapped `settings` back to a raw object. Extracted the derived-field re-wrapping (dates + settings) into a shared `UserModel.normalize()` the subclass re-calls, so no derived field is silently forgotten. Builds on the #46/#47 model date-column convention ([15730f4](https://github.com/WildernessJ/vikunja/commit/15730f4b4)).
- 2026-07-20 — **feat** — roll up sub-project tasks in the List view: a per-project "Show sub-project tasks" toggle. A new `include_child_projects` query param on the shared `TaskCollection` (bound on both v1 and v2) expands the project set to the viewed project plus all readable, non-archived descendant projects; borrowed rows show a project-origin chip ([1997ac3](https://github.com/WildernessJ/vikunja/commit/1997ac328845651c45a93e285fc27b38038a409a)).
- 2026-07-20 — **feat** — right-click context menu on List-view tasks ([0254653](https://github.com/WildernessJ/vikunja/commit/02546535c43917bf64b03833143ec21e8d4718d1)).
- 2026-07-20 — **fix** — refresh the Today count and macOS app badge on defer and Gantt reschedule ([7746fa0](https://github.com/WildernessJ/vikunja/commit/7746fa0ecf5c2cbee37539c3ba55560b916c467e)).
- 2026-07-17 — **feat** — scheduled, config-driven full-instance backups ([18dabce](https://github.com/WildernessJ/vikunja/commit/18dabce342502863e251025565795eb6f51fa317)).
- 2026-07-17 — **feat** — label the lowest priority "No Priority" instead of "Unset" ([3f735dd](https://github.com/WildernessJ/vikunja/commit/3f735ddbc3fb2d4872730059b4b7212a61c190a3)).
- 2026-07-17 — **fix** — `Popup` renders its content only when open (`v-if` + `Transition`), so closed popups stay inert and out of the DOM ([9dd2c3c](https://github.com/WildernessJ/vikunja/commit/9dd2c3c379cc847118cc10c3720781f5cab09c93)).
- 2026-07-17 — **fix** — enforce one Date-column convention across models so `created`/`updated` and friends deserialize consistently (#46, #47) ([f718efc](https://github.com/WildernessJ/vikunja/commit/f718efc31e99b571828b3c6ff707c2bf25d98816)).
- 2026-07-17 — **fix** — desktop: dark-mat macOS icon and drop the dock theme-swap ([57c569e](https://github.com/WildernessJ/vikunja/commit/57c569e1566d1960575b776e102100bd0e7259c7)).
- 2026-07-16 — **feat** — quick-add composer enhancements: a reminders chip, typing-triggered autocomplete for magic tokens, `+project`-scoped assignee suggestions, and popup clipping/a11y fixes; override precedence consolidated into `resolveOverride` ([4127a53](https://github.com/WildernessJ/vikunja/commit/4127a53775f51fd707e0907c2245dad79ce6c59b)).
- 2026-07-14 — **feat** — Todoist-style quick-add composer with interactive chips, replacing the raw magic-string input ([77b5c63](https://github.com/WildernessJ/vikunja/commit/77b5c63f3881443f61c4f1f5e1ae973866734fd5)).
- 2026-07-14 — **feat** — interval recurrence (every Nth month/week on a pattern); contradictory interval input degrades gracefully instead of corrupting the task ([7606eb1](https://github.com/WildernessJ/vikunja/commit/7606eb1e7712a6f3073b6b8edf2cfd406ec4a506)).
- 2026-07-12 — **feat** — exclude mode for overview projects ([3aae412](https://github.com/WildernessJ/vikunja/commit/3aae412c22aea7588b9dbdaf5df5cbceb247fc39)).
- 2026-07-11 — **refactor** — frontend type-error burndown to baseline 1, gated going forward by a per-file typecheck ratchet (#21) ([e9e2349](https://github.com/WildernessJ/vikunja/commit/e9e2349cbcd1fe15b951adadfb4a4b458824e8d8)).
- 2026-07-11 — **feat** — user-selectable text size and body font, reaching kanban cards, pickers, the command palette, and notifications (#20) ([bf2a1be](https://github.com/WildernessJ/vikunja/commit/bf2a1be067a031054acbe47cdd268bcccea78387)).
- 2026-07-11 — **fix** — logout teardown resets appearance settings and no longer fires a doomed task fetch, so stale styles clear and no unauthorized request is made (#44, #45) ([760c6e4](https://github.com/WildernessJ/vikunja/commit/760c6e4d3af8ca3f735b833340406879b4bc46b5)).
- 2026-07-11 — **feat** — tint task-row project names with the project color, with a guaranteed-AA-contrast guard and hex validation ([b414ec8](https://github.com/WildernessJ/vikunja/commit/b414ec87a2f52c9f835eb722aa682e2a76000a78)).
- 2026-07-11 — **fix** — give disabled kanban bucket-menu items native `disabled` semantics ([2bf8e26](https://github.com/WildernessJ/vikunja/commit/2bf8e26164b4e7f85fd0fe3aa6c519055e3b9b36)).
- 2026-07-10 — **feat** — let users pick which projects appear on the overview, pruning stale and non-positive ids (#19) ([b911426](https://github.com/WildernessJ/vikunja/commit/b9114263a685b46a76651766c7c0e1b7f0df4cb9)).
- 2026-07-08 — **feat** — calendar project view with a month/week grid, windowed + unscheduled fetch splitting, and a new calendar view kind ([976b9ae](https://github.com/WildernessJ/vikunja/commit/976b9ae897fed420605e73b8bc0df598c660af7d)).
- 2026-07-08 — **feat** — user-toggleable sidebar navigation items (#18) ([b8c01df](https://github.com/WildernessJ/vikunja/commit/b8c01df2be10d8de13b952ce630428b706a58a47)).
- 2026-07-08 — **feat** — nest a project by dragging it onto another in the sidebar ([5063a45](https://github.com/WildernessJ/vikunja/commit/5063a45b9252c02a2e98566fe5d6352686f22508)).
- 2026-07-08 — **fix** — models: enforce parent write access and stable view order when duplicating a project ([2d73629](https://github.com/WildernessJ/vikunja/commit/2d73629f07908ab4109f44d4e9f2d43b97af340b)).
- 2026-07-08 — **fix** — models: don't drop an admin-created user or its events when a reload fails ([8c47b1c](https://github.com/WildernessJ/vikunja/commit/8c47b1c3ccae82467147e2d88f51d9632649cd27)).
- 2026-07-07 — **feat** — project templates: save-as-template and a template library with create-from-template; `is_template` carried through the listing CTE to close template leaks ([43a57a9](https://github.com/WildernessJ/vikunja/commit/43a57a976ba5c73a4a77f9ae524cff2aa120149f)).
- 2026-07-07 — **feat** — user-facing project activity feed with a per-project activity panel ([6efe31e](https://github.com/WildernessJ/vikunja/commit/6efe31e9f4c139d0367bbced70924e6e7091e2ff)).
- 2026-07-07 — **feat** — independent recurring reminders with a dedicated editor: reminders re-arm on their own schedule (creator timezone), separate from task recurrence ([95c865b](https://github.com/WildernessJ/vikunja/commit/95c865b1ef09978604526720c450914375f7ff5d)).
- 2026-07-07 — **feat** — personal statistics page and `/stats` endpoint ([d4f699d](https://github.com/WildernessJ/vikunja/commit/d4f699d30ef18516e72a901250c79c9c0985fb75)).
- 2026-07-06 — **feat** — rrule-based calendar-pattern recurrence engine with quick-add parsing and CalDAV round-trip; COUNT-based rules rejected as out of the supported subset ([a324b15](https://github.com/WildernessJ/vikunja/commit/a324b151b16c47db7faabeaebd3dc3cdfd788871)).
- 2026-07-06 — **feat** — deadline field with `{}` quick-add syntax, filtering, reminder support, and overdue styling ([f5f8338](https://github.com/WildernessJ/vikunja/commit/f5f8338c909829c2ef2b05926639d9f3a94d7d18)).
- 2026-07-06 — **feat** — estimated-duration task field, filterable, with a CalDAV round-trip and clear-to-zero support ([5b227c0](https://github.com/WildernessJ/vikunja/commit/5b227c0fca1872e6844bf9b259c2377ab279f82e)).
- 2026-07-05 — **feat** — project task counts: `GET /api/v2/projects/counts`, a Today nav item, per-project sidebar badges, and a Today count on the macOS app icon ([5a9603e](https://github.com/WildernessJ/vikunja/commit/5a9603e9484c485ba38f2efedfab252b79b536a9)).
- 2026-07-05 — **fix** — coherent kanban default/done bucket handling: forbid a bucket being both default and done, allow completing repeating tasks through a full done bucket, and normalize existing default==done views via migration ([c97c6d7](https://github.com/WildernessJ/vikunja/commit/c97c6d764a47270673c6888af4a2bbf8f30bbc7e)).
- 2026-07-05 — **fix** — harden the task list against stale responses and revert optimistic favorite/reorder/assignee state on failure; ref-count loading so overlapping requests don't flicker the spinner ([c6ad518](https://github.com/WildernessJ/vikunja/commit/c6ad518675f07c1aae2c89892651e0dca9b01f4b)).
- 2026-07-05 — **feat** — desktop: theme-aware macOS dock icon on a rounded tile ([bbfd917](https://github.com/WildernessJ/vikunja/commit/bbfd917af62d9260657dcabd317cd7d89969dd7a)).
- 2026-07-04 — **fix** — repair sidebar project drag-and-drop: (1) drop `@mousedown.stop`/`@touchstart.stop` on the drag handle so SortableJS's Safari-only mousedown listener fires; (2) recalculate sibling positions *after* persisting the moved row in `UpdateProject` so a dropped project no longer jumps to the top; (3) restore last-known-good state on a failed `updateProject` instead of flipping `isFavorite`. All three pre-existing upstream.
- 2026-07-04 — **fix** — guard `GetTokenFromTokenString` against a panic on short/prefix-only API tokens (unauth DoS); covers the main token middleware, CalDAV, and feeds. Reported upstream.
- 2026-07-04 — **ci** — fork-only container image build workflow (`ghcr.io/wildernessj/vikunja`) ([bd9e106](https://github.com/WildernessJ/vikunja/commit/bd9e106de820073fe514d43ecf4af148ed18d5b0)).

<!-- Add entries here, newest first. Example:
- 2026-07-04 — **feat** — add per-project default reminder time ([abc1234](https://github.com/WildernessJ/vikunja/commit/abc1234))
-->
