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
	"time"

	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/user"
	"code.vikunja.io/api/pkg/web"

	"xorm.io/xorm"
)

// ProjectTaskCount holds the per-project badge counts shown in the sidebar.
type ProjectTaskCount struct {
	Open       int64 `json:"open" doc:"Number of undone tasks in the project."`
	DueOverdue int64 `json:"due_overdue" doc:"Number of undone tasks that are overdue or due today, evaluated against the start of tomorrow in the user's timezone."`
}

// GetProjectTaskCounts returns, for every real project (id > 0) the auth can
// read, the number of undone tasks and the number of undone tasks that are
// overdue or due today. The due/overdue boundary is start-of-tomorrow in the
// user's configured timezone; it is computed in Go so the comparison is
// portable across SQLite/MySQL/Postgres.
func GetProjectTaskCounts(s *xorm.Session, a web.Auth) (map[int64]*ProjectTaskCount, error) {
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

	boundary, err := startOfTomorrowInUserTimezone(fullUser)
	if err != nil {
		return nil, err
	}

	projects, _, err := getAllProjectsForUser(s, fullUser.ID, &projectOptions{getArchived: true})
	if err != nil {
		return nil, err
	}

	counts := make(map[int64]*ProjectTaskCount, len(projects))
	projectIDs := make([]int64, 0, len(projects))
	for _, p := range projects {
		if p.ID <= 0 {
			continue
		}
		counts[p.ID] = &ProjectTaskCount{}
		projectIDs = append(projectIDs, p.ID)
	}

	if len(projectIDs) == 0 {
		return counts, nil
	}

	var tasks []*Task
	err = s.
		In("project_id", projectIDs).
		And("done = ?", false).
		Cols("project_id", "due_date").
		Find(&tasks)
	if err != nil {
		return nil, err
	}

	for _, t := range tasks {
		c, ok := counts[t.ProjectID]
		if !ok {
			continue
		}
		c.Open++
		if !t.DueDate.IsZero() && t.DueDate.Before(boundary) {
			c.DueOverdue++
		}
	}

	return counts, nil
}

// startOfTomorrowInUserTimezone mirrors the timezone handling in
// getUndoneOverdueTasks: use the user's configured timezone, falling back to
// the instance default when empty.
func startOfTomorrowInUserTimezone(u *user.User) (time.Time, error) {
	tzName := u.Timezone
	if tzName == "" {
		tzName = config.GetTimeZone().String()
	}

	loc, err := time.LoadLocation(tzName)
	if err != nil {
		return time.Time{}, err
	}

	now := time.Now().In(loc)
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	return startOfToday.AddDate(0, 0, 1).UTC(), nil
}
