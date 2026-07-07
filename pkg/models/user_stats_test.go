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
	"encoding/json"
	"testing"
	"time"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"xorm.io/xorm"
)

// mustInsertStatsTask inserts a task directly (bypassing Task.Create's
// business logic) so done/done_at/created_by_id/due_date can be set to exact
// values needed to test window and boundary math.
func mustInsertStatsTask(t *testing.T, s *xorm.Session, projectID, index, createdByID int64, done bool, doneAt, dueDate time.Time) {
	t.Helper()
	task := &Task{
		Title:       "stats task",
		ProjectID:   projectID,
		Index:       index,
		CreatedByID: createdByID,
		Done:        done,
		DoneAt:      doneAt,
		DueDate:     dueDate,
	}
	_, err := s.Insert(task)
	require.NoError(t, err)
}

// mustInsertStatsProject creates a fresh project owned by ownerID, isolated
// from fixture project data so counts in these tests are exact.
func mustInsertStatsProject(t *testing.T, s *xorm.Session, title string, ownerID int64) *Project {
	t.Helper()
	project := &Project{Title: title, OwnerID: ownerID}
	_, err := s.Insert(project)
	require.NoError(t, err)
	return project
}

func TestUserStats(t *testing.T) {
	requestingUser := &user.User{ID: 1}

	t.Run("completions per day are grouped and gap days are zero-filled", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		fullUser, err := user.GetUserByID(s, requestingUser.ID)
		require.NoError(t, err)
		boundary, err := startOfTomorrowInUserTimezone(fullUser)
		require.NoError(t, err)

		project := mustInsertStatsProject(t, s, "stats-per-day", requestingUser.ID)

		threeDaysAgo := boundary.AddDate(0, 0, -3)
		oneDayAgo := boundary.AddDate(0, 0, -1)

		mustInsertStatsTask(t, s, project.ID, 1, requestingUser.ID, true, threeDaysAgo.Add(2*time.Hour), time.Time{})
		mustInsertStatsTask(t, s, project.ID, 2, requestingUser.ID, true, threeDaysAgo.Add(3*time.Hour), time.Time{})
		mustInsertStatsTask(t, s, project.ID, 3, requestingUser.ID, true, oneDayAgo.Add(1*time.Hour), time.Time{})

		require.NoError(t, s.Commit())

		s2 := db.NewSession()
		defer s2.Close()
		stats, err := GetUserStats(s2, requestingUser, 12)
		require.NoError(t, err)

		countFor := func(day time.Time) int64 {
			date := day.In(time.UTC).Format("2006-01-02")
			for _, d := range stats.CompletedPerDay {
				if d.Date == date {
					return d.Count
				}
			}
			t.Fatalf("day %s not present in CompletedPerDay", date)
			return -1
		}

		twoDaysAgo := boundary.AddDate(0, 0, -2)
		assert.EqualValues(t, 2, countFor(threeDaysAgo))
		assert.EqualValues(t, 0, countFor(twoDaysAgo))
		assert.EqualValues(t, 1, countFor(oneDayAgo))
	})

	t.Run("completions bucket by the user's local calendar day, not UTC", func(t *testing.T) {
		// The default test-env timezone is GMT, so the per-day test above passes
		// even if bucketing were done in UTC. This one forces a non-UTC tz and a
		// completion whose UTC date differs from its local date, so a
		// UTC-bucketing regression (and by extension a broken windowStart tz
		// step) is actually caught.
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		_, err := s.ID(requestingUser.ID).Cols("timezone").Update(&user.User{Timezone: "America/New_York"})
		require.NoError(t, err)

		fullUser, err := user.GetUserByID(s, requestingUser.ID)
		require.NoError(t, err)
		loc, err := userTimezoneLocation(fullUser)
		require.NoError(t, err)
		boundary, err := startOfTomorrowInUserTimezone(fullUser)
		require.NoError(t, err)

		project := mustInsertStatsProject(t, s, "stats-tz-bucketing", requestingUser.ID)

		// 23:00 local three days ago → in UTC this rolls into the next calendar
		// day (New York is UTC-4/-5), so localDate and utcDate differ.
		doneAt := boundary.In(loc).AddDate(0, 0, -3).Add(23 * time.Hour).UTC()
		localDate := doneAt.In(loc).Format("2006-01-02")
		utcDate := doneAt.UTC().Format("2006-01-02")
		require.NotEqual(t, localDate, utcDate, "test setup: the completion's UTC and local dates must differ")

		mustInsertStatsTask(t, s, project.ID, 1, requestingUser.ID, true, doneAt, time.Time{})
		require.NoError(t, s.Commit())

		s2 := db.NewSession()
		defer s2.Close()
		stats, err := GetUserStats(s2, requestingUser, 12)
		require.NoError(t, err)

		countFor := func(date string) int64 {
			for _, d := range stats.CompletedPerDay {
				if d.Date == date {
					return d.Count
				}
			}
			t.Fatalf("day %s not present in CompletedPerDay", date)
			return -1
		}

		assert.EqualValues(t, 1, countFor(localDate), "completion must bucket to its local calendar day")
		assert.EqualValues(t, 0, countFor(utcDate), "completion must NOT bucket to its UTC calendar day")
	})

	t.Run("created_by_me is authored-only while completed_in_projects includes teammates", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		const teammateID = int64(3)
		project := mustInsertStatsProject(t, s, "stats-authored-vs-completed", requestingUser.ID)

		// created_by_me: 2 authored by the requesting user, 5 by a teammate, none done —
		// isolates the authored-count assertion from the completed-count one below.
		for i := int64(1); i <= 2; i++ {
			mustInsertStatsTask(t, s, project.ID, i, requestingUser.ID, false, time.Time{}, time.Time{})
		}
		for i := int64(3); i <= 7; i++ {
			mustInsertStatsTask(t, s, project.ID, i, teammateID, false, time.Time{}, time.Time{})
		}

		// completed_in_projects: 4 completions in the shared project, all
		// authored by the teammate — completed_in_projects must still count
		// them (no completed-by column exists), while created_by_me above
		// stays unaffected since none of these are authored by the requesting user.
		for i := int64(8); i <= 11; i++ {
			mustInsertStatsTask(t, s, project.ID, i, teammateID, true, time.Now(), time.Time{})
		}

		require.NoError(t, s.Commit())

		s2 := db.NewSession()
		defer s2.Close()
		stats, err := GetUserStats(s2, requestingUser, 12)
		require.NoError(t, err)

		assert.EqualValues(t, 2, stats.CreatedByMe, "created_by_me must only count tasks authored by the requesting user")
		assert.EqualValues(t, 4, stats.CompletedInProjects, "completed_in_projects intentionally includes teammate completions")

		body, err := json.Marshal(stats)
		require.NoError(t, err)
		assert.Contains(t, string(body), `"completed_in_projects"`, "field name must say completed_in_projects, not completions-by-me")
	})

	t.Run("overdue matches GetProjectTaskCounts (SC-003 badge parity)", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		fullUser, err := user.GetUserByID(s, requestingUser.ID)
		require.NoError(t, err)
		boundary, err := startOfTomorrowInUserTimezone(fullUser)
		require.NoError(t, err)

		project := mustInsertStatsProject(t, s, "stats-overdue-parity", requestingUser.ID)

		// 2 overdue (due before start-of-tomorrow), 1 due-in-future, 1 undated.
		mustInsertStatsTask(t, s, project.ID, 1, requestingUser.ID, false, time.Time{}, boundary.Add(-48*time.Hour))
		mustInsertStatsTask(t, s, project.ID, 2, requestingUser.ID, false, time.Time{}, boundary.Add(-1*time.Hour))
		mustInsertStatsTask(t, s, project.ID, 3, requestingUser.ID, false, time.Time{}, boundary.Add(48*time.Hour))
		mustInsertStatsTask(t, s, project.ID, 4, requestingUser.ID, false, time.Time{}, time.Time{})

		require.NoError(t, s.Commit())

		s2 := db.NewSession()
		defer s2.Close()
		stats, err := GetUserStats(s2, requestingUser, 12)
		require.NoError(t, err)

		s3 := db.NewSession()
		defer s3.Close()
		badgeCounts, err := GetProjectTaskCounts(s3, requestingUser)
		require.NoError(t, err)

		badgeCountForProject, ok := badgeCounts[project.ID]
		require.True(t, ok, "badge counts must include the freshly created project")
		assert.EqualValues(t, 2, badgeCountForProject.DueOverdue)

		var statsRowForProject *UserProjectStats
		for _, p := range stats.Projects {
			if p.ProjectID == project.ID {
				statsRowForProject = p
			}
		}
		require.NotNil(t, statsRowForProject, "stats projects must include the freshly created project")
		assert.Equal(t, badgeCountForProject.DueOverdue, statsRowForProject.Overdue, "Statistics overdue must equal the project badge overdue")
		assert.Equal(t, badgeCountForProject.Open, statsRowForProject.Open)
	})

	t.Run("open and overdue ignore the window param", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		fullUser, err := user.GetUserByID(s, requestingUser.ID)
		require.NoError(t, err)
		boundary, err := startOfTomorrowInUserTimezone(fullUser)
		require.NoError(t, err)

		project := mustInsertStatsProject(t, s, "stats-window-independent", requestingUser.ID)
		mustInsertStatsTask(t, s, project.ID, 1, requestingUser.ID, false, time.Time{}, boundary.Add(-48*time.Hour))
		mustInsertStatsTask(t, s, project.ID, 2, requestingUser.ID, false, time.Time{}, time.Time{})

		require.NoError(t, s.Commit())

		s2 := db.NewSession()
		defer s2.Close()
		narrow, err := GetUserStats(s2, requestingUser, 1)
		require.NoError(t, err)

		s3 := db.NewSession()
		defer s3.Close()
		wide, err := GetUserStats(s3, requestingUser, 52)
		require.NoError(t, err)

		assert.Equal(t, wide.Open, narrow.Open)
		assert.Equal(t, wide.Overdue, narrow.Overdue)
		assert.GreaterOrEqual(t, narrow.Open, int64(2))
	})

	t.Run("tasks in unshared projects are excluded", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		const strangerID = int64(3)
		privateProject := mustInsertStatsProject(t, s, "stats-private-to-stranger", strangerID)
		mustInsertStatsTask(t, s, privateProject.ID, 1, strangerID, true, time.Now(), time.Time{})
		mustInsertStatsTask(t, s, privateProject.ID, 2, strangerID, false, time.Time{}, time.Now().Add(-48*time.Hour))

		require.NoError(t, s.Commit())

		s2 := db.NewSession()
		defer s2.Close()
		stats, err := GetUserStats(s2, requestingUser, 12)
		require.NoError(t, err)

		for _, p := range stats.Projects {
			assert.NotEqual(t, privateProject.ID, p.ProjectID, "requesting user cannot read this project and must not see its stats")
		}
	})

	t.Run("fresh user with no projects gets a well-formed zeroed response", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		freshUser := &user.User{ID: 21} // fixture user with no owned/shared projects and no team membership (17/18 are disabled/locked, not just empty)

		stats, err := GetUserStats(s, freshUser, 12)
		require.NoError(t, err)
		require.NoError(t, s.Commit())

		assert.EqualValues(t, 0, stats.CompletedInProjects)
		assert.EqualValues(t, 0, stats.CreatedByMe)
		assert.EqualValues(t, 0, stats.Open)
		assert.EqualValues(t, 0, stats.Overdue)
		assert.Empty(t, stats.Projects)
		require.NotEmpty(t, stats.CompletedPerDay)
		for _, d := range stats.CompletedPerDay {
			assert.EqualValues(t, 0, d.Count)
		}
	})

	t.Run("model-layer guard clamps an over-range window to 52 weeks", func(t *testing.T) {
		// This tests the model-layer defense-in-depth clamp (clampUserStatsWindow),
		// reachable only by direct/non-HTTP callers. The HTTP endpoint does NOT
		// clamp: its route schema rejects weeks>52 with a 422 before this runs
		// (see the webtest). This asserts the model guard, not the HTTP behavior.
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		fullUser, err := user.GetUserByID(s, requestingUser.ID)
		require.NoError(t, err)
		boundary, err := startOfTomorrowInUserTimezone(fullUser)
		require.NoError(t, err)

		project := mustInsertStatsProject(t, s, "stats-window-clamp", requestingUser.ID)
		// 53 weeks ago: outside even an unclamped-looking 999-week request once clamped to 52.
		tooOld := boundary.AddDate(0, 0, -53*7)
		mustInsertStatsTask(t, s, project.ID, 1, requestingUser.ID, true, tooOld, time.Time{})

		require.NoError(t, s.Commit())

		s2 := db.NewSession()
		defer s2.Close()
		clampedFromHuge, err := GetUserStats(s2, requestingUser, 999)
		require.NoError(t, err)

		s3 := db.NewSession()
		defer s3.Close()
		explicit52, err := GetUserStats(s3, requestingUser, 52)
		require.NoError(t, err)

		assert.Len(t, clampedFromHuge.CompletedPerDay, len(explicit52.CompletedPerDay))
		assert.EqualValues(t, 0, clampedFromHuge.CompletedInProjects, "a completion 53 weeks ago must fall outside a 52-week-clamped window")
	})
}
