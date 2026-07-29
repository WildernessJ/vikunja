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
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/log"
	"code.vikunja.io/api/pkg/user"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"xorm.io/xorm"
)

// fakePushService stands in for the browser vendor's push endpoint. Injecting
// it at the HTTPClient seam keeps the real payload encryption in the path, so
// the test exercises everything except the network hop.
type fakePushService struct {
	status   int
	requests []*http.Request
}

func (f *fakePushService) Do(req *http.Request) (*http.Response, error) {
	f.requests = append(f.requests, req)
	return &http.Response{
		StatusCode: f.status,
		Body:       io.NopCloser(strings.NewReader("")),
		Header:     http.Header{},
		Request:    req,
	}, nil
}

// newTestSubscriptionKeys returns a p256dh/auth pair the webpush library can
// actually encrypt against, so a bad key never passes silently.
func newTestSubscriptionKeys(t *testing.T) (p256dh, auth string) {
	t.Helper()
	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	require.NoError(t, err)
	authSecret := make([]byte, 16)
	_, err = rand.Read(authSecret)
	require.NoError(t, err)
	return base64.RawURLEncoding.EncodeToString(priv.PublicKey().Bytes()),
		base64.RawURLEncoding.EncodeToString(authSecret)
}

// setupWebPush points the send path at a fake push service and gives it a
// usable VAPID pair, restoring both afterwards.
func setupWebPush(t *testing.T, status int) *fakePushService {
	t.Helper()

	private, public, err := webpush.GenerateVAPIDKeys()
	require.NoError(t, err)

	config.WebPushEnabled.Set(true)
	config.WebPushPublicKey.Set(public)
	config.WebPushPrivateKey.Set(private)
	config.ServicePublicURL.Set("https://vikunja.example.com/")

	fake := &fakePushService{status: status}
	setPushHTTPClient(fake)

	t.Cleanup(func() {
		setPushHTTPClient(nil)
		config.WebPushEnabled.Set(false)
		config.WebPushPublicKey.Set("")
		config.WebPushPrivateKey.Set("")
		config.ServicePublicURL.Set("")
	})

	return fake
}

func setPushHTTPClient(client webpush.HTTPClient) {
	pushHTTPClientMu.Lock()
	defer pushHTTPClientMu.Unlock()
	pushHTTPClient = client
}

// captureLogs redirects the global logger to a file and returns a reader for it.
func captureLogs(t *testing.T) func() string {
	t.Helper()
	dir := t.TempDir()
	log.ConfigureStandardLogger(true, "file", dir, "DEBUG", "text")
	t.Cleanup(log.InitLogger)

	return func() string {
		content, err := os.ReadFile(filepath.Join(dir, "standard.log"))
		require.NoError(t, err)
		return string(content)
	}
}

func mustInsertPushSubscription(t *testing.T, s *xorm.Session, userID int64, endpoint string) {
	t.Helper()
	p256dh, auth := newTestSubscriptionKeys(t)
	sub := &PushSubscription{UserID: userID, Endpoint: endpoint, P256dh: p256dh, Auth: auth}
	_, err := s.Insert(sub)
	require.NoError(t, err)
}

// badgeCountUser is the fixture user the badge-count assertions run against.
var badgeCountUser = &user.User{ID: 1}

func retimeBadgeCountUser(t *testing.T, s *xorm.Session, tz string) {
	t.Helper()
	_, err := s.Where("id = ?", badgeCountUser.ID).Cols("timezone").Update(&user.User{Timezone: tz})
	require.NoError(t, err)
}

