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
	"code.vikunja.io/api/pkg/log"

	"github.com/robfig/cron/v3"
)

var c *cron.Cron

// Init starts the cron
func Init() {
	c = cron.New()
	c.Start()
}

// Schedule schedules a job as a cron job
func Schedule(schedule string, f func()) (err error) {
	_, err = c.AddFunc(schedule, f)
	return
}

// ScheduleWithoutOverlap schedules a job which is skipped while its previous
// invocation is still running, instead of running concurrently with itself.
// Use it for jobs whose runtime is not bounded by the interval - network
// fan-outs, anything proportional to the number of users.
func ScheduleWithoutOverlap(schedule string, f func()) (err error) {
	job := cron.NewChain(cron.SkipIfStillRunning(&skipLogger{schedule: schedule})).Then(cron.FuncJob(f))
	_, err = c.AddJob(schedule, job)
	return
}

// skipLogger routes the job wrapper's messages into Vikunja's logger. Once a
// job outruns its own interval every following run is dropped and the job
// effectively stops, so the drop has to be visible: with a discarding logger
// that instance looks healthy while nothing happens on it any more.
type skipLogger struct {
	schedule string
}

// Info only ever receives SkipIfStillRunning's "skip" (robfig/cron/v3/chain.go),
// which is why this is a warning and not an info line.
func (l *skipLogger) Info(msg string, _ ...interface{}) {
	log.Warningf("[Cron] Dropped a run of the %q job (%s): its previous run is still going", l.schedule, msg)
}

func (l *skipLogger) Error(err error, msg string, _ ...interface{}) {
	log.Errorf("[Cron] The %q job reported an error (%s): %s", l.schedule, msg, err)
}

// Stop stops the cron scheduler
func Stop() {
	c.Stop()
}
