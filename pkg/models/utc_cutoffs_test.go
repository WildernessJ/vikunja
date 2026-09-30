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
	"testing"
	"time"

	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/files"
	"code.vikunja.io/api/pkg/notifications"
	"code.vikunja.io/api/pkg/user"
	"code.vikunja.io/api/pkg/utils"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Each cutoff below is compared against UTC columns. The rows sit one hour on
// either side of the cutoff, closer than any of these zones' UTC offsets, so a
// local-zone cutoff moves the boundary past one of them: early east of UTC
// (Tokyo), late west of UTC (New York).
func forEachCutoffZone(t *testing.T, fn func(t *testing.T)) {
	for _, name := range []string{"UTC", "America/New_York", "Asia/Tokyo"} {
		location, err := time.LoadLocation(name)
		require.NoError(t, err)

		t.Run(name, func(t *testing.T) {
			previous := time.Local                      //nolint:gosmopolitan // Deliberate test-local timezone isolation; t.Cleanup restores it.
			time.Local = location                       //nolint:gosmopolitan // Deliberate test-local timezone isolation.
			t.Cleanup(func() { time.Local = previous }) //nolint:gosmopolitan // Restore the prior timezone before the test returns.
			fn(t)
		})
	}
}

func TestUTCCutoff_StaleSessions(t *testing.T) {
	forEachCutoffZone(t, func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		now := time.Now()
		ttl := time.Duration(config.ServiceJWTTTL.GetInt64()) * time.Second
		for id, lastActive := range map[string]time.Time{
			"00000000-0000-0000-0000-00000000c0de": now.Add(-ttl + time.Hour), // inside the TTL
			"00000000-0000-0000-0000-00000000dead": now.Add(-ttl - time.Hour), // past the TTL
		} {
			_, err := s.Insert(&Session{ID: id, UserID: 1, TokenHash: id, LastActive: lastActive})
			require.NoError(t, err)
		}

		_, err := deleteStaleSessions(s, now)
		require.NoError(t, err)
		require.NoError(t, s.Commit())

		db.AssertExists(t, "sessions", map[string]interface{}{"id": "00000000-0000-0000-0000-00000000c0de"}, false)
		db.AssertMissing(t, "sessions", map[string]interface{}{"id": "00000000-0000-0000-0000-00000000dead"})
	})
}

func TestUTCCutoff_ExpiredTasks(t *testing.T) {
	// Task 51 was soft-deleted at this time in the fixtures.
	deletedAt := time.Date(2018, 12, 1, 1, 12, 4, 0, time.UTC)

	forEachCutoffZone(t, func(t *testing.T) {
		t.Run("inside the retention period", func(t *testing.T) {
			db.LoadAndAssertFixtures(t)
			deleteExpiredTasks(deletedAt.Add(TaskDeleteRetention - time.Hour).Local()) //nolint:gosmopolitan // The cron passes a local-zone time.Now().
			db.AssertExists(t, "tasks", map[string]interface{}{"id": 51}, false)
		})
		t.Run("past the retention period", func(t *testing.T) {
			db.LoadAndAssertFixtures(t)
			files.InitTestFileFixtures(t)
			deleteExpiredTasks(deletedAt.Add(TaskDeleteRetention + time.Hour).Local()) //nolint:gosmopolitan // The cron passes a local-zone time.Now().
			db.AssertMissing(t, "tasks", map[string]interface{}{"id": 51})
		})
	})
}

func TestUTCCutoff_ActivityRetention(t *testing.T) {
	forEachCutoffZone(t, func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		now := time.Now()
		keepID := insertActivityWithCreated(t, s, now.AddDate(0, 0, -90).Add(time.Hour))
		pruneID := insertActivityWithCreated(t, s, now.AddDate(0, 0, -90).Add(-time.Hour))

		_, err := pruneActivities(s, 90, now)
		require.NoError(t, err)
		require.NoError(t, s.Commit())

		db.AssertExists(t, "activities", map[string]interface{}{"id": keepID}, false)
		db.AssertMissing(t, "activities", map[string]interface{}{"id": pruneID})
	})
}

