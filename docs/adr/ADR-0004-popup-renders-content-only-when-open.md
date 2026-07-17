---
status: Enacted
date: 2026-07-17
deciders: fork maintainer
phase: —
---

# ADR-0004: The shared Popup renders its content only when open (v-if + Transition), not always-mounted

## Context

`frontend/src/components/misc/Popup.vue` used to keep its `content` slot **always mounted**, hidden
purely by CSS (`opacity:0; block-size:0; overflow:hidden`), flipped visible by an `is-open` class, with
`:inert="!open"` (added in `650b52550`) to drop closed content from the tab order. Closed content was
therefore present in the DOM, clipped to zero height, and inert.

That always-mounted design was the root of a recurring class of bugs: a `v-focus`/autofocus inside
content fired once at first mount *while inert* and silently failed; closed content stayed queryable in
the DOM (Playwright deemed it "visible", forcing e2e specs to scope selectors to `.popup.is-open`); and
nested popups were clipped by the ancestor `overflow:hidden` (patched per-case with `has-overflow`).
`:inert` only addressed tab order, not the mounting.

## Decision

Render the content div with `v-if="openValue"`, wrapped in `<Transition name="popup">` to preserve the
fade. Closed content is **not in the DOM at all**; it mounts fresh on open and unmounts on close. The
`is-open` class and `:inert` binding are removed (both moot once closed content doesn't exist), as is the
`block-size:0→auto` animation (v-if now governs presence). The `trigger` slot stays always-rendered.

## Alternatives considered

- **A — v-if + Transition** (chosen): fully resolves the residue — v-focus works (fresh mount on open),
  DOM is clean when closed, a11y is strictly stronger than `inert`. Trade-off: content state resets on
  close (acceptable/expected here — all consumers hold their state in parent scope).
- **B — v-show (`display:none`)** (rejected): keeps content mounted, so it's the lowest-risk change, but
  does **not** fix the v-focus-while-hidden failure and leaves content in the DOM. Only a partial fix.
- **C — Teleport to `<body>` + floating-ui** (rejected): would also retire the `has-overflow`
  overflow-clipping hack, but re-derives positioning for all 7 consumers — far larger blast radius than
  the mounting residue warrants.

## Consequences

- **Positive:** the mounting foot-guns are gone at the source; `:inert` is no longer needed; closed
  popups add nothing to the DOM/a11y tree.
- **Negative / trade-offs & foot-gun to guard:** popup content now **unmounts on close** — a consumer
  must not stash state inside the content slot expecting it to survive a close (keep it in parent scope).
  And critically, **`.popup` no longer carries an `is-open` class**: any `:deep(.popup){ &.is-open {…} }`
  sizing/styling rule silently stops matching, collapsing the popup. Three consumers had exactly such a
  rule (`DatepickerWithRange`, `DatepickerWithValues`, `SingleTaskInProject`) and were migrated to the
  unconditional `:deep(.popup)` block (since `.popup` now only exists when open, unconditional == when
  open). E2E specs that scoped selectors to `.popup.is-open` were updated to `.popup` (which now uniquely
  matches the open popup). A future consumer that copies the old `&.is-open` pattern will hit the same
  silent collapse — there is no lint guard for it.

## Confirmation

Review checkpoint: any new `:deep(.popup)` rule nested under `&.is-open`, or any e2e selector using
`.popup.is-open`, is a bug — `.popup` alone is the open popup. Verified this change by unit suite (1324),
typecheck ratchet (1), and a real e2e run of the affected specs (quick-add-composer,
project-view-calendar, recurring-reminder → 23 passed) plus in-browser live-verify of all 7 consumers.

## Links

- Source: the "Popup keeps closed content mounted" residue (tracked in PROJECT_STATE open questions);
  supersedes the tab-order-only `:inert` fix from `650b52550`.
- Related ADRs: —
