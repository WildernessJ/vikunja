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
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/models"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestTaskBucketV2 covers PUT /projects/{project}/views/{view}/buckets/{bucket}/tasks.
// It drives the Echo+Huma stack directly (humaRequest/humaTokenFor) because the
// route is an action sub-path webHandlerTestV2's buildURL doesn't model. Fixtures
// (project 1, view 4): bucket 1 default, bucket 2 "Doing" limit 3 (full), bucket 3 done.
func TestTaskBucketV2(t *testing.T) {
	const path = "/api/v2/projects/1/views/4/buckets/%d/tasks"

	t.Run("moves a task into a bucket", func(t *testing.T) {
		e, err := setupTestEnv()
		require.NoError(t, err)
		token := humaTokenFor(t, &testuser1)

		// Task 3 starts in bucket 2; move it into bucket 1 (neither full nor done).
		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf(path, 1), `{"task_id":3}`, token, "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
		assert.Contains(t, rec.Body.String(), `"task_id":3`)

		db.AssertExists(t, "task_buckets", map[string]interface{}{
			"task_id":   3,
			"bucket_id": 1,
		}, false)
	})

	t.Run("moving a task into the done bucket marks it done", func(t *testing.T) {
		e, err := setupTestEnv()
		require.NoError(t, err)
		token := humaTokenFor(t, &testuser1)

		// Bucket 3 is the done bucket on view 4; task 1 is not yet done.
		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf(path, 3), `{"task_id":1}`, token, "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
		assert.Contains(t, rec.Body.String(), `"done":true`)

		db.AssertExists(t, "tasks", map[string]interface{}{
			"id":   1,
			"done": true,
		}, false)
		db.AssertExists(t, "task_buckets", map[string]interface{}{
			"task_id":   1,
			"bucket_id": 3,
		}, false)
	})

	t.Run("moving a task out of the done bucket un-marks it done", func(t *testing.T) {
		e, err := setupTestEnv()
		require.NoError(t, err)
		token := humaTokenFor(t, &testuser1)

		// Task 2 starts in bucket 3 (done) and is done; move it to bucket 1.
		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf(path, 1), `{"task_id":2}`, token, "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
		assert.Contains(t, rec.Body.String(), `"done":false`)

		db.AssertExists(t, "tasks", map[string]interface{}{
			"id":   2,
			"done": false,
		}, false)
		db.AssertExists(t, "task_buckets", map[string]interface{}{
			"task_id":   2,
			"bucket_id": 1,
		}, false)
	})

	t.Run("full bucket is rejected", func(t *testing.T) {
		e, err := setupTestEnv()
		require.NoError(t, err)
		token := humaTokenFor(t, &testuser1)

		// Bucket 2 already holds 3 tasks and has a limit of 3.
		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf(path, 2), `{"task_id":1}`, token, "")
		require.Equal(t, http.StatusPreconditionFailed, rec.Code, "body: %s", rec.Body.String())
		assert.Contains(t, rec.Body.String(), fmt.Sprintf(`"code":%d`, models.ErrCodeBucketLimitExceeded))
	})

	t.Run("bucket on another view is rejected", func(t *testing.T) {
		e, err := setupTestEnv()
		require.NoError(t, err)
		token := humaTokenFor(t, &testuser1)

		// Bucket 4 lives on view 8 (project 2), so under view 4 / project 1 the
		// permission check resolves the bucket's own view scoped by the path
		// project and finds none → 404 before the move's own 400 can fire.
		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf(path, 4), `{"task_id":1}`, token, "")
		require.Equal(t, http.StatusNotFound, rec.Code, "body: %s", rec.Body.String())
		assert.Contains(t, rec.Body.String(), fmt.Sprintf(`"code":%d`, models.ErrCodeProjectViewDoesNotExist))
	})

	t.Run("task from a foreign project is forbidden", func(t *testing.T) {
		e, err := setupTestEnv()
		require.NoError(t, err)
		// testuser1 owns project 1 but has no access to project 20 (owner 13),
		// where task 34 lives. The body task id must be authorized, not just
		// the URL bucket (GHSA-5pg6-m483-7vrg).
		token := humaTokenFor(t, &testuser1)

		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf(path, 3), `{"task_id":34}`, token, "")
		require.Equal(t, http.StatusForbidden, rec.Code, "body: %s", rec.Body.String())

		db.AssertMissing(t, "task_buckets", map[string]interface{}{
			"task_id":         34,
			"project_view_id": 4,
		})
		// The task's own bucket placement stays untouched.
		db.AssertExists(t, "task_buckets", map[string]interface{}{
			"task_id":   34,
			"bucket_id": 5,
		}, false)
		db.AssertExists(t, "tasks", map[string]interface{}{
			"id":   34,
			"done": false,
		}, false)
	})

	t.Run("no write access is forbidden", func(t *testing.T) {
		e, err := setupTestEnv()
		require.NoError(t, err)
		// testuser15 has no access to project 1.
		token := humaTokenFor(t, &testuser15)

		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf(path, 1), `{"task_id":1}`, token, "")
		require.Equal(t, http.StatusForbidden, rec.Code, "body: %s", rec.Body.String())
	})
}

