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
	"xorm.io/xorm"
)

type templateListBody struct {
	Body Paginated[*models.TemplateListItem]
}

// templateBody is the read/update shape for a single template. Title and
// Description are writable (rename); everything else is server-controlled.
type templateBody struct {
	ID          int64  `json:"id" readOnly:"true" doc:"The unique numeric id of the template."`
	Title       string `json:"title" minLength:"1" doc:"The name of the template."`
	Description string `json:"description" doc:"The description of the template."`
	OwnerID     int64  `json:"owner_id" readOnly:"true" doc:"The id of the user who owns the template."`
	TaskCount   int64  `json:"task_count" readOnly:"true" doc:"The number of tasks contained in the template."`
}

// RegisterTemplateRoutes wires the project-template endpoints onto the Huma API.
func RegisterTemplateRoutes(api huma.API) {
	tags := []string{"templates"}

	Register(api, huma.Operation{
		OperationID: "templates-list",
		Summary:     "List templates",
		Description: "Returns the templates the authenticated user can access (owned plus shared with them), with task counts. Templates never appear in the normal project list.",
		Method:      http.MethodGet,
		Path:        "/templates",
		Tags:        tags,
	}, templatesList)

	Register(api, huma.Operation{
		OperationID: "templates-read",
		Summary:     "Get a template",
		Description: "Returns a single template. Responds 404 when the id is not a template.",
		Method:      http.MethodGet,
		Path:        "/templates/{id}",
		Tags:        tags,
	}, templatesRead)

	Register(api, huma.Operation{
		OperationID: "templates-update",
		Summary:     "Update a template",
		Description: "Renames a template and updates its description. Requires write access; responds 404 when the id is not a template.",
		Method:      http.MethodPut,
		Path:        "/templates/{id}",
		Tags:        tags,
	}, templatesUpdate)

	Register(api, huma.Operation{
		OperationID: "templates-delete",
		Summary:     "Delete a template",
		Description: "Deletes a template and its contents. Requires delete access; responds 404 when the id is not a template.",
		Method:      http.MethodDelete,
		Path:        "/templates/{id}",
		Tags:        tags,
	}, templatesDelete)

	Register(api, huma.Operation{
		OperationID: "projects-save-as-template",
		Summary:     "Save a project as a template",
		Description: "Snapshots a project into a new template owned by the authenticated user. Requires write access to the source project. Child projects, link shares, webhooks and subscriptions are not included.",
		Method:      http.MethodPost,
		Path:        "/projects/{projectid}/save-as-template",
		Tags:        tags,
	}, projectsSaveAsTemplate)

	Register(api, huma.Operation{
		OperationID: "templates-instantiate",
		Summary:     "Create a project from a template",
		Description: "Creates a new regular project from a template, copying its content with all tasks reset to not-done. Requires read access to the template and, when a parent is given, create access under it. Responds 404 when the id is not a template.",
		Method:      http.MethodPost,
		Path:        "/templates/{id}/instantiate",
		Tags:        tags,
	}, templatesInstantiate)
}

func init() { AddRouteRegistrar(RegisterTemplateRoutes) }

func templatesList(ctx context.Context, in *struct {
	ListParams
}) (*templateListBody, error) {
	a, err := authFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	s := db.NewSession()
	defer s.Close()

	items, total, err := models.GetTemplatesForUser(s, a, in.Q, in.Page, in.PerPage)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	if err := s.Commit(); err != nil {
		return nil, translateDomainError(err)
	}
	return &templateListBody{Body: NewPaginated(items, total, in.Page, in.PerPage)}, nil
}

func templatesRead(ctx context.Context, in *struct {
	ID int64 `path:"id" doc:"The numeric id of the template."`
}) (*singleBody[templateBody], error) {
	a, err := authFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	s := db.NewSession()
	defer s.Close()

	template, err := models.GetTemplateByID(s, in.ID)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	canRead, _, err := template.CanRead(s, a)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	if !canRead {
		_ = s.Rollback()
		return nil, huma.Error403Forbidden("forbidden")
	}

	counts, err := taskCountBody(s, in.ID)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	if err := s.Commit(); err != nil {
		return nil, translateDomainError(err)
	}
	return &singleBody[templateBody]{Body: &templateBody{
		ID:          template.ID,
		Title:       template.Title,
		Description: template.Description,
		OwnerID:     template.OwnerID,
		TaskCount:   counts,
	}}, nil
}

