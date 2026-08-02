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

// Endpoint is varchar(500) rather than text so it can carry a unique index on
// MySQL, where TEXT columns need a prefix length. 500 utf8mb4 chars is 2000
// bytes, inside InnoDB's 3072-byte key limit, and comfortably longer than the
// endpoints Apple/Mozilla/FCM hand out.
type PushSubscription20260729154002 struct {
	ID       int64     `xorm:"bigint autoincr not null unique pk"`
	UserID   int64     `xorm:"bigint not null index"`
	Endpoint string    `xorm:"varchar(500) not null unique"`
	P256dh   string    `xorm:"varchar(255) not null"`
	Auth     string    `xorm:"varchar(255) not null"`
	Created  time.Time `xorm:"created not null"`
}

func (PushSubscription20260729154002) TableName() string {
	return "push_subscriptions"
}

func init() {
	migrations = append(migrations, &xormigrate.Migration{
		ID:          "20260729154002",
		Description: "Add the push_subscriptions table for Web Push notifications",
		Migrate: func(tx *xorm.Engine) error {
			return tx.Sync(PushSubscription20260729154002{})
		},
		Rollback: func(tx *xorm.Engine) error {
			return tx.DropTables(PushSubscription20260729154002{})
		},
	})
}