// moveTaskBucket updates the task_buckets row directly, bypassing the move logic,
// so a test can position a task before exercising the endpoint.
func moveTaskBucket(t *testing.T, taskID, viewID, bucketID int64) {
	s := db.NewSession()
	defer s.Close()
	_, err := s.
		Where("task_id = ? AND project_view_id = ?", taskID, viewID).
		Cols("bucket_id").
		Update(&models.TaskBucket{BucketID: bucketID})
	require.NoError(t, err)
	require.NoError(t, s.Commit())
}

func setBucketLimit(t *testing.T, bucketID, limit int64) {
	s := db.NewSession()
	defer s.Close()
	_, err := s.
		Where("id = ?", bucketID).
		Cols("limit").
		Update(&models.Bucket{Limit: limit})
	require.NoError(t, err)
	require.NoError(t, s.Commit())
}

// setViewDefaultAndDoneBucket points a view's default and done bucket at the
// given bucket ids. Passing the same id for both models the user-reachable
// configuration where one bucket is both the default and the done column.
func setViewDefaultAndDoneBucket(t *testing.T, viewID, defaultBucketID, doneBucketID int64) {
	s := db.NewSession()
	defer s.Close()
	_, err := s.
		Where("id = ?", viewID).
		Cols("default_bucket_id", "done_bucket_id").
		Update(&models.ProjectView{DefaultBucketID: defaultBucketID, DoneBucketID: doneBucketID})
	require.NoError(t, err)
	require.NoError(t, s.Commit())
}

