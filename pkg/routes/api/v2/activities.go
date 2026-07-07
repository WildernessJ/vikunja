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
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/models"

	"github.com/danielgtaylor/huma/v2"
)

// activityListBody is the keyset-paginated feed envelope. Unlike the offset
// Paginated envelope used elsewhere on v2, the feed pages by an opaque cursor
// so pages stay stable while new activity streams in between requests (SC-003).
type activityListBody struct {
	Body struct {
		Items      []*models.Activity `json:"items" doc:"The activity entries, newest first."`
		NextCursor string             `json:"next_cursor" doc:"Opaque cursor for the next (older) page. Empty when there are no more entries; otherwise pass it back as the cursor query param."`
	}
}

func init() { AddRouteRegistrar(RegisterActivityRoutes) }

// RegisterActivityRoutes wires the activity feed onto the Huma API. These are
// read-only, keyset-paginated custom routes (not generic CRUD).
func RegisterActivityRoutes(api huma.API) {
	tags := []string{"activities"}

	Register(api, huma.Operation{
		OperationID: "activities-list-all",
		Summary:     "List activity across all your projects",
		Description: "Returns activity from every project you can read, newest first, keyset-paginated. Filter by actor_id and verb; follow next_cursor for older entries.",
		Method:      http.MethodGet,
		Path:        "/activities",
		Tags:        tags,
	}, activitiesListAll)

	Register(api, huma.Operation{
		OperationID: "activities-list-project",
		Summary:     "List a project's activity",
		Description: "Returns one project's activity, newest first, keyset-paginated. Requires read access to the project (403 otherwise). Filter by actor_id and verb; follow next_cursor for older entries.",
		Method:      http.MethodGet,
		Path:        "/projects/{project}/activities",
		Tags:        tags,
	}, activitiesListProject)
}

func activitiesListAll(ctx context.Context, in *struct {
	PerPage int    `query:"per_page" default:"50" minimum:"1" maximum:"100" doc:"Page size (max 100)."`
	Cursor  string `query:"cursor" doc:"Opaque cursor from a previous response's next_cursor. Omit for the first (newest) page."`
	ActorID int64  `query:"actor_id" doc:"Only return activity performed by this user id."`
	Verb    string `query:"verb" doc:"Only return activity of this verb, e.g. task_completed."`
}) (*activityListBody, error) {
	a, err := authFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	q, err := buildActivityQuery(in.Cursor, in.PerPage, in.ActorID, in.Verb)
	if err != nil {
		return nil, err
	}

	s := db.NewSession()
	defer s.Close()

	activities, err := models.GetActivityForUser(s, a, q)
	if err != nil {
		return nil, translateDomainError(err)
	}
	return activityResponse(activities, in.PerPage), nil
}

func activitiesListProject(ctx context.Context, in *struct {
	ProjectID int64  `path:"project"`
	PerPage   int    `query:"per_page" default:"50" minimum:"1" maximum:"100" doc:"Page size (max 100)."`
	Cursor    string `query:"cursor" doc:"Opaque cursor from a previous response's next_cursor. Omit for the first (newest) page."`
	ActorID   int64  `query:"actor_id" doc:"Only return activity performed by this user id."`
	Verb      string `query:"verb" doc:"Only return activity of this verb, e.g. task_completed."`
}) (*activityListBody, error) {
	a, err := authFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	q, err := buildActivityQuery(in.Cursor, in.PerPage, in.ActorID, in.Verb)
	if err != nil {
		return nil, err
	}

	s := db.NewSession()
	defer s.Close()

	activities, err := models.GetActivityForProject(s, a, in.ProjectID, q)
	if err != nil {
		return nil, translateDomainError(err)
	}
	return activityResponse(activities, in.PerPage), nil
}

// buildActivityQuery turns the request params into a model query. It asks for
// one extra row (Limit = perPage+1) so the handler can tell whether a next
// page exists without a separate count.
func buildActivityQuery(cursor string, perPage int, actorID int64, verb string) (*models.ActivityQuery, error) {
	q := &models.ActivityQuery{
		ActorID: actorID,
		Verb:    verb,
		Limit:   perPage + 1,
	}
	if cursor != "" {
		created, id, err := decodeActivityCursor(cursor)
		if err != nil {
			return nil, err
		}
		q.HasCursor = true
		q.CursorCreated = created
		q.CursorID = id
	}
	return q, nil
}

// activityResponse trims the over-fetched row and derives next_cursor from the
// last entry of the page actually returned.
func activityResponse(activities []*models.Activity, perPage int) *activityListBody {
	body := &activityListBody{}
	if len(activities) > perPage {
		activities = activities[:perPage]
		last := activities[len(activities)-1]
		body.Body.NextCursor = encodeActivityCursor(last.Created, last.ID)
	}
	if activities == nil {
		activities = []*models.Activity{}
	}
	body.Body.Items = activities
	return body
}

// encodeActivityCursor packs the (created, id) keyset position into an opaque,
// URL-safe token. Nanosecond precision keeps it exact across the round trip.
func encodeActivityCursor(created time.Time, id int64) string {
	raw := strconv.FormatInt(created.UnixNano(), 10) + ":" + strconv.FormatInt(id, 10)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// decodeActivityCursor reverses encodeActivityCursor, returning a 400 (never a
// 500) on any malformed input.
func decodeActivityCursor(cursor string) (time.Time, int64, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, 0, huma.Error400BadRequest("invalid cursor")
	}
	created, id, ok := strings.Cut(string(raw), ":")
	if !ok {
		return time.Time{}, 0, huma.Error400BadRequest("invalid cursor")
	}
	nanos, err := strconv.ParseInt(created, 10, 64)
	if err != nil {
		return time.Time{}, 0, huma.Error400BadRequest("invalid cursor")
	}
	parsedID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		return time.Time{}, 0, huma.Error400BadRequest("invalid cursor")
	}
	return time.Unix(0, nanos), parsedID, nil
}
