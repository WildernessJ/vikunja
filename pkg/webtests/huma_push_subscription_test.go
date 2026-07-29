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

package webtests

import (
	"encoding/json"
	"net/http"
	"testing"

	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/db"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Fixture topology (pkg/db/fixtures/push_subscriptions.yml):
//   - #1, #2: user1's two devices.
//   - #3: user2's device — user1 must not be able to touch it.
func TestHumaPushSubscription(t *testing.T) {
	testHandler := webHandlerTestV2{
		user:     &testuser1,
		basePath: "/api/v2/push-subscriptions",
		idParam:  "id",
		t:        t,
	}

	t.Run("Create", func(t *testing.T) {
		t.Run("Normal", func(t *testing.T) {
			rec, err := testHandler.testCreateWithUser(nil, nil,
				`{"endpoint":"https://push.example.com/fresh-device","p256dh":"BPublicKey","auth":"AuthSecret"}`)
			require.NoError(t, err)
			assert.Equal(t, http.StatusCreated, rec.Code)
			assert.Contains(t, rec.Body.String(), `"endpoint":"https://push.example.com/fresh-device"`)
			// The owner is derived from the token, so it never appears on the wire.
			assert.NotContains(t, rec.Body.String(), `"user_id"`)
			// p256dh and auth are the device's payload-encryption secrets and
			// are write-only: echoing them back puts them in every log, proxy
			// and cache between here and the browser.
			assert.NotContains(t, rec.Body.String(), "BPublicKey")
			assert.NotContains(t, rec.Body.String(), "AuthSecret")
			assert.NotContains(t, rec.Body.String(), `"p256dh"`)
			assert.NotContains(t, rec.Body.String(), `"auth"`)
		})
		t.Run("Endpoint must be https", func(t *testing.T) {
			for _, endpoint := range []string{
				"http://push.example.com/plaintext",
				"http://169.254.169.254/latest/meta-data/",
				"ftp://push.example.com/weird",
			} {
				t.Run(endpoint, func(t *testing.T) {
					rec, err := testHandler.testCreateWithUser(nil, nil,
						`{"endpoint":"`+endpoint+`","p256dh":"BPublicKey","auth":"AuthSecret"}`)
					require.Error(t, err)
					assert.Equal(t, http.StatusUnprocessableEntity, getHTTPErrorCode(err))
					assert.Contains(t, rec.Body.String(), "endpoint",
						"the offending field must be named in invalid_fields")
					db.AssertMissing(t, "push_subscriptions", map[string]interface{}{"endpoint": endpoint})
				})
			}
		})
		t.Run("Re-subscribing with a known endpoint updates it in place", func(t *testing.T) {
			rec, err := testHandler.testCreateWithUser(nil, nil,
				`{"endpoint":"https://push.example.com/subscription-user1-a","p256dh":"BRotated","auth":"RotatedAuth"}`)
			require.NoError(t, err)
			assert.Equal(t, http.StatusCreated, rec.Code)
			assert.Contains(t, rec.Body.String(), `"id":1`,
				"the existing row must be reused rather than a second one created; body: %s", rec.Body.String())
		})
		t.Run("Missing endpoint", func(t *testing.T) {
			_, err := testHandler.testCreateWithUser(nil, nil, `{"p256dh":"BPublicKey","auth":"AuthSecret"}`)
			require.Error(t, err)
			assert.Equal(t, http.StatusUnprocessableEntity, getHTTPErrorCode(err))
		})
		t.Run("Endpoint is not a URL", func(t *testing.T) {
			// govalidator failures surface as 422 on v2, same as Huma's own
			// schema validation; the full problem+json shape is asserted once
			// globally in TestHuma_ErrorShapeIsRFC9457.
			rec, err := testHandler.testCreateWithUser(nil, nil,
				`{"endpoint":"not-a-url","p256dh":"BPublicKey","auth":"AuthSecret"}`)
			require.Error(t, err)
			assert.Equal(t, http.StatusUnprocessableEntity, getHTTPErrorCode(err))
			assert.Contains(t, rec.Body.String(), "endpoint",
				"the offending field must be named in invalid_fields")
		})
	})

	t.Run("Delete", func(t *testing.T) {
		t.Run("Normal", func(t *testing.T) {
			rec, err := testHandler.testDeleteWithUser(nil, map[string]string{"id": "2"})
			require.NoError(t, err)
			assert.Equal(t, http.StatusNoContent, rec.Code)
			assert.Empty(t, rec.Body.String())
			db.AssertMissing(t, "push_subscriptions", map[string]interface{}{"id": 2})
		})
		t.Run("Nonexisting", func(t *testing.T) {
			_, err := testHandler.testDeleteWithUser(nil, map[string]string{"id": "9999"})
			require.Error(t, err)
			assert.Equal(t, http.StatusForbidden, getHTTPErrorCode(err))
		})
		t.Run("Permissions check", func(t *testing.T) {
			t.Run("Forbidden - subscription of another user", func(t *testing.T) {
				_, err := testHandler.testDeleteWithUser(nil, map[string]string{"id": "3"})
				require.Error(t, err)
				assert.Equal(t, http.StatusForbidden, getHTTPErrorCode(err))
				db.AssertExists(t, "push_subscriptions", map[string]interface{}{"id": 3}, false)
			})
		})
	})
}

func TestHumaPushSubscription_Unauthenticated(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)

	for _, tc := range []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"public key", http.MethodGet, "/api/v2/notifications/push/public-key", ""},
		{"create", http.MethodPost, "/api/v2/push-subscriptions", `{"endpoint":"https://push.example.com/x","p256dh":"a","auth":"b"}`},
		{"delete", http.MethodDelete, "/api/v2/push-subscriptions/1", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := humaRequest(t, e, tc.method, tc.path, tc.body, "", "")
			assert.Equal(t, http.StatusUnauthorized, rec.Code, "body: %s", rec.Body.String())
		})
	}
}

func TestHumaPushSubscription_PublicKey(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)
	token := humaTokenFor(t, &testuser1)

	readBody := func(t *testing.T) (bool, string) {
		t.Helper()
		rec := humaRequest(t, e, http.MethodGet, "/api/v2/notifications/push/public-key", "", token, "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
		var body struct {
			Enabled   bool   `json:"enabled"`
			PublicKey string `json:"public_key"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		return body.Enabled, body.PublicKey
	}

	t.Run("Not configured", func(t *testing.T) {
		enabled, key := readBody(t)
		assert.False(t, enabled)
		assert.Empty(t, key, "an unconfigured instance must not leak a half-set key")
	})

	t.Run("Enabled without a key pair still reports disabled", func(t *testing.T) {
		config.WebPushEnabled.Set(true)
		t.Cleanup(func() { config.WebPushEnabled.Set(false) })

		enabled, key := readBody(t)
		assert.False(t, enabled, "without VAPID keys nothing can be sent, so subscribing must not be offered")
		assert.Empty(t, key)
	})

	t.Run("Configured", func(t *testing.T) {
		config.WebPushEnabled.Set(true)
		config.WebPushPublicKey.Set("BTestPublicKeyValue")
		config.WebPushPrivateKey.Set("TestPrivateKeyValue")
		t.Cleanup(func() {
			config.WebPushEnabled.Set(false)
			config.WebPushPublicKey.Set("")
			config.WebPushPrivateKey.Set("")
		})

		enabled, key := readBody(t)
		assert.True(t, enabled)
		assert.Equal(t, "BTestPublicKeyValue", key)
	})
}
