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

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/user"

	"xorm.io/builder"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReminderGetTasksInTheNextMinute(t *testing.T) {
	t.Run("Found Tasks", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		now, err := time.Parse(time.RFC3339Nano, "2018-12-01T01:12:00Z")
		require.NoError(t, err)
		notifications, err := getTasksWithRemindersDueAndTheirUsers(s, now, builder.Eq{"users.email_reminders_enabled": true})
		require.NoError(t, err)
		assert.Len(t, notifications, 1)
		assert.Equal(t, int64(27), notifications[0].Task.ID)
	})
	t.Run("Found No Tasks", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		now, err := time.Parse(time.RFC3339Nano, "2018-12-02T01:13:00Z")
		require.NoError(t, err)
		taskIDs, err := getTasksWithRemindersDueAndTheirUsers(s, now, builder.Eq{"users.email_reminders_enabled": true})
		require.NoError(t, err)
		assert.Empty(t, taskIDs)
	})
}

func TestReminderRepeatRRuleValidation(t *testing.T) {
	u := &user.User{ID: 1}

	t.Run("rejects rrule on a relative reminder", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		task := &Task{
			ID:        1,
			Title:     "test",
			ProjectID: 1,
			DueDate:   time.Date(2026, time.July, 7, 9, 0, 0, 0, time.UTC),
			Reminders: []*TaskReminder{
				{
					RelativeTo:     ReminderRelationDueDate,
					RelativePeriod: 0,
					RepeatRRule:    "FREQ=WEEKLY;BYDAY=TU",
				},
			},
		}
		err := task.Update(s, u)
		require.Error(t, err)
		assert.True(t, IsErrReminderRRuleRequiresAbsolute(err))
	})

	t.Run("rejects an invalid rrule", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		task := &Task{
			ID:        1,
			Title:     "test",
			ProjectID: 1,
			Reminders: []*TaskReminder{
				{
					Reminder:    time.Date(2026, time.July, 7, 9, 0, 0, 0, time.UTC),
					RepeatRRule: "not a valid rrule",
				},
			},
		}
		err := task.Update(s, u)
		require.Error(t, err)
		assert.True(t, IsErrInvalidReminderRRule(err))
	})
}

func TestReminderRepeatRRuleSurvivesTaskEdit(t *testing.T) {
	u := &user.User{ID: 1}

	db.LoadAndAssertFixtures(t)
	s := db.NewSession()
	defer s.Close()

	task := &Task{
		ID:        1,
		Title:     "test",
		ProjectID: 1,
		Reminders: []*TaskReminder{
			{
				Reminder:    time.Date(2026, time.July, 7, 9, 0, 0, 0, time.UTC),
				RepeatRRule: "FREQ=WEEKLY;BYDAY=TU",
			},
		},
	}
	err := task.Update(s, u)
	require.NoError(t, err)
	require.Len(t, task.Reminders, 1)
	assert.Equal(t, "FREQ=WEEKLY;BYDAY=TU", task.Reminders[0].RepeatRRule)
	require.NoError(t, s.Commit())

	// Editing an unrelated field (title) must resend and preserve the reminder's rrule,
	// since updateReminders rebuilds every reminder from the client-supplied set.
	editTask := &Task{
		ID:        1,
		Title:     "renamed",
		ProjectID: 1,
		Reminders: task.Reminders,
	}
	err = editTask.Update(s, u)
	require.NoError(t, err)
	require.Len(t, editTask.Reminders, 1)
	assert.Equal(t, "FREQ=WEEKLY;BYDAY=TU", editTask.Reminders[0].RepeatRRule)
	require.NoError(t, s.Commit())

	reloaded := &Task{ID: 1}
	err = reloaded.ReadOne(s, u)
	require.NoError(t, err)
	require.Len(t, reloaded.Reminders, 1)
	assert.Equal(t, "FREQ=WEEKLY;BYDAY=TU", reloaded.Reminders[0].RepeatRRule)
}

