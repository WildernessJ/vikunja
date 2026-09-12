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
	apiv1 "code.vikunja.io/api/pkg/routes/api/v1"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserWebhookV1(t *testing.T) {
	// Update validates events against the global registry, which this harness never fills.
	models.RegisterUserDirectedEventForWebhook(&models.TaskOverdueEvent{})

	t.Run("Update: body id cannot re-target the URL's webhook", func(t *testing.T) {
		rec, err := newTestRequestWithUser(t, http.MethodPost, apiv1.UpdateUserWebhook, &testuser6,
			`{"id":6,"events":["task.overdue"]}`, nil, map[string]string{"webhook": "7"})
		require.NoError(t, err)
		assert.Contains(t, rec.Body.String(), `"id":7`)
		db.AssertExists(t, "webhooks", map[string]interface{}{"id": 7, "events": `["task.overdue"]`}, false)
		db.AssertExists(t, "webhooks", map[string]interface{}{"id": 6, "events": `["task.reminder.fired"]`}, false)
	})
	t.Run("Delete: body id cannot re-target the URL's webhook", func(t *testing.T) {
		_, err := newTestRequestWithUser(t, http.MethodDelete, apiv1.DeleteUserWebhook, &testuser6,
			`{"id":6}`, nil, map[string]string{"webhook": "7"})
		require.NoError(t, err)
		db.AssertMissing(t, "webhooks", map[string]interface{}{"id": 7})
		db.AssertExists(t, "webhooks", map[string]interface{}{"id": 6}, false)
	})
	t.Run("Update: another user's webhook is not found", func(t *testing.T) {
		_, err := newTestRequestWithUser(t, http.MethodPost, apiv1.UpdateUserWebhook, &testuser6,
			"", nil, map[string]string{"webhook": "8"})
		// echo v5's ErrNotFound is not an *echo.HTTPError, so getHTTPErrorCode reads it as 0.
		require.ErrorIs(t, err, echo.ErrNotFound)
	})
}
