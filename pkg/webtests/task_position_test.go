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
	"net/http"
	"testing"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/models"
	"code.vikunja.io/api/pkg/web/handler"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"xorm.io/builder"
)

// A position below MinPositionSpacing makes the update recalculate every
// position in the target view. Without the view/project check in
// TaskPosition.CanUpdate, a user with write on any one task could point the
// body at a foreign view and wipe its stored ordering (#88).
func TestTaskPositionForeignViewDoesNotRecalculate(t *testing.T) {
	testHandler := webHandlerTest{
		user: &testuser1,
		strFunc: func() handler.CObject {
			return &models.TaskPosition{}
		},
		t: t,
	}

	// Task 1 is in project 1 (testuser1 owns it); view 21 belongs to project 6,
	// on which testuser1 only has read access.
	_, err := testHandler.testUpdateWithUser(nil, map[string]string{"task": "1"}, `{"project_view_id":21,"position":0.001}`)
	require.Error(t, err)
	assert.Equal(t, http.StatusNotFound, getHTTPErrorCode(err))
	assertHandlerErrorCode(t, err, models.ErrCodeProjectViewDoesNotExist)

	db.AssertCount(t, "task_positions", builder.Eq{"project_view_id": 21}, 1)
	db.AssertExists(t, "task_positions", map[string]interface{}{
		"task_id":         35,
		"project_view_id": 21,
		"position":        0,
	}, false)
}