// TestGetUserBadgeCount pins the boundary the badge count shares with the
// sidebar badge: start-of-tomorrow in the user's own timezone. The same task
// is therefore inside one user's window and outside another's.
func TestGetUserBadgeCount(t *testing.T) {
	s := db.NewSession()
	defer s.Close()
	db.LoadAndAssertFixtures(t)

	project := mustInsertStatsProject(t, s, "badge count project", 1)

	// Both baselines have to be taken before inserting, because fixture tasks
	// can also fall between the two timezones' boundaries.
	retimeBadgeCountUser(t, s, "UTC")
	baselineUTC, err := getUserBadgeCount(s, badgeCountUser)
	require.NoError(t, err)

	retimeBadgeCountUser(t, s, "America/Los_Angeles")
	baselineLA, err := getUserBadgeCount(s, badgeCountUser)
	require.NoError(t, err)

	utcBoundary := startOfTomorrowAt(time.Now(), time.UTC)
	mustInsertStatsTask(t, s, project.ID, 1, 1, false, time.Time{}, utcBoundary.Add(-time.Hour))
	mustInsertStatsTask(t, s, project.ID, 2, 1, false, time.Time{}, utcBoundary.Add(time.Hour))

	retimeBadgeCountUser(t, s, "UTC")
	afterUTC, err := getUserBadgeCount(s, badgeCountUser)
	require.NoError(t, err)
	assert.Equal(t, baselineUTC+1, afterUTC,
		"for a UTC user only the task due before start-of-tomorrow UTC counts")

	// America/Los_Angeles runs 7-8h behind UTC, so its start-of-tomorrow lands
	// hours after the UTC one and both tasks fall inside the window.
	retimeBadgeCountUser(t, s, "America/Los_Angeles")
	afterLA, err := getUserBadgeCount(s, badgeCountUser)
	require.NoError(t, err)
	assert.Equal(t, baselineLA+2, afterLA,
		"for a user behind UTC both tasks are still due before their start-of-tomorrow")
}