// TestTaskBucketV2RepeatingDoneReroute covers the reroute a repeating task takes
// when it is marked done: view 4 sends it back to its default bucket (1) instead
// of leaving it in the done bucket (3). The destination bucket's limit must be
// enforced and its real count reported — not the done bucket's.
func TestTaskBucketV2RepeatingDoneReroute(t *testing.T) {
	const path = "/api/v2/projects/1/views/4/buckets/%d/tasks"

	t.Run("rerouted repeating task respects the default bucket's limit", func(t *testing.T) {
		e, err := setupTestEnv()
		require.NoError(t, err)
		token := humaTokenFor(t, &testuser1)

		// Task 28 repeats. Move it out of the default bucket (1) so the reroute is
		// a genuine move, then cap bucket 1 at its current occupancy (10) so any
		// further insert exceeds the limit.
		moveTaskBucket(t, 28, 4, 2)
		setBucketLimit(t, 1, 10)

		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf(path, 3), `{"task_id":28}`, token, "")
		require.Equal(t, http.StatusPreconditionFailed, rec.Code, "body: %s", rec.Body.String())
		assert.Contains(t, rec.Body.String(), fmt.Sprintf(`"code":%d`, models.ErrCodeBucketLimitExceeded))

		// The rejected move must roll back entirely: the task stays in bucket 2.
		db.AssertExists(t, "task_buckets", map[string]interface{}{
			"task_id":   28,
			"bucket_id": 2,
		}, false)
		db.AssertMissing(t, "task_buckets", map[string]interface{}{
			"task_id":   28,
			"bucket_id": 1,
		})
	})

	t.Run("rerouted back into its origin bucket still reports that bucket", func(t *testing.T) {
		e, err := setupTestEnv()
		require.NoError(t, err)
		token := humaTokenFor(t, &testuser1)

		// The natural fixture state: task 28 already sits in its default bucket
		// (1). Marking it done routes it back into bucket 1 - the very bucket it
		// started in - so no row moves. The response must still report the real
		// destination (bucket 1) and its true count (11 tasks, task 28 included),
		// not the done bucket (3). This is the common trigger for a repeating task
		// marked done from its "To-Do" column.
		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf(path, 3), `{"task_id":28}`, token, "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

		var resp models.TaskBucket
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
		require.NotNil(t, resp.Bucket)
		assert.Equal(t, int64(1), resp.Bucket.ID, "must report the origin/default bucket the task was routed back to, not the done bucket")
		assert.Equal(t, int64(11), resp.Bucket.Count, "must report the origin bucket's real count, not the done bucket's")
		require.NotNil(t, resp.Task)
		assert.False(t, resp.Task.Done, "a repeating task reopens for its next occurrence, so it is not left done")

		// The task stays in bucket 1 and is not left in the done bucket.
		db.AssertExists(t, "task_buckets", map[string]interface{}{
			"task_id":   28,
			"bucket_id": 1,
		}, false)
		db.AssertMissing(t, "task_buckets", map[string]interface{}{
			"task_id":   28,
			"bucket_id": 3,
		})
	})

	t.Run("reports the destination bucket and its real count", func(t *testing.T) {
		e, err := setupTestEnv()
		require.NoError(t, err)
		token := humaTokenFor(t, &testuser1)

		// Same setup, but bucket 1 has room. Bucket 1 holds 10 tasks after moving
		// task 28 out; the reroute lands task 28 back in it for 11 total.
		moveTaskBucket(t, 28, 4, 2)

		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf(path, 3), `{"task_id":28}`, token, "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

		var resp models.TaskBucket
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
		require.NotNil(t, resp.Bucket)
		assert.Equal(t, int64(1), resp.Bucket.ID, "must report the default bucket the task was routed to, not the done bucket")
		assert.Equal(t, int64(11), resp.Bucket.Count, "must report the destination bucket's real count")

		db.AssertExists(t, "task_buckets", map[string]interface{}{
			"task_id":   28,
			"bucket_id": 1,
		}, false)
	})
}

