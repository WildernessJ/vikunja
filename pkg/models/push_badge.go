// Vikunja is a to-do list application to facilitate your life.
// Copyright 2018-present Vikunja and contributors. All rights reserved.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package models

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/cron"
	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/i18n"
	"code.vikunja.io/api/pkg/log"
	"code.vikunja.io/api/pkg/modules/keyvalue"
	"code.vikunja.io/api/pkg/user"
	"code.vikunja.io/api/pkg/utils"

	webpush "github.com/SherClockHolmes/webpush-go"
	"xorm.io/xorm"
)

const (
	// badgePushType tags the payload so the service worker can tell badge
	// refreshes apart from any future push kind.
	badgePushType = "badge-count"

	// A badge refresh is worthless once the next one is due, but the device may
	// be offline for a while; a day is the longest it stays useful.
	badgePushTTLSeconds = 24 * 60 * 60

	lastBadgeCountKeyPrefix = "webpush_last_badge_count_"

	defaultBadgeInterval = 3 * time.Hour
)

// badgePushPayload is the service worker's contract (see frontend/src/sw.ts).
// Keys are camelCase to match the browser-side Notification/Badging APIs the
// worker feeds them into, not the snake_case used on the REST surface.
type badgePushPayload struct {
	Title      string `json:"title"`
	Body       string `json:"body"`
	BadgeCount int64  `json:"badgeCount"`
	Type       string `json:"type"`
}

// pushHTTPClient is nil until first use; tests replace it to intercept sends.
// Guarded because overlapping cron runs would otherwise race on the lazy init.
var (
	pushHTTPClientMu sync.Mutex
	pushHTTPClient   webpush.HTTPClient
)

// User-supplied endpoints are an SSRF vector, so pushes go out through the
// same guarded client webhooks use.
func getPushHTTPClient() webpush.HTTPClient {
	pushHTTPClientMu.Lock()
	defer pushHTTPClientMu.Unlock()

	if pushHTTPClient == nil {
		pushHTTPClient = utils.NewSSRFSafeHTTPClient()
	}
	return pushHTTPClient
}

// getUserBadgeCount totals the user's due-or-overdue tasks across every project
// they can read, reusing GetProjectTaskCounts so the pushed number can never
// disagree with the sidebar badge or the statistics page.
func getUserBadgeCount(s *xorm.Session, u *user.User) (int64, error) {
	counts, err := GetProjectTaskCounts(s, u)
	if err != nil {
		return 0, err
	}

	var total int64
	for _, c := range counts {
		total += c.DueOverdue
	}
	return total, nil
}

func buildBadgePayload(count int64, lang string) ([]byte, error) {
	return json.Marshal(&badgePushPayload{
		Title:      i18n.T(lang, "notifications.push.badge.title"),
		Body:       i18n.TP(lang, "notifications.push.badge.body", count, count),
		BadgeCount: count,
		Type:       badgePushType,
	})
}

// vapidSubscriber is the `sub` claim of the VAPID JWT: a way for the push
// service to reach whoever runs this instance. RFC 8292 accepts an https URL,
// and only that - webpush-go prefixes anything else with `mailto:`, so an
// http:// public URL goes out as `sub: "mailto:http://…"` and every send comes
// back as a bare 403 the log cannot explain. There is deliberately no fallback:
// a default would claim vikunja.io's operators as the contact for this
// instance's pushes.
func vapidSubscriber() (string, error) {
	publicURL := config.ServicePublicURL.GetString()
	if publicURL == "" {
		return "", fmt.Errorf("%s is not set", config.ServicePublicURL)
	}

	parsed, err := url.Parse(publicURL)
	if err != nil {
		return "", fmt.Errorf("%s is not a valid URL: %w", config.ServicePublicURL, err)
	}
	if !strings.EqualFold(parsed.Scheme, "https") {
		return "", fmt.Errorf("%s must be an https:// URL", config.ServicePublicURL)
	}

	return publicURL, nil
}

