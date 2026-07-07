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
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/events"
	"code.vikunja.io/api/pkg/files"
	"code.vikunja.io/api/pkg/user"

	"github.com/ThreeDotsLabs/watermill"
	"github.com/ThreeDotsLabs/watermill/message"
	"github.com/stretchr/testify/require"
	"xorm.io/builder"
	"xorm.io/xorm"
)

// replayActivityEvents feeds every recorded event through the capture listener,
// mirroring what the real event bus does. Events are faked in tests, so the
// listener never runs on its own.
func replayActivityEvents(t *testing.T) {
	for _, name := range activityCapturedEventNames() {
		for _, e := range events.GetDispatchedEvents(name) {
			events.TestListener(t, e, &ActivityCaptureListener{EventName: name})
		}
	}
}

func TestActivityCapture_TaskCompletedViaUpdateFlow(t *testing.T) {
	u := &user.User{ID: 1}
	db.LoadAndAssertFixtures(t)
	events.ClearDispatchedEvents()
	s := db.NewSession()
	defer s.Close()

	task, err := GetTaskByIDSimple(s, 1)
	require.NoError(t, err)
	task.Done = true
	require.NoError(t, task.Update(s, u))
	require.NoError(t, s.Commit())
	events.DispatchPending(context.Background(), s)

	replayActivityEvents(t)

	db.AssertExists(t, "activities", map[string]interface{}{
		"project_id": 1,
		"task_id":    1,
		"actor_id":   1,
		"verb":       ActivityVerbTaskCompleted,
		"summary":    "task #1",
	}, false)

	// A done-toggle through the update flow intentionally produces BOTH a
	// task_completed entry (from the dedicated done-transition event) and a
	// task_updated entry (from TaskUpdatedEvent, which carries only post-state
	// and cannot tell the change was done-only). This double-entry is a known,
	// accepted product decision; assert it explicitly so the behavior is
	// documented and can't regress vacuously.
	db.AssertExists(t, "activities", map[string]interface{}{
		"project_id": 1,
		"task_id":    1,
		"actor_id":   1,
		"verb":       ActivityVerbTaskUpdated,
	}, false)
}

func TestActivityCapture_TaskDeletedTombstoneHasNoTaskID(t *testing.T) {
	u := &user.User{ID: 1}
	db.LoadAndAssertFixtures(t)
	events.ClearDispatchedEvents()
	s := db.NewSession()
	defer s.Close()

	task := &Task{ID: 1}
	require.NoError(t, task.Delete(s, u))
	require.NoError(t, s.Commit())
	events.DispatchPending(context.Background(), s)

	replayActivityEvents(t)

	// The tombstone keeps the title in the summary but MUST drop the task
	// reference (task_id = 0) so the feed doesn't link to a now-deleted task.
	db.AssertExists(t, "activities", map[string]interface{}{
		"project_id": 1,
		"task_id":    0,
		"actor_id":   1,
		"verb":       ActivityVerbTaskDeleted,
		"summary":    "task #1",
	}, false)
	db.AssertMissing(t, "activities", map[string]interface{}{
		"task_id": 1,
		"verb":    ActivityVerbTaskDeleted,
	})
}

func TestActivityCapture_TaskCompletedViaKanbanDoneBucket(t *testing.T) {
	u := &user.User{ID: 1}
	db.LoadAndAssertFixtures(t)
	events.ClearDispatchedEvents()
	s := db.NewSession()
	defer s.Close()

	// View 4 (project 1) has bucket 3 as its done bucket; task 1 starts in bucket 1.
	tb := &TaskBucket{
		TaskID:        1,
		BucketID:      3,
		ProjectViewID: 4,
		ProjectID:     1,
	}
	require.NoError(t, tb.Update(s, u))
	require.NoError(t, s.Commit())
	events.DispatchPending(context.Background(), s)

	replayActivityEvents(t)

	db.AssertExists(t, "activities", map[string]interface{}{
		"project_id": 1,
		"task_id":    1,
		"actor_id":   1,
		"verb":       ActivityVerbTaskCompleted,
	}, false)
}

