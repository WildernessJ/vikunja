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

package caldavtests

import (
	"testing"
	"time"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/models"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A completed repeating VTODO completes one iteration on create, as on update
// and as a Task.Create through the API does (#119, #124).
func TestCalDAVCompletedRepeatingTaskCompletesOneIteration(t *testing.T) {
	e := setupTestEnv(t)
	due := time.Date(2030, 6, 1, 9, 0, 0, 0, time.UTC)
	vtodo := NewVTodo("completed-repeating", "Completed Repeating").
		Due(due).
		Rrule("FREQ=DAILY").
		Status("COMPLETED").
		Completed(time.Date(2030, 5, 31, 9, 0, 0, 0, time.UTC)).
		Build()

	stored := func() *models.Task {
		s := db.NewSession()
		defer s.Close()
		task := &models.Task{}
		has, err := s.Where("uid = ?", "completed-repeating").Get(task)
		require.NoError(t, err)
		require.True(t, has)
		return task
	}

	rec := caldavPUT(t, e, "/dav/projects/36/completed-repeating.ics", vtodo)
	require.True(t, rec.Code >= 200 && rec.Code < 300, "create PUT failed with status %d. Body:\n%s", rec.Code, rec.Body.String())
	created := stored()
	assert.Equal(t, models.TaskRepeatModeRRule, created.RepeatMode)
	assert.False(t, created.Done)
	assert.Equal(t, due.AddDate(0, 0, 1).Unix(), created.DueDate.Unix())

	rec = caldavPUT(t, e, "/dav/projects/36/completed-repeating.ics", vtodo)
	require.True(t, rec.Code >= 200 && rec.Code < 300, "update PUT failed with status %d. Body:\n%s", rec.Code, rec.Body.String())
	updated := stored()
	assert.False(t, updated.Done)
	assert.Equal(t, due.AddDate(0, 0, 2).Unix(), updated.DueDate.Unix())
}