// WebPushDeliverable reports whether a badge push could actually reach a device:
// the feature switched on, a VAPID key pair present, and a usable subscriber
// claim. The cron refuses to register without all three, so the client-facing
// surface has to answer the same question — otherwise an instance with, say, an
// http:// public URL still invites devices to subscribe to a channel that can
// never send, which looks to the user like push is simply broken.
func WebPushDeliverable() bool {
	if !config.WebPushEnabled.GetBool() {
		return false
	}

	if config.WebPushPublicKey.GetString() == "" || config.WebPushPrivateKey.GetString() == "" {
		return false
	}

	_, err := vapidSubscriber()
	return err == nil
}

// badgePushJob is everything one user's fan-out needs, read up front so the
// blocking sends can happen with no database transaction open.
type badgePushJob struct {
	userID  int64
	count   int64
	payload []byte
	subs    []*PushSubscription
}

// badgePushResult is what the fan-out learned and the database still has to be
// told about. Revocations carry the whole subscription, not just its id: by the
// time they are written back the row may be a different one.
type badgePushResult struct {
	delivered int
	revoked   []*PushSubscription
}

type pushSendOutcome int

const (
	pushFailed pushSendOutcome = iota
	pushDelivered
	pushRevoked
)

// collectBadgePush gathers everything needed to refresh a user's badge, or
// returns a nil job when there is nothing worth sending.
func collectBadgePush(s *xorm.Session, userID int64) (*badgePushJob, error) {
	subs, err := getPushSubscriptionsForUser(s, userID)
	if err != nil {
		return nil, err
	}
	if len(subs) == 0 {
		return nil, nil
	}

	u, err := user.GetUserByID(s, userID)
	if err != nil {
		return nil, err
	}

	count, err := getUserBadgeCount(s, u)
	if err != nil {
		return nil, err
	}

	// Nothing due and nothing due last time either: the badge is already
	// correct, and iOS would surface a pointless notification for every push.
	if lastCount, known := getLastBadgeCount(userID); count == 0 && known && lastCount == 0 {
		return nil, nil
	}

	payload, err := buildBadgePayload(count, u.Lang())
	if err != nil {
		return nil, err
	}

	return &badgePushJob{userID: userID, count: count, payload: payload, subs: subs}, nil
}

// deliverBadgePush does the blocking network work. It deliberately takes no
// session: a push service can take seconds per device, and a transaction held
// across that stalls every other writer (on SQLite, the whole database).
func deliverBadgePush(job *badgePushJob) (res badgePushResult) {
	for _, sub := range job.subs {
		switch sendBadgePushToSubscription(sub, job.payload, job.count) {
		case pushDelivered:
			res.delivered++
		case pushRevoked:
			res.revoked = append(res.revoked, sub)
		case pushFailed:
		}
	}
	return res
}

// applyBadgePushResult writes back what the fan-out found: revoked devices go
// away, and the count is remembered only if a device actually got it.
func applyBadgePushResult(s *xorm.Session, job *badgePushJob, res badgePushResult) error {
	for _, sub := range res.revoked {
		// Matching the whole channel, not just the id: nothing was locked while
		// the push was in flight, so the row may since have been re-registered
		// (PushSubscription.Create upserts in place and keeps the id, and the id
		// itself can be reused after a delete). Only the channel the push
		// service actually rejected may go - a fresh registration is not covered
		// by a revocation of what used to be there.
		_, err := s.
			Where("id = ? AND user_id = ? AND endpoint = ? AND p256dh = ? AND auth = ?",
				sub.ID, sub.UserID, sub.Endpoint, sub.P256dh, sub.Auth).
			Delete(&PushSubscription{})
		if err != nil {
			return fmt.Errorf("could not delete revoked push subscription %d: %w", sub.ID, err)
		}
	}

	// Only a delivered push moves a badge, so only a delivered push may update
	// what we believe the devices are showing. Remembering a count nothing
	// received would let the zero-count skip suppress the retry forever.
	if res.delivered == 0 {
		return nil
	}

	if err := setLastBadgeCount(job.userID, job.count); err != nil {
		log.Errorf("[Web Push] Could not remember the badge count sent to user %d: %s", job.userID, err)
	}
	return nil
}

