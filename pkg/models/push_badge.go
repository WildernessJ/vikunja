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
	"encoding/json"
	"io"
	"net/http"
	"strconv"
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
// service to reach whoever runs this instance. RFC 8292 accepts an https URL.
func vapidSubscriber() string {
	if publicURL := config.ServicePublicURL.GetString(); publicURL != "" {
		return publicURL
	}
	return "https://vikunja.io"
}

// SendBadgePush pushes the user's current due/overdue count to each of their
// registered devices. Deliberately independent of the mailer: push is its own
// transport and works on instances with mail switched off.
//
// Errors from individual sends are logged, not returned - one dead device must
// not stop the others from being refreshed.
func SendBadgePush(s *xorm.Session, userID int64) error {
	subs, err := getPushSubscriptionsForUser(s, userID)
	if err != nil {
		return err
	}
	if len(subs) == 0 {
		return nil
	}

	u, err := user.GetUserByID(s, userID)
	if err != nil {
		return err
	}

	count, err := getUserBadgeCount(s, u)
	if err != nil {
		return err
	}

	// Nothing due and nothing due last time either: the badge is already
	// correct, and iOS would surface a pointless notification for every push.
	if lastCount, known := getLastBadgeCount(userID); count == 0 && known && lastCount == 0 {
		return nil
	}

	payload, err := buildBadgePayload(count, u.Lang())
	if err != nil {
		return err
	}

	for _, sub := range subs {
		sendBadgePushToSubscription(s, sub, payload, count)
	}

	if err := setLastBadgeCount(userID, count); err != nil {
		log.Errorf("[Web Push] Could not remember the badge count sent to user %d: %s", userID, err)
	}

	return nil
}

func sendBadgePushToSubscription(s *xorm.Session, sub *PushSubscription, payload []byte, count int64) {
	res, err := webpush.SendNotification(payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256dh,
			Auth:   sub.Auth,
		},
	}, &webpush.Options{
		HTTPClient:      getPushHTTPClient(),
		Subscriber:      vapidSubscriber(),
		VAPIDPublicKey:  config.WebPushPublicKey.GetString(),
		VAPIDPrivateKey: config.WebPushPrivateKey.GetString(),
		TTL:             badgePushTTLSeconds,
		Urgency:         webpush.UrgencyLow,
	})
	if err != nil {
		log.Errorf("[Web Push] Could not send badge push to subscription %d of user %d: %s", sub.ID, sub.UserID, err)
		return
	}
	defer func() {
		_, _ = io.Copy(io.Discard, res.Body)
		_ = res.Body.Close()
	}()

	// The push service is the only authority on whether a subscription is still
	// live; 404/410 mean the browser dropped it and it will never work again.
	if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusGone {
		log.Warningf("[Web Push] Subscription %d of user %d was revoked by the push service (HTTP %d), deleting it", sub.ID, sub.UserID, res.StatusCode)
		if _, err := s.Where("id = ?", sub.ID).Delete(&PushSubscription{}); err != nil {
			log.Errorf("[Web Push] Could not delete revoked subscription %d of user %d: %s", sub.ID, sub.UserID, err)
		}
		return
	}

	if res.StatusCode >= http.StatusMultipleChoices {
		log.Errorf("[Web Push] Push service rejected subscription %d of user %d with HTTP %d", sub.ID, sub.UserID, res.StatusCode)
		return
	}

	log.Debugf("[Web Push] Sent badge count %d to subscription %d of user %d (HTTP %d)", count, sub.ID, sub.UserID, res.StatusCode)
}

func lastBadgeCountKey(userID int64) string {
	return lastBadgeCountKeyPrefix + strconv.FormatInt(userID, 10)
}

// Stored as a string because the redis backend hands values back as strings
// while the memory one returns whatever was put in.
func getLastBadgeCount(userID int64) (count int64, known bool) {
	value, exists, err := keyvalue.Get(lastBadgeCountKey(userID))
	if err != nil {
		log.Errorf("[Web Push] Could not read the last badge count of user %d: %s", userID, err)
		return 0, false
	}
	if !exists {
		return 0, false
	}

	stored, is := value.(string)
	if !is {
		return 0, false
	}
	count, err = strconv.ParseInt(stored, 10, 64)
	if err != nil {
		return 0, false
	}
	return count, true
}

func setLastBadgeCount(userID, count int64) error {
	return keyvalue.Put(lastBadgeCountKey(userID), strconv.FormatInt(count, 10))
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
		log.Warning("[Web Push] webpush.enabled is set but no VAPID key pair is configured, not sending badge pushes. Generate one with `vikunja webpush-keys`.")
		return
	}

	err := cron.Schedule("@every "+badgePushInterval().String(), func() {
		s := db.NewSession()
		defer s.Close()

		userIDs, err := getUserIDsWithPushSubscriptions(s)
		if err != nil {
			log.Errorf("[Web Push] Could not load the users with push subscriptions: %s", err)
			return
		}

		if len(userIDs) == 0 {
			return
		}

		log.Debugf("[Web Push] Refreshing the badge count of %d users", len(userIDs))

		for _, userID := range userIDs {
			if err := SendBadgePush(s, userID); err != nil {
				log.Errorf("[Web Push] Could not send the badge push to user %d: %s", userID, err)
			}
		}

		if err := s.Commit(); err != nil {
			log.Errorf("[Web Push] Could not commit: %s", err)
		}
	})
	if err != nil {
		log.Fatalf("Could not register web push badge cron: %s", err)
	}
}