func TestActivityCapture_EditingDoneTaskCreatesNoCompletion(t *testing.T) {
	u := &user.User{ID: 1}
	db.LoadAndAssertFixtures(t)
	events.ClearDispatchedEvents()
	s := db.NewSession()
	defer s.Close()

	// Task 2 is already done; a plain edit must not produce a completion entry.
	task, err := GetTaskByIDSimple(s, 2)
	require.NoError(t, err)
	task.Title = "task #2 edited"
	require.NoError(t, task.Update(s, u))
	require.NoError(t, s.Commit())
	events.DispatchPending(context.Background(), s)

	replayActivityEvents(t)

	db.AssertMissing(t, "activities", map[string]interface{}{
		"task_id": 2,
		"verb":    ActivityVerbTaskCompleted,
	})
}

func TestActivityCapture_AssigneeAdded(t *testing.T) {
	u := &user.User{ID: 1}
	db.LoadAndAssertFixtures(t)
	events.ClearDispatchedEvents()
	s := db.NewSession()
	defer s.Close()

	la := &TaskAssginee{TaskID: 1, UserID: 1}
	require.NoError(t, la.Create(s, u))
	require.NoError(t, s.Commit())
	events.DispatchPending(context.Background(), s)

	replayActivityEvents(t)

	db.AssertExists(t, "activities", map[string]interface{}{
		"project_id": 1,
		"task_id":    1,
		"verb":       ActivityVerbAssigneeAdded,
	}, false)
}

func TestActivityCapture_CommentCreated(t *testing.T) {
	u := &user.User{ID: 1}
	db.LoadAndAssertFixtures(t)
	events.ClearDispatchedEvents()
	s := db.NewSession()
	defer s.Close()

	tc := &TaskComment{Comment: "hi", TaskID: 1}
	require.NoError(t, tc.Create(s, u))
	require.NoError(t, s.Commit())
	events.DispatchPending(context.Background(), s)

	replayActivityEvents(t)

	db.AssertExists(t, "activities", map[string]interface{}{
		"project_id": 1,
		"task_id":    1,
		"verb":       ActivityVerbCommentCreated,
	}, false)
}

func TestActivityCapture_RelationAdded(t *testing.T) {
	u := &user.User{ID: 1}
	db.LoadAndAssertFixtures(t)
	events.ClearDispatchedEvents()
	s := db.NewSession()
	defer s.Close()

	rel := &TaskRelation{TaskID: 1, OtherTaskID: 2, RelationKind: RelationKindSubtask}
	require.NoError(t, rel.Create(s, u))
	require.NoError(t, s.Commit())
	events.DispatchPending(context.Background(), s)

	replayActivityEvents(t)

	db.AssertExists(t, "activities", map[string]interface{}{
		"project_id": 1,
		"task_id":    1,
		"verb":       ActivityVerbRelationAdded,
	}, false)
}

func TestActivityCapture_AttachmentAdded(t *testing.T) {
	u := &user.User{ID: 1}
	db.LoadAndAssertFixtures(t)
	files.InitTestFileFixtures(t)
	events.ClearDispatchedEvents()
	s := db.NewSession()
	defer s.Close()

	ta := &TaskAttachment{TaskID: 1}
	content := []byte("activity attachment")
	require.NoError(t, ta.NewAttachment(s, bytes.NewReader(content), "test.txt", uint64(len(content)), u))
	require.NoError(t, s.Commit())
	events.DispatchPending(context.Background(), s)

	replayActivityEvents(t)

	db.AssertExists(t, "activities", map[string]interface{}{
		"project_id": 1,
		"task_id":    1,
		"verb":       ActivityVerbAttachmentAdded,
	}, false)
}

func TestActivityCapture_ProjectUpdated(t *testing.T) {
	u := &user.User{ID: 1}
	db.LoadAndAssertFixtures(t)
	events.ClearDispatchedEvents()
	s := db.NewSession()
	defer s.Close()

	p := &Project{ID: 1}
	require.NoError(t, p.ReadOne(s, u))
	p.Title = "Renamed project"
	require.NoError(t, p.Update(s, u))
	require.NoError(t, s.Commit())
	events.DispatchPending(context.Background(), s)

	replayActivityEvents(t)

	db.AssertExists(t, "activities", map[string]interface{}{
		"project_id": 1,
		"verb":       ActivityVerbProjectUpdated,
	}, false)
}

