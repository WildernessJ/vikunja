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
	"fmt"

	"src.techknowlogick.com/xormigrate"
	"xorm.io/xorm"
)

func init() {
	migrations = append(migrations, &xormigrate.Migration{
		ID:          "20260705180638",
		Description: "Clear done_bucket_id on project views where it equals default_bucket_id",
		Migrate: func(tx *xorm.Engine) error {
			// The done and default bucket must not be the same view config:
			// new tasks would land in the done bucket and be marked done
			// immediately. Validation now forbids it; clear the done bucket
			// designation (0 = no auto-move on done) on legacy rows so they
			// pass validation. The default bucket is left untouched.
			_, err := tx.Exec(`UPDATE project_views SET done_bucket_id = 0 WHERE done_bucket_id <> 0 AND done_bucket_id = default_bucket_id`)
			if err != nil {
				return fmt.Errorf("failed to normalize project views with done bucket equal to default bucket: %w", err)
			}
			return nil
		},
		Rollback: func(_ *xorm.Engine) error {
			return nil
		},
	})
}
