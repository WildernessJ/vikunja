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

// A NULL default on TEXT is rejected by older MySQL/MariaDB; leave the column
// nullable with no default. xorm reads NULL into "", the canonical "no rule" value.
// Explicit column names needed: xorm's snake-case mapper turns "RepeatRRule"
// into "repeat_r_rule", not "repeat_rrule".
type TaskRepeatRRule20260706092628 struct {
	RepeatRRule          string `xorm:"TEXT null 'repeat_rrule'" json:"repeat_rrule"`
	RepeatFromCompletion bool   `xorm:"not null default false 'repeat_from_completion'" json:"repeat_from_completion"`
}

func (TaskRepeatRRule20260706092628) TableName() string {
	return "tasks"
}

func init() {
	migrations = append(migrations, &xormigrate.Migration{
		ID:          "20260706092628",
		Description: "Add repeat_rrule and repeat_from_completion columns to tasks",
		Migrate: func(tx *xorm.Engine) error {
			return tx.Sync(TaskRepeatRRule20260706092628{})
		},
		Rollback: func(tx *xorm.Engine) error {
			return nil
		},
	})
}