func TestUTCCutoff_OldExportFiles(t *testing.T) {
	forEachCutoffZone(t, func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		now := time.Now()
		insertFile := func(created time.Time) int64 {
			f := &files.File{Name: "export.zip", Size: 1, CreatedByID: 1}
			_, err := s.Insert(f)
			require.NoError(t, err)
			_, err = s.ID(f.ID).Cols("created").Update(&files.File{Created: created})
			require.NoError(t, err)
			return f.ID
		}
		recentID := insertFile(now.Add(-7*24*time.Hour + time.Hour))
		oldID := insertFile(now.Add(-7*24*time.Hour - time.Hour))

		fs, err := findOldExportFiles(s, []int64{recentID, oldID}, now)
		require.NoError(t, err)

		ids := []int64{}
		for _, f := range fs {
			ids = append(ids, f.ID)
		}
		assert.Equal(t, []int64{oldID}, ids)
	})
}

func TestUTCCutoff_APITokenExpiryWindow(t *testing.T) {
	forEachCutoffZone(t, func(t *testing.T) {
		for name, tc := range map[string]struct {
			expiresIn time.Duration
			notified  bool
		}{
			"inside the 7-day window": {7*24*time.Hour - time.Hour, true},
			"past the 7-day window":   {7*24*time.Hour + time.Hour, false},
		} {
			t.Run(name, func(t *testing.T) {
				db.LoadAndAssertFixtures(t)
				notifications.Fake()
				t.Cleanup(notifications.Unfake)

				now := time.Now()
				s := db.NewSession()
				defer s.Close()
				_, err := s.Insert(&APIToken{
					Title:          "Near the window edge",
					TokenSalt:      "salt",
					TokenHash:      "uniquehashwindowedge",
					TokenLastEight: "edge1234",
					APIPermissions: APIPermissions{"tasks": {"read"}},
					ExpiresAt:      now.Add(tc.expiresIn),
					OwnerID:        1,
				})
				require.NoError(t, err)
				require.NoError(t, s.Commit())

				checkForExpiringAPITokensAt(now)

				if tc.notified {
					notifications.AssertSent(t, &APITokenExpiringWeekNotification{})
				} else {
					notifications.AssertNotSent(t, &APITokenExpiringWeekNotification{})
				}
			})
		}
	})
}

func TestUTCCutoff_ScheduledUserDeletion(t *testing.T) {
	forEachCutoffZone(t, func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		notifications.Fake()
		t.Cleanup(notifications.Unfake)

		s := db.NewSession()
		_, err := s.ID(4).Cols("deletion_scheduled_at").Update(&user.User{DeletionScheduledAt: time.Now().Add(-time.Hour)})
		require.NoError(t, err)
		require.NoError(t, s.Commit())
		s.Close()

		deleteUsers()

		db.AssertMissing(t, "users", map[string]interface{}{"id": 4})
	})
}

func TestUTCCutoff_InviteLinkExpiry(t *testing.T) {
	forEachCutoffZone(t, func(t *testing.T) {
		s, _ := inviteLinkSetup(t)

		now := time.Now()
		for token, expiresAt := range map[string]time.Time{
			"expires-soon":   now.Add(time.Hour),
			"expired-lately": now.Add(-time.Hour),
		} {
			_, err := s.Insert(&UserInviteLink{Name: token, TokenHash: utils.Sha256Hex(token), ExpiresAt: &expiresAt, CreatedByID: 1})
			require.NoError(t, err)
		}

		_, err := GetInviteLinkByToken(s, "expires-soon")
		require.NoError(t, err)
		_, err = GetInviteLinkByToken(s, "expired-lately")
		require.ErrorIs(t, err, ErrInviteLinkInvalid{})
	})
}