// TestActivityCapture_SwallowsInternalFailures is the spec edge case: any
// internal failure must be swallowed and logged, and the handler MUST return
// nil so the event bus does not retry-spam or poison-queue the message
// (handlers are wrapped in Retry(5x)+PoisonQueue+Sentry).
//
// Note: the spec suggested driving this with a "closed/erroring session", but
// in this codebase a closed or rolled-back xorm/sqlite session does not error
// on subsequent writes (verified empirically). So we drive the same
// swallow-and-return-nil contract through the two failures the listener can
// actually hit: a malformed payload (parse error) and an event referencing a
// missing task with no project id (resolve error).
func TestActivityCapture_SwallowsInternalFailures(t *testing.T) {
	t.Run("malformed payload", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		msg := message.NewMessage(watermill.NewUUID(), []byte("{not json"))
		l := &ActivityCaptureListener{EventName: (&TaskCreatedEvent{}).Name()}

		// capture detects the failure, Handle swallows it and returns nil.
		require.Error(t, l.capture(s, msg))
		require.NoError(t, l.Handle(msg))
	})

	t.Run("resolve failure writes nothing", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)

		// No project id and a task that doesn't exist forces the DB backfill to
		// fail inside buildActivity.
		ev := &TaskDoneChangedEvent{
			Task: &Task{ID: 99999},
			Doer: &user.User{ID: 1},
			Done: true,
		}
		payload, err := json.Marshal(ev)
		require.NoError(t, err)
		msg := message.NewMessage(watermill.NewUUID(), payload)

		l := &ActivityCaptureListener{EventName: ev.Name()}
		require.NoError(t, l.Handle(msg))

		db.AssertMissing(t, "activities", map[string]interface{}{"task_id": 99999})
	})
}

func TestActivityCapture_TaskDeleteRemovesEntries(t *testing.T) {
	u := &user.User{ID: 1}
	db.LoadAndAssertFixtures(t)
	events.ClearDispatchedEvents()
	s := db.NewSession()
	defer s.Close()

	_, err := s.Insert(&Activity{
		ProjectID: 1,
		TaskID:    1,
		ActorID:   1,
		Verb:      ActivityVerbTaskCompleted,
		Summary:   "task #1",
	})
	require.NoError(t, err)

	task := &Task{ID: 1}
	require.NoError(t, task.Delete(s, u))
	require.NoError(t, s.Commit())

	db.AssertMissing(t, "activities", map[string]interface{}{"task_id": 1})
}

// TestActivityCursorFormatIsUTC pins the keyset cursor literal to the DB
// storage timezone (GMT/UTC), independent of the time.Time's own location.
// Regression guard: the DB stores `created` in UTC (SetTZDatabase(GMT)), so
// formatting the cursor in config.GetTimeZone() instead would offset the
// literal on any non-UTC instance and silently break paging. The GMT test env
// masks that, so assert it explicitly here.
func TestActivityCursorFormatIsUTC(t *testing.T) {
	instant := time.Date(2026, 7, 7, 15, 1, 2, 0, time.UTC)

	ny, err := time.LoadLocation("America/New_York")
	require.NoError(t, err)
	// Same instant, wall clock 11:01:02-04:00 — what a read-back Created carries
	// when config.GetTimeZone() is non-UTC.
	inNY := instant.In(ny)

	require.Equal(t, "2026-07-07 15:01:02", formatActivityCursorForDB(inNY),
		"cursor literal must be the UTC wall clock regardless of the value's location")
	require.Equal(t, "2026-07-07 15:01:02", formatActivityCursorForDB(instant))

	// Sub-second precision (e.g. Postgres) must survive; trailing zeros trimmed.
	withMicros := time.Date(2026, 7, 7, 15, 1, 2, 300000000, time.UTC).In(ny)
	require.Equal(t, "2026-07-07 15:01:02.3", formatActivityCursorForDB(withMicros))
}

