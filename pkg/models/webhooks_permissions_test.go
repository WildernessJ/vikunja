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

func TestWebhook_Permissions(t *testing.T) {
	doer := &user.User{ID: 1}
	cases := []struct {
		name    string
		webhook Webhook
		want    bool
	}{
		{"body user_id on a foreign project", Webhook{ProjectID: 2, UserID: 1}, false},
		{"body user_id on an own project", Webhook{ProjectID: 1, UserID: 1}, true},
		{"own user-level", Webhook{UserID: 1}, true},
		{"foreign user-level", Webhook{UserID: 2}, false},
		{"negative project", Webhook{ProjectID: -1}, false},
		{"body user_id on a negative project", Webhook{ProjectID: -1, UserID: 1}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db.LoadAndAssertFixtures(t)
			s := db.NewSession()
			defer s.Close()

			w := tc.webhook
			can, err := w.CanCreate(s, doer)
			require.NoError(t, err)
			assert.Equal(t, tc.want, can)
		})
	}
}

func TestWebhook_CanRead(t *testing.T) {
	doer := &user.User{ID: 1}
	cases := []struct {
		name    string
		webhook Webhook
		want    bool
	}{
		{"body user_id on a foreign project", Webhook{ProjectID: 2, UserID: 1}, false},
		{"body user_id on an own project", Webhook{ProjectID: 1, UserID: 1}, true},
		{"own user-level", Webhook{UserID: 1}, true},
		{"foreign user-level", Webhook{UserID: 2}, false},
		// Favorites is always readable; pinned so nobody narrows the branch to `> 0`.
		{"foreign user_id on the favorites pseudo project", Webhook{ProjectID: -1, UserID: 2}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db.LoadAndAssertFixtures(t)
			s := db.NewSession()
			defer s.Close()

			w := tc.webhook
			can, _, err := w.CanRead(s, doer)
			require.NoError(t, err)
			assert.Equal(t, tc.want, can)
		})
	}
}
