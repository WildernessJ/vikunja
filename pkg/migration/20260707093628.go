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
	"time"

	"src.techknowlogick.com/xormigrate"
	"xorm.io/xorm"
)

type Activity20260707093628 struct {
	ID        int64     `xorm:"bigint autoincr not null unique pk" json:"id"`
	ProjectID int64     `xorm:"bigint not null index" json:"project_id"`
	TaskID    int64     `xorm:"bigint null index" json:"task_id"`
	ActorID   int64     `xorm:"bigint not null index" json:"actor_id"`
	Verb      string    `xorm:"varchar(50) not null" json:"verb"`
	Summary   string    `xorm:"text null" json:"summary"`
	Created   time.Time `xorm:"created not null index" json:"created"`
}

func (Activity20260707093628) TableName() string {
	return "activities"
}

func init() {
	migrations = append(migrations, &xormigrate.Migration{
		ID:          "20260707093628",
		Description: "Add activities table for the project activity feed",
		Migrate: func(tx *xorm.Engine) error {
			return tx.Sync2(Activity20260707093628{})
		},
		Rollback: func(tx *xorm.Engine) error {
			return nil
		},
	})
}
