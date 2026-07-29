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

package cron

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"code.vikunja.io/api/pkg/log"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestScheduleWithoutOverlapLogsDroppedRuns pins the operator-visible half of
// the overlap guard: a job which outruns its interval has every following run
// dropped, and this log line is the only sign that it stopped running.
func TestScheduleWithoutOverlapLogsDroppedRuns(t *testing.T) {
	dir := t.TempDir()
	log.ConfigureStandardLogger(true, "file", dir, "DEBUG", "text")
	t.Cleanup(log.InitLogger)

	Init()
	t.Cleanup(Stop)

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	require.NoError(t, ScheduleWithoutOverlap("@every 1s", func() {
		started <- struct{}{}
		<-release
	}))

	<-started
	// Long enough for the next tick to arrive while the first run still holds
	// the slot, which is the case the log line has to surface.
	time.Sleep(1500 * time.Millisecond)
	close(release)

	logged, err := os.ReadFile(filepath.Join(dir, "standard.log"))
	require.NoError(t, err)

	assert.Contains(t, string(logged), "level=WARN",
		"a dropped run is operationally meaningful, so it must not be logged below warning")
	assert.Contains(t, string(logged), "its previous run is still going")
	assert.Contains(t, string(logged), "@every 1s",
		"the log has to name which job stopped running")
}