// TestActivityKeyset_CursorFromNonUTCLocation exercises the full keyset query
// with a cursor time carried in a non-UTC location (mimicking a read-back
// Created on a non-UTC instance). The boundary row must be excluded and older
// rows returned — proving the comparison does not depend on the time.Time's
// location.
func TestActivityKeyset_CursorFromNonUTCLocation(t *testing.T) {
	db.LoadAndAssertFixtures(t)
	s := db.NewSession()
	defer s.Close()

	base := time.Now().UTC().Truncate(time.Second)
	a1 := insertActivityWithCreated(t, s, base.Add(-3*time.Second))
	a2 := insertActivityWithCreated(t, s, base.Add(-2*time.Second))
	a3 := insertActivityWithCreated(t, s, base.Add(-1*time.Second))

	page1, err := queryActivities(s, []int64{1}, &ActivityQuery{Limit: 2})
	require.NoError(t, err)
	// page1 newest two: a3, a2. Cursor = a2 (its DB-read Created), re-expressed
	// in a non-UTC location to prove location independence.
	cursor := page1[1]
	require.Equal(t, a2, cursor.ID)

	ny, err := time.LoadLocation("America/New_York")
	require.NoError(t, err)
	q := &ActivityQuery{
		Limit:         2,
		HasCursor:     true,
		CursorCreated: cursor.Created.In(ny),
		CursorID:      cursor.ID,
	}
	page2, err := queryActivities(s, []int64{1}, q)
	require.NoError(t, err)

	ids := make([]int64, 0, len(page2))
	for _, a := range page2 {
		ids = append(ids, a.ID)
	}
	require.Equal(t, []int64{a1}, ids, "boundary row must be excluded, older row returned")
	_ = a3
}

func TestActivityRetention_PrunesOldEntries(t *testing.T) {
	db.LoadAndAssertFixtures(t)
	s := db.NewSession()
	defer s.Close()

	now := time.Now()
	oldID := insertActivityWithCreated(t, s, now.AddDate(0, 0, -91))
	recentID := insertActivityWithCreated(t, s, now.AddDate(0, 0, -1))

	deleted, err := pruneActivities(s, 90, now)
	require.NoError(t, err)
	require.NoError(t, s.Commit())

	require.Equal(t, int64(1), deleted)
	db.AssertMissing(t, "activities", map[string]interface{}{"id": oldID})
	db.AssertExists(t, "activities", map[string]interface{}{"id": recentID}, false)
}

func TestActivityRetention_ZeroDisablesPruning(t *testing.T) {
	db.LoadAndAssertFixtures(t)
	s := db.NewSession()
	defer s.Close()

	now := time.Now()
	oldID := insertActivityWithCreated(t, s, now.AddDate(0, 0, -400))

	deleted, err := pruneActivities(s, 0, now)
	require.NoError(t, err)
	require.NoError(t, s.Commit())

	require.Equal(t, int64(0), deleted)
	db.AssertExists(t, "activities", map[string]interface{}{"id": oldID}, false)
}

// insertActivityWithCreated inserts an activity and backdates its created
// column (the xorm "created" tag sets it to now on insert, so it must be
// overwritten afterwards).
func insertActivityWithCreated(t *testing.T, s *xorm.Session, created time.Time) int64 {
	act := &Activity{ProjectID: 1, TaskID: 1, ActorID: 1, Verb: ActivityVerbTaskCompleted, Summary: "task #1"}
	_, err := s.Insert(act)
	require.NoError(t, err)
	_, err = s.ID(act.ID).Cols("created").Update(&Activity{Created: created})
	require.NoError(t, err)
	return act.ID
}

func TestActivityCapture_ProjectDeleteRemovesEntries(t *testing.T) {
	u := &user.User{ID: 1}
	db.LoadAndAssertFixtures(t)
	events.ClearDispatchedEvents()
	s := db.NewSession()
	defer s.Close()

	_, err := s.Insert(&Activity{
		ProjectID: 1,
		TaskID:    1,
		ActorID:   1,
		Verb:      ActivityVerbTaskCompleted,
		Summary:   "task #1",
	})
	require.NoError(t, err)

	p := &Project{ID: 1}
	require.NoError(t, p.Delete(s, u))
	require.NoError(t, s.Commit())

	db.AssertCount(t, "activities", builder.Eq{"project_id": 1}, 0)
}
