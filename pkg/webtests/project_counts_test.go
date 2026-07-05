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
	"time"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/models"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestProjectCounts exercises GET /api/v2/projects/counts for user1.
//
// Fixture facts the assertions rely on (pkg/db/fixtures/tasks.yml):
//   - Project 1 (owned by user1) has 19 undone tasks; task #2 is done and
//     excluded. Three of those undone tasks carry a due_date (tasks #5, #6,
//     #28), all in 2018 — long before start-of-tomorrow — so all three count
//     as due_overdue regardless of timezone.
//   - Project 3 (shared to user1, users_projects id=1) has one undone task
//     (#32) with no due_date: open=1, due_overdue=0.
//   - Project 22 (owned by user1, archived) has undone task #36 with an
//     overdue due_date and done task #38 which must be excluded from both
//     counts: open=1, due_overdue=1.
//   - Project 20 (owned by user13) is unreadable by user1 and must be absent.
//
// Limitation: every dated fixture task lies in the past, so the "future-dated
// tasks are excluded from due_overdue" branch cannot be proven from fixtures
// alone. TestProjectCounts_FutureDueDateExcluded covers it by inserting a
// future-dated task at runtime.
func TestProjectCounts(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)
	token := humaTokenFor(t, &testuser1)

	rec := humaRequest(t, e, http.MethodGet, "/api/v2/projects/counts", "", token, "")
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

	counts := map[int64]*models.ProjectTaskCount{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &counts), "body: %s", rec.Body.String())

	t.Run("owned project with due and done tasks", func(t *testing.T) {
		require.Contains(t, counts, int64(1))
		assert.Equal(t, int64(19), counts[1].Open, "project 1 must count 19 undone tasks (task #2 done excluded)")
		assert.Equal(t, int64(3), counts[1].DueOverdue, "project 1 has three past-due undone tasks (#5, #6, #28)")
	})

	t.Run("shared project without due dates", func(t *testing.T) {
		require.Contains(t, counts, int64(3))
		assert.Equal(t, int64(1), counts[3].Open)
		assert.Equal(t, int64(0), counts[3].DueOverdue, "task #32 has no due_date")
	})

	t.Run("done task excluded from both counts", func(t *testing.T) {
		require.Contains(t, counts, int64(22))
		assert.Equal(t, int64(1), counts[22].Open, "archived project 22: only undone task #36 counts, done task #38 excluded")
		assert.Equal(t, int64(1), counts[22].DueOverdue, "task #36 is overdue; done task #38 excluded")
	})

	t.Run("unreadable project has no entry", func(t *testing.T) {
		assert.NotContains(t, counts, int64(20), "project 20 is not readable by user1")
	})
}

func TestProjectCounts_Unauthenticated(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)

	rec := humaRequest(t, e, http.MethodGet, "/api/v2/projects/counts", "", "", "")
	assert.Equal(t, http.StatusUnauthorized, rec.Code, "body: %s", rec.Body.String())
}

// TestProjectCounts_FutureDueDateExcluded proves the boundary branch: a task
// due well in the future bumps open but not due_overdue. Fixtures contain only
// past-dated tasks, so this scenario is set up at runtime.
func TestProjectCounts_FutureDueDateExcluded(t *testing.T) {
	_, err := setupTestEnv()
	require.NoError(t, err)

	s := db.NewSession()
	defer s.Close()

	future := time.Now().AddDate(0, 0, 30)
	_, err = s.Insert(&models.Task{
		Title:       "future dated task",
		ProjectID:   1,
		Index:       9001,
		Done:        false,
		DueDate:     future,
		CreatedByID: 1,
	})
	require.NoError(t, err)

	counts, err := models.GetProjectTaskCounts(s, &testuser1)
	require.NoError(t, err)

	require.Contains(t, counts, int64(1))
	assert.Equal(t, int64(20), counts[1].Open, "the future-dated task adds to open")
	assert.Equal(t, int64(3), counts[1].DueOverdue, "a future due_date must not count as overdue")
}
