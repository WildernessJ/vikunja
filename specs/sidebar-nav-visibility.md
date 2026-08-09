# Sidebar Nav Visibility Specification

## Purpose

The frontend SHALL let each user hide or show individual top-level sidebar navigation links (Upcoming, Today, Projects, Labels, Templates, Teams) via a persisted per-user setting, so users can declutter the sidebar of entries they don't use. Visibility is stored in the existing free-form `frontend_settings` JSON blob — no backend change, no migration. This is the first of the settings-cluster issues (#18); #19 (overview composition) and #20 (text size/font) reuse the same `frontendSettings` + General-settings-card pattern independently.

## Invariants

- The Overview link SHALL always render; it is not user-hideable (it is the default landing route — hiding it could strand a user with no sidebar path home).
- The Time-tracking link's existing Pro-feature gate (`v-if="timeTrackingEnabled"`) SHALL remain the outer condition; the visibility setting only applies when that gate already passes.
- Default state SHALL be all links visible. A user who has never touched the setting, and a `frontend_settings` blob predating this feature, MUST render the full nav unchanged. Note: on login the value is `undefined` for such users (the `loadSettings()` default literal in `stores/auth.ts` does not include it), so every read site MUST treat a missing/`undefined` value as "nothing hidden" (coalesce to `[]`) — not merely a missing key.
- The setting SHALL be additive-safe: a navigation link added in the future that is not represented in the stored setting defaults to visible (never hidden by omission).

## Requirements

### Requirement: Persisted per-item visibility setting

`IFrontendSettings` SHALL carry a value recording which toggleable top-nav links are hidden, defaulting to "none hidden" (all visible). The persistence path is the existing `settings.frontendSettings` → `updateSettings()` flow used by every other frontend setting; the stored representation SHALL be omission-safe so that absent keys mean "visible" (recommended shape: `hiddenNavItems: string[]` of hidden item keys, default `[]`).

#### Scenario: Default is all-visible

- **GIVEN** a user whose `frontend_settings` has no nav-visibility value set
- **WHEN** the sidebar renders
- **THEN** all of Overview, Upcoming, Today, Projects, Labels, Templates, and Teams links are shown (Time-tracking per its own Pro gate)

#### Scenario: Persisted hidden item stays hidden across reload

- **GIVEN** a user who has hidden the "Teams" link and saved settings
- **WHEN** the app is reloaded and the sidebar renders
- **THEN** the Teams link is not present in the DOM
- **AND** the remaining links (Overview, Upcoming, Today, Projects, Labels, Templates) are present

#### Scenario: Edge case: unknown key in stored setting is ignored

- **GIVEN** a `frontend_settings` value listing a nav key that no longer exists (e.g. a removed item)
- **WHEN** the sidebar renders
- **THEN** the sidebar renders without error and the unknown key has no effect on visible links

#### Scenario: Edge case: malformed (non-array) stored value

- **GIVEN** a tampered `frontend_settings` where the visibility value is not an array (e.g. a number or object)
- **WHEN** the sidebar or settings page renders
- **THEN** every read normalizes the value to "nothing hidden" without throwing
- **AND** all links render as visible

### Requirement: Settings UI to toggle each link

`views/user/settings/General.vue` SHALL present a control group (its own titled card/section, mirroring the existing settings cards) with one show/hide toggle per toggleable top-nav link. Toggling a control and saving SHALL persist the change through the existing `updateSettings()` call and take effect on the sidebar without a full reload.

#### Scenario: Hiding a link from settings updates the sidebar

- **GIVEN** the user is on the General settings page with all nav links visible
- **WHEN** the user unchecks the "Projects" show-toggle and saves
- **THEN** settings persist successfully
- **AND** the Projects link is removed from the sidebar

#### Scenario: Re-showing a hidden link restores it

- **GIVEN** the user has previously hidden the "Labels" link
- **WHEN** the user re-checks the "Labels" show-toggle and saves
- **THEN** the Labels link reappears in the sidebar

#### Scenario: Toggle takes effect without a reload

- **GIVEN** the user is on the General settings page with the "Teams" link visible
- **WHEN** the user unchecks the "Teams" show-toggle and saves
- **THEN** the Teams link is removed from the sidebar without reloading the page (reactive store update)

#### Scenario: Overview has no hide control

- **GIVEN** the user is on the General settings page
- **WHEN** the nav-visibility control group is inspected
- **THEN** there is no show/hide control for Overview
- **AND** controls exist for Upcoming, Today, Projects, Labels, Templates, and Teams

### Requirement: Localized labels

Every new user-facing string (the section title and each toggle label) SHALL be added to `frontend/src/i18n/lang/en.json` and referenced via `$t(...)`; no hardcoded English in the template. Only `en.json` is edited (other locales are handled by the translation workflow).

#### Scenario: Section and toggle labels come from i18n

- **WHEN** the nav-visibility settings section renders
- **THEN** its title and every toggle label resolve from `en.json` keys via `$t(...)`
- **AND** no literal display string is hardcoded in the component template

## Success Criteria

- **SC-001**: A user can hide any of the six toggleable links and, after reload, that link is absent from the sidebar while all others remain — verified end-to-end.
- **SC-002**: With no stored setting, the sidebar is byte-for-byte the same set of links as before this feature (non-breaking default), verified against a fresh user.
- **SC-003**: The Overview link is present in the sidebar in every configuration and has no hide control in settings.
- **SC-004**: `cd frontend && pnpm typecheck` introduces zero net-new errors versus the ~1800-error baseline; `pnpm lint` and `pnpm lint:styles` pass on changed files.
- **SC-005**: All scenarios above pass under Playwright e2e (the checkbox→`v-if` path is standard DOM, unlike the sidebar drag interactions).

## Non-Goals

- No hiding of the Favorites section, the Saved-Filters section, or the main project tree — those already render only when non-empty; this feature covers the fixed top-nav links only.
- No reordering of nav items — visibility only.
- No backend/API change, no DB migration — `frontend_settings` is free-form JSON stored verbatim (`pkg/user/user.go:125`).
- No per-device or global-admin nav config — this is per-user only.
- Not #19 (overview list composition) or #20 (text size/font); they are separate specs reusing this same settings pattern.
