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
	"time"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/events"
	"code.vikunja.io/api/pkg/web"

	"xorm.io/xorm"
	"xorm.io/xorm/schemas"
)

// TaskBucket represents the relation between a task and a kanban bucket.
// A task can only appear once per project view which is ensured by a
// unique index on the combination of task_id and project_view_id.
type TaskBucket struct {
	BucketID int64   `xorm:"bigint not null index" json:"bucket_id" param:"bucket" doc:"The bucket to move the task into. This is taken from the URL; a value in the body is ignored."`
	Bucket   *Bucket `xorm:"-" json:"bucket" readOnly:"true" doc:"The resolved target bucket, including its updated task count."`
	// The task which belongs to the bucket. Together with ProjectViewID
	// this field is part of a unique index to prevent duplicates.
	TaskID int64 `xorm:"bigint not null index unique(task_view)" json:"task_id" doc:"The id of the task to place in the bucket."`
	// The view this bucket belongs to. Combined with TaskID this forms a
	// unique index.
	ProjectViewID int64 `xorm:"bigint not null index unique(task_view)" json:"project_view_id" param:"view" doc:"The view the bucket belongs to. This is taken from the URL; a value in the body is ignored."`
	ProjectID     int64 `xorm:"-" json:"-" param:"project"`
	Task          *Task `xorm:"-" json:"task" readOnly:"true" doc:"The task as it stands after the move, reflecting any done-state change."`

	web.Permissions `xorm:"-" json:"-"`
	web.CRUDable    `xorm:"-" json:"-"`

	// Carries the done transition out of updateTaskBucket so the Kanban entry
	// point (Update) can dispatch TaskDoneChangedEvent. Set only on an actual
	// transition; the internal task-flow callers ignore these.
	doneChanged bool
	doneAfter   bool
	// routeOnly marks a move by the task flow after the done state is final and stored.
	// updateTaskBucket then only checks the limit and moves the row.
	routeOnly bool
}

func (b *TaskBucket) TableName() string {
	return "task_buckets"
}

func (b *TaskBucket) CanUpdate(s *xorm.Session, a web.Auth) (bool, error) {
	bucket := Bucket{
		ID:            b.BucketID,
		ProjectID:     b.ProjectID,
		ProjectViewID: b.ProjectViewID,
	}
	canDoBucket, err := bucket.canDoBucket(s, a)
	if err != nil || !canDoBucket {
		return false, err
	}

	// The task comes from the request body and may live in a different
	// project than the bucket, so it needs its own write check.
	task := &Task{ID: b.TaskID}
	return task.CanWrite(s, a)
}

func (b *TaskBucket) upsert(s *xorm.Session) (err error) {
	// A native upsert moves the task in one atomic statement, without
	// depending on the affected-row count (MySQL/MariaDB report 0 affected
	// rows for an unchanged value).
	onConflict := "ON CONFLICT (task_id, project_view_id) DO UPDATE SET bucket_id = excluded.bucket_id"
	if db.Type() == schemas.MYSQL {
		onConflict = "ON DUPLICATE KEY UPDATE bucket_id = VALUES(bucket_id)"
	}

	// Raw SQL bypasses xorm's bean-based table-name handling, so qualify the
	// table ourselves to honor a configured postgres schema (database.schema).
	table := s.Engine().TableName(b, true)
	query := "INSERT INTO " + table + " (task_id, project_view_id, bucket_id) VALUES (?, ?, ?) " + onConflict
	_, err = s.Exec(query, b.TaskID, b.ProjectViewID, b.BucketID)
	return
}

// resolveBucketWithCount loads the bucket, enforces its task limit for the given
// task, and returns it with its real (pre-insert) count populated.
func resolveBucketWithCount(s *xorm.Session, a web.Auth, task *Task, bucketID int64) (*Bucket, error) {
	bucket, err := getBucketByID(s, bucketID)
	if err != nil {
		return nil, err
	}
	view, err := GetProjectViewByID(s, bucket.ProjectViewID)
	if err != nil {
		return nil, err
	}
	taskCount, err := checkBucketLimit(s, a, task, bucket, view, 0)
	if err != nil {
		return nil, err
	}
	bucket.Count = taskCount
	return bucket, nil
}

// resolveDestinationBucket loads the bucket the task ends up in after a reroute
// and populates its real count. When the task genuinely moves into the bucket
// (isMove) its limit is enforced and the pre-insert count is returned (the
// caller bumps it after the upsert). When the task already sits in the bucket
// (a reroute back to its origin) nothing moves and no new slot is consumed, so
// the current count is returned without re-checking the limit — otherwise a full
// bucket would wrongly block its own task's completion.
func resolveDestinationBucket(s *xorm.Session, a web.Auth, task *Task, bucketID int64, isMove bool) (*Bucket, error) {
	if isMove {
		return resolveBucketWithCount(s, a, task, bucketID)
	}

	bucket, err := getBucketByID(s, bucketID)
	if err != nil {
		return nil, err
	}
	bucket.Count, err = countTasksInBucket(s, a, bucket)
	if err != nil {
		return nil, err
	}
	return bucket, nil
}

