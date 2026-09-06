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

	"xorm.io/xorm"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBucket_ReadAll(t *testing.T) {
	t.Run("normal", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		testuser := &user.User{ID: 1}
		b := &TaskCollection{
			ProjectViewID: 4,
			ProjectID:     1,
		}
		bucketsInterface, _, _, err := b.ReadAll(s, testuser, "", 0, 0)
		require.NoError(t, err)

		buckets, is := bucketsInterface.([]*Bucket)
		assert.True(t, is)

		// Assert that we have a user for each bucket
		assert.Equal(t, testuser.ID, buckets[0].CreatedBy.ID)
		assert.Equal(t, testuser.ID, buckets[1].CreatedBy.ID)
		assert.Equal(t, testuser.ID, buckets[2].CreatedBy.ID)

		// Assert our three test buckets
		assert.Len(t, buckets, 3)

		// Assert all tasks are in the right bucket
		assert.Len(t, buckets[0].Tasks, 11)
		assert.Len(t, buckets[1].Tasks, 3)
		assert.Len(t, buckets[2].Tasks, 4)

		// Assert we have bucket 1, 2, 3 but not 4 (that belongs to a different project) and their position
		assert.Equal(t, int64(1), buckets[0].ID)
		assert.Equal(t, int64(2), buckets[1].ID)
		assert.Equal(t, int64(3), buckets[2].ID)

		// Kinda assert all tasks are in the right buckets
		assert.Equal(t, int64(1), buckets[0].Tasks[0].BucketID)
		assert.Equal(t, int64(1), buckets[0].Tasks[1].BucketID)

		assert.Equal(t, int64(2), buckets[1].Tasks[0].BucketID)
		assert.Equal(t, int64(2), buckets[1].Tasks[1].BucketID)
		assert.Equal(t, int64(2), buckets[1].Tasks[2].BucketID)

		assert.Equal(t, int64(3), buckets[2].Tasks[0].BucketID)
		assert.Equal(t, int64(3), buckets[2].Tasks[1].BucketID)
		assert.Equal(t, int64(3), buckets[2].Tasks[2].BucketID)
	})
	t.Run("filtered", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		testuser := &user.User{ID: 1}
		b := &TaskCollection{
			ProjectViewID: 4,
			ProjectID:     1,
			Filter:        "title ~ 'done'",
		}
		bucketsInterface, _, _, err := b.ReadAll(s, testuser, "", -1, 0)
		require.NoError(t, err)

		buckets := bucketsInterface.([]*Bucket)
		assert.Len(t, buckets, 3)
		assert.Equal(t, int64(33), buckets[0].Tasks[0].ID)
		assert.Equal(t, int64(2), buckets[2].Tasks[0].ID)
	})
	t.Run("filtered by bucket", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		testuser := &user.User{ID: 1}
		b := &TaskCollection{
			ProjectViewID: 4,
			ProjectID:     1,
			Filter:        "title ~ 'task' && bucket_id = 2",
		}
		taskIn, _, _, err := b.ReadAll(s, testuser, "", -1, 0)
		require.NoError(t, err)

		tasks := taskIn.([]*Task)
		assert.Len(t, tasks, 3)
		assert.Equal(t, int64(3), tasks[0].ID)
		assert.Equal(t, int64(4), tasks[1].ID)
		assert.Equal(t, int64(5), tasks[2].ID)
	})
	t.Run("accessed by link share", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		linkShare := &LinkSharing{
			ID:         1,
			ProjectID:  1,
			Permission: PermissionRead,
		}
		b := &TaskCollection{
			ProjectID:     1,
			ProjectViewID: 4,
		}
		result, _, _, err := b.ReadAll(s, linkShare, "", 0, 0)
		require.NoError(t, err)
		buckets, _ := result.([]*Bucket)
		assert.Len(t, buckets, 3)
		assert.NotNil(t, buckets[0].CreatedBy)
		assert.Equal(t, int64(1), buckets[0].CreatedByID)
	})
	t.Run("created by link share", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		testuser := &user.User{ID: 12}
		b := &TaskCollection{
			ProjectID:     23,
			ProjectViewID: 92,
		}
		result, _, _, err := b.ReadAll(s, testuser, "", 0, 0)
		require.NoError(t, err)
		buckets, _ := result.([]*Bucket)
		assert.Len(t, buckets, 1)
		assert.NotNil(t, buckets[0].CreatedBy)
		assert.Equal(t, int64(-2), buckets[0].CreatedByID)
	})
}

