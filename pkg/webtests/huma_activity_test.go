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

type activityFeedResponse struct {
	Items []struct {
		ID      int64  `json:"id"`
		Verb    string `json:"verb"`
		ActorID int64  `json:"actor_id"`
		TaskID  int64  `json:"task_id"`
		Summary string `json:"summary"`
	} `json:"items"`
	NextCursor string `json:"next_cursor"`
}

func parseActivityFeed(t *testing.T, body []byte) activityFeedResponse {
	t.Helper()
	var resp activityFeedResponse
	require.NoError(t, json.Unmarshal(body, &resp), "feed body must be a keyset envelope: %s", string(body))
	return resp
}

func feedIDs(resp activityFeedResponse) []int64 {
	ids := make([]int64, 0, len(resp.Items))
	for _, it := range resp.Items {
		ids = append(ids, it.ID)
	}
	return ids
}

// seedActivity inserts one activity row with a controlled created timestamp
// (the xorm "created" tag forces now-on-insert, so it is overwritten). Rows are
// spaced whole seconds apart by the caller to stay distinct under SQLite's
// datetime granularity.
func seedActivity(t *testing.T, projectID, taskID, actorID int64, verb string, created time.Time) int64 {
	t.Helper()
	s := db.NewSession()
	defer s.Close()

	act := &models.Activity{ProjectID: projectID, TaskID: taskID, ActorID: actorID, Verb: verb, Summary: "seeded"}
	_, err := s.Insert(act)
	require.NoError(t, err)
	_, err = s.ID(act.ID).Cols("created").Update(&models.Activity{Created: created})
	require.NoError(t, err)
	require.NoError(t, s.Commit())
	return act.ID
}

func TestHumaActivity_ProjectFeed(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)

	base := time.Now().Truncate(time.Second)
	a1 := seedActivity(t, 1, 1, 1, models.ActivityVerbTaskCreated, base.Add(-3*time.Second))
	a2 := seedActivity(t, 1, 1, 1, models.ActivityVerbTaskCompleted, base.Add(-2*time.Second))
	a3 := seedActivity(t, 1, 1, 1, models.ActivityVerbCommentCreated, base.Add(-1*time.Second))

	token := humaTokenFor(t, &testuser1)
	rec := humaRequest(t, e, http.MethodGet, "/api/v2/projects/1/activities", "", token, "")
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

	resp := parseActivityFeed(t, rec.Body.Bytes())
	// Newest first: a3, a2, a1.
	assert.Equal(t, []int64{a3, a2, a1}, feedIDs(resp), "feed must be newest-first")
}

func TestHumaActivity_ProjectFeed_Forbidden(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)

	// user2 cannot read project 1 (owned by user1, unshared).
	token := humaTokenFor(t, &testuser2)
	rec := humaRequest(t, e, http.MethodGet, "/api/v2/projects/1/activities", "", token, "")
	require.Equal(t, http.StatusForbidden, rec.Code, "body: %s", rec.Body.String())
}

