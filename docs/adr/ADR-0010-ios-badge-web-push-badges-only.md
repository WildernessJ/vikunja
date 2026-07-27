---
status: Accepted
date: 2026-07-27
deciders: Jason
phase: —
---

# ADR-0010: iOS badge via standard Web Push with visible notifications; badge-only UX comes from device Settings

## Context

The fork is used as an installed PWA on iOS, where the app icon should carry a live badge count
(e.g. tasks due today) without spamming the user with banners. iOS offers **no silent badge-only
web push on any path**: legacy Web Push payloads that produce no visible notification count toward
WebKit's silent-push penalty and eventually get the subscription revoked, and Declarative Web Push
(iOS 18.4+) requires the `notification` member — a badge-only declarative payload falls back to the
legacy path and incurs the same penalty. WebKit source review established that the revocation check
fires on notification-request *acceptance* (not presentation), and that per-app iOS Settings
surfaces (Lock Screen / Banners / Notification Center / Sounds) suppress *display*, not delivery —
implying that a user who disables every alert surface except **Badges** gets exactly the desired
badge-only behavior without endangering the subscription. No published empirical report of this
configuration existed, so a decision needed real data before committing to a backend-heavy build.

## Decision

Build iOS badge support on **standard Web Push where every push carries a visible notification**,
and rely on the user configuring the app's iOS notification Settings to Badges-only for a
badge-only experience. A ~30-hour on-device spike (a minimal PWA + push server on an internal
host, one push every 3 hours) validated the mechanism: 12/12 sends accepted by APNs (HTTP 201),
zero revocations, the badge tracked every send with banners suppressed, and the subscription
survived server restarts and an airplane-mode gap. The Vikunja implementation (VAPID keys,
subscription model, `/api/v2` routes, service-worker push handler) follows in its own spec.

## Alternatives considered

- **A — Silent/badge-only push:** does not exist on iOS; both legacy and declarative paths
  penalize display-less pushes and revoke the subscription. Ruled out at the mechanism level.
- **B — Sparse digest notifications:** visible notifications at a low, tolerable frequency
  (e.g. one morning digest). Would have been the fallback had muting endangered delivery; badge
  goes stale between digests and the user still sees banners.
- **C — Foreground-only badge updates:** set the badge only when the app is opened. Zero backend
  cost, but a stale badge by definition — defeats the purpose.
- **D — Native app wrapper:** full control over badges, but a permanent second client to maintain;
  out of proportion for this fork.

## Consequences

- **Positive:** a fully standard Web Push stack — no undocumented API usage, nothing for Apple to
  break by policy; the same stack serves normal (visible) notifications on all platforms, with
  badges-only iOS behavior as a configuration, not a code path.
- **Negative / trade-offs:** the badge-only experience depends on **per-device manual Settings
  configuration that no code can detect or enforce** (WebKit never exposes the preference) — a
  misconfigured device gets banners with every badge update. The empirical basis is a single-device
  spike; Apple could change the revocation heuristics in a future iOS release.

## Confirmation

The push-send path must log per-send status codes and surface subscription revocation (HTTP
404/410) loudly rather than swallowing it — a revocation spike is the signal that Apple changed the
rules. Re-verify badge delivery on-device after major iOS updates.

## Links

- Related ADRs: ADR-0001 (the new routes go on `/api/v2`)
