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

func TestWebhook_Create(t *testing.T) {
	doer := &user.User{ID: 1}

	t.Run("rejected on template project", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		_, err := s.ID(1).Cols("is_template").Update(&Project{IsTemplate: true})
		require.NoError(t, err)

		w := &Webhook{
			ProjectID: 1,
			TargetURL: "https://example.com/hook",
			Events:    []string{"task.updated"},
		}
		err = w.Create(s, doer)
		require.Error(t, err)
		assert.True(t, IsErrProjectIsTemplate(err), "webhook on a template must return ErrProjectIsTemplate")
	})
}