// syncTaskIntoOtherDoneBuckets places a newly-done task into the done bucket of
// every other manual kanban view of its project, so its done state is reflected
// everywhere.
func syncTaskIntoOtherDoneBuckets(s *xorm.Session, view *ProjectView, task *Task) (err error) {
	viewsWithDoneBucket := []*ProjectView{}
	err = s.
		Where("project_id = ? AND view_kind = ? AND bucket_configuration_mode = ? AND id != ? AND done_bucket_id != 0",
			view.ProjectID, ProjectViewKindKanban, BucketConfigurationModeManual, view.ID).
		Find(&viewsWithDoneBucket)
	if err != nil {
		return err
	}
	for _, v := range viewsWithDoneBucket {
		var doneBucketID int64
		doneBucketID, err = existingBucketID(s, v.ID, v.DoneBucketID)
		if err != nil {
			return err
		}
		if doneBucketID == 0 {
			continue
		}
		newBucket := &TaskBucket{
			TaskID:        task.ID,
			ProjectViewID: v.ID,
			BucketID:      doneBucketID,
		}
		if err = newBucket.upsert(s); err != nil {
			return err
		}
	}
	return nil
}

// repeatingTaskPassesThroughDoneBucket reports whether a repeating task that
// completed an iteration (completeOneIteration) only transits the requested done
// bucket: it reopened, so the done-state handling reroutes it to the view's
// default bucket. In that case the task never occupies a done slot, so the done
// bucket's limit must not block completion — the real destination's limit is
// still enforced afterwards via resolveDestinationBucket. It returns false when
// the rule has no next occurrence (the task stays done in the done bucket, #120)
// and when default == done (the reroute lands the task right back in the done
// bucket, so the limit must still apply); createProjectView/Update forbid that
// config, this keeps legacy rows safe.
func repeatingTaskPassesThroughDoneBucket(view *ProjectView, task *Task, completed bool) bool {
	return completed &&
		!task.Done &&
		view.DefaultBucketID != 0 &&
		view.DefaultBucketID != view.DoneBucketID
}

// rerouteDoneRepeatingTask validates the default bucket because a kind switch
// can leave it stale or on another view; the caller's upsert does not check.
func rerouteDoneRepeatingTask(s *xorm.Session, view *ProjectView, fallback int64) (int64, error) {
	target, err := existingBucketID(s, view.ID, view.DefaultBucketID)
	if err != nil || target != 0 {
		return target, err
	}
	return fallback, nil
}

// applyDoneBucketMove sets and stores the done state of a task moved into or out of the view's done
// bucket. It reports whether the task_buckets row must still move: a reopened repeating task rerouted
// to the bucket it already sits in stays where it is.
func applyDoneBucketMove(s *xorm.Session, view *ProjectView, b *TaskBucket, task *Task, oldBucketID int64, completed bool) (updateBucket bool, err error) {
	updateBucket = true
	if view.DoneBucketID == 0 {
		return updateBucket, nil
	}

	// Only change the done state if the task's done value actually changes
	var doneChanged bool
	if view.DoneBucketID == b.BucketID && (completed || !task.Done) {
		doneChanged = true
		// Set even when the completed iteration reopened the task;
		// drives TaskDoneChangedEvent dispatched in Update.
		b.doneChanged = true
		b.doneAfter = true
		if !completed {
			task.Done = true
		} else if !task.Done {
			// A reopened repeating task doesn't stay in the done bucket;
			// route it back to the view's default bucket so the user sees
			// the next iteration waiting in the "To-Do" column. A task
			// whose rule has no next occurrence stays done, in the done bucket.
			b.BucketID, err = rerouteDoneRepeatingTask(s, view, oldBucketID)
			if err != nil {
				return false, err
			}
			// The task is already in the correct bucket, so there is
			// nothing to move and no count to bump.
			if b.BucketID == oldBucketID {
				updateBucket = false
			}
		}
	}

	if oldBucketID == view.DoneBucketID && task.Done && b.BucketID != view.DoneBucketID {
		doneChanged = true
		b.doneChanged = true
		b.doneAfter = false
		task.Done = false
	}

	if !doneChanged {
		return updateBucket, nil
	}

	// A completed iteration counts as done even when it reopened, as in updateDone.
	if b.doneAfter {
		task.DoneAt = time.Now()
	} else {
		task.DoneAt = time.Time{}
	}
	_, err = s.Where("id = ?", task.ID).
		Cols(repeatingIterationCols...).
		Update(task)
	if err != nil {
		return false, err
	}

	err = task.updateReminders(s, task)
	if err != nil {
		return false, err
	}

	// Since the done state of the task was changed, we need to move the task into all done buckets everywhere
	if task.Done {
		if err = syncTaskIntoOtherDoneBuckets(s, view, task); err != nil {
			return false, err
		}
	}
	return updateBucket, nil
}

