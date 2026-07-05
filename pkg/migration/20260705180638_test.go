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
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"xorm.io/xorm"
)

func setupProjectViewsEngine20260705180638(t *testing.T) *xorm.Engine {
	t.Helper()

	engine, err := xorm.NewEngine("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("could not create engine: %v", err)
	}
	t.Cleanup(func() {
		_ = engine.Close()
	})

	_, err = engine.Exec(`CREATE TABLE project_views (
		id INTEGER PRIMARY KEY,
		done_bucket_id BIGINT NULL,
		default_bucket_id BIGINT NULL
	)`)
	if err != nil {
		t.Fatalf("could not create table: %v", err)
	}

	_, err = engine.Exec(`INSERT INTO project_views (id, done_bucket_id, default_bucket_id) VALUES
		(1, 5, 5),
		(2, 3, 4),
		(3, 0, 4),
		(4, NULL, NULL)`)
	if err != nil {
		t.Fatalf("could not insert fixtures: %v", err)
	}

	return engine
}

func findMigration20260705180638(t *testing.T) func(*xorm.Engine) error {
	t.Helper()

	for _, m := range migrations {
		if m.ID == "20260705180638" {
			return m.Migrate
		}
	}
	t.Fatal("migration 20260705180638 is not registered")
	return nil
}

func TestNormalizeProjectViewDoneBucket20260705180638(t *testing.T) {
	engine := setupProjectViewsEngine20260705180638(t)
	migrate := findMigration20260705180638(t)

	if err := migrate(engine); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	type row struct {
		ID              int64  `xorm:"id"`
		DoneBucketID    *int64 `xorm:"done_bucket_id"`
		DefaultBucketID *int64 `xorm:"default_bucket_id"`
	}
	var rows []row
	if err := engine.SQL("SELECT id, done_bucket_id, default_bucket_id FROM project_views ORDER BY id").Find(&rows); err != nil {
		t.Fatalf("could not read rows back: %v", err)
	}
	if len(rows) != 4 {
		t.Fatalf("expected 4 rows, got %d", len(rows))
	}

	if rows[0].DoneBucketID == nil || *rows[0].DoneBucketID != 0 {
		t.Errorf("row 1: done_bucket_id should be cleared to 0, got %v", rows[0].DoneBucketID)
	}
	if rows[0].DefaultBucketID == nil || *rows[0].DefaultBucketID != 5 {
		t.Errorf("row 1: default_bucket_id must stay 5, got %v", rows[0].DefaultBucketID)
	}
	if rows[1].DoneBucketID == nil || *rows[1].DoneBucketID != 3 {
		t.Errorf("row 2: distinct done bucket must be untouched, got %v", rows[1].DoneBucketID)
	}
	if rows[2].DoneBucketID == nil || *rows[2].DoneBucketID != 0 {
		t.Errorf("row 3: zero done bucket must stay 0, got %v", rows[2].DoneBucketID)
	}
	if rows[3].DoneBucketID != nil {
		t.Errorf("row 4: NULL done bucket must stay NULL, got %v", *rows[3].DoneBucketID)
	}

	// Re-running must be a no-op.
	if err := migrate(engine); err != nil {
		t.Fatalf("re-running migration failed: %v", err)
	}
}