func templatesUpdate(ctx context.Context, in *struct {
	ID   int64 `path:"id" doc:"The numeric id of the template."`
	Body templateBody
}) (*singleBody[templateBody], error) {
	a, err := authFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	s := db.NewSession()
	defer s.Close()

	template, err := models.GetTemplateByID(s, in.ID)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	canUpdate, err := template.CanUpdate(s, a)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	if !canUpdate {
		_ = s.Rollback()
		return nil, huma.Error403Forbidden("forbidden")
	}

	template.Title = in.Body.Title
	template.Description = in.Body.Description
	if _, err := s.ID(in.ID).Cols("title", "description").Update(template); err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}

	counts, err := taskCountBody(s, in.ID)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	if err := s.Commit(); err != nil {
		return nil, translateDomainError(err)
	}
	return &singleBody[templateBody]{Body: &templateBody{
		ID:          template.ID,
		Title:       template.Title,
		Description: template.Description,
		OwnerID:     template.OwnerID,
		TaskCount:   counts,
	}}, nil
}

func templatesDelete(ctx context.Context, in *struct {
	ID int64 `path:"id" doc:"The numeric id of the template."`
}) (*emptyBody, error) {
	a, err := authFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	s := db.NewSession()
	defer s.Close()

	template, err := models.GetTemplateByID(s, in.ID)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	canDelete, err := template.CanDelete(s, a)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	if !canDelete {
		_ = s.Rollback()
		return nil, huma.Error403Forbidden("forbidden")
	}
	if err := template.Delete(s, a); err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	if err := s.Commit(); err != nil {
		return nil, translateDomainError(err)
	}
	return &emptyBody{}, nil
}

type saveAsTemplatePayload struct {
	Name        string `json:"name" minLength:"1" doc:"The name of the new template."`
	Description string `json:"description" doc:"An optional description for the new template."`
}

func projectsSaveAsTemplate(ctx context.Context, in *struct {
	ProjectID int64 `path:"projectid" doc:"The numeric id of the project to snapshot into a template."`
	Body      saveAsTemplatePayload
}) (*singleBody[models.Project], error) {
	a, err := authFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	s := db.NewSession()
	defer s.Close()

	source, err := models.GetProjectSimpleByID(s, in.ProjectID)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	// Persistent snapshot exposure is gated tighter than one-shot duplicate's read.
	canWrite, err := source.CanWrite(s, a)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	if !canWrite {
		_ = s.Rollback()
		return nil, huma.Error403Forbidden("forbidden")
	}

	pd := &models.ProjectDuplicate{ProjectID: in.ProjectID, Project: source, AsTemplate: true}
	pd.Project.Title = in.Body.Name
	pd.Project.Description = in.Body.Description
	if err := pd.Create(s, a); err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	if err := s.Commit(); err != nil {
		return nil, translateDomainError(err)
	}
	return &singleBody[models.Project]{Body: pd.Project}, nil
}

type instantiatePayload struct {
	Title           string `json:"title" minLength:"1" doc:"The title of the new project."`
	ParentProjectID int64  `json:"parent_project_id" doc:"The id of the project under which the new project is created. Omit or 0 for top level."`
}

func templatesInstantiate(ctx context.Context, in *struct {
	ID   int64 `path:"id" doc:"The numeric id of the template to instantiate."`
	Body instantiatePayload
}) (*singleBody[models.Project], error) {
	a, err := authFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	s := db.NewSession()
	defer s.Close()

	if _, err := models.GetTemplateByID(s, in.ID); err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}

	pd := &models.ProjectDuplicate{
		ProjectID:       in.ID,
		ParentProjectID: in.Body.ParentProjectID,
		FromTemplate:    true,
	}
	canCreate, err := pd.CanCreate(s, a)
	if err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	if !canCreate {
		_ = s.Rollback()
		return nil, huma.Error403Forbidden("forbidden")
	}
	pd.Project.Title = in.Body.Title
	if err := pd.Create(s, a); err != nil {
		_ = s.Rollback()
		return nil, translateDomainError(err)
	}
	if err := s.Commit(); err != nil {
		return nil, translateDomainError(err)
	}
	return &singleBody[models.Project]{Body: pd.Project}, nil
}

func taskCountBody(s *xorm.Session, projectID int64) (int64, error) {
	return s.Where("project_id = ?", projectID).Count(&models.Task{})
}
