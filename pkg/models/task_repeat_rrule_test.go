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
	"time"

	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// nextOrSameWeekday walks forward from t to the next date (possibly t itself)
// falling on wd, used to build deterministic future test fixtures without
// hardcoding a calendar date whose weekday could drift from the assertion.
func nextOrSameWeekday(t time.Time, wd time.Weekday) time.Time {
	for t.Weekday() != wd {
		t = t.AddDate(0, 0, 1)
	}
	return t
}

func TestNextRRuleOccurrence(t *testing.T) {
	nyLoc, err := time.LoadLocation("America/New_York")
	require.NoError(t, err)

	tests := []struct {
		name   string
		rule   string
		after  time.Time
		loc    *time.Location
		want   time.Time
		wantOk bool
	}{
		{
			name:   "weekday set",
			rule:   "FREQ=WEEKLY;BYDAY=MO,FR",
			after:  time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC),
			loc:    time.UTC,
			want:   time.Date(2026, 7, 10, 9, 0, 0, 0, time.UTC),
			wantOk: true,
		},
		{
			name:   "ordinal weekday: 3rd Friday",
			rule:   "FREQ=MONTHLY;BYDAY=3FR",
			after:  time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC),
			loc:    time.UTC,
			want:   time.Date(2026, 8, 21, 0, 0, 0, 0, time.UTC),
			wantOk: true,
		},
		{
			name:   "last day of month",
			rule:   "FREQ=MONTHLY;BYMONTHDAY=-1",
			after:  time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC),
			loc:    time.UTC,
			want:   time.Date(2026, 8, 31, 0, 0, 0, 0, time.UTC),
			wantOk: true,
		},
		{
			name:   "last workday of month",
			rule:   "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
			after:  time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC), // a Friday
			loc:    time.UTC,
			want:   time.Date(2026, 8, 31, 0, 0, 0, 0, time.UTC), // a Monday
			wantOk: true,
		},
		{
			name:   "UNTIL bound reached: no next occurrence",
			rule:   "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260710T000000Z",
			after:  time.Date(2026, 7, 6, 0, 0, 0, 0, time.UTC),
			loc:    time.UTC,
			wantOk: false,
		},
		{
			name:   "overdue task with multiple missed occurrences: next after now, not next after old due date",
			rule:   "FREQ=WEEKLY;BYDAY=MO",
			after:  time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC), // "now"; original due date (2026-06-01) is irrelevant to this helper
			loc:    time.UTC,
			want:   time.Date(2026, 7, 6, 0, 0, 0, 0, time.UTC),
			wantOk: true,
		},
		{
			// Local wall-clock time (09:00) must be preserved across the spring-forward
			// transition, not the fixed UTC offset (US Eastern: DST starts 2026-03-08).
			name:   "DST transition week: local wall-clock time preserved",
			rule:   "FREQ=WEEKLY;BYDAY=SU",
			after:  time.Date(2026, 3, 1, 9, 0, 0, 0, nyLoc),
			loc:    nyLoc,
			want:   time.Date(2026, 3, 8, 9, 0, 0, 0, nyLoc),
			wantOk: true,
		},
		{
			// BYMONTHDAY=31 has no match in February (or any 30-day month); those
			// months are skipped entirely rather than clamped or erroring.
			name:   "31st in a short month is skipped, not clamped",
			rule:   "FREQ=MONTHLY;BYMONTHDAY=31",
			after:  time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC),
			loc:    time.UTC,
			want:   time.Date(2026, 3, 31, 0, 0, 0, 0, time.UTC),
			wantOk: true,
		},
		{
			// "last Saturday of every 3rd month" — the frontend's headline INTERVAL
			// combo. Anchored on the last Saturday of July, the next occurrence must
			// skip August and September (INTERVAL=3) and land on the last Saturday of
			// October, not the next month.
			name:   "monthly INTERVAL skips intervening months and keeps the ordinal weekday",
			rule:   "FREQ=MONTHLY;INTERVAL=3;BYDAY=-1SA",
			after:  time.Date(2026, 7, 25, 0, 0, 0, 0, time.UTC),
			loc:    time.UTC,
			want:   time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC),
			wantOk: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// These cases anchor and cut off at the same instant (the pre-split
			// semantics), which exercises the core occurrence math directly.
			got, ok := nextRRuleOccurrence(tt.rule, tt.after, tt.after, tt.loc)
			assert.Equal(t, tt.wantOk, ok)
			if tt.wantOk {
				assert.True(t, tt.want.Equal(got), "want %s, got %s", tt.want, got)
			}
		})
	}
}