// updateTaskBucket is internally used to actually do the update. It has two modes:
//   - A drag (TaskBucket.Update): a move into or out of the done bucket changes the done
//     state, and a repeating task moved into the done bucket completes one iteration.
//   - A routing-only move (b.routeOnly, set by the task flow after the done state is
//     stored): it checks the destination bucket's limit and moves the row, nothing else.
func updateTaskBucket(s *xorm.Session, a web.Auth, b *TaskBucket) (err error) {
	oldTaskBucket := &TaskBucket{}
	_, err = s.
		Where("task_id = ? AND project_view_id = ?", b.TaskID, b.ProjectViewID).
		Get(oldTaskBucket)
	if err != nil {
		return
	}

	if oldTaskBucket.BucketID == b.BucketID {
		// no need to do anything
		return
	}

	view, err := GetProjectViewByIDAndProject(s, b.ProjectViewID, b.ProjectID)
	if err != nil {
		return err
	}

	bucket, err := getBucketByID(s, b.BucketID)
	if err != nil {
		return err
	}

	// If there is a bucket set, make sure they belong to the same project as the task
	if view.ID != bucket.ProjectViewID {
		return ErrBucketDoesNotBelongToProjectView{
			ProjectViewID: view.ID,
			BucketID:      bucket.ID,
		}
	}

	// Row lock, and past the session memo: ReadOne can return the copy the permission check read before
	// any lock, and the done-state write below would then overwrite a change made since.
	stored, err := GetTaskSimple(lockingSession(s), &Task{ID: b.TaskID})
	if err != nil {
		return err
	}
	task := &stored
	err = addMoreInfoToTasks(s, map[int64]*Task{task.ID: task}, a, nil, nil)
	if err != nil {
		return err
	}

	// A repeating task moved into the done bucket completes one iteration. This
	// runs before the limit check because the result decides whether the task
	// occupies a done slot. It writes nothing, so a failed limit check leaves no trace.
	completed := !b.routeOnly && view.DoneBucketID != 0 && view.DoneBucketID == b.BucketID && !task.Done && task.isRepeating()
	if completed {
		completeOneIteration(task)
	}

	// Check the bucket limit
	// Only check the bucket limit if the task is being moved between buckets, allow reordering the task within a bucket
	if b.BucketID != 0 && b.BucketID != oldTaskBucket.BucketID && !repeatingTaskPassesThroughDoneBucket(view, task, completed) {
		taskCount, err := checkBucketLimit(s, a, task, bucket, view, 0)
		if err != nil {
			return err
		}
		bucket.Count = taskCount
	}

	updateBucket := true
	if !b.routeOnly {
		updateBucket, err = applyDoneBucketMove(s, view, b, task, oldTaskBucket.BucketID, completed)
		if err != nil {
			return err
		}
	}

	// The done-state handling above can reroute a repeating task to the view's
	// default bucket. The earlier limit check ran against the originally
	// requested (done) bucket, so re-resolve the real destination and report its
	// true count instead of the done bucket's. This must run even when
	// updateBucket is false (the reroute target is the bucket the task already
	// sits in): no row moves, but the response still has to reflect the real
	// destination. b.BucketID differs from the loaded bucket.ID only when a
	// reroute changed the destination.
	if b.BucketID != bucket.ID {
		bucket, err = resolveDestinationBucket(s, a, task, b.BucketID, updateBucket)
		if err != nil {
			return err
		}
	}

	if updateBucket {
		err = b.upsert(s)
		if err != nil {
			return
		}
		bucket.Count++
	}

	b.Task = task
	b.Bucket = bucket

	return
}

// Update is the handler to update a task bucket
// @Summary Update a task bucket
// @Description Updates a task in a bucket
// @tags task
// @Accept json
// @Produce json
// @Security JWTKeyAuth
// @Param project path int true "Project ID"
// @Param view path int true "Project View ID"
// @Param bucket path int true "Bucket ID"
// @Param taskBucket body models.TaskBucket true "The id of the task you want to move into the bucket."
// @Success 200 {object} models.TaskBucket "The updated task bucket."
// @Failure 400 {object} web.HTTPError "Invalid task bucket object provided."
// @Failure 500 {object} models.Message "Internal error"
// @Router /projects/{project}/views/{view}/buckets/{bucket}/tasks [post]
func (b *TaskBucket) Update(s *xorm.Session, a web.Auth) (err error) {
	err = updateTaskBucket(s, a, b)
	if err != nil {
		return err
	}

	if b.Task != nil {
		events.DispatchOnCommit(s, &TaskUpdatedEvent{
			Task: b.Task,
			Doer: doerFromAuth(s, a),
		})

		if b.doneChanged {
			events.DispatchOnCommit(s, &TaskDoneChangedEvent{
				Task: b.Task,
				Doer: doerFromAuth(s, a),
				Done: b.doneAfter,
			})
		}
	}
	return nil
}
