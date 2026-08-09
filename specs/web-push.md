# Web Push notifications with badge count (feat-web-push)

**STATUS: draft — pending review.** Implements ADR-0010 (Accepted 2026-07-27). Scoping/decision
record: `specs/ios-live-badge.md`. Spike evidence: 26+/26 sends 201, zero revocations.

## Problem

The iOS app-icon badge only updates while the app is open (`frontend/src/composables/useAppBadge.ts:16`).
ADR-0010 decided: standard Web Push where every push carries a visible notification with the badge
count; badges-only UX comes from per-device iOS Settings. No push infrastructure exists anywhere yet.

## Intended behavior

**Backend (Go):**
1. **VAPID config**: new keys `webpush.enabled`, `webpush.publickey`, `webpush.privatekey` in
   `pkg/config/config.go` + `config-raw.json`. Keys must stay stable (rotation kills subscriptions).
2. **Keygen CLI**: `vikunja webpush-keys` generates a VAPID pair and prints it for the config file
   (pattern: `pkg/cmd/testmail.go:34`). Library: `github.com/SherClockHolmes/webpush-go`.
3. **`PushSubscription` model** (`pkg/models/`): `id, user_id, endpoint (unique), p256dh, auth, created`.
   Owner-only permissions (`Can*` on user_id match). Migration via `mage dev:make-migration`.
   Skills: `crudable`, `migration`.
4. **v2 routes** (`pkg/routes/api/v2/`, skill `api-v2-routes`):
   - `GET /api/v2/notifications/push/public-key` — VAPID public key + enabled flag (authed, non-CRUD).
   - `POST /api/v2/push-subscriptions` — create (upsert on duplicate endpoint).
   - `DELETE /api/v2/push-subscriptions/{id}` — remove own subscription.
5. **Send path**: a badge-push helper that computes the user's total due/overdue count
   (sum of `DueOverdue` per `pkg/models/project_counts.go:93` boundary logic, user-timezone aware),
   sends to all of the user's subscriptions with TTL 24h, and payload `{title, body, badgeCount, type}`.
   Notification text via `pkg/i18n` (en.json only). **Push is independent of mailer config** — do NOT
   gate on mail-enabled like `task_overdue_reminder.go:133` does.
6. **Trigger cadence**: dedicated cron (registered like `task_overdue_reminder.go:113`), interval from
   `webpush.badgeinterval` (default 3h, matching the validated spike cadence), sending to every user
   who has ≥1 subscription. Skip send when the user's count AND last-sent count are both 0.
7. **Revocation handling (ADR-0010 Confirmation clause)**: per-send status logged; HTTP 404/410 →
   delete the subscription AND log at WARN with a distinct message — never swallowed.

**Frontend (Vue/PWA):**
8. **SW `push` handler** in `frontend/src/sw.ts` (alongside `notificationclick` at `sw.ts:79`):
   always `showNotification()` (iOS-mandatory) + `navigator.setAppBadge(badgeCount)`; clear badge at 0.
   Notification click opens the app (reuse existing deep-link handling).
9. **Subscribe flow + settings toggle** in `frontend/src/views/user/settings/General.vue`: on user
   gesture request Notification permission → `pushManager.subscribe()` with the fetched public key →
   POST to backend. Unsubscribe reverses both. Hidden when `webpush.enabled` is false or the browser
   lacks push support. New `pushSubscription` service (pattern: `frontend/src/services/apiToken.ts:5`).
10. **i18n**: strings in BOTH `frontend/src/i18n/lang/en.json` (toggle UI) and `pkg/i18n/lang/en.json`
    (notification text) — two independent trees.

## Out of scope

- Integrating push as a general channel in `pkg/notifications/` (mail/DB only today,
  `notification.go:96` — no transport abstraction; a later refactor if push proves out).
- Event-driven instant pushes (task assigned/commented etc.) — cadence-based badge refresh only.
- Declarative Web Push, Android/desktop silent badge pushes, encrypted payload padding tuning.
- Any change to the foreground path (`useAppBadge.ts` stays as-is; SW path is purely additive).

## Security hardening — added 2026-07-29 after review (authorized, in scope)

Review (adversarial + security agents) refuted the first implementation. These fixes are
corrections to the behavior above, not new features:

- **Endpoint must be `https://`.** Any-scheme URLs let an authenticated user aim the recurring
  outbound sender anywhere (`http://` also puts the VAPID JWT on the wire in cleartext).
- **Per-user subscription cap** (constant, ~20). Unbounded rows let one user monopolize the cron.
- **Commit the DB transaction before the HTTP fan-out**; use a short fresh session for revocation
  deletes. Holding a write transaction across N blocking sends stalls the DB (SQLite: whole file).
- **Wrap the cron in `SkipIfStillRunning`** so an overrunning run can't overlap itself.
- **Never log push endpoint URLs** — they are bearer capability URLs, and `*url.Error` embeds the
  full URL on any transport failure. Log subscription id + error kind.