func TestDispatchReminder(t *testing.T) {
	u := &user.User{ID: 1}

	t.Run("recurring reminder re-arms from the scheduled time without drift", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		task := &Task{
			Title:     "weekly nudge",
			ProjectID: 1,
			Reminders: []*TaskReminder{
				{Reminder: time.Date(2026, 7, 7, 9, 0, 0, 0, time.UTC), RepeatRRule: "FREQ=WEEKLY;BYDAY=TU"},
			},
		}
		require.NoError(t, task.Create(s, u))
		require.Len(t, task.Reminders, 1)

		n := &ReminderDueNotification{User: u, Task: task, TaskReminder: task.Reminders[0]}

		// Three simulated firings. The next fire time is always derived from the
		// reminder's scheduled time, never from the (possibly delayed) delivery
		// time, so the schedule stays exactly on its weekly Tuesday 09:00 cadence.
		want := []time.Time{
			time.Date(2026, 7, 14, 9, 0, 0, 0, time.UTC),
			time.Date(2026, 7, 21, 9, 0, 0, 0, time.UTC),
			time.Date(2026, 7, 28, 9, 0, 0, 0, time.UTC),
		}
		for i, w := range want {
			require.NoError(t, dispatchReminder(s, []*ReminderDueNotification{n}, false, false))
			assert.True(t, w.Equal(task.Reminders[0].Reminder), "firing %d: want %s, got %s", i+1, w, task.Reminders[0].Reminder)

			stored := &TaskReminder{}
			has, err := s.ID(task.Reminders[0].ID).Get(stored)
			require.NoError(t, err)
			require.True(t, has)
			assert.True(t, w.Equal(stored.Reminder), "firing %d: DB row must be re-armed in the same session", i+1)
		}
	})

	t.Run("multiple recipients re-arm the reminder only once", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		task := &Task{
			Title:     "shared nudge",
			ProjectID: 1,
			Reminders: []*TaskReminder{
				{Reminder: time.Date(2026, 7, 7, 9, 0, 0, 0, time.UTC), RepeatRRule: "FREQ=WEEKLY;BYDAY=TU"},
			},
		}
		require.NoError(t, task.Create(s, u))
		reminder := task.Reminders[0]

		// Two recipients sharing the same reminder pointer, as the cron produces
		// for a task with a creator plus a subscriber.
		recipients := []*ReminderDueNotification{
			{User: u, Task: task, TaskReminder: reminder},
			{User: &user.User{ID: 2}, Task: task, TaskReminder: reminder},
		}
		require.NoError(t, dispatchReminder(s, recipients, false, false))

		// Advanced by exactly one week, not two.
		assert.True(t, time.Date(2026, 7, 14, 9, 0, 0, 0, time.UTC).Equal(reminder.Reminder),
			"reminder must advance one occurrence regardless of recipient count, got %s", reminder.Reminder)
	})

	t.Run("plain reminder is left untouched", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		fire := time.Date(2026, 7, 7, 9, 0, 0, 0, time.UTC)
		task := &Task{
			Title:     "one-shot",
			ProjectID: 1,
			Reminders: []*TaskReminder{
				{Reminder: fire},
			},
		}
		require.NoError(t, task.Create(s, u))

		n := &ReminderDueNotification{User: u, Task: task, TaskReminder: task.Reminders[0]}
		require.NoError(t, dispatchReminder(s, []*ReminderDueNotification{n}, false, false))

		assert.True(t, fire.Equal(task.Reminders[0].Reminder), "plain reminder must not be re-armed")
	})

	t.Run("exhausted UNTIL rule becomes one-shot-complete", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		fire := time.Date(2026, 7, 7, 9, 0, 0, 0, time.UTC) // a Tuesday
		task := &Task{
			Title:     "expiring nudge",
			ProjectID: 1,
			Reminders: []*TaskReminder{
				// UNTIL falls before the next Tuesday (Jul 14), so after firing on
				// Jul 7 there is no further occurrence.
				{Reminder: fire, RepeatRRule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20260709T000000Z"},
			},
		}
		require.NoError(t, task.Create(s, u))
		n := &ReminderDueNotification{User: u, Task: task, TaskReminder: task.Reminders[0]}

		require.NoError(t, dispatchReminder(s, []*ReminderDueNotification{n}, false, false))
		assert.True(t, fire.Equal(task.Reminders[0].Reminder), "exhausted rule must leave the reminder at its last fire time")

		// Firing again is a no-op: the exact-minute cron window means a past time
		// is never selected again, so the row stays put.
		require.NoError(t, dispatchReminder(s, []*ReminderDueNotification{n}, false, false))
		assert.True(t, fire.Equal(task.Reminders[0].Reminder), "an exhausted reminder must never advance")
	})

	t.Run("rrule is evaluated in the task creator's timezone", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		nyLoc, err := time.LoadLocation("America/New_York")
		require.NoError(t, err)

		_, err = s.ID(1).Cols("timezone").Update(&user.User{Timezone: "America/New_York"})
		require.NoError(t, err)

		// Tuesday 09:00 New York, one week before the autumn DST transition. The
		// next Tuesday 09:00 New York is one hour further from UTC. Evaluating the
		// rule in UTC instead would land on 08:00 New York — a different instant,
		// which this assertion rejects.
		fire := time.Date(2026, 10, 27, 9, 0, 0, 0, nyLoc)
		wantNext := time.Date(2026, 11, 3, 9, 0, 0, 0, nyLoc)

		task := &Task{
			Title:     "tz nudge",
			ProjectID: 1,
			Reminders: []*TaskReminder{
				{Reminder: fire, RepeatRRule: "FREQ=WEEKLY;BYDAY=TU"},
			},
		}
		require.NoError(t, task.Create(s, u))
		n := &ReminderDueNotification{User: u, Task: task, TaskReminder: task.Reminders[0]}

		require.NoError(t, dispatchReminder(s, []*ReminderDueNotification{n}, false, false))
		assert.True(t, wantNext.Equal(task.Reminders[0].Reminder),
			"reminder must re-arm to 09:00 in the creator's timezone (want %s, got %s)", wantNext, task.Reminders[0].Reminder)
	})
}

