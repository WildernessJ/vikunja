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

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPushSubscription_Create(t *testing.T) {
	t.Run("normal", func(t *testing.T) {
		u := &user.User{ID: 1}
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)

		sub := &PushSubscription{
			Endpoint: "https://push.example.com/brand-new",
			P256dh:   "BPublicKeyValue",
			Auth:     "AuthSecretValue",
		}
		require.NoError(t, sub.Create(s, u))
		require.NoError(t, s.Commit())

		assert.NotZero(t, sub.ID)
		assert.Equal(t, int64(1), sub.UserID)
		db.AssertExists(t, "push_subscriptions", map[string]interface{}{
			"endpoint": "https://push.example.com/brand-new",
			"user_id":  1,
		}, false)
	})
	t.Run("upsert on duplicate endpoint keeps a single row", func(t *testing.T) {
		u := &user.User{ID: 1}
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)

		sub := &PushSubscription{
			Endpoint: "https://push.example.com/subscription-user1-a",
			P256dh:   "BRotatedPublicKey",
			Auth:     "RotatedAuthSecret",
		}
		require.NoError(t, sub.Create(s, u))
		require.NoError(t, s.Commit())

		// The browser re-subscribes with the same endpoint but fresh keys after
		// a permission reset; that must refresh the row, not add a second one.
		assert.Equal(t, int64(1), sub.ID)
		db.AssertExists(t, "push_subscriptions", map[string]interface{}{
			"id":      1,
			"p256dh":  "BRotatedPublicKey",
			"auth":    "RotatedAuthSecret",
			"user_id": 1,
		}, false)

		count, err := s.Where("endpoint = ?", "https://push.example.com/subscription-user1-a").Count(&PushSubscription{})
		require.NoError(t, err)
		assert.Equal(t, int64(1), count)
	})
	t.Run("upsert reassigns an endpoint claimed by another user", func(t *testing.T) {
		// A shared device: whoever last subscribed owns the push channel, so
		// the previous owner stops receiving badge pushes on it.
		u := &user.User{ID: 2}
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)

		sub := &PushSubscription{
			Endpoint: "https://push.example.com/subscription-user1-a",
			P256dh:   "BUser2PublicKey",
			Auth:     "User2AuthSecret",
		}
		require.NoError(t, sub.Create(s, u))
		require.NoError(t, s.Commit())

		db.AssertExists(t, "push_subscriptions", map[string]interface{}{
			"id":      1,
			"user_id": 2,
		}, false)
	})
	t.Run("link share cannot subscribe", func(t *testing.T) {
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)

		sub := &PushSubscription{Endpoint: "https://push.example.com/share", P256dh: "x", Auth: "y"}
		can, err := sub.CanCreate(s, &LinkSharing{ID: 1})
		require.Error(t, err)
		assert.False(t, can)
	})
}

func TestPushSubscription_CanDelete(t *testing.T) {
	t.Run("own subscription", func(t *testing.T) {
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)

		sub := &PushSubscription{ID: 1}
		can, err := sub.CanDelete(s, &user.User{ID: 1})
		require.NoError(t, err)
		assert.True(t, can)
	})
	t.Run("subscription of another user", func(t *testing.T) {
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)

		sub := &PushSubscription{ID: 3}
		can, err := sub.CanDelete(s, &user.User{ID: 1})
		require.NoError(t, err)
		assert.False(t, can)
	})
	t.Run("nonexisting subscription", func(t *testing.T) {
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)

		sub := &PushSubscription{ID: 9999}
		can, err := sub.CanDelete(s, &user.User{ID: 1})
		require.NoError(t, err)
		assert.False(t, can)
	})
	t.Run("link share", func(t *testing.T) {
		s := db.NewSession()
		defer s.Close()
		db.LoadAndAssertFixtures(t)

		sub := &PushSubscription{ID: 1}
		can, err := sub.CanDelete(s, &LinkSharing{ID: 1})
		require.Error(t, err)
		assert.False(t, can)
	})
}

// The cron fans out over this query, so an empty result would silently disable
// the whole feature rather than fail.
func TestGetUserIDsWithPushSubscriptions(t *testing.T) {
	s := db.NewSession()
	defer s.Close()
	db.LoadAndAssertFixtures(t)

	userIDs, err := getUserIDsWithPushSubscriptions(s)
	require.NoError(t, err)
	assert.ElementsMatch(t, []int64{1, 2}, userIDs,
		"user 1 has two devices but must appear once; users without a subscription must not appear")
}

func TestPushSubscription_Delete(t *testing.T) {
	s := db.NewSession()
	defer s.Close()
	db.LoadAndAssertFixtures(t)

	sub := &PushSubscription{ID: 1}
	can, err := sub.CanDelete(s, &user.User{ID: 1})
	require.NoError(t, err)
	require.True(t, can)
	require.NoError(t, sub.Delete(s, &user.User{ID: 1}))
	require.NoError(t, s.Commit())

	db.AssertMissing(t, "push_subscriptions", map[string]interface{}{"id": 1})
	// Deleting one device must not touch the user's other devices.
	db.AssertExists(t, "push_subscriptions", map[string]interface{}{"id": 2}, false)
}
