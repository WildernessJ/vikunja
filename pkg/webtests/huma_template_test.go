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
	"strconv"
	"testing"

	"code.vikunja.io/api/pkg/files"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestHumaTemplates covers the save-as-template → library → instantiate flow
// plus the template-endpoint 404 guard and the write-permission gate.
func TestHumaTemplates(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)
	// save-as-template copies task attachments, so the fixture file blobs must exist.
	files.InitTestFileFixtures(t)
	token := humaTokenFor(t, &testuser1)

	// user1 owns project 1 (write) → save-as-template succeeds.
	rec := humaRequest(t, e, http.MethodPost, "/api/v2/projects/1/save-as-template",
		`{"name":"Packing","description":"trip checklist"}`, token, "")
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	var created map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &created))
	assert.Equal(t, "Packing", created["title"])
	assert.Equal(t, true, created["is_template"])
	templateID := int64(created["id"].(float64))
	require.NotZero(t, templateID)

	t.Run("library lists the template", func(t *testing.T) {
		rec := humaRequest(t, e, http.MethodGet, "/api/v2/templates", "", token, "")
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var list struct {
			Items []struct {
				ID    int64  `json:"id"`
				Title string `json:"title"`
			} `json:"items"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &list))
		var found bool
		for _, it := range list.Items {
			if it.ID == templateID {
				found = true
				assert.Equal(t, "Packing", it.Title)
			}
			assert.NotEqual(t, int64(1), it.ID, "regular project 1 must not appear in the library")
		}
		assert.True(t, found, "the created template must be listed")
	})

	t.Run("instantiate creates a normal project", func(t *testing.T) {
		rec := humaRequest(t, e, http.MethodPost, "/api/v2/templates/"+strconv.FormatInt(templateID, 10)+"/instantiate",
			`{"title":"Japan trip"}`, token, "")
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		var proj map[string]interface{}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &proj))
		assert.Equal(t, "Japan trip", proj["title"])
		assert.Equal(t, false, proj["is_template"])
	})

	t.Run("template endpoints 404 on a regular project id", func(t *testing.T) {
		// project 1 is a regular project.
		for _, tc := range []struct {
			method, path, body string
		}{
			{http.MethodGet, "/api/v2/templates/1", ""},
			{http.MethodPut, "/api/v2/templates/1", `{"title":"x"}`},
			{http.MethodDelete, "/api/v2/templates/1", ""},
			{http.MethodPost, "/api/v2/templates/1/instantiate", `{"title":"x"}`},
		} {
			rec := humaRequest(t, e, tc.method, tc.path, tc.body, token, "")
			assert.Equal(t, http.StatusNotFound, rec.Code, "%s %s should 404: %s", tc.method, tc.path, rec.Body.String())
		}
	})

	t.Run("read-only user cannot save-as-template", func(t *testing.T) {
		// user1 has read-only access to project 9 (shared read-only, see fixtures).
		rec := humaRequest(t, e, http.MethodPost, "/api/v2/projects/9/save-as-template",
			`{"name":"nope"}`, token, "")
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
	})

	t.Run("instantiate under a template parent is rejected", func(t *testing.T) {
		// The template itself is a template project; using it as the parent must
		// be rejected (a template can't hold children — the copy would orphan).
		rec := humaRequest(t, e, http.MethodPost, "/api/v2/templates/"+strconv.FormatInt(templateID, 10)+"/instantiate",
			`{"title":"orphan","parent_project_id":`+strconv.FormatInt(templateID, 10)+`}`, token, "")
		assert.Equal(t, http.StatusPreconditionFailed, rec.Code, rec.Body.String())
	})
}
