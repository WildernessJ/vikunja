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

package backup

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"code.vikunja.io/api/pkg/config"
)

func touchFile(t *testing.T, dir, name string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	require.NoError(t, os.WriteFile(p, []byte("x"), 0600))
	return p
}

func TestPruneBackups(t *testing.T) {
	t.Run("keeps newest N and deletes the rest", func(t *testing.T) {
		dir := t.TempDir()
		names := []string{
			"vikunja-dump_2024-01-01_00-00-00.zip",
			"vikunja-dump_2024-01-02_00-00-00.zip",
			"vikunja-dump_2024-01-03_00-00-00.zip",
			"vikunja-dump_2024-01-04_00-00-00.zip",
			"vikunja-dump_2024-01-05_00-00-00.zip",
		}
		for _, n := range names {
			touchFile(t, dir, n)
		}

		err := pruneBackups(dir, 2)
		require.NoError(t, err)

		remaining, err := filepath.Glob(filepath.Join(dir, "vikunja-dump_*.zip"))
		require.NoError(t, err)
		assert.ElementsMatch(t, []string{
			filepath.Join(dir, "vikunja-dump_2024-01-05_00-00-00.zip"),
			filepath.Join(dir, "vikunja-dump_2024-01-04_00-00-00.zip"),
		}, remaining)
	})

	t.Run("ignores files not matching the dump glob", func(t *testing.T) {
		dir := t.TempDir()
		touchFile(t, dir, "vikunja-dump_2024-01-01_00-00-00.zip")
		decoy1 := touchFile(t, dir, "other.zip")
		decoy2 := touchFile(t, dir, "vikunja-dump_2024-01-01.txt")

		err := pruneBackups(dir, 1)
		require.NoError(t, err)

		assert.FileExists(t, decoy1)
		assert.FileExists(t, decoy2)
	})

	t.Run("keep=0 deletes nothing", func(t *testing.T) {
		dir := t.TempDir()
		files := []string{
			"vikunja-dump_2024-01-01_00-00-00.zip",
			"vikunja-dump_2024-01-02_00-00-00.zip",
		}
		for _, n := range files {
			touchFile(t, dir, n)
		}

		err := pruneBackups(dir, 0)
		require.NoError(t, err)

		remaining, err := filepath.Glob(filepath.Join(dir, "vikunja-dump_*.zip"))
		require.NoError(t, err)
		assert.Len(t, remaining, 2)
	})

	t.Run("keep >= count deletes nothing", func(t *testing.T) {
		dir := t.TempDir()
		files := []string{
			"vikunja-dump_2024-01-01_00-00-00.zip",
			"vikunja-dump_2024-01-02_00-00-00.zip",
		}
		for _, n := range files {
			touchFile(t, dir, n)
		}

		err := pruneBackups(dir, 5)
		require.NoError(t, err)

		remaining, err := filepath.Glob(filepath.Join(dir, "vikunja-dump_*.zip"))
		require.NoError(t, err)
		assert.Len(t, remaining, 2)
	})

	t.Run("empty dir does not error or panic", func(t *testing.T) {
		dir := t.TempDir()

		err := pruneBackups(dir, 3)
		require.NoError(t, err)
	})
}

func TestCleanupPartialBackup(t *testing.T) {
	t.Run("removes the partial dump file", func(t *testing.T) {
		dir := t.TempDir()
		p := touchFile(t, dir, "vikunja-dump_2024-01-01_00-00-00.zip")

		cleanupPartialBackup(p, errors.New("simulated dump failure"))

		assert.NoFileExists(t, p)
	})

	t.Run("does not panic when the file does not exist", func(t *testing.T) {
		dir := t.TempDir()
		p := filepath.Join(dir, "vikunja-dump_missing.zip")

		assert.NotPanics(t, func() {
			cleanupPartialBackup(p, errors.New("simulated dump failure"))
		})
	})
}

func remainingDumpFiles(t *testing.T, dir string) []string {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(dir, "vikunja-dump_*.zip"))
	require.NoError(t, err)
	return matches
}

func TestRunBackupJob(t *testing.T) {
	t.Run("success keeps the new file and prunes older ones", func(t *testing.T) {
		dir := t.TempDir()
		config.BackupPath.Set(dir)
		config.BackupKeep.Set(1)

		older := touchFile(t, dir, "vikunja-dump_2020-01-01_00-00-00.zip")

		runBackupJob(func(filename string) error {
			return os.WriteFile(filename, []byte("zip"), 0600)
		})

		remaining := remainingDumpFiles(t, dir)
		assert.NoFileExists(t, older)
		assert.Len(t, remaining, 1)
	})

	t.Run("dump error cleans up the partial file", func(t *testing.T) {
		dir := t.TempDir()
		config.BackupPath.Set(dir)
		config.BackupKeep.Set(1)

		runBackupJob(func(filename string) error {
			require.NoError(t, os.WriteFile(filename, []byte("zip"), 0600))
			return errors.New("simulated dump failure")
		})

		assert.Empty(t, remainingDumpFiles(t, dir))
	})

	t.Run("panic during dump cleans up the partial file and does not re-panic", func(t *testing.T) {
		dir := t.TempDir()
		config.BackupPath.Set(dir)
		config.BackupKeep.Set(1)

		assert.NotPanics(t, func() {
			runBackupJob(func(filename string) error {
				require.NoError(t, os.WriteFile(filename, []byte("zip"), 0600))
				panic("boom")
			})
		})

		assert.Empty(t, remainingDumpFiles(t, dir))
	})

	t.Run("skips the run when a backup is already in progress", func(t *testing.T) {
		dir := t.TempDir()
		config.BackupPath.Set(dir)
		config.BackupKeep.Set(1)

		backupMu.Lock()
		defer backupMu.Unlock()

		called := false
		runBackupJob(func(_ string) error {
			called = true
			return nil
		})

		assert.False(t, called)
		assert.Empty(t, remainingDumpFiles(t, dir))
	})
}
