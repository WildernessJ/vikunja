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
	"testing"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProjectView_CanRead(t *testing.T) {
	t.Run("view outside the path project is rejected at CanRead", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		pv := &ProjectView{ID: 4, ProjectID: 2}
		can, _, err := pv.CanRead(s, &user.User{ID: 3})
		assert.False(t, can)
		var target *ErrProjectViewDoesNotExist
		require.ErrorAs(t, err, &target)
	})
	t.Run("view in the path project", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		pv := &ProjectView{ID: 4, ProjectID: 1}
		can, _, err := pv.CanRead(s, &user.User{ID: 1})
		require.NoError(t, err)
		assert.True(t, can)
	})
	t.Run("favorites pseudo project", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		pv := &ProjectView{ID: FavoritesPseudoProject.Views[0].ID, ProjectID: FavoritesPseudoProjectID}
		can, _, err := pv.CanRead(s, &user.User{ID: 1})
		require.NoError(t, err)
		assert.True(t, can)
	})
}
