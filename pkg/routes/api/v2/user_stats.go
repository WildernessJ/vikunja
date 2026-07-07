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

func init() { AddRouteRegistrar(RegisterUserStatsRoutes) }

// RegisterUserStatsRoutes wires the personal-statistics endpoint. Not a
// CRUDable resource: it aggregates over the authenticated user's readable
// projects, so it opens its own session and reads auth from the context.
func RegisterUserStatsRoutes(api huma.API) {
	Register(api, huma.Operation{
		OperationID: "user-stats",
		Summary:     "Get personal statistics",
		Description: "Returns personal productivity statistics for the authenticated user over the requested window: completions per day, window totals (completed_in_projects, created_by_me), point-in-time totals (open, overdue), and a per-project breakdown. All figures are scoped to projects the user can read. completed_in_projects counts completions by anyone in those projects (the data model has no completed-by column); created_by_me counts only tasks the user authored. open and overdue are point-in-time and ignore the window.",
		Method:      http.MethodGet,
		Path:        "/user/stats",
		Tags:        []string{"user"},
	}, userStats)
}

func userStats(ctx context.Context, in *struct {
	Weeks int `query:"weeks" default:"12" minimum:"1" maximum:"52" doc:"The window in weeks the completed/created series and totals cover. Must be between 1 and 52; defaults to 12. Does not affect the open and overdue totals, which are point-in-time."`
}) (*singleBody[models.UserStats], error) {
	a, err := authFromCtx(ctx)
	if err != nil {
		return nil, err
	}

	s := db.NewSession()
	defer s.Close()

	stats, err := models.GetUserStats(s, a, in.Weeks)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}

	if err := s.Commit(); err != nil {
		return nil, translateDomainError(err)
	}

	return &singleBody[models.UserStats]{Body: stats}, nil
}