func TestBucket_Delete(t *testing.T) {
	u := &user.User{ID: 1}

	t.Run("normal", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{
			ID:            2, // The second bucket only has 3 tasks
			ProjectID:     1,
			ProjectViewID: 4,
		}
		err := b.Delete(s, u)
		require.NoError(t, err)
		err = s.Commit()
		require.NoError(t, err)

		// Assert all tasks have been moved to bucket 1 as that one is the first
		tasks := []*TaskBucket{}
		err = s.Where("bucket_id = ?", 1).Find(&tasks)
		require.NoError(t, err)
		assert.Len(t, tasks, 14)
		db.AssertMissing(t, "buckets", map[string]interface{}{
			"id":              2,
			"project_view_id": 4,
		})
	})
	t.Run("last bucket in project", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{
			ID:            34,
			ProjectID:     18,
			ProjectViewID: 72,
		}
		err := b.Delete(s, u)
		require.Error(t, err)
		assert.True(t, IsErrCannotRemoveLastBucket(err))
		err = s.Commit()
		require.NoError(t, err)

		db.AssertExists(t, "buckets", map[string]interface{}{
			"id":              34,
			"project_view_id": 72,
		}, false)
	})
	t.Run("delete default bucket relocates tasks to a surviving bucket", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// Bucket 1 is both the default and the leftmost bucket of view 4
		b := &Bucket{
			ID:            1,
			ProjectID:     1,
			ProjectViewID: 4,
		}
		err := b.Delete(s, u)
		require.NoError(t, err)
		err = s.Commit()
		require.NoError(t, err)

		// No task may still point at the deleted bucket
		orphaned := []*TaskBucket{}
		err = s.Where("bucket_id = ?", 1).Find(&orphaned)
		require.NoError(t, err)
		assert.Empty(t, orphaned)
		// Tasks moved to the leftmost surviving bucket
		moved := []*TaskBucket{}
		err = s.Where("bucket_id = ?", 2).Find(&moved)
		require.NoError(t, err)
		assert.Len(t, moved, 14)
		db.AssertMissing(t, "buckets", map[string]interface{}{
			"id":              1,
			"project_view_id": 4,
		})
	})
	t.Run("stale default bucket id falls back to a surviving bucket", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// A kanban→list→kanban kind switch can leave default_bucket_id
		// pointing at a bucket that no longer exists
		_, err := s.Where("id = ?", 4).
			Cols("default_bucket_id").
			Update(&ProjectView{DefaultBucketID: 9999})
		require.NoError(t, err)

		b := &Bucket{
			ID:            1,
			ProjectID:     1,
			ProjectViewID: 4,
		}
		err = b.Delete(s, u)
		require.NoError(t, err)
		err = s.Commit()
		require.NoError(t, err)

		orphaned := []*TaskBucket{}
		err = s.Where("bucket_id = ? OR bucket_id = ?", 1, 9999).Find(&orphaned)
		require.NoError(t, err)
		assert.Empty(t, orphaned)
		moved := []*TaskBucket{}
		err = s.Where("bucket_id = ?", 2).Find(&moved)
		require.NoError(t, err)
		assert.Len(t, moved, 14)
	})
	t.Run("done bucket should be reset", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{
			ID:            3,
			ProjectID:     1,
			ProjectViewID: 4,
		}
		err := b.Delete(s, u)
		require.NoError(t, err)

		err = s.Commit()
		require.NoError(t, err)

		db.AssertExists(t, "project_views", map[string]interface{}{
			"id":             b.ProjectViewID,
			"done_bucket_id": 0,
		}, false)
	})
}

func TestBucket_CanDoBucket(t *testing.T) {
	u := &user.User{ID: 1}

	t.Run("bucket in the url's view", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{ID: 1, ProjectID: 1, ProjectViewID: 4}
		can, err := b.canDoBucket(s, u)
		require.NoError(t, err)
		assert.True(t, can)
	})
	t.Run("bucket of another view of the same project", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// Bucket 1 belongs to view 4; the URL names view 1 of the same project
		b := &Bucket{ID: 1, ProjectID: 1, ProjectViewID: 1}
		can, err := b.canDoBucket(s, u)
		require.Error(t, err)
		assert.True(t, IsErrBucketDoesNotExist(err))
		assert.False(t, can)
	})
}

