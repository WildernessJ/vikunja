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
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/cron"
	"code.vikunja.io/api/pkg/log"
	"code.vikunja.io/api/pkg/modules/dump"
)

var backupMu sync.Mutex

// RegisterBackupCron schedules the periodic backup job configured via the
// `backup.*` config keys. It is a no-op when backups are disabled. A malformed
// cron schedule logs a CRITICAL error and leaves scheduled backups disabled;
// it no longer crashes the server.
//
// dumpFunc is injected (rather than calling dump.Dump directly) for
// testability and because that package imports pkg/initialize, which would
// otherwise create an import cycle for any caller wiring this in from
// initialize.FullInit. We only import pkg/modules/dump here for its filename helper.
func RegisterBackupCron(dumpFunc func(filename string) error) {
	if !config.BackupEnabled.GetBool() {
		log.Info("Scheduled backups are disabled, not registering backup cron")
		return
	}

	err := cron.Schedule(config.BackupSchedule.GetString(), func() {
		runBackupJob(dumpFunc)
	})
	if err != nil {
		log.Criticalf("Invalid backup.schedule %q: %s. Scheduled backups are DISABLED until this is fixed.", config.BackupSchedule.GetString(), err)
		return
	}
}

func runBackupJob(dumpFunc func(filename string) error) {
	// fullPath is non-empty only while a dump file may be on disk but not yet
	// known-good; the panic recover uses it to decide whether to clean up.
	var fullPath string
	defer func() {
		if r := recover(); r != nil {
			log.Errorf("Recovered from panic in scheduled backup job: %v", r)
			if fullPath != "" {
				cleanupPartialBackup(fullPath, fmt.Errorf("panic during backup: %v", r))
			}
		}
	}()

	if !backupMu.TryLock() {
		log.Warning("Scheduled backup skipped, a previous backup run is still in progress")
		return
	}
	defer backupMu.Unlock()

	dir := config.BackupPath.GetString()
	if dir == "" {
		dir = filepath.Join(config.ServiceRootpath.GetString(), "backups")
	}

	if err := os.MkdirAll(dir, 0700); err != nil {
		log.Errorf("Could not create backup directory %s: %s", dir, err)
		return
	}

	filename := dump.DefaultDumpFilename()
	dumpPath := filepath.Join(dir, filename)
	fullPath = dumpPath

	if err := dumpFunc(dumpPath); err != nil {
		cleanupPartialBackup(dumpPath, err)
		return
	}
	fullPath = "" // dump completed successfully, a later panic must not clean it up

	log.Infof("Scheduled backup saved at %s", dumpPath)

	if err := pruneBackups(dir, config.BackupKeep.GetInt()); err != nil {
		log.Errorf("Could not prune old backups in %s: %s", dir, err)
	}
}

// cleanupPartialBackup removes a dump file left behind by a failed backup run and
// loudly logs the underlying error which caused the failure.
func cleanupPartialBackup(path string, dumpErr error) {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		log.Errorf("Could not remove partial backup file %s: %s", path, err)
	}
	log.Errorf("Scheduled backup failed: %s", dumpErr)
}

// pruneBackups deletes backup zips in dir beyond the newest keep, matching only
// the `vikunja-dump_*.zip` glob (manual CLI dumps sharing that name count too).
// keep <= 0 keeps everything.
func pruneBackups(dir string, keep int) error {
	if keep <= 0 {
		return nil
	}

	matches, err := filepath.Glob(filepath.Join(dir, "vikunja-dump_*.zip"))
	if err != nil {
		return fmt.Errorf("could not glob backup directory %s: %w", dir, err)
	}

	if len(matches) <= keep {
		return nil
	}

	sort.Sort(sort.Reverse(sort.StringSlice(matches)))

	var removeErr error
	for _, m := range matches[keep:] {
		if err := os.Remove(m); err != nil {
			removeErr = fmt.Errorf("could not remove old backup %s: %w", m, err)
			log.Errorf("%s", removeErr)
		}
	}

	return removeErr
}
