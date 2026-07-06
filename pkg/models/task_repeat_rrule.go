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

package models

import (
	"time"

	"code.vikunja.io/api/pkg/config"

	"github.com/teambition/rrule-go"
)

// anchorRRuleDueDate gives an RRULE-mode task a due date when it has none, set
// to the first occurrence strictly after now, so a recurring task is never left
// dateless and inert (Todoist parity). It never overwrites an existing due date
// and does nothing for non-RRULE modes or a rule with no future occurrence
// (e.g. an already-passed UNTIL). Returns true when it set a due date.
func anchorRRuleDueDate(t *Task) bool {
	if t.RepeatMode != TaskRepeatModeRRule || !t.DueDate.IsZero() {
		return false
	}
	// No prior due date means no time-of-day to preserve; anchor and cutoff are
	// both now, so the first occurrence at or after now becomes the due date.
	now := time.Now()
	next, ok := nextRRuleOccurrence(t.RepeatRRule, now, now, config.GetTimeZone())
	if !ok {
		return false
	}
	t.DueDate = next
	return true
}

// supportedRRuleFreqs whitelists the RFC 5545 subset this engine understands.
// Anything outside it (BYHOUR/BYMINUTE/BYMONTH/etc., or an unlisted FREQ) parses
// fine in rrule-go but isn't part of the calendar-pattern feature's supported subset.
var supportedRRuleFreqs = map[rrule.Frequency]bool{
	rrule.DAILY:   true,
	rrule.WEEKLY:  true,
	rrule.MONTHLY: true,
	rrule.YEARLY:  true,
}

// IsValidTaskRRule reports whether rule is a valid, supported RRULE for
// TaskRepeatModeRRule. CalDAV import uses it to decide whether to keep an
// incoming recurrence rule (unsupported rules are dropped, not rejected).
func IsValidTaskRRule(rule string) bool {
	return validateTaskRRule(rule) == nil
}

// validateTaskRRule rejects empty, malformed, or out-of-subset RRULE strings.
func validateTaskRRule(rule string) error {
	if rule == "" {
		return ErrInvalidTaskRepeatRRule{RRule: rule}
	}

	option, err := rrule.StrToROptionInLocation(rule, time.UTC)
	if err != nil {
		return ErrInvalidTaskRepeatRRule{RRule: rule}
	}

	if !supportedRRuleFreqs[option.Freq] {
		return ErrInvalidTaskRepeatRRule{RRule: rule}
	}

	// COUNT is out of the supported subset (see spec Non-Goals): occurrence
	// counting needs per-task state we don't store, and since each completion
	// resets Dtstart, a COUNT rule would never exhaust and repeat forever.
	if option.Count > 0 {
		return ErrInvalidTaskRepeatRRule{RRule: rule}
	}

	if len(option.Bymonth) > 0 || len(option.Byyearday) > 0 || len(option.Byweekno) > 0 ||
		len(option.Byhour) > 0 || len(option.Byminute) > 0 || len(option.Bysecond) > 0 ||
		len(option.Byeaster) > 0 {
		return ErrInvalidTaskRepeatRRule{RRule: rule}
	}

	if _, err := rrule.NewRRule(*option); err != nil {
		return ErrInvalidTaskRepeatRRule{RRule: rule}
	}

	return nil
}

// nextRRuleOccurrence returns the first occurrence of rule strictly after the
// cutoff `after`, with the rule anchored at `dtstart`. The two are deliberately
// separate: dtstart fixes the recurrence's time-of-day AND interval phase (so an
// "every Monday 09:00" rule keeps 09:00 and an INTERVAL>1 rule keeps its week
// phase), while `after` only skips past already-elapsed occurrences. Conflating
// them — using the completion time as dtstart — leaks the completion clock time
// into every future occurrence. ok is false when rule is empty or invalid, or
// when no occurrence remains after the cutoff (e.g. its UNTIL bound has passed).
func nextRRuleOccurrence(rule string, dtstart, after time.Time, loc *time.Location) (time.Time, bool) {
	if rule == "" {
		return time.Time{}, false
	}
	if loc == nil {
		loc = time.UTC
	}

	option, err := rrule.StrToROptionInLocation(rule, loc)
	if err != nil {
		return time.Time{}, false
	}
	option.Dtstart = dtstart.In(loc)

	r, err := rrule.NewRRule(*option)
	if err != nil {
		return time.Time{}, false
	}

	next := r.After(after, false)
	if next.IsZero() {
		return time.Time{}, false
	}
	return next, true
}