func TestValidateTaskRRule(t *testing.T) {
	tests := []struct {
		name    string
		rule    string
		wantErr bool
	}{
		{name: "weekday set is valid", rule: "FREQ=WEEKLY;BYDAY=MO,FR", wantErr: false},
		{name: "ordinal weekday is valid", rule: "FREQ=MONTHLY;BYDAY=3FR", wantErr: false},
		{name: "negative ordinal weekday is valid", rule: "FREQ=MONTHLY;BYDAY=-1FR", wantErr: false},
		{name: "BYMONTHDAY including -1 is valid", rule: "FREQ=MONTHLY;BYMONTHDAY=-1", wantErr: false},
		{name: "BYSETPOS is valid", rule: "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", wantErr: false},
		{name: "UNTIL is valid", rule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260710T000000Z", wantErr: false},
		{name: "INTERVAL is valid", rule: "FREQ=DAILY;INTERVAL=2", wantErr: false},
		{name: "YEARLY is valid", rule: "FREQ=YEARLY;BYMONTHDAY=15", wantErr: false},
		{name: "BYMONTH is outside the supported subset and rejected", rule: "FREQ=YEARLY;BYMONTH=1;BYDAY=1MO", wantErr: true},
		{name: "COUNT bound is out of subset and rejected", rule: "FREQ=WEEKLY;COUNT=3", wantErr: true},
		{name: "COUNT with daily freq is rejected", rule: "FREQ=DAILY;COUNT=10", wantErr: true},
		{name: "bogus frequency is rejected", rule: "FREQ=BOGUS", wantErr: true},
		{name: "unsupported frequency/component is rejected", rule: "FREQ=HOURLY;BYMINUTE=30", wantErr: true},
		{name: "empty string is rejected", rule: "", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateTaskRRule(tt.rule)
			if tt.wantErr {
				require.Error(t, err)
				assert.True(t, IsErrInvalidTaskRepeatRRule(err))
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestUpdateDone_RRuleMode(t *testing.T) {
	t.Run("weekday set: due date, start/end dates and reminders shift by the same delta", func(t *testing.T) {
		monday := nextOrSameWeekday(time.Now().AddDate(5, 0, 0), time.Monday)
		due := time.Date(monday.Year(), monday.Month(), monday.Day(), 9, 0, 0, 0, time.UTC)
		wantDue := due.AddDate(0, 0, 4) // next Friday in the BYDAY=MO,FR set, same week

		oldTask := &Task{
			Done:        false,
			RepeatMode:  TaskRepeatModeRRule,
			RepeatRRule: "FREQ=WEEKLY;BYDAY=MO,FR",
			DueDate:     due,
			StartDate:   due.Add(-2 * time.Hour),
			EndDate:     due.Add(time.Hour),
			Reminders: []*TaskReminder{
				{Reminder: due.Add(-24 * time.Hour)},
			},
		}
		newTask := &Task{Done: true}
		// newTask.Reminders ends up aliasing oldTask.Reminders (same pointers,
		// matching setTaskDatesDefault's convention), so capture the original
		// value here rather than reading it back off oldTask after the call.
		originalReminder := oldTask.Reminders[0].Reminder

		updateDone(oldTask, newTask)

		require.False(t, newTask.Done, "task should reopen for its next occurrence")
		assert.True(t, wantDue.Equal(newTask.DueDate), "want due %s, got %s", wantDue, newTask.DueDate)

		delta := wantDue.Sub(due)
		assert.True(t, due.Add(-2*time.Hour).Add(delta).Equal(newTask.StartDate), "start date should shift by the same delta as the due date")
		assert.True(t, due.Add(time.Hour).Add(delta).Equal(newTask.EndDate), "end date should shift by the same delta as the due date")
		require.Len(t, newTask.Reminders, 1)
		assert.True(t, originalReminder.Add(delta).Equal(newTask.Reminders[0].Reminder), "reminder should shift by the same delta as the due date")
	})

	t.Run("recurring reminder is exempt from the due-date-delta shift, plain reminder still shifted", func(t *testing.T) {
		monday := nextOrSameWeekday(time.Now().AddDate(5, 0, 0), time.Monday)
		due := time.Date(monday.Year(), monday.Month(), monday.Day(), 9, 0, 0, 0, time.UTC)
		wantDue := due.AddDate(0, 0, 4) // next Friday in the BYDAY=MO,FR set, same week

		plainReminderTime := due.Add(-24 * time.Hour)
		rruleReminderTime := due.Add(-2 * time.Hour)
		oldTask := &Task{
			Done:        false,
			RepeatMode:  TaskRepeatModeRRule,
			RepeatRRule: "FREQ=WEEKLY;BYDAY=MO,FR",
			DueDate:     due,
			Reminders: []*TaskReminder{
				{Reminder: plainReminderTime},
				{Reminder: rruleReminderTime, RepeatRRule: "FREQ=WEEKLY;BYDAY=TU"},
			},
		}
		newTask := &Task{Done: true}

		updateDone(oldTask, newTask)

		require.False(t, newTask.Done)
		assert.True(t, wantDue.Equal(newTask.DueDate))

		delta := wantDue.Sub(due)
		require.Len(t, newTask.Reminders, 2)
		assert.True(t, plainReminderTime.Add(delta).Equal(newTask.Reminders[0].Reminder), "plain reminder must be shifted by the due-date delta")
		assert.True(t, rruleReminderTime.Equal(newTask.Reminders[1].Reminder), "recurring reminder must not be shifted by the task's due-date delta")
		assert.Equal(t, "FREQ=WEEKLY;BYDAY=TU", newTask.Reminders[1].RepeatRRule)
	})

	t.Run("deadline shifts by the same delta as the due date", func(t *testing.T) {
		monday := nextOrSameWeekday(time.Now().AddDate(5, 0, 0), time.Monday)
		due := time.Date(monday.Year(), monday.Month(), monday.Day(), 9, 0, 0, 0, time.UTC)
		wantDue := due.AddDate(0, 0, 4) // next Friday in the BYDAY=MO,FR set, same week
		deadline := due.Add(48 * time.Hour)

		oldTask := &Task{
			Done:        false,
			RepeatMode:  TaskRepeatModeRRule,
			RepeatRRule: "FREQ=WEEKLY;BYDAY=MO,FR",
			DueDate:     due,
			Deadline:    deadline,
		}
		newTask := &Task{Done: true}

		updateDone(oldTask, newTask)

		require.False(t, newTask.Done)
		delta := wantDue.Sub(due)
		assert.True(t, deadline.Add(delta).Equal(newTask.Deadline), "deadline should shift by the same delta as the due date")
	})

	t.Run("overdue completion preserves the original time-of-day", func(t *testing.T) {
		// Original due date is a Monday 09:00 far in the past, so completion
		// happens well after the due time. The next due date must land on a
		// Monday at 09:00 (the rule's time-of-day, carried by the original due
		// date), NOT at the completion clock time.
		oldTask := &Task{
			Done:        false,
			RepeatMode:  TaskRepeatModeRRule,
			RepeatRRule: "FREQ=WEEKLY;BYDAY=MO",
			DueDate:     time.Date(2020, 1, 6, 9, 0, 0, 0, time.UTC), // a Monday, long past
		}
		newTask := &Task{Done: true}

		before := time.Now()
		updateDone(oldTask, newTask)

		require.False(t, newTask.Done)
		got := newTask.DueDate.In(time.UTC)
		assert.Equal(t, time.Monday, got.Weekday(), "next due must fall on the rule's weekday")
		assert.Equal(t, 9, got.Hour(), "next due must keep the original 09:00 time-of-day, not the completion time")
		assert.Equal(t, 0, got.Minute())
		assert.Equal(t, 0, got.Second())
		assert.True(t, newTask.DueDate.After(before), "next due must be strictly after now")
	})

	t.Run("repeat_from_completion preserves the original time-of-day", func(t *testing.T) {
		// From-completion evaluates the next occurrence relative to now, but the
		// time-of-day still comes from the original due date (09:00).
		oldTask := &Task{
			Done:                 false,
			RepeatMode:           TaskRepeatModeRRule,
			RepeatRRule:          "FREQ=WEEKLY;BYDAY=MO",
			RepeatFromCompletion: true,
			DueDate:              time.Date(2020, 1, 6, 9, 0, 0, 0, time.UTC), // a Monday, long past
		}
		newTask := &Task{Done: true}

		before := time.Now()
		updateDone(oldTask, newTask)

		require.False(t, newTask.Done)
		got := newTask.DueDate.In(time.UTC)
		assert.Equal(t, time.Monday, got.Weekday())
		assert.Equal(t, 9, got.Hour(), "from-completion next due must keep the original 09:00, not the completion time")
		assert.Equal(t, 0, got.Minute())
		assert.True(t, newTask.DueDate.After(before), "next due must be strictly after now")
	})

	t.Run("INTERVAL greater than 1 preserves the interval phase", func(t *testing.T) {
		// FREQ=WEEKLY;INTERVAL=2 anchored to a specific past Monday: the next due
		// must be an EVEN number of weeks from the original due date (phase
		// preserved), at the original 09:00, not re-phased off the completion date.
		base := time.Date(2020, 1, 6, 9, 0, 0, 0, time.UTC) // a Monday
		oldTask := &Task{
			Done:        false,
			RepeatMode:  TaskRepeatModeRRule,
			RepeatRRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
			DueDate:     base,
		}
		newTask := &Task{Done: true}

		before := time.Now()
		updateDone(oldTask, newTask)

		require.False(t, newTask.Done)
		got := newTask.DueDate.In(time.UTC)
		assert.Equal(t, time.Monday, got.Weekday())
		assert.Equal(t, 9, got.Hour())
		assert.True(t, newTask.DueDate.After(before))

		weeks := int(newTask.DueDate.Sub(base).Round(24*time.Hour).Hours() / 24 / 7)
		assert.Equal(t, 0, weeks%2, "next due must be an even number of weeks from the original due date (INTERVAL=2 phase), got %d weeks", weeks)
	})

	t.Run("UNTIL bound reached: task stays done", func(t *testing.T) {
		oldTask := &Task{
			Done:        false,
			RepeatMode:  TaskRepeatModeRRule,
			RepeatRRule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20200110T000000Z",
			DueDate:     time.Date(2020, 1, 6, 0, 0, 0, 0, time.UTC), // a Monday, before UNTIL
		}
		newTask := &Task{Done: true}

		updateDone(oldTask, newTask)

		assert.True(t, newTask.Done, "task with no next occurrence must stay done")
		assert.True(t, newTask.DueDate.IsZero(), "due date must be left untouched when the repeat does not fire")
	})
}

// TestTaskBucket_Update_RRuleRepeatingTask is a kanban regression: an RRULE-mode
// task completed into a view's done bucket must route back to the default
// bucket, mirroring the existing repeat_after-based bucket-routing behavior
// (see the "moving a repeating task to the done bucket" cases in
// kanban_task_bucket_test.go). Task 28 already has that bucket-routing fixture
// setup (view 4, sitting in default bucket 1); it's repurposed here into RRULE
// mode rather than adding a whole new fixture task.
func TestTaskBucket_Update_RRuleRepeatingTask(t *testing.T) {
	db.LoadAndAssertFixtures(t)
	s := db.NewSession()
	defer s.Close()

	u := &user.User{ID: 1}

	due := time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC) // a Monday
	_, err := s.ID(28).
		Cols("repeat_mode", "repeat_rrule", "repeat_after", "repeat_from_completion", "due_date").
		Update(&Task{
			RepeatMode:  TaskRepeatModeRRule,
			RepeatRRule: "FREQ=WEEKLY;BYDAY=MO",
			DueDate:     due,
		})
	require.NoError(t, err)

	tb := &TaskBucket{
		TaskID:        28,
		BucketID:      3, // Bucket 3 is the done bucket on view 4
		ProjectViewID: 4,
		ProjectID:     1,
	}
	err = tb.Update(s, u)
	require.NoError(t, err)
	err = s.Commit()
	require.NoError(t, err)

	assert.False(t, tb.Task.Done)
	assert.Equal(t, int64(1), tb.BucketID, "should be routed to the default bucket (1), not left in the done bucket (3)")
	assert.True(t, tb.Task.DueDate.After(due), "due date must have advanced to the next occurrence")

	db.AssertExists(t, "tasks", map[string]interface{}{
		"id":   28,
		"done": false,
	}, false)
	db.AssertMissing(t, "task_buckets", map[string]interface{}{
		"task_id":   28,
		"bucket_id": 3,
	})
}

func TestRRuleDueDateAnchoring(t *testing.T) {
	usr := &user.User{ID: 1, Username: "user1"}

	isMonOrFri := func(wd time.Weekday) bool {
		return wd == time.Monday || wd == time.Friday
	}

	t.Run("create without a due date anchors to the first occurrence", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		before := time.Now()
		task := &Task{
			Title:       "anchor me",
			ProjectID:   1,
			RepeatMode:  TaskRepeatModeRRule,
			RepeatRRule: "FREQ=WEEKLY;BYDAY=MO,FR",
		}
		require.NoError(t, task.Create(s, usr))
		require.NoError(t, s.Commit())

		assert.False(t, task.DueDate.IsZero(), "due date must be anchored, not left empty")
		assert.True(t, task.DueDate.After(before), "anchored due date must be strictly after now")
		assert.True(t, isMonOrFri(task.DueDate.In(config.GetTimeZone()).Weekday()), "anchored due date must fall on a rule occurrence (Mon or Fri), got %s", task.DueDate.Weekday())
		assert.Less(t, task.DueDate.Sub(before), 8*24*time.Hour, "first weekly occurrence must be within a week")

		reread, err := GetTaskByIDSimple(s, task.ID)
		require.NoError(t, err)
		assert.False(t, reread.DueDate.IsZero(), "anchored due date must persist to the database")
	})

	t.Run("create with an explicit due date does not overwrite it", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		explicit := time.Date(2026, 7, 31, 9, 0, 0, 0, time.UTC) // a Friday
		task := &Task{
			Title:       "keep my date",
			ProjectID:   1,
			RepeatMode:  TaskRepeatModeRRule,
			RepeatRRule: "FREQ=WEEKLY;BYDAY=MO,FR",
			DueDate:     explicit,
		}
		require.NoError(t, task.Create(s, usr))
		require.NoError(t, s.Commit())

		assert.True(t, explicit.Equal(task.DueDate), "explicit due date must not be overwritten, got %s", task.DueDate)
	})

	t.Run("create with a fully-past UNTIL leaves the due date empty and does not error", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		task := &Task{
			Title:       "expired rule",
			ProjectID:   1,
			RepeatMode:  TaskRepeatModeRRule,
			RepeatRRule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20200110T000000Z",
		}
		require.NoError(t, task.Create(s, usr))
		require.NoError(t, s.Commit())

		assert.True(t, task.DueDate.IsZero(), "a rule with no future occurrence must leave the due date empty")
	})

	t.Run("partial update into rrule mode anchors and persists the due date", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// A plain task with no due date, so the update is the first time a rule appears.
		plain := &Task{Title: "plain", ProjectID: 1}
		require.NoError(t, plain.Create(s, usr))
		require.NoError(t, s.Commit())
		require.True(t, plain.DueDate.IsZero())

		before := time.Now()
		// Explicitly exclude due_date from the updated fields to exercise the
		// narrowed colsToUpdate allow-list — the anchor must add it back itself.
		upd := &Task{
			ID:          plain.ID,
			RepeatMode:  TaskRepeatModeRRule,
			RepeatRRule: "FREQ=WEEKLY;BYDAY=MO,FR",
		}
		require.NoError(t, upd.updateSingleTask(s, usr, []string{"repeat_mode", "repeat_rrule"}))
		require.NoError(t, s.Commit())

		reread, err := GetTaskByIDSimple(s, plain.ID)
		require.NoError(t, err)
		assert.False(t, reread.DueDate.IsZero(), "anchored due date must persist even when due_date is not in the updated field set")
		assert.True(t, reread.DueDate.After(before), "anchored due date must be strictly after now")
		assert.True(t, isMonOrFri(reread.DueDate.In(config.GetTimeZone()).Weekday()), "anchored due date must fall on a rule occurrence")
	})
}