// sendBadgePushForUser pushes the user's current due/overdue count to each of
// their registered devices. Deliberately independent of the mailer: push is its
// own transport and works on instances with mail switched off.
//
// It runs in three phases - read, send, write back - each database phase in its
// own short-lived session and the sends in none at all, so a slow push service
// can never hold a transaction open (on SQLite that would lock the whole file).
func sendBadgePushForUser(userID int64) {
	var job *badgePushJob
	err := inShortSession(func(s *xorm.Session) (err error) {
		job, err = collectBadgePush(s, userID)
		return err
	})
	if err != nil {
		log.Errorf("[Web Push] Could not prepare the badge push for user %d: %s", userID, err)
		return
	}
	if job == nil {
		return
	}

	res := deliverBadgePush(job)

	err = inShortSession(func(s *xorm.Session) error {
		return applyBadgePushResult(s, job, res)
	})
	if err != nil {
		log.Errorf("[Web Push] Could not record the badge push result for user %d: %s", userID, err)
	}
}

func inShortSession(fn func(s *xorm.Session) error) error {
	s := db.NewSession()
	defer s.Close()

	if err := fn(s); err != nil {
		_ = s.Rollback()
		return err
	}
	return s.Commit()
}

func sendBadgePushToSubscription(sub *PushSubscription, payload []byte, count int64) pushSendOutcome {
	subscriber, err := vapidSubscriber()
	if err != nil {
		log.Errorf("[Web Push] Could not send badge push to subscription %d of user %d: %s", sub.ID, sub.UserID, err)
		return pushFailed
	}

	res, err := webpush.SendNotification(payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256dh,
			Auth:   sub.Auth,
		},
	}, &webpush.Options{
		HTTPClient:      getPushHTTPClient(),
		Subscriber:      subscriber,
		VAPIDPublicKey:  config.WebPushPublicKey.GetString(),
		VAPIDPrivateKey: config.WebPushPrivateKey.GetString(),
		TTL:             badgePushTTLSeconds,
	})
	if err != nil {
		log.Errorf("[Web Push] Could not send badge push to subscription %d of user %d: %s", sub.ID, sub.UserID, pushErrorKind(err))
		return pushFailed
	}
	defer func() {
		_, _ = io.Copy(io.Discard, res.Body)
		_ = res.Body.Close()
	}()

	// The push service is the only authority on whether a subscription is still
	// live; 404/410 mean the browser dropped it and it will never work again.
	if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusGone {
		log.Warningf("[Web Push] Subscription %d of user %d was revoked by the push service (HTTP %d), deleting it", sub.ID, sub.UserID, res.StatusCode)
		return pushRevoked
	}

	if res.StatusCode >= http.StatusMultipleChoices {
		log.Errorf("[Web Push] Push service rejected subscription %d of user %d with HTTP %d", sub.ID, sub.UserID, res.StatusCode)
		return pushFailed
	}

	log.Debugf("[Web Push] Sent badge count %d to subscription %d of user %d (HTTP %d)", count, sub.ID, sub.UserID, res.StatusCode)
	return pushDelivered
}

// pushErrorKind reduces a send failure to something safe to log. A push
// endpoint is a bearer capability - whoever reads it can push to that device -
// and every transport failure arrives wrapped in a *url.Error carrying the full
// URL, so the error must never be logged verbatim. Errors from below the
// transport are reported by kind only, for the same reason.
func pushErrorKind(err error) string {
	var urlErr *url.Error
	if !errors.As(err, &urlErr) {
		// Failures before the request exists (payload encryption, VAPID
		// signing) have no endpoint in them and are the ones worth reading.
		return err.Error()
	}

	inner := urlErr.Err
	switch {
	case urlErr.Timeout():
		return "the push service did not answer in time"
	case errors.Is(inner, context.Canceled):
		return "the request was cancelled"
	}

	var dnsErr *net.DNSError
	if errors.As(inner, &dnsErr) {
		return "the push service host could not be resolved"
	}
	var certErr *tls.CertificateVerificationError
	if errors.As(inner, &certErr) {
		return "the push service TLS certificate could not be verified"
	}
	return fmt.Sprintf("the request to the push service failed (%T)", inner)
}

