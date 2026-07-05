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

// TestProjectView_DefaultEqualsDoneBucketValidation covers the rule that a view's
// default and done bucket must be distinct buckets. Allowing them to be the same
// reopens the bucket-limit bypass for repeating tasks (see issue #26).
func TestProjectView_DefaultEqualsDoneBucketValidation(t *testing.T) {
	u := &user.User{ID: 1}

	t.Run("create is rejected when default equals done bucket", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		pv := &ProjectView{
			Title:                   "default==done",
			ProjectID:               1,
			ViewKind:                ProjectViewKindKanban,
			BucketConfigurationMode: BucketConfigurationModeManual,
			DefaultBucketID:         3,
			DoneBucketID:            3,
		}
		err := pv.Create(s, u)
		require.Error(t, err)
		assert.True(t, IsErrProjectViewDefaultBucketEqualsDoneBucket(err))
	})

	t.Run("create succeeds with distinct default and done buckets", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		pv := &ProjectView{
			Title:                   "distinct buckets",
			ProjectID:               1,
			ViewKind:                ProjectViewKindKanban,
			BucketConfigurationMode: BucketConfigurationModeManual,
		}
		err := pv.Create(s, u)
		require.NoError(t, err)
		require.NotZero(t, pv.DefaultBucketID)
		require.NotZero(t, pv.DoneBucketID)
		assert.NotEqual(t, pv.DefaultBucketID, pv.DoneBucketID)
	})

	t.Run("update is rejected when default equals done bucket", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// View 4 exists with default bucket 1 and done bucket 3.
		pv := &ProjectView{
			ID:              4,
			ProjectID:       1,
			DefaultBucketID: 3,
			DoneBucketID:    3,
		}
		err := pv.Update(s, u)
		require.Error(t, err)
		assert.True(t, IsErrProjectViewDefaultBucketEqualsDoneBucket(err))
	})

	t.Run("update succeeds with distinct default and done buckets", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		pv := &ProjectView{
			ID:              4,
			ProjectID:       1,
			DefaultBucketID: 1,
			DoneBucketID:    3,
		}
		err := pv.Update(s, u)
		require.NoError(t, err)
	})
}
