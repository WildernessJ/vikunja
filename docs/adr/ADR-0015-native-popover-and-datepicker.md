---
status: Proposed
date: 2026-09-24
deciders: Jason
supersedes: ADR-0004
---

# ADR-0015: Adopt upstream's native popover and date picker

## Context

ADR-0004 chose a fork-local `v-if` plus `<Transition>` popup. It rejected a Teleport/floating-ui rewrite because migrating every popup consumer was too large for the original bug: always-mounted hidden content broke autofocus, polluted selectors and the accessibility tree, and nested overlays were clipped.

Upstream has now completed that whole-app migration. Its `Popup` uses the browser Popover API for top-layer rendering and light-dismiss, floating-ui for collision-aware anchoring, and a modal bottom sheet on mobile. Upstream also replaced flatpickr with native Vue calendar, shortcut, and time-control components and migrated the consumers together.

Keeping ADR-0004's component now has the opposite cost profile. It would require adapting every incoming consumer back to the fork's absolute-positioned popup, retaining flatpickr-only seams, and maintaining a permanent parallel overlay/date architecture. Taking upstream's component removes clipping and positioning work that the fork previously patched per consumer.

## Decision

Adopt upstream's native-Popover/floating-ui `Popup`, mobile sheet behavior, and native date picker. Delete flatpickr and `vue-flatpickr-component`. Once implemented and verified, this ADR supersedes ADR-0004's implementation choice.

Preserve the behavioral invariants rather than the old mechanism:

- closed popup content must not be visible or keyboard-focusable;
- browser light-dismiss, Escape, a second trigger activation, and explicit close must produce one close transition;
- anchored desktop popups must remain in the viewport and mobile consumers that opt in render as bottom sheets;
- consumers that require mount-on-open semantics gate their content with the slot's `isOpen` value instead of forking `Popup`;
- state that must survive close remains in the parent, not in popup-local content;
- date-only mode from ADR-0014 is ported to the native picker: no time control, canonical start/end boundaries, and `forceTime` for reminder/tracking/recurrence inputs;
- tests target focusability, visibility, dismiss behavior, boundary timestamps, and consumer outcomes rather than incidental global DOM absence.

## Consequences

### Positive

- One overlay/date architecture shared with upstream.
- Browser-managed top-layer rendering removes ancestor clipping and most z-index work.
- Floating-ui supplies viewport-aware placement.
- Mobile date and popup interactions gain a supported bottom-sheet presentation.
- Flatpickr lifecycle, string-v-model, stale-HMR, and timezone parsing workarounds can be deleted.
- Future upstream popup and date fixes merge at their native seam rather than being reimplemented.

### Negative and risks

- A desktop popover element may remain in the DOM while closed; the invariant becomes not rendered/focusable, not globally absent.
- The Popover API and its focus behavior require real-browser verification; happy-dom unit tests use a shim.
- Fork-only consumers must supply anchors/placement and may need `v-if="isOpen"` around stateful slot content.
- Fork selectors and styles that assume `.popup` exists only while open, plus `hasOverflow` and flatpickr selectors, are obsolete and must be migrated.
- Date-only logic moves from flatpickr configuration into native picker/helper state transitions, increasing the importance of boundary tests.

## Alternatives considered

### Keep ADR-0004 and port upstream consumers backward

Rejected. It preserves a fork-local implementation by discarding an upstream-wide migration, creates recurring conflicts, and forfeits top-layer/mobile behavior.

### Maintain both popup/date stacks

Rejected. Two shared overlay systems would produce inconsistent focus, dismissal, styling, and mobile behavior. Retaining flatpickr only for fork consumers would also preserve the parsing and lifecycle defects the native picker removes.

### Take upstream Popup but retain flatpickr

Rejected. Upstream migrated Popup and date consumers as one interaction design. Keeping flatpickr would require compatibility wrappers and would not reduce the conflict surface.

## Verification

- Popup unit tests cover open/close, light-dismiss, trigger re-close, anchoring, and mobile sheets.
- Native picker tests cover date-only visibility and canonical start/end boundaries plus time-bearing exemptions.
- Full frontend unit, typecheck, lint, build, and Playwright suites pass.
- Live acceptance confirms desktop clipping/dismiss behavior, phone-width bottom sheet behavior, and Sortable-driven fork surfaces after the upstream sync.
