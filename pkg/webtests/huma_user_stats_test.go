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

type userStatsResponse struct {
	CompletedPerDay []struct {
		Date  string `json:"date"`
		Count int64  `json:"count"`
	} `json:"completed_per_day"`
	CompletedInProjects int64 `json:"completed_in_projects"`
	CreatedByMe         int64 `json:"created_by_me"`
	Open                int64 `json:"open"`
	Overdue             int64 `json:"overdue"`
	Projects            []struct {
		ProjectID         int64 `json:"project_id"`
		Open              int64 `json:"open"`
		CompletedInWindow int64 `json:"completed_in_window"`
		Overdue           int64 `json:"overdue"`
	} `json:"projects"`
}

func TestHumaUserStats(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)

	t.Run("Requires auth", func(t *testing.T) {
		rec := humaRequest(t, e, http.MethodGet, "/api/v2/user/stats", "", "", "")
		assert.Equal(t, http.StatusUnauthorized, rec.Code, "body: %s", rec.Body.String())
	})

	t.Run("Happy path returns non-zero figures for a user with recent activity", func(t *testing.T) {
		// testuser1 owns project 1. Fixture tasks there are dated 2018, outside
		// any window, so the figures below come solely from these fresh rows.
		s := db.NewSession()
		completed := &models.Task{Title: "stats webtest done", ProjectID: 1, Index: 9001, CreatedByID: 1, Done: true, DoneAt: time.Now()}
		_, err := s.Insert(completed)
		require.NoError(t, err)
		open := &models.Task{Title: "stats webtest open", ProjectID: 1, Index: 9002, CreatedByID: 1}
		_, err = s.Insert(open)
		require.NoError(t, err)
		require.NoError(t, s.Commit())
		s.Close()

		rec := humaRequest(t, e, http.MethodGet, "/api/v2/user/stats", "", humaTokenFor(t, &testuser1), "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

		var resp userStatsResponse
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp), "body: %s", rec.Body.String())

		assert.GreaterOrEqual(t, resp.CompletedInProjects, int64(1))
		assert.GreaterOrEqual(t, resp.CreatedByMe, int64(2))
		assert.GreaterOrEqual(t, resp.Open, int64(1))
		require.NotEmpty(t, resp.CompletedPerDay, "series must be zero-filled, never empty")
		require.NotEmpty(t, resp.Projects, "a project with activity must appear in the breakdown")

		var todayCount int64
		today := time.Now().UTC().Format("2006-01-02")
		for _, d := range resp.CompletedPerDay {
			if d.Date == today {
				todayCount = d.Count
			}
		}
		assert.GreaterOrEqual(t, todayCount, int64(1), "the completion inserted just now must land on today's bucket")
	})

	t.Run("Fresh user with no projects gets a well-formed zeroed response", func(t *testing.T) {
		// testuser21 owns no projects and is on no team with project access.
		rec := humaRequest(t, e, http.MethodGet, "/api/v2/user/stats", "", humaTokenFor(t, &testuser21), "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

		var resp userStatsResponse
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp), "body: %s", rec.Body.String())

		assert.Equal(t, int64(0), resp.CompletedInProjects)
		assert.Equal(t, int64(0), resp.CreatedByMe)
		assert.Equal(t, int64(0), resp.Open)
		assert.Equal(t, int64(0), resp.Overdue)
		assert.Empty(t, resp.Projects)
		assert.NotEmpty(t, resp.CompletedPerDay, "series must still be present and zero-filled")
	})

	t.Run("weeks above the schema max is rejected at validation", func(t *testing.T) {
		rec := humaRequest(t, e, http.MethodGet, "/api/v2/user/stats?weeks=99", "", humaTokenFor(t, &testuser1), "")
		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, "Huma rejects weeks>52 at the schema; body: %s", rec.Body.String())
	})
}
