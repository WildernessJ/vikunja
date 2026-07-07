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
	"sort"
	"time"

	"code.vikunja.io/api/pkg/user"
	"code.vikunja.io/api/pkg/web"

	"xorm.io/xorm"
)

const (
	// DefaultUserStatsWindowWeeks is used when the caller passes weeks <= 0.
	DefaultUserStatsWindowWeeks = 12
	// MaxUserStatsWindowWeeks caps the requested window; larger requests are clamped.
	MaxUserStatsWindowWeeks = 52
)

// UserStatsDay is the completion count for a single calendar day, bucketed in
// the requesting user's configured timezone.
type UserStatsDay struct {
	Date  string `json:"date" doc:"The day, as YYYY-MM-DD in the user's configured timezone."`
	Count int64  `json:"count" doc:"Number of tasks completed on this day across the user's readable projects."`
}

// UserProjectStats is the per-project row of the personal statistics
// breakdown. Open and Overdue are point-in-time; CompletedInWindow is bound
// to the requested window.
type UserProjectStats struct {
	ProjectID         int64 `json:"project_id" doc:"The project this row describes."`
	Open              int64 `json:"open" doc:"Undone tasks in the project right now."`
	CompletedInWindow int64 `json:"completed_in_window" doc:"Tasks completed in the project within the requested window."`
	Overdue           int64 `json:"overdue" doc:"Undone tasks in the project overdue or due today, same boundary as the project's overdue badge."`
}

// UserStats is the personal statistics payload for the requesting user's
// readable projects.
//
// CompletedInProjects deliberately counts completions by anyone in a
// readable project, not just the requesting user — the task model has no
// completed-by column. CreatedByMe, by contrast, is authored-only
// (created_by_id = requesting user). The two are intentionally different
// scopes; see specs/personal-stats.md's honest-labeling invariant.
type UserStats struct {
	CompletedPerDay     []*UserStatsDay     `json:"completed_per_day" doc:"Completions per day across the requested window, zero-filled for days with none."`
	CompletedInProjects int64               `json:"completed_in_projects" doc:"Tasks completed in the user's readable projects within the window, by anyone."`
	CreatedByMe         int64               `json:"created_by_me" doc:"Tasks the requesting user authored within the window."`
	Open                int64               `json:"open" doc:"Undone tasks in readable projects right now. Not window-bound."`
	Overdue             int64               `json:"overdue" doc:"Undone, overdue-or-due-today tasks in readable projects right now. Not window-bound."`
	Projects            []*UserProjectStats `json:"projects" doc:"Per-project breakdown across readable projects with any open, completed-in-window, or overdue tasks."`
}

// GetUserStats aggregates personal statistics for the authenticated user over
// the given window in weeks (clamped to [1, MaxUserStatsWindowWeeks];
// weeks <= 0 uses DefaultUserStatsWindowWeeks). Project scoping and the
// overdue boundary mirror GetProjectTaskCounts so the two never disagree.
func GetUserStats(s *xorm.Session, a web.Auth, weeks int) (*UserStats, error) {
	weeks = clampUserStatsWindow(weeks)

	u, err := user.GetFromAuth(a)
	if err != nil {
		return nil, err
	}

	// The auth user carried on the JWT context is partial and does not include
	// the timezone; reload it from the database to read the configured value.
	fullUser, err := user.GetUserByID(s, u.ID)
	if err != nil {
		return nil, err
	}

	loc, err := userTimezoneLocation(fullUser)
	if err != nil {
		return nil, err
	}
	boundary := startOfTomorrowAt(time.Now(), loc)
	// Step back in the user's timezone (not on the UTC instant) so the start
	// lands on local midnight even across a DST transition in the window;
	// AddDate on the UTC-normalized boundary would preserve its UTC offset and
	// leave windowStart at 23:00/01:00 local, producing a spurious leading bar.
	windowStart := boundary.In(loc).AddDate(0, 0, -weeks*7).UTC()

	stats := &UserStats{
		CompletedPerDay: zeroFilledDays(windowStart, boundary, loc),
		Projects:        []*UserProjectStats{},
	}

	projectStats := make(map[int64]*UserProjectStats)
	projectRow := func(id int64) *UserProjectStats {
		p, ok := projectStats[id]
		if !ok {
			p = &UserProjectStats{ProjectID: id}
			projectStats[id] = p
		}
		return p
	}

	dayIndex := make(map[string]*UserStatsDay, len(stats.CompletedPerDay))
	for _, d := range stats.CompletedPerDay {
		dayIndex[d.Date] = d
	}

	// One windowed scan for completions, grouped in Go by day and by project.
	var completed []*Task
	err = s.
		Where(accessibleProjectIDsSubquery(a, "project_id")).
		And("done = ?", true).
		And("done_at >= ? AND done_at < ?", windowStart, boundary).
		Cols("project_id", "done_at").
		Find(&completed)
	if err != nil {
		return nil, err
	}
	for _, t := range completed {
		stats.CompletedInProjects++
		projectRow(t.ProjectID).CompletedInWindow++
		if d, ok := dayIndex[t.DoneAt.In(loc).Format("2006-01-02")]; ok {
			d.Count++
		}
	}

	// One windowed count for authored tasks; unlike CompletedInProjects this is
	// scoped to the requesting user (see the honest-labeling invariant above).
	stats.CreatedByMe, err = s.
		Where(accessibleProjectIDsSubquery(a, "project_id")).
		And("created_by_id = ?", fullUser.ID).
		And("created >= ? AND created < ?", windowStart, boundary).
		Count(&Task{})
	if err != nil {
		return nil, err
	}

	// One unwindowed scan for open/overdue snapshots, same boundary as GetProjectTaskCounts.
	var undone []*Task
	err = s.
		Where(accessibleProjectIDsSubquery(a, "project_id")).
		And("done = ?", false).
		Cols("project_id", "due_date").
		Find(&undone)
	if err != nil {
		return nil, err
	}
	for _, t := range undone {
		stats.Open++
		p := projectRow(t.ProjectID)
		p.Open++
		if !t.DueDate.IsZero() && t.DueDate.Before(boundary) {
			stats.Overdue++
			p.Overdue++
		}
	}

	for _, p := range projectStats {
		stats.Projects = append(stats.Projects, p)
	}
	sort.Slice(stats.Projects, func(i, j int) bool {
		return stats.Projects[i].ProjectID < stats.Projects[j].ProjectID
	})

	return stats, nil
}

// clampUserStatsWindow is defense-in-depth for direct/non-HTTP callers; the
// v2 route rejects out-of-range weeks with a 422 before reaching here.
func clampUserStatsWindow(weeks int) int {
	if weeks <= 0 {
		return DefaultUserStatsWindowWeeks
	}
	if weeks > MaxUserStatsWindowWeeks {
		return MaxUserStatsWindowWeeks
	}
	return weeks
}

// zeroFilledDays returns one entry per calendar day in [start, end) in loc,
// each initialized to a zero count.
func zeroFilledDays(start, end time.Time, loc *time.Location) []*UserStatsDay {
	startLocal := start.In(loc)
	cursor := time.Date(startLocal.Year(), startLocal.Month(), startLocal.Day(), 0, 0, 0, 0, loc)
	endLocal := end.In(loc)

	days := make([]*UserStatsDay, 0)
	for cursor.Before(endLocal) {
		days = append(days, &UserStatsDay{Date: cursor.Format("2006-01-02")})
		cursor = cursor.AddDate(0, 0, 1)
	}
	return days
}