func TestHumaActivity_Filters(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)

	base := time.Now().Truncate(time.Second)
	// Two actors, two verbs.
	seedActivity(t, 1, 1, 1, models.ActivityVerbTaskCompleted, base.Add(-4*time.Second))
	completedByOther := seedActivity(t, 1, 1, 2, models.ActivityVerbTaskCompleted, base.Add(-3*time.Second))
	seedActivity(t, 1, 1, 2, models.ActivityVerbCommentCreated, base.Add(-2*time.Second))

	token := humaTokenFor(t, &testuser1)

	t.Run("actor and verb", func(t *testing.T) {
		rec := humaRequest(t, e, http.MethodGet,
			"/api/v2/projects/1/activities?actor_id=2&verb=task_completed", "", token, "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
		resp := parseActivityFeed(t, rec.Body.Bytes())
		assert.Equal(t, []int64{completedByOther}, feedIDs(resp),
			"only user2's completion must match; body: %s", rec.Body.String())
	})

	t.Run("verb only", func(t *testing.T) {
		rec := humaRequest(t, e, http.MethodGet,
			"/api/v2/projects/1/activities?verb=task_completed", "", token, "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
		resp := parseActivityFeed(t, rec.Body.Bytes())
		for _, it := range resp.Items {
			assert.Equal(t, models.ActivityVerbTaskCompleted, it.Verb)
		}
		assert.Len(t, resp.Items, 2)
	})
}

func TestHumaActivity_AllProjectsScoping(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)

	base := time.Now().Truncate(time.Second)
	seeded := seedActivity(t, 1, 1, 1, models.ActivityVerbTaskCompleted, base.Add(-1*time.Second))

	t.Run("owner sees their project's activity", func(t *testing.T) {
		token := humaTokenFor(t, &testuser1)
		rec := humaRequest(t, e, http.MethodGet, "/api/v2/activities", "", token, "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
		resp := parseActivityFeed(t, rec.Body.Bytes())
		assert.Contains(t, feedIDs(resp), seeded)
	})

	t.Run("no-access user does not see it", func(t *testing.T) {
		// user2 cannot read project 1, so its activity must not leak into the
		// cross-project feed.
		token := humaTokenFor(t, &testuser2)
		rec := humaRequest(t, e, http.MethodGet, "/api/v2/activities", "", token, "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
		resp := parseActivityFeed(t, rec.Body.Bytes())
		assert.NotContains(t, feedIDs(resp), seeded)
	})
}

// TestHumaActivity_KeysetStability is SC-003: a row inserted between page
// requests must not cause an existing row to be skipped or duplicated across
// pages.
func TestHumaActivity_KeysetStability(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)

	base := time.Now().Truncate(time.Second)
	a1 := seedActivity(t, 1, 1, 1, models.ActivityVerbTaskCreated, base.Add(-4*time.Second))
	a2 := seedActivity(t, 1, 1, 1, models.ActivityVerbTaskCreated, base.Add(-3*time.Second))
	a3 := seedActivity(t, 1, 1, 1, models.ActivityVerbTaskCreated, base.Add(-2*time.Second))
	a4 := seedActivity(t, 1, 1, 1, models.ActivityVerbTaskCreated, base.Add(-1*time.Second))

	token := humaTokenFor(t, &testuser1)

	// Page 1 (newest two): a4, a3.
	rec := humaRequest(t, e, http.MethodGet, "/api/v2/projects/1/activities?per_page=2", "", token, "")
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
	page1 := parseActivityFeed(t, rec.Body.Bytes())
	require.Equal(t, []int64{a4, a3}, feedIDs(page1))
	require.NotEmpty(t, page1.NextCursor, "a next cursor must be returned when more rows exist")

	// Concurrent insert of a newer row between page requests.
	a5 := seedActivity(t, 1, 1, 1, models.ActivityVerbTaskCreated, base.Add(1*time.Second))

	// Page 2 via the cursor: a2, a1. The newly inserted a5 (newer than the
	// cursor) must NOT appear, and nothing from page 1 may repeat.
	rec = humaRequest(t, e, http.MethodGet,
		"/api/v2/projects/1/activities?per_page=2&cursor="+page1.NextCursor, "", token, "")
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
	page2 := parseActivityFeed(t, rec.Body.Bytes())

	assert.Equal(t, []int64{a2, a1}, feedIDs(page2), "page 2 must be the next-older rows, stable under the concurrent insert")
	assert.NotContains(t, feedIDs(page2), a5, "concurrently-inserted newer row must not appear on an older page")
	assert.NotContains(t, feedIDs(page2), a4, "no overlap with page 1")
	assert.NotContains(t, feedIDs(page2), a3, "no overlap with page 1")
}

// TestHumaActivity_KeysetSameTimestampTiebreak is the heart of SC-003: when
// several entries share ONE identical created value (the common case under
// SQLite's second precision), the page boundary must be decided by the id
// tiebreak (`created = ? AND id < ?`), not the timestamp. The boundary here
// falls between two same-second rows.
func TestHumaActivity_KeysetSameTimestampTiebreak(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)

	base := time.Now().Truncate(time.Second)
	// a1..a3 share the exact same created; a0 is one second older.
	a0 := seedActivity(t, 1, 1, 1, models.ActivityVerbTaskCreated, base.Add(-1*time.Second))
	a1 := seedActivity(t, 1, 1, 1, models.ActivityVerbTaskCreated, base)
	a2 := seedActivity(t, 1, 1, 1, models.ActivityVerbTaskCreated, base)
	a3 := seedActivity(t, 1, 1, 1, models.ActivityVerbTaskCreated, base)

	token := humaTokenFor(t, &testuser1)

	// Order is (created DESC, id DESC) → a3, a2, a1, a0. Page 1 splits the
	// same-second run between a2 and a1 purely by id.
	rec := humaRequest(t, e, http.MethodGet, "/api/v2/projects/1/activities?per_page=2", "", token, "")
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
	page1 := parseActivityFeed(t, rec.Body.Bytes())
	require.Equal(t, []int64{a3, a2}, feedIDs(page1), "same-second rows must order by id desc")
	require.NotEmpty(t, page1.NextCursor)

	// Page 2 must resume at a1 (same created as the cursor, smaller id → id
	// tiebreak) then a0 (older created → the `<` branch). No overlap, complete.
	rec = humaRequest(t, e, http.MethodGet,
		"/api/v2/projects/1/activities?per_page=2&cursor="+page1.NextCursor, "", token, "")
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
	page2 := parseActivityFeed(t, rec.Body.Bytes())

	assert.Equal(t, []int64{a1, a0}, feedIDs(page2),
		"the boundary between same-timestamp rows must be decided by the id tiebreak")
	assert.NotContains(t, feedIDs(page2), a2, "boundary row must not repeat across pages")
	assert.NotContains(t, feedIDs(page2), a3, "no overlap with page 1")
}

func TestHumaActivity_MalformedCursor(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)

	token := humaTokenFor(t, &testuser1)
	rec := humaRequest(t, e, http.MethodGet,
		"/api/v2/projects/1/activities?cursor=not-a-valid-cursor%21%21", "", token, "")
	require.Equal(t, http.StatusBadRequest, rec.Code,
		"a garbage cursor must be a 400, never a 500; body: %s", rec.Body.String())
}
