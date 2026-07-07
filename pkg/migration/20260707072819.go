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

package migration

import (
	"src.techknowlogick.com/xormigrate"
	"xorm.io/xorm"
)

type TaskReminderRepeatRRule20260707072819 struct {
	RepeatRRule string `xorm:"TEXT null 'repeat_rrule'" json:"repeat_rrule"`
}

func (TaskReminderRepeatRRule20260707072819) TableName() string {
	return "task_reminders"
}

func init() {
	migrations = append(migrations, &xormigrate.Migration{
		ID:          "20260707072819",
		Description: "Add repeat_rrule column to task_reminders",
		Migrate: func(tx *xorm.Engine) error {
			return tx.Sync(TaskReminderRepeatRRule20260707072819{})
		},
		Rollback: func(tx *xorm.Engine) error {
			return nil
		},
	})
}
