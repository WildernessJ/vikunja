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

package handler

import (
	"errors"
	"fmt"

	"code.vikunja.io/api/pkg/log"
	"code.vikunja.io/api/pkg/models"
	"code.vikunja.io/api/pkg/web"

	"github.com/labstack/echo/v5"
)

// WebHandler defines the webhandler object
// This does web stuff, aka returns json etc. Uses CRUDable Methods to get the data
type WebHandler struct {
	EmptyStruct func() CObject
}

// CObject is the definition of our object, holds the structs
type CObject interface {
	web.CRUDable
	web.Permissions
}

// bindAndForcePathValues binds the request, then re-applies the URL's path params
// so the body cannot override a value the route already names — echo binds the
// body last, and permission checks compare against the bound value. This is the
// same precedence /api/v2 implements per handler. See issue #86.
// Relies on every param-tagged field being of int64 or string kind (named
// string types like RelationKind included): a BindUnmarshaler carrying state
// would not survive being bound twice.
// Takes any, not CObject, so the read handlers and custom v1 handlers can
// reuse it rather than hand-copy the precedence a fourth time.
func bindAndForcePathValues(ctx *echo.Context, currentStruct any) error {
	if err := ctx.Bind(currentStruct); err != nil {
		return invalidModelErr(err)
	}

	if err := echo.BindPathValues(ctx, currentStruct); err != nil {
		return invalidModelErr(err)
	}

	return nil
}

func invalidModelErr(err error) error {
	log.Debugf("Invalid model error. Internal error was: %s", err.Error())
	var he *echo.HTTPError
	if errors.As(err, &he) {
		return models.ErrInvalidModel{Message: fmt.Sprintf("%v", he.Message), Err: err}
	}
	return models.ErrInvalidModel{Err: err}
}