// TestTaskBucketV2RepeatingDoneThroughFullDoneBucket covers issue #26 (1): a
// repeating task marked done only passes through the done bucket before being
// rerouted to the view's default bucket, so a full done bucket - distinct from
// the default - must not block completion. The task never occupies a done slot.
func TestTaskBucketV2RepeatingDoneThroughFullDoneBucket(t *testing.T) {
	const path = "/api/v2/projects/1/views/4/buckets/%d/tasks"

	t.Run("full done bucket distinct from default does not block a genuine reroute", func(t *testing.T) {
		e, err := setupTestEnv()
		require.NoError(t, err)
		token := humaTokenFor(t, &testuser1)

		// View 4: default bucket 1, done bucket 3 (distinct). Bucket 3 holds 4
		// tasks (2, 6, 7, 8); a limit of 4 caps it at capacity. Move repeating
		// task 28 into bucket 2 first so marking it done is a genuine reroute out
		// of bucket 2 back into the default bucket 1.
		setBucketLimit(t, 3, 4)
		moveTaskBucket(t, 28, 4, 2)

		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf(path, 3), `{"task_id":28}`, token, "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

		var resp models.TaskBucket
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
		require.NotNil(t, resp.Task)
		assert.False(t, resp.Task.Done, "a repeating task reopens for its next occurrence")
		require.NotNil(t, resp.Bucket)
		assert.Equal(t, int64(1), resp.Bucket.ID, "the task reopens in the default bucket, not the full done bucket")

		// The task reopens in the default bucket and never lands in the full done bucket.
		db.AssertExists(t, "task_buckets", map[string]interface{}{
			"task_id":   28,
			"bucket_id": 1,
		}, false)
		db.AssertMissing(t, "task_buckets", map[string]interface{}{
			"task_id":   28,
			"bucket_id": 3,
		})
	})

	t.Run("full done bucket distinct from default does not block completion from the default column", func(t *testing.T) {
		e, err := setupTestEnv()
		require.NoError(t, err)
		token := humaTokenFor(t, &testuser1)

		// Repeating task 28 already sits in its default bucket (1). Marking it
		// done routes it straight back to bucket 1 - it only transits the full
		// done bucket (3) and never occupies a slot there.
		setBucketLimit(t, 3, 4)

		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf(path, 3), `{"task_id":28}`, token, "")
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

		var resp models.TaskBucket
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
		require.NotNil(t, resp.Task)
		assert.False(t, resp.Task.Done)
		require.NotNil(t, resp.Bucket)
		assert.Equal(t, int64(1), resp.Bucket.ID)

		db.AssertExists(t, "task_buckets", map[string]interface{}{
			"task_id":   28,
			"bucket_id": 1,
		}, false)
		db.AssertMissing(t, "task_buckets", map[string]interface{}{
			"task_id":   28,
			"bucket_id": 3,
		})
	})
}

// TestTaskBucketV2DefaultEqualsDoneBucketLimit guards the invariant that a full
// bucket rejects an incoming task even when it is both the view's default and
// done bucket. The frontend lets a user pick one bucket for both roles, and the
// backend forbids no such config. When default == done, a repeating task dragged
// into that bucket is "rerouted" straight back into it, so a bypass that skips
// the done bucket's limit check would let the task land in a full bucket with no
// limit check on any path. The limit must still be enforced.
func TestTaskBucketV2DefaultEqualsDoneBucketLimit(t *testing.T) {
	const path = "/api/v2/projects/1/views/4/buckets/%d/tasks"

	t.Run("full default==done bucket rejects a rerouted repeating task", func(t *testing.T) {
		e, err := setupTestEnv()
		require.NoError(t, err)
		token := humaTokenFor(t, &testuser1)

		// Make bucket 3 both the default and the done bucket of view 4, then fill
		// it: it holds 4 tasks (2, 6, 7, 8), so a limit of 4 caps it at capacity.
		setViewDefaultAndDoneBucket(t, 4, 3, 3)
		setBucketLimit(t, 3, 4)
		// Repeating task 28 sits in bucket 1, so dropping it into bucket 3 is a
		// genuine cross-bucket move into the full default==done bucket.

		rec := humaRequest(t, e, http.MethodPut, fmt.Sprintf(path, 3), `{"task_id":28}`, token, "")
		require.Equal(t, http.StatusPreconditionFailed, rec.Code, "body: %s", rec.Body.String())
		assert.Contains(t, rec.Body.String(), fmt.Sprintf(`"code":%d`, models.ErrCodeBucketLimitExceeded))

		// The rejected move must roll back entirely: task 28 stays in bucket 1 and
		// never lands in the full default==done bucket.
		db.AssertExists(t, "task_buckets", map[string]interface{}{
			"task_id":   28,
			"bucket_id": 1,
		}, false)
		db.AssertMissing(t, "task_buckets", map[string]interface{}{
			"task_id":   28,
			"bucket_id": 3,
		})
	})
}
