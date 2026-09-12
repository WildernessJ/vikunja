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
	"net/http"
	"testing"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/models"
	"code.vikunja.io/api/pkg/web/handler"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWebhook(t *testing.T) {
	// availableWebhookEvents is filled by RegisterListeners, which this harness never calls.
	models.RegisterEventForWebhook(&models.TaskUpdatedEvent{})

	testHandler := webHandlerTest{
		user: &testuser1,
		strFunc: func() handler.CObject {
			return &models.Webhook{}
		},
		t: t,
	}
	t.Run("ReadAll", func(t *testing.T) {
		t.Run("should not expose BasicAuth credentials", func(t *testing.T) {
			rec, err := testHandler.testReadAllWithUser(nil, map[string]string{"project": "1"})
			require.NoError(t, err)
			assert.Contains(t, rec.Body.String(), `"target_url"`)
			assert.NotContains(t, rec.Body.String(), `webhook-user`)
			assert.NotContains(t, rec.Body.String(), `webhook-password`)
			assert.NotContains(t, rec.Body.String(), `webhook-secret-fixture`)
		})
		t.Run("Body cannot re-target the URL's project", func(t *testing.T) {
			hndl := testHandler.getHandler()
			_, err := newTestRequestWithUser(t, http.MethodGet, hndl.ReadAllWeb, &testuser1,
				`{"project_id":1}`, nil, map[string]string{"project": "2"})
			assertHandlerErrorCode(t, err, models.ErrorCodeGenericForbidden)
		})
		t.Run("Body user_id cannot select the user-level list under a project URL", func(t *testing.T) {
			hndl := testHandler.getHandler()
			_, err := newTestRequestWithUser(t, http.MethodGet, hndl.ReadAllWeb, &testuser1,
				`{"user_id":1}`, nil, map[string]string{"project": "2"})
			assertHandlerErrorCode(t, err, models.ErrorCodeGenericForbidden)
		})
	})
	t.Run("Create", func(t *testing.T) {
		t.Run("Normal", func(t *testing.T) {
			_, err := testHandler.testCreateWithUser(nil, map[string]string{"project": "1"},
				`{"target_url":"https://example.com/ok","events":["task.updated"]}`)
			require.NoError(t, err)
			db.AssertExists(t, "webhooks", map[string]interface{}{
				"target_url": "https://example.com/ok",
				"project_id": 1,
			}, false)
		})
		t.Run("Body user_id cannot bypass the project permission", func(t *testing.T) {
			_, err := testHandler.testCreateWithUser(nil, map[string]string{"project": "2"},
				`{"target_url":"https://example.com/x","events":["task.updated"],"user_id":1}`)
			require.Error(t, err)
			assert.Equal(t, http.StatusForbidden, getHTTPErrorCode(err))
			db.AssertMissing(t, "webhooks", map[string]interface{}{"target_url": "https://example.com/x"})
		})
		// The project branch now passes this cell; Create's both-set check is the
		// only thing left refusing the row, so pin it.
		t.Run("Foreign user_id on a writable project is rejected by Create", func(t *testing.T) {
			_, err := testHandler.testCreateWithUser(nil, map[string]string{"project": "1"},
				`{"target_url":"https://example.com/both","events":["task.updated"],"user_id":2}`)
			require.Error(t, err)
			assert.Equal(t, http.StatusPreconditionFailed, getHTTPErrorCode(err))
			db.AssertMissing(t, "webhooks", map[string]interface{}{"target_url": "https://example.com/both"})
		})
		t.Run("Without user_id is forbidden as before", func(t *testing.T) {
			_, err := testHandler.testCreateWithUser(nil, map[string]string{"project": "2"},
				`{"target_url":"https://example.com/x","events":["task.updated"]}`)
			require.Error(t, err)
			assert.Equal(t, http.StatusForbidden, getHTTPErrorCode(err))
		})
	})
}