- **Last-sent count must round-trip on the Redis keyvalue backend** (store `int64`; the Redis
  backend gob-encodes strings, so the zero-count dedup was silently dead → a "nothing due"
  notification every interval, forever — the exact spam ADR-0010 exists to avoid).
- **Only record the last-sent count when at least one send succeeded.** Recording it after a total
  failure strands a stale badge that the dedup logic then suppresses forever.
- **`DeleteUser` must purge `push_subscriptions`** (erasure gap + a permanent per-interval error log).
- **SW must always `showNotification()`** — the two early `return`s on missing/unparseable payload
  are silent pushes, which is what gets iOS subscriptions revoked.
- **Do not echo `p256dh`/`auth` back** in the create response.
- **`log.Criticalf` + return, not `log.Fatalf`**, in the cron registrar (ADR-0005: config-driven
  crons fail soft).
- **Close the account-switch leak:** drop the device's push subscription on logout, so user A's
  task count can't render on user B's lock screen on a shared installed PWA.
- Frontend robustness: `onMounted(load)` needs a catch; guard `Number(stored)` → `NaN`; compare
  `applicationServerKey` against the current VAPID key before reusing a browser subscription;
  remove the unreachable `pushNotificationsUnsupported` branch.

## Audit must-fix — added 2026-07-31 (authorized, in scope)

The cold session audit refuted the branch. These five are required before merge; everything else it
raised stays deferred.

1. **`available` must be false when no service worker is registered.** Today `load()` sets
   `available` from the server's `enabled` flag and then returns early on a null registration,
   leaving it true — so `General.vue`'s `v-if="pushAvailable"` renders a toggle that fires a real OS
   permission prompt and then always throws. `registerServiceWorker.ts` registers only under
   `import.meta.env.PROD`, so this is **guaranteed** broken in `pnpm dev`, and reachable in
   production via the `window.load` race on a first visit. Spec §9 already requires the control be
   hidden when the browser lacks push support; a registration-less origin is exactly that.
2. **Reject malformed `p256dh`/`auth` at create time.** Nothing validates the key is a P-256 point.
   A garbage key fails encryption *before* any HTTP request, so it is never a 404/410, is never
   pruned, and logs an ERROR every interval forever — and with a single device `delivered == 0`, so
   the dedup never suppresses the retry. Validate on create (base64url decode + curve check for
   `p256dh`; decoded-length check for `auth`) and reject with a field-named 422.
3. **Validate the VAPID `sub` scheme, and fail loudly at registration.** `vapidSubscriber()` returns
   `service.publicurl` unchanged, and config permits `http://`. webpush-go then emits
   `sub: "mailto:http://…"`, which APNs rejects as a generic 403 per send — total silent failure
   with a log that points nowhere. Require `https:`; if it is unusable, refuse to register the cron
   with a Critical naming the config key (ADR-0005 fail-soft), rather than failing per send. The
   hardcoded `https://vikunja.io` fallback must go — it points a push service's operator-contact
   claim at the upstream project.
4. **Test the frontend lifecycle and the service worker.** `load()`, `subscribe()`, `available`, and
   `sw.ts`'s `push` handler have zero coverage, and that gap is exactly where every regression in
   this branch has landed. The `push`-event test must assert `showNotification` is called even for an
   empty/garbage payload — that is the load-bearing invariant of ADR-0010 (a push that shows nothing
   gets the subscription revoked on iOS).
5. **Drop `Urgency: UrgencyLow`.** ADR-0010's entire empirical basis is a spike that ran on the
   library default; shipping a delivery-affecting header the spike never exercised means the
   "12/12 accepted, zero revocations" evidence does not cover what ships. Reverting costs one line
   and restores agreement with the evidence. (Chosen over amending the ADR, which would weaken its
   evidence claim rather than honour it.)

## Deferred — needs Jason's decision (NOT in this change)

- **Provider allowlist** for push endpoints (`*.push.apple.com`, `fcm.googleapis.com`, …). The
  strongest SSRF fix, but it would break self-hosted UnifiedPush-style distributors — a product
  call, not a bug fix. `https://`-only + the SSRF-safe client is the interim posture.
- **`GET /api/v2/push-subscriptions`** (list your devices). Fixes "the toggle reflects browser
  state, not server ownership" properly and gives users a revocation inventory.
- **Endpoint-upsert ownership transfer semantics** — currently a duplicate endpoint is reassigned
  to the caller by design (shared-device UX). Alternative: delete + reinsert so the old owner's id
  404s instead of pointing at another user's row.
- **`pushsubscriptionchange` SW handler** — automatic re-subscribe after Apple revokes.

## Test approach

- `/tdd` at the seams: model CRUD + permissions (webtests, positive AND negative auth per repo rule);
  count-computation unit test (timezone boundary); send-path test with a fake push endpoint asserting
  payload shape, 410 → subscription pruned + warning logged.
- Routes: v2 webtests for subscribe/unsubscribe/public-key (401 unauthed, cross-user 403/404).
- Live-verify: real iPhone — subscribe from Settings, receive cron push, badge updates with surfaces
  muted; confirm revocation path by deleting the subscription server-side and observing the log.
