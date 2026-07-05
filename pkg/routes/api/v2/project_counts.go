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

package apiv2

import (
	"context"
	"net/http"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/models"

	"github.com/danielgtaylor/huma/v2"
)

// projectCountsBody maps each real project id the caller can read to its
// undone/overdue task counts.
type projectCountsBody struct {
	Body map[int64]*models.ProjectTaskCount
}

func init() { AddRouteRegistrar(RegisterProjectCountsRoutes) }

// RegisterProjectCountsRoutes wires the per-project task-count endpoint used to
// render the sidebar badges.
func RegisterProjectCountsRoutes(api huma.API) {
	Register(api, huma.Operation{
		OperationID: "projects-counts",
		Summary:     "Per-project task counts",
		Description: "Returns, for every real project the authenticated user can read, the number of undone tasks (`open`) and the number of undone tasks that are overdue or due today (`due_overdue`). Due/overdue is evaluated against the start of tomorrow in the user's configured timezone, so overdue and due-today tasks are counted together. Pseudo-projects (favorites, saved filters) are excluded.",
		Method:      http.MethodGet,
		Path:        "/projects/counts",
		Tags:        []string{"projects"},
	}, projectsCounts)
}

func projectsCounts(ctx context.Context, _ *struct{}) (*projectCountsBody, error) {
	a, err := authFromCtx(ctx)
	if err != nil {
		return nil, err
	}

	s := db.NewSession()
	defer s.Close()

	counts, err := models.GetProjectTaskCounts(s, a)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	if err := s.Commit(); err != nil {
		return nil, translateDomainError(err)
	}

	return &projectCountsBody{Body: counts}, nil
}