func TestBuildBadgePayload(t *testing.T) {
	t.Run("shape", func(t *testing.T) {
		payload, err := buildBadgePayload(3, "en")
		require.NoError(t, err)

		var decoded map[string]any
		require.NoError(t, json.Unmarshal(payload, &decoded))

		assert.Equal(t, []string{"badgeCount", "body", "title", "type"}, sortedKeys(decoded),
			"the service worker contract is exactly these four keys")
		assert.InDelta(t, float64(3), decoded["badgeCount"], 0)
		assert.Equal(t, badgePushType, decoded["type"])
		assert.NotEmpty(t, decoded["title"])
		assert.NotEmpty(t, decoded["body"])
	})
	t.Run("body is translated and pluralized", func(t *testing.T) {
		none, err := buildBadgePayload(0, "en")
		require.NoError(t, err)
		one, err := buildBadgePayload(1, "en")
		require.NoError(t, err)
		many, err := buildBadgePayload(5, "en")
		require.NoError(t, err)

		var n, o, m badgePushPayload
		require.NoError(t, json.Unmarshal(none, &n))
		require.NoError(t, json.Unmarshal(one, &o))
		require.NoError(t, json.Unmarshal(many, &m))

		assert.NotEqual(t, o.Body, m.Body, "singular and plural must differ")
		assert.NotEqual(t, n.Body, o.Body, "the zero case must have its own wording")
		assert.Contains(t, m.Body, "5")
		// A missing translation makes i18n echo the key back.
		assert.NotContains(t, m.Body, "notifications.")
	})
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

func TestBadgePushInterval(t *testing.T) {
	for _, tc := range []struct {
		configured string
		expected   time.Duration
	}{
		{"3h", 3 * time.Hour},
		{"30m", 30 * time.Minute},
		{"", defaultBadgeInterval},
		{"nonsense", defaultBadgeInterval},
		{"0s", defaultBadgeInterval},
		{"-1h", defaultBadgeInterval},
	} {
		t.Run(tc.configured, func(t *testing.T) {
			config.WebPushBadgeInterval.Set(tc.configured)
			t.Cleanup(func() { config.WebPushBadgeInterval.Set("3h") })

			assert.Equal(t, tc.expected, badgePushInterval())
		})
	}
}

func TestSendBadgePush(t *testing.T) {
	t.Run("sends to every subscription of the user", func(t *testing.T) {
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)
		fake := setupWebPush(t, http.StatusCreated)
		clearLastBadgeCount(t, 1)

		require.NoError(t, SendBadgePush(s, 1))

		require.Len(t, fake.requests, 2, "user 1 has two subscriptions in the fixtures")
		endpoints := []string{fake.requests[0].URL.String(), fake.requests[1].URL.String()}
		assert.ElementsMatch(t, []string{
			"https://push.example.com/subscription-user1-a",
			"https://push.example.com/subscription-user1-b",
		}, endpoints)

		for _, req := range fake.requests {
			assert.Equal(t, "86400", req.Header.Get("TTL"), "TTL must be 24h")
			assert.Equal(t, "aes128gcm", req.Header.Get("Content-Encoding"))
			assert.NotEmpty(t, req.Header.Get("Authorization"), "the VAPID header must be signed")
		}
	})

	t.Run("410 Gone prunes the subscription and logs a warning", func(t *testing.T) {
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)
		fake := setupWebPush(t, http.StatusGone)
		clearLastBadgeCount(t, 2)
		readLog := captureLogs(t)

		require.NoError(t, SendBadgePush(s, 2))
		require.NoError(t, s.Commit())

		require.Len(t, fake.requests, 1)
		db.AssertMissing(t, "push_subscriptions", map[string]interface{}{"id": 3})
		// The other users' subscriptions must survive an unrelated revocation.
		db.AssertExists(t, "push_subscriptions", map[string]interface{}{"id": 1}, false)

		logged := readLog()
		assert.Contains(t, logged, "level=WARN")
		assert.Contains(t, logged, "revoked by the push service",
			"revocation must have its own message, not be folded into a generic error")
		assert.Contains(t, logged, "410")
	})

	t.Run("404 Not Found also prunes the subscription", func(t *testing.T) {
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)
		setupWebPush(t, http.StatusNotFound)
		clearLastBadgeCount(t, 2)

		require.NoError(t, SendBadgePush(s, 2))
		require.NoError(t, s.Commit())

		db.AssertMissing(t, "push_subscriptions", map[string]interface{}{"id": 3})
	})

	t.Run("a rejected send keeps the subscription and logs an error", func(t *testing.T) {
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)
		setupWebPush(t, http.StatusInternalServerError)
		clearLastBadgeCount(t, 2)
		readLog := captureLogs(t)

		require.NoError(t, SendBadgePush(s, 2))
		require.NoError(t, s.Commit())

		db.AssertExists(t, "push_subscriptions", map[string]interface{}{"id": 3}, false)
		assert.Contains(t, readLog(), "level=ERROR")
	})

	t.Run("skips the send when the count and the last sent count are both zero", func(t *testing.T) {
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)
		fake := setupWebPush(t, http.StatusCreated)
		clearLastBadgeCount(t, 9)

		// user9 owns no projects, so their badge count is zero.
		mustInsertPushSubscription(t, s, 9, "https://push.example.com/subscription-user9")
		count, err := getUserBadgeCount(s, &user.User{ID: 9})
		require.NoError(t, err)
		require.Zero(t, count, "precondition: user9 must have no due or overdue tasks")

		// First run still pushes: the badge may be showing a stale non-zero
		// count from before, and only a delivered push can clear it.
		require.NoError(t, SendBadgePush(s, 9))
		require.Len(t, fake.requests, 1)

		// Second run has nothing to say.
		require.NoError(t, SendBadgePush(s, 9))
		assert.Len(t, fake.requests, 1, "a repeated zero count must not push again")
	})

	t.Run("pushes again once the count leaves zero", func(t *testing.T) {
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)
		fake := setupWebPush(t, http.StatusCreated)
		clearLastBadgeCount(t, 9)

		mustInsertPushSubscription(t, s, 9, "https://push.example.com/subscription-user9")
		require.NoError(t, SendBadgePush(s, 9))
		require.NoError(t, SendBadgePush(s, 9))
		require.Len(t, fake.requests, 1)

		project := mustInsertStatsProject(t, s, "user9 project", 9)
		mustInsertStatsTask(t, s, project.ID, 1, 9, false, time.Time{}, time.Now().Add(-time.Hour))

		require.NoError(t, SendBadgePush(s, 9))
		assert.Len(t, fake.requests, 2)
	})

	t.Run("does nothing for a user without subscriptions", func(t *testing.T) {
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)
		fake := setupWebPush(t, http.StatusCreated)

		require.NoError(t, SendBadgePush(s, 3))
		assert.Empty(t, fake.requests)
	})
}

func clearLastBadgeCount(t *testing.T, userID int64) {
	t.Helper()
	require.NoError(t, forgetLastBadgeCount(userID))
}
