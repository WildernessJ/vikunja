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

	"code.vikunja.io/api/pkg/user"
	"code.vikunja.io/api/pkg/web"

	"xorm.io/xorm"
)

// TemplateListItem is a single entry in a user's template library.
type TemplateListItem struct {
	ID          int64     `json:"id" readOnly:"true" doc:"The unique numeric id of the template."`
	Title       string    `json:"title" doc:"The name of the template."`
	Description string    `json:"description" doc:"The description of the template."`
	TaskCount   int64     `json:"task_count" readOnly:"true" doc:"The number of tasks contained in the template."`
	OwnerID     int64     `json:"owner_id" readOnly:"true" doc:"The id of the user who owns the template."`
	Created     time.Time `json:"created" readOnly:"true" doc:"A timestamp when the template was created."`
	Updated     time.Time `json:"updated" readOnly:"true" doc:"A timestamp when the template was last updated."`
}

// GetTemplateByID loads a template project by its id. It returns
// ErrProjectDoesNotExist when the id does not exist or is not a template, so
// the template-scoped endpoints 404 rather than acting on a regular project.
func GetTemplateByID(s *xorm.Session, id int64) (*Project, error) {
	project, err := GetProjectSimpleByID(s, id)
	if err != nil {
		return nil, err
	}
	if !project.IsTemplate {
		return nil, ErrProjectDoesNotExist{ID: id}
	}
	return project, nil
}

// GetTemplatesForUser returns the templates the auth can access (owned +
// shared), with task counts, paginated. Permission scoping is inherited from
// getAllProjectsForUser; only template projects are kept.
func GetTemplatesForUser(s *xorm.Session, a web.Auth, search string, page, perPage int) (templates []*TemplateListItem, total int64, err error) {
	u, err := user.GetFromAuth(a)
	if err != nil {
		return nil, 0, err
	}

	all, _, err := getAllProjectsForUser(s, u.ID, &projectOptions{
		search:           search,
		user:             u,
		page:             -1,
		includeTemplates: true,
	})
	if err != nil {
		return nil, 0, err
	}

	templateProjects := make([]*Project, 0)
	ids := make([]int64, 0)
	for _, p := range all {
		if p.ID > 0 && p.IsTemplate {
			templateProjects = append(templateProjects, p)
			ids = append(ids, p.ID)
		}
	}

	counts, err := taskCountsByProject(s, ids)
	if err != nil {
		return nil, 0, err
	}

	total = int64(len(templateProjects))

	limit, start := getLimitFromPageIndex(page, perPage)
	if limit > 0 {
		if start > len(templateProjects) {
			start = len(templateProjects)
		}
		end := start + limit
		if end > len(templateProjects) {
			end = len(templateProjects)
		}
		templateProjects = templateProjects[start:end]
	}

	templates = make([]*TemplateListItem, 0, len(templateProjects))
	for _, p := range templateProjects {
		templates = append(templates, &TemplateListItem{
			ID:          p.ID,
			Title:       p.Title,
			Description: p.Description,
			TaskCount:   counts[p.ID],
			OwnerID:     p.OwnerID,
			Created:     p.Created,
			Updated:     p.Updated,
		})
	}

	return templates, total, nil
}

func taskCountsByProject(s *xorm.Session, projectIDs []int64) (map[int64]int64, error) {
	counts := make(map[int64]int64, len(projectIDs))
	if len(projectIDs) == 0 {
		return counts, nil
	}

	type countRow struct {
		ProjectID int64 `xorm:"project_id"`
		Count     int64 `xorm:"count"`
	}
	rows := []*countRow{}
	err := s.
		Table("tasks").
		Select("project_id, count(*) as count").
		In("project_id", projectIDs).
		GroupBy("project_id").
		Find(&rows)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		counts[r.ProjectID] = r.Count
	}
	return counts, nil
}