func TestGetTaskUsersForTasks(t *testing.T) {
	t.Run("task owner", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// Task 1 is owned by user 1 (created_by_id: 1) in project 1 (owned by user 1)
		taskUsers, err := getTaskUsersForTasks(s, []int64{1}, nil)
		require.NoError(t, err)
		require.NotEmpty(t, taskUsers)

		// Should include the task creator
		hasUser1 := false
		for _, tu := range taskUsers {
			if tu.User.ID == 1 && tu.Task.ID == 1 {
				hasUser1 = true
				break
			}
		}
		assert.True(t, hasUser1, "task owner should be included in task users")
	})

	t.Run("project shared directly with user", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// Task 32 is in project 3, which is shared directly with user 1 (users_projects id: 1)
		taskUsers, err := getTaskUsersForTasks(s, []int64{32}, nil)
		require.NoError(t, err)
		require.NotEmpty(t, taskUsers)

		// Should include user 1 who has direct share
		hasUser1 := false
		for _, tu := range taskUsers {
			if tu.User.ID == 1 && tu.Task.ID == 32 {
				hasUser1 = true
				break
			}
		}
		assert.True(t, hasUser1, "user with direct project share should be included")
	})

	t.Run("creator who lost project access", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// Task 1 is in project 1 (owned by user 1)
		// Task 1 was created by user 1 (created_by_id: 1)
		// User 13 has no access to project 1
		// Create a scenario by pretending user 13 created the task but has no access

		_, err := s.
			Cols("created_by_id").
			Where("id = ?", 1).
			Update(&Task{CreatedByID: 13})
		require.NoError(t, err)

		taskUsers, err := getTaskUsersForTasks(s, []int64{1}, nil)
		require.NoError(t, err)

		// Should only include users with access
		// User 13 should not be in the results (no access to project 1)
		hasUser13 := false
		for _, tu := range taskUsers {
			if tu.User.ID == 13 && tu.Task.ID == 1 {
				hasUser13 = true
				break
			}
		}
		assert.False(t, hasUser13, "creator without project access should be filtered out")
	})

	t.Run("subscriber who lost project access", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// Task 2 is in project 1 (owned by user 1)
		// Create a subscription for user 13 who has no access to project 1
		subscription := &Subscription{
			EntityType: SubscriptionEntityTask,
			EntityID:   2,
			UserID:     13,
		}
		_, err := s.Insert(subscription)
		require.NoError(t, err)

		taskUsers, err := getTaskUsersForTasks(s, []int64{2}, nil)
		require.NoError(t, err)

		// User 13 should NOT be in the results (subscribed but no access to project 1)
		hasUser13 := false
		for _, tu := range taskUsers {
			if tu.User.ID == 13 && tu.Task.ID == 2 {
				hasUser13 = true
				break
			}
		}
		assert.False(t, hasUser13, "subscriber without project access should be filtered out")
	})

	t.Run("assignees - with and without project access", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// Task 30 has assignees: user 1 and user 2 (task_assignees)
		// Task 30 is in project 1, owned by user 1
		// User 1 has access (owner), user 2 does NOT have access to project 1
		taskUsers, err := getTaskUsersForTasks(s, []int64{30}, nil)
		require.NoError(t, err)
		require.NotEmpty(t, taskUsers)

		// Should include user 1 (assignee WITH project access)
		// Should NOT include user 2 (assignee WITHOUT project access)
		hasUser1 := false
		hasUser2 := false
		for _, tu := range taskUsers {
			if tu.Task.ID == 30 {
				if tu.User.ID == 1 {
					hasUser1 = true
				}
				if tu.User.ID == 2 {
					hasUser2 = true
				}
			}
		}
		assert.True(t, hasUser1, "assignee with project access should be included")
		assert.False(t, hasUser2, "assignee without project access should be filtered out")
	})

	t.Run("subscribers - with project access", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// Task 2 has subscription from user 1 (subscriptions id: 1)
		// Task 2 is in project 1, owned by user 1
		// User 1 has access as the owner
		taskUsers, err := getTaskUsersForTasks(s, []int64{2}, nil)
		require.NoError(t, err)
		require.NotEmpty(t, taskUsers)

		// Should include the subscriber who has access
		hasUser1 := false
		for _, tu := range taskUsers {
			if tu.User.ID == 1 && tu.Task.ID == 2 {
				hasUser1 = true
				break
			}
		}
		assert.True(t, hasUser1, "subscriber with project access should be included")
	})

	t.Run("no duplicate users", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// Task 30: user 1 is both creator and assignee
		taskUsers, err := getTaskUsersForTasks(s, []int64{30}, nil)
		require.NoError(t, err)
		require.NotEmpty(t, taskUsers)

		// Count how many times user 1 appears for task 30
		user1Count := 0
		for _, tu := range taskUsers {
			if tu.User.ID == 1 && tu.Task.ID == 30 {
				user1Count++
			}
		}
		assert.Equal(t, 1, user1Count, "each user should appear only once per task")
	})

	t.Run("empty task list", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		taskUsers, err := getTaskUsersForTasks(s, []int64{}, nil)
		require.NoError(t, err)
		assert.Empty(t, taskUsers)
	})

	t.Run("multiple tasks with various relationships", func(t *testing.T) {
		db.LoadAndAssertFixtures(t)
		s := db.NewSession()
		defer s.Close()

		// Task 1: user 1 is creator and owner
		// Task 2: user 1 is subscriber and owner
		// Task 30: user 1 is assignee and owner, user 2 is assignee without access
		taskUsers, err := getTaskUsersForTasks(s, []int64{1, 2, 30}, nil)
		require.NoError(t, err)
		require.NotEmpty(t, taskUsers)

		// Count unique task IDs in results
		taskIDs := make(map[int64]bool)
		for _, tu := range taskUsers {
			taskIDs[tu.Task.ID] = true
		}
		assert.True(t, taskIDs[1], "should include users for task 1")
		assert.True(t, taskIDs[2], "should include users for task 2")
		assert.True(t, taskIDs[30], "should include users for task 30")

		// Verify user 2 is NOT included for any task (no access to project 1)
		hasUser2 := false
		for _, tu := range taskUsers {
			if tu.User.ID == 2 {
				hasUser2 = true
				break
			}
		}
		assert.False(t, hasUser2, "user without project access should not be included for any task")
	})
}