func TestGetDefaultBucketID(t *testing.T) {
	t.Run("live stored default", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		id, err := getDefaultBucketID(s, &ProjectView{ID: 4, DefaultBucketID: 1})
		require.NoError(t, err)
		assert.Equal(t, int64(1), id)
	})
	t.Run("stale default falls back to the leftmost bucket", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// A kanban→list kind switch drops the default-clearing write, so a
		// nonzero default can point at a bucket that no longer exists
		id, err := getDefaultBucketID(s, &ProjectView{ID: 4, DefaultBucketID: 9999})
		require.NoError(t, err)
		assert.Equal(t, int64(1), id)
	})
	t.Run("default pointing at another view's bucket falls back", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// Bucket 4 exists but belongs to view 8, not view 4
		id, err := getDefaultBucketID(s, &ProjectView{ID: 4, DefaultBucketID: 4})
		require.NoError(t, err)
		assert.Equal(t, int64(1), id)
	})
}

func TestBucket_Update(t *testing.T) {

	testAndAssertBucketUpdate := func(t *testing.T, b *Bucket, s *xorm.Session) {
		err := b.Update(s, &user.User{ID: 1})
		require.NoError(t, err)

		err = s.Commit()
		require.NoError(t, err)

		db.AssertExists(t, "buckets", map[string]interface{}{
			"id":    1,
			"title": b.Title,
			"limit": b.Limit,
		}, false)
	}

	t.Run("normal", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{
			ID:            1,
			Title:         "New Name",
			Limit:         2,
			ProjectViewID: 4,
		}

		testAndAssertBucketUpdate(t, b, s)
	})
	t.Run("reset limit", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{
			ID:            1,
			Title:         "testbucket1",
			Limit:         0,
			ProjectViewID: 4,
		}

		testAndAssertBucketUpdate(t, b, s)
	})
	t.Run("does not persist project_view_id", func(t *testing.T) {
		// GHSA-569v-q83c-3j3g: mass-assigning project_view_id relocated a
		// bucket into another tenant's view. Since #86 a body value never
		// reaches the model on the write handlers (the URL's view is
		// re-forced after binding; the read handlers still bind body-last, #90) and
		// canDoBucket rejects a URL≠stored mismatch, but Update's column
		// allow-list is the inner defense layer and needs its own pressure —
		// this calls Update directly, bypassing both.
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{
			ID:            1,
			Title:         "testbucket1",
			ProjectViewID: 80,
		}
		err := b.Update(s, &user.User{ID: 1})
		require.NoError(t, err)
		err = s.Commit()
		require.NoError(t, err)

		db.AssertExists(t, "buckets", map[string]interface{}{
			"id":              1,
			"project_view_id": 4,
		}, false)
		db.AssertMissing(t, "buckets", map[string]interface{}{
			"id":              1,
			"project_view_id": 80,
		})
	})
}

func TestBucket_CanCreate(t *testing.T) {
	t.Run("archived through parent", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{ProjectID: 21, ProjectViewID: 84}
		_, err := b.CanCreate(s, &user.User{ID: 1})
		assert.True(t, IsErrProjectIsArchived(err))
	})
	t.Run("archived individually", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{ProjectID: 22, ProjectViewID: 88}
		_, err := b.CanCreate(s, &user.User{ID: 1})
		assert.True(t, IsErrProjectIsArchived(err))
	})
	t.Run("not archived", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{ProjectID: 1, ProjectViewID: 4}
		can, err := b.CanCreate(s, &user.User{ID: 1})
		require.NoError(t, err)
		assert.True(t, can)
	})
	t.Run("no permission", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{ProjectID: 1, ProjectViewID: 4}
		can, err := b.CanCreate(s, &user.User{ID: 2})
		require.NoError(t, err)
		assert.False(t, can)
	})
}

func TestBucket_CanUpdate(t *testing.T) {
	t.Run("archived through parent", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{ID: 19, ProjectID: 21, ProjectViewID: 84}
		_, err := b.CanUpdate(s, &user.User{ID: 1})
		assert.True(t, IsErrProjectIsArchived(err))
	})
	t.Run("archived individually", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{ID: 20, ProjectID: 22, ProjectViewID: 88}
		_, err := b.CanUpdate(s, &user.User{ID: 1})
		assert.True(t, IsErrProjectIsArchived(err))
	})
	t.Run("not archived", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		b := &Bucket{ID: 1, ProjectID: 1, ProjectViewID: 4}
		can, err := b.CanUpdate(s, &user.User{ID: 1})
		require.NoError(t, err)
		assert.True(t, can)
	})
}
