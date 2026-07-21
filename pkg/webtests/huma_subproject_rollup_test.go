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

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestHumaTaskList_IncludeChildProjects proves ?include_child_projects binds
// through the real v2 query parser and reaches models.TaskCollection — the
// model-level test sets the struct field directly and can't catch a binding gap.
//
// Fixtures (pkg/db/fixtures): projects 41 -> 42 -> 44 are a hierarchy owned by
// user6 with tasks 49 (proj 41), 50 (proj 42), 54 (proj 44). Project 46 is an
// archived child of 41 with task 55. See task_collection_test.go.
func TestHumaTaskList_IncludeChildProjects(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)
	token := humaTokenFor(t, &testuser6)

	taskIDs := func(t *testing.T, path string) map[int64]bool {
		rec := humaRequest(t, e, http.MethodGet, path, "", token, "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
		var page struct {
			Items []struct {
				ID int64 `json:"id"`
			} `json:"items"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &page), "body: %s", rec.Body.String())
		got := map[int64]bool{}
		for _, it := range page.Items {
			got[it.ID] = true
		}
		return got
	}

	t.Run("flag on rolls up all descendants, archived excluded", func(t *testing.T) {
		got := taskIDs(t, "/api/v2/projects/41/tasks?include_child_projects=true")
		assert.True(t, got[49], "parent project's own task")
		assert.True(t, got[50], "direct child project's task")
		assert.True(t, got[54], "grandchild project's task")
		assert.False(t, got[55], "archived descendant's task must be excluded")
	})

	t.Run("flag off returns only the parent project's tasks", func(t *testing.T) {
		got := taskIDs(t, "/api/v2/projects/41/tasks")
		assert.True(t, got[49])
		assert.False(t, got[50], "child task must not leak when the flag is off")
		assert.False(t, got[54])
	})

	t.Run("excluded_project_ids binds through the query parser and drops the excluded project's tasks", func(t *testing.T) {
		got := taskIDs(t, "/api/v2/projects/41/tasks?include_child_projects=true&excluded_project_ids=42")
		assert.True(t, got[49], "parent project's own task")
		assert.False(t, got[50], "excluded project's task must be dropped")
		assert.True(t, got[54], "grandchild task must still ride along - exclusion is per-project, not subtree")
	})
}