func lastBadgeCountKey(userID int64) string {
	return lastBadgeCountKeyPrefix + strconv.FormatInt(userID, 10)
}

func getLastBadgeCount(userID int64) (count int64, known bool) {
	value, exists, err := keyvalue.Get(lastBadgeCountKey(userID))
	if err != nil {
		log.Errorf("[Web Push] Could not read the last badge count of user %d: %s", userID, err)
		return 0, false
	}
	if !exists {
		return 0, false
	}

	return parseLastBadgeCount(value)
}

// parseLastBadgeCount normalises the two shapes the backends hand an integer
// back as: the memory store returns the int64 it was given, redis returns its
// decimal string (pkg/modules/keyvalue/redis/redis.go).
func parseLastBadgeCount(value interface{}) (count int64, known bool) {
	switch v := value.(type) {
	case int64:
		return v, true
	case string:
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

// setLastBadgeCount must hand keyvalue an integer type: the redis backend
// stores those raw and gob-encodes everything else, and gob bytes are not
// something Get can hand back as a readable value.
func setLastBadgeCount(userID, count int64) error {
	return keyvalue.Put(lastBadgeCountKey(userID), count)
}

func forgetLastBadgeCount(userID int64) error {
	return keyvalue.Del(lastBadgeCountKey(userID))
}

func badgePushInterval() time.Duration {
	raw := config.WebPushBadgeInterval.GetString()
	interval, err := time.ParseDuration(raw)
	if err != nil || interval <= 0 {
		log.Warningf("[Web Push] Invalid %s value %q, falling back to %s", config.WebPushBadgeInterval, raw, defaultBadgeInterval)
		return defaultBadgeInterval
	}
	return interval
}

// RegisterBadgePushCron registers the job which periodically refreshes the
// app-icon badge of every device with a push subscription.
func RegisterBadgePushCron() {
	if !config.WebPushEnabled.GetBool() {
		return
	}

	if config.WebPushPublicKey.GetString() == "" || config.WebPushPrivateKey.GetString() == "" {
		log.Critical("[Web Push] webpush.enabled is set but no VAPID key pair is configured, not sending badge pushes. Generate one with `vikunja webpush-keys`.")
		return
	}

	// Every send signs a VAPID JWT with this as its `sub` claim, so an unusable
	// value is a guaranteed rejection on every push, forever. Better to say so
	// once, here, than to register a cron that logs the same 403 every interval.
	if _, err := vapidSubscriber(); err != nil {
		log.Criticalf("[Web Push] %s, so the VAPID subscriber cannot be built and no badge push could be delivered. Set service.publicurl to this instance's https:// URL.", err)
		return
	}

	// The runtime grows with the number of devices and with how fast the push
	// services answer, so it is not bounded by the interval: without skipping, a
	// slow run would be joined by the next one pushing the same counts again.
	err := cron.ScheduleWithoutOverlap("@every "+badgePushInterval().String(), runBadgePushCron)
	if err != nil {
		// ADR-0005: the schedule comes from operator config, so a bad value
		// disables badge pushes rather than taking the instance down.
		log.Criticalf("[Web Push] Could not register the badge push cron (webpush.badgeinterval), badge pushes are disabled: %s", err)
	}
}

func runBadgePushCron() {
	var userIDs []int64
	err := inShortSession(func(s *xorm.Session) (err error) {
		userIDs, err = getUserIDsWithPushSubscriptions(s)
		return err
	})
	if err != nil {
		log.Errorf("[Web Push] Could not load the users with push subscriptions: %s", err)
		return
	}

	if len(userIDs) == 0 {
		return
	}

	log.Debugf("[Web Push] Refreshing the badge count of %d users", len(userIDs))

	for _, userID := range userIDs {
		sendBadgePushForUser(userID)
	}
}
