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
	"slices"
	"strings"
	"testing"
	"time"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/models"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"src.techknowlogick.com/xormigrate"
	"xorm.io/xorm"
)

// Upstream added these after 20260908202544 was already recorded on existing installs,
// so they run late there, out of ID order.
var lateUpstreamMigrationIDs = []string{
	"20260901001942",
	"20260901220330",
	"20260911150507",
	"20260911193534",
	"20260911193552",
	"20260914185746",
}

type migrationStatusLate struct {
	ID           int64      `xorm:"bigint autoincr not null unique pk"`
	UserID       int64      `xorm:"bigint not null"`
	StartedAt    time.Time  `xorm:"not null"`
	HeartbeatAt  *time.Time `xorm:"null"`
	ErrorKind    string     `xorm:"varchar(50) null"`
	UploadFileID *int64     `xorm:"bigint null"`
}

func (migrationStatusLate) TableName() string { return "migration_status" }

func runAllMigrations(t *testing.T, x *xorm.Engine) {
	t.Helper()
	sorted := slices.Clone(migrations)
	slices.SortFunc(sorted, func(a, b *xormigrate.Migration) int { return strings.Compare(a.ID, b.ID) })
	m := xormigrate.New(x, sorted)
	m.InitSchema(initSchema)
	require.NoError(t, m.Migrate())
}

func TestLateUpstreamMigrationsApplyAfterProjectAncestors(t *testing.T) {
	x, err := db.CreateTestEngine()
	require.NoError(t, err)

	tables := append(schemaBeans(), &xormigrate.Migration{})
	require.NoError(t, x.DropTables(tables...))
	t.Cleanup(func() {
		require.NoError(t, x.DropTables(tables...))
	})

	// A fresh install records every migration; roll the six back to the state of an
	// install that has 20260908202544 but predates them.
	runAllMigrations(t, x)
	require.NoError(t, x.DropTables(&models.ProjectTaskCounter{}, &models.TaskIndexAlias{}, &models.UserInviteLinkTeam{}, &models.UserInviteLink{}))
	for _, col := range []string{"heartbeat_at", "error_kind", "error_message", "upload_file_id"} {
		require.NoError(t, dropTableColum(x, "migration_status", col))
	}
	_, err = x.In("id", lateUpstreamMigrationIDs).Delete(&xormigrate.Migration{})
	require.NoError(t, err)

	recorded, err := x.Where("id = ?", "20260908202544").Exist(&xormigrate.Migration{})
	require.NoError(t, err)
	require.True(t, recorded)

	_, err = x.Insert(&models.Project{ID: 1, Title: "p1", OwnerID: 1}, &models.Project{ID: 2, Title: "p2", OwnerID: 1})
	require.NoError(t, err)
	_, err = x.Insert(&models.ProjectAncestor{AncestorID: 1, ProjectID: 1}, &models.ProjectAncestor{AncestorID: 2, ProjectID: 2})
	require.NoError(t, err)
	_, err = x.Insert(
		&models.Task{ID: 1, Title: "a", ProjectID: 1, Index: 4, CreatedByID: 1},
		&models.Task{ID: 2, Title: "b", ProjectID: 1, Index: 9, CreatedByID: 1},
		&models.Task{ID: 3, Title: "c", ProjectID: 2, Index: 2, CreatedByID: 1},
	)
	require.NoError(t, err)

	runAllMigrations(t, x)

	count, err := x.In("id", lateUpstreamMigrationIDs).Count(&xormigrate.Migration{})
	require.NoError(t, err)
	assert.Equal(t, int64(len(lateUpstreamMigrationIDs)), count)

	counters := []*models.ProjectTaskCounter{}
	require.NoError(t, x.OrderBy("project_id").Find(&counters))
	require.Len(t, counters, 2)
	assert.Equal(t, int64(9), counters[0].LastIndex)
	assert.Equal(t, int64(2), counters[1].LastIndex)

	ancestors, err := x.Count(&models.ProjectAncestor{})
	require.NoError(t, err)
	assert.Equal(t, int64(2), ancestors)

	beat := time.Now()
	fileID := int64(7)
	_, err = x.Insert(&migrationStatusLate{UserID: 1, StartedAt: beat, HeartbeatAt: &beat, ErrorKind: "interrupted", UploadFileID: &fileID})
	require.NoError(t, err)

	_, err = x.Insert(&models.TaskIndexAlias{ProjectID: 1, Index: 1, TaskID: 1})
	require.NoError(t, err)
	has, err := x.Exist(&models.UserInviteLink{})
	require.NoError(t, err)
	assert.False(t, has)
}
