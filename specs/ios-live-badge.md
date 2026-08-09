# iOS live overdue/due badge — scoping & decision record

**STATUS: spike PASSED → option A decided (2026-07-27).** 12/12 sends HTTP 201 over ~30h (2026-07-26 14:15 → 2026-07-27 20:29 UTC), no `REVOKED`, subscription survived container restarts, and Jason confirmed on-device that the badge tracks the latest send with banners suppressed — through a flight window included. Per the pre-agreed decision rule, the outcome is **option A: build the real Vikunja Web Push stack** (badges-only mute config). Implementation not yet started. Captured 2026-07-12; addendum 2026-07-26; verdict 2026-07-27.

## Addendum 2026-07-26 — research + on-device spike

Two researcher passes (WebKit source + docs + empirical sweep) established:

- **No silent badge-only push exists on ANY path.** Classic Web Push requires `showNotification()` per push (revocation after ~3 silent pushes). **Declarative Web Push (iOS 18.4+) is NOT an escape hatch:** its `notification` member is required (`NotificationJSONParser.cpp` returns `SyntaxError` without it); a badge-only payload fails parsing, falls through to the legacy path, and counts toward the silent-push penalty. Badge is delivered *as part of* the notification (`UNMutableNotificationContent.badge`).
- **The badges-only mute workaround is mechanistically sound but empirically unverified.** WebKit's revocation check (`WebPushDaemon.mm didShowNotification`) fires when `UNUserNotificationCenter` *accepts* the notification request, not when it's *presented*; per-surface iOS settings suppress display, not scheduling. So: Allow Notifications ON + all surfaces OFF + Badges ON should keep delivery alive with an effectively silent badge. Zero public reports of anyone testing this — hence the spike.
- Per-device manual Settings config was "unshippable" for a product; irrelevant for this personal fork.
- If building later: VAPID keys must stay stable (rotation kills subscriptions); `web.push.apple.com` returns 404/410 on revocation — prune/log.

**Spike deployed 2026-07-26:** minimal PWA + push server at `https://badge.home.holdy.org` (Unraid, compose project `badge-spike`, SWAG conf `badge.subdomain.conf`, files in `~/Github`-adjacent `docker-compose/badge-spike/`). Auto-push every 3h, badge cycles 1–9, 24h TTL, send results logged (`/api/status`; 404/410 → `REVOKED`). Early result: **muted badge-only updates confirmed working** on-device (banner suppressed, badge updates). Decisive: ~10 clean sends over 48h with the badge still moving. Airplane-mode gaps don't count against subscription health (penalty requires a *delivered* push the SW mishandles); Apple typically delivers only the most recent queued push on reconnect.

## Goal

Show an iOS app-icon **badge** with a count of overdue + due-today tasks, kept up to date in the **background** (while the app is closed). Count source already exists: `ProjectTaskCount.DueOverdue` (`pkg/models/project_counts.go:30,40`), surfaced to the frontend as `todayTotal` (`frontend/src/stores/projectCounts.ts:11`).

## What already exists

- **Foreground badge works today.** `frontend/src/composables/useAppBadge.ts` watches `todayTotal` and calls the Web Badging API (`navigator.setAppBadge()`) for installed PWAs, and `window.vikunjaDesktop.setBadgeCount()` for the Electron desktop wrapper. It only recomputes **while the app is open** — accurate on open, frozen when closed.
- **No web-push infrastructure anywhere.** Confirmed: backend has no VAPID/subscriptions/push transport; frontend SW (`frontend/src/sw.ts`) has only `message` + `notificationclick` handlers, no `push`; nothing requests Notification permission.

## The hard platform constraints (both are load-bearing)

### 1. iOS forbids a *silent* badge update
Every Web Push `push` event on iOS **must** show a user-visible notification via `showNotification()`. A badge-only update does not satisfy this, and violating the `userVisibleOnly` promise gets the subscription **revoked**.
> "a badge update by itself does not fulfill the 'user visible' requirement; Keep showing those notifications!" — https://webkit.org/blog/14112/badging-for-home-screen-web-apps/
> "Violations of the userVisibleOnly promise will result in a push subscription being revoked." — https://webkit.org/blog/12945/meet-web-push/

**Consequence:** on iOS, a live background badge is inseparable from a visible notification per update. There is no quiet-badge option. (Android/desktop PWAs *do* allow silent badge-only push.)

- Baseline: iOS/iPadOS **16.4+**, and only for apps **added to the Home Screen**.
- Badge only renders if the user has granted **Notification permission**; permission request must be **user-gesture-initiated**.

### 2. A native app doesn't escape this — it hits a *different* wall
Building our own native iOS app with a **free Apple ID** (Personal Team, no $99/yr) is possible but:
- **Remote push (APNs) requires the paid $99/yr Apple Developer Program.** Confirmed by Apple DTS on the developer forums (Jan 2026): "Personal development teams do not support the Push Notifications and iCloud capabilities." — https://developer.apple.com/forums/thread/811929
- Without APNs, the only free-tier background mechanism is **BGTaskScheduler / Background App Refresh** — explicitly best-effort, OS-scheduled, "can be delayed by hours or skipped entirely." Not a reliable live badge.
- **7-day code-signing expiry** — free-provisioned apps stop opening after 7 days and must be re-signed/redeployed via Xcode (AltStore/Sideloadly can automate the refresh if a helper runs on the same network). — https://developer.apple.com/support/compare-memberships/
- Free tier: **no App Store, no TestFlight, no ad-hoc distribution**; max 10 App IDs and 3 devices, each expiring in 7 days.

## The comparison that drives the decision

| Path | Truly live background badge? | Apple $99/yr needed? | Notification per update? | Install / distribution | Build cost |
|---|---|---|---|---|---|
| **PWA + Web Push** (scoped below) | **Yes** | **No** — Web Push uses our own VAPID keys, not an Apple dev account | **Yes** — mandatory on iOS | Add to Home Screen, free, instant | Backend-heavy, one stack |
| **Native, free Apple ID** | No — BGTaskScheduler only, unreliable | No | No (but no live badge either) | 7-day expiry, re-sign, own devices only | A whole separate Swift app |
| **Native, paid $99/yr** | Yes (APNs), silent badge possible | **Yes** | Optional | App Store/TestFlight | Separate Swift app **+** APNs |

**Punchline:** the PWA + Web Push path is the *only* way to get a genuinely live background badge on iOS **without paying Apple $99/yr** — and it reuses the frontend we already ship. A free native app cannot deliver a reliable live badge at all. A paid native app can do a *silent* badge but costs $99/yr and is far more work (separate app + APNs). So "build our own iOS app" does not dodge the notification-vs-badge tradeoff; it either can't do the job (free) or costs money and more effort (paid).

## Scope of the PWA + Web Push feature (the iOS-viable option)

Feature really is *"push notifications for due/overdue tasks, carrying the badge count"* — notification and badge are a package on iOS.

**Backend (Go) — all net-new:**
1. VAPID config keys (`webpush.*` in `pkg/config/config.go`) + a CLI command to generate a **stable** keypair (rotating kills all subscriptions).
2. Add a web-push Go library (e.g. `SherClockHolmes/webpush-go`).
3. `PushSubscription` model (user_id, endpoint, p256dh, auth) → invoke **migration** + **crudable** skills.
4. v2 subscribe/unsubscribe endpoints on `/api/v2` → invoke **api-v2-routes** skill.
5. Send path + trigger: hook `TaskOverdueEvent` / the overdue-reminder cron (`pkg/models/task_overdue_reminder.go:125`); payload carries the fresh per-user `DueOverdue` total. Prune subs on HTTP 410.
6. Notification text via `pkg/i18n` (en.json only).

**Frontend (Vue/PWA):**
7. SW `push` handler in `src/sw.ts`: `showNotification()` (mandatory) **and** `setAppBadge(count)`; reuse `notificationclick` for deep-link.
8. Subscription flow: request Notification permission on user gesture, `pushManager.subscribe()` with VAPID public key, POST to backend; unsubscribe path.
9. Settings toggle; fetch VAPID public key from a backend info endpoint; i18n strings.

**Cross-cutting:** backend webtests (subscribe/unsubscribe + negative auth), send-logic test, translations flagged per the repo workflow. `useAppBadge` stays as the foreground path; SW is purely additive.

## "Can option A work if I just disable notifications?" — no

The badge on iOS is *downstream* of notifications; you can't keep one without the other.

- **App sends silent push (badge-only, no `showNotification`)** → iOS **revokes the push subscription** (`userVisibleOnly` violation). Works for a few pushes, then Apple cuts delivery. Dead.
- **Never grant Notification permission** → can't subscribe to push at all on iOS (subscription is gated behind notification permission), so no background wake — and the badge won't render anyway ("the badge will only appear if the user has granted notifications permission", WebKit 14112). Dead both ways.
- **Only near-miss (user-side, not shippable):** keep notifications *permitted* and the app still calls `showNotification()`, but the user manually strips presentation in iOS Settings → the web app → Banners/Sounds/Lock Screen/Notification Center **off**, **Badges on**. Effectively a silent badge bump. Caveats: it's per-device manual config the PWA can't control; **unverified** whether iOS keeps push delivery alive with all surfaces but badges disabled (could treat as effectively-off); each push may still land a record in Notification Center unless that's off too.

Bottom line: you cannot *design* A to be notification-free. Best achievable is "a notification you've muted down to just the badge," and only if iOS cooperates with that stripped state. **Open question worth a research pass before committing to A:** does iOS keep web-push delivery alive when a home-screen web app's notifications are set to badges-only?

## Decision needed before writing a real spec

- **(A) Accept a visible notification per badge update** → build the PWA + Web Push stack above. Live iOS badge, no Apple fee. For overdue tasks, a notification is arguably desirable anyway.
- **(B) Notifications unacceptable** → iOS badge stays foreground-only (today's behavior). Optionally add silent badge-only push for Android/desktop PWAs only (narrower, probably not worth the infra).
- **(C) Native app** → free tier can't do a reliable live badge; paid ($99/yr) can do a silent badge but is a separate Swift app + APNs. Only worth it if a native app is wanted for reasons beyond the badge.

Recommendation: if a live iOS badge is genuinely wanted, **(A)** is the only sane path — it's cheapest (no Apple fee), reuses the shipped frontend, and the "spam" is just overdue-task alerts you'd plausibly want. Not writing the spec until this is chosen.
