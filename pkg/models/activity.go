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
	"encoding/json"
	"time"

	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/cron"
	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/log"
	"code.vikunja.io/api/pkg/user"
	"code.vikunja.io/api/pkg/web"

	"github.com/ThreeDotsLabs/watermill/message"
	"xorm.io/xorm"
)

// Activity verbs. These are the immutable, wire-visible identifiers of the
// user-facing activity feed; do not rename existing values.
const (
	ActivityVerbTaskCreated     = "task_created"
	ActivityVerbTaskUpdated     = "task_updated"
	ActivityVerbTaskDeleted     = "task_deleted"
	ActivityVerbTaskCompleted   = "task_completed"
	ActivityVerbTaskReopened    = "task_reopened"
	ActivityVerbAssigneeAdded   = "assignee_added"
	ActivityVerbAssigneeRemoved = "assignee_removed"
	ActivityVerbCommentCreated  = "comment_created"
	ActivityVerbAttachmentAdded = "attachment_added"
	ActivityVerbRelationAdded   = "relation_added"
	ActivityVerbProjectUpdated  = "project_updated"
)

// Activity is a single, immutable entry in a project's user-facing activity
// feed. It is distinct from the license-gated admin audit log (pkg/audit).
type Activity struct {
	ID        int64      `xorm:"bigint autoincr not null unique pk" json:"id" readOnly:"true" doc:"The unique, numeric id of this activity entry."`
	ProjectID int64      `xorm:"bigint not null index" json:"project_id" readOnly:"true" doc:"The project this activity belongs to."`
	TaskID    int64      `xorm:"bigint null index" json:"task_id" readOnly:"true" doc:"The task this activity refers to, if any. 0 for project-level activity, or when the task has since been deleted."`
	ActorID   int64      `xorm:"bigint not null index" json:"actor_id" readOnly:"true" doc:"The id of the user who performed the action."`
	Actor     *user.User `xorm:"-" json:"actor" readOnly:"true" doc:"The user who performed the action."`
	Verb      string     `xorm:"varchar(50) not null" json:"verb" readOnly:"true" doc:"What happened, e.g. task_completed, comment_created, assignee_added."`
	Summary   string     `xorm:"text null" json:"summary" readOnly:"true" doc:"A short human-readable fragment captured at event time, e.g. the task title."`
	Created   time.Time  `xorm:"created not null index" json:"created" readOnly:"true" doc:"When the action happened."`

	web.CRUDable    `xorm:"-" json:"-"`
	web.Permissions `xorm:"-" json:"-"`
}

// TableName holds the table name for activities.
func (act *Activity) TableName() string {
	return "activities"
}

// CanRead delegates to the project's read check, so feed visibility follows
// project read permission (including link-share auth, handled by Project.CanRead).
func (act *Activity) CanRead(s *xorm.Session, a web.Auth) (bool, int, error) {
	p := &Project{ID: act.ProjectID}
	return p.CanRead(s, a)
}

// ActivityQuery carries the feed retrieval options: keyset cursor, filters,
// and page size. The cursor's (created, id) pair is decoded by the transport
// layer; a zero HasCursor means "start at the newest entry".
type ActivityQuery struct {
	ActorID       int64
	Verb          string
	Limit         int
	HasCursor     bool
	CursorCreated time.Time
	CursorID      int64
}

const activityDefaultPageSize = 50

// GetActivityForProject returns a project's activity, newest first, for a user
// with read access. It enforces read permission at the model layer.
func GetActivityForProject(s *xorm.Session, a web.Auth, projectID int64, q *ActivityQuery) ([]*Activity, error) {
	p := &Project{ID: projectID}
	can, _, err := p.CanRead(s, a)
	if err != nil {
		return nil, err
	}
	if !can {
		return nil, ErrGenericForbidden{}
	}
	return queryActivities(s, []int64{projectID}, q)
}

// GetActivityForUser returns activity across every project the user can read,
// newest first. Scoping to readable projects is the permission boundary.
func GetActivityForUser(s *xorm.Session, a web.Auth, q *ActivityQuery) ([]*Activity, error) {
	projectIDs, err := readableProjectIDsForActivity(s, a)
	if err != nil {
		return nil, err
	}
	return queryActivities(s, projectIDs, q)
}

// readableProjectIDsForActivity resolves the set of projects whose activity the
// auth may read. A link share is scoped to its single project; a user gets
// every project they can read.
func readableProjectIDsForActivity(s *xorm.Session, a web.Auth) ([]int64, error) {
	if share, ok := a.(*LinkSharing); ok {
		return []int64{share.ProjectID}, nil
	}

	projects, _, err := getAllProjectsForUser(s, a.GetID(), &projectOptions{getArchived: true})
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(projects))
	for _, p := range projects {
		if p.ID > 0 {
			ids = append(ids, p.ID)
		}
	}
	return ids, nil
}

// queryActivities runs the keyset-paginated feed query and populates actors.
// The (created DESC, id DESC) order paired with the strict (created, id) <
// cursor predicate makes pages stable under concurrent inserts: a row added
// between requests changes no existing page's contents, and no row is skipped
// or duplicated across pages.
func queryActivities(s *xorm.Session, projectIDs []int64, q *ActivityQuery) ([]*Activity, error) {
	if len(projectIDs) == 0 {
		return []*Activity{}, nil
	}

	limit := q.Limit
	if limit <= 0 {
		limit = activityDefaultPageSize
	}

	sess := s.In("project_id", projectIDs)
	if q.ActorID != 0 {
		sess = sess.And("actor_id = ?", q.ActorID)
	}
	if q.Verb != "" {
		sess = sess.And("verb = ?", q.Verb)
	}
	if q.HasCursor {
		cursorCreated := formatActivityCursorForDB(q.CursorCreated)
		sess = sess.And("(created < ? OR (created = ? AND id < ?))", cursorCreated, cursorCreated, q.CursorID)
	}

	activities := []*Activity{}
	if err := sess.OrderBy("created DESC, id DESC").Limit(limit).Find(&activities); err != nil {
		return nil, err
	}

	if err := loadActivityActors(s, activities); err != nil {
		return nil, err
	}
	return activities, nil
}

// formatActivityCursorForDB renders the keyset cursor's created value as a
// string literal for the `created < ? / created = ?` comparison.
//
// It compares against a string literal, not a bound time.Time: xorm binds a
// time.Time by its own Location's wall clock and can add sub-second precision
// the stored value lacks, which makes the boundary (cursor) row leak into the
// next page via `<`.
//
// The literal MUST be in UTC. The DB stores `created` in GMT/UTC regardless of
// config.GetTimeZone() (engine.SetTZDatabase(GMT) in pkg/db/db.go), so a
// config-tz literal would be offset by hours on any non-UTC instance and
// silently skip/duplicate rows across pages. The cursor value came from the
// DB, so its precision already matches the column's; the trailing-zero-trimming
// layout reproduces the stored string exactly (no fractional on
// SQLite/MySQL-default, microseconds on Postgres), so `created = ?` catches the
// boundary row and the id tiebreak decides it.
func formatActivityCursorForDB(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04:05.999999999")
}

func loadActivityActors(s *xorm.Session, activities []*Activity) error {
	if len(activities) == 0 {
		return nil
	}
	actorIDs := make([]int64, 0, len(activities))
	for _, act := range activities {
		if act.ActorID > 0 {
			actorIDs = append(actorIDs, act.ActorID)
		}
	}
	if len(actorIDs) == 0 {
		return nil
	}

	actors, err := user.GetUsersByIDs(s, actorIDs)
	if err != nil {
		return err
	}
	for _, act := range activities {
		if actor, ok := actors[act.ActorID]; ok {
			act.Actor = actor
		}
	}
	return nil
}

// ActivityCaptureListener records an activity entry for one event. A separate
// instance is registered per event name (EventName), which is how a single
// listener type derives the verb for each topic it consumes.
type ActivityCaptureListener struct {
	EventName string
}

// Name defines the name for the ActivityCaptureListener listener. It is
// constant on purpose: the event bus qualifies consumer handlers as
// "<topic>.<name>", so the topic already makes each registration unique.
func (l *ActivityCaptureListener) Name() string {
	return "activity.capture"
}

// Handle records the activity entry. It swallows and logs every error and
// always returns nil: the event bus wraps handlers in
// Retry(5x)+PoisonQueue+Sentry (pkg/events/events.go), so a returned error
// means retry-spam, not silence. A capture failure must never affect the
// originating operation, which has already committed.
func (l *ActivityCaptureListener) Handle(msg *message.Message) error {
	s := db.NewSession()
	defer s.Close()
	if err := l.capture(s, msg); err != nil {
		log.Errorf("activity capture: could not record %s: %s", l.EventName, err)
		return nil
	}
	return nil
}

// activityEventEnvelope is the union of the fields the capture listener needs
// across every event it consumes. JSON unmarshal ignores the fields a given
// event doesn't carry, so one envelope decodes all of them.
type activityEventEnvelope struct {
	Task    *Task      `json:"task"`
	Project *Project   `json:"project"`
	Doer    *user.User `json:"doer"`
	Done    bool       `json:"done"`
}

// capture builds and persists the activity entry, returning any error for
// Handle to swallow. Returns nil (no-op) when the event doesn't map to a feed
// entry.
func (l *ActivityCaptureListener) capture(s *xorm.Session, msg *message.Message) error {
	act, err := l.buildActivity(s, msg)
	if err != nil {
		return err
	}
	if act == nil {
		return nil
	}

	if _, err := s.Insert(act); err != nil {
		return err
	}

	return s.Commit()
}

// buildActivity decodes the event and maps it to an Activity, or returns nil
// when the event doesn't map to a feed entry (or can't be attributed to a
// project). It uses the session only as a fallback to resolve the project and
// summary when the payload doesn't carry them.
func (l *ActivityCaptureListener) buildActivity(s *xorm.Session, msg *message.Message) (*Activity, error) {
	var e activityEventEnvelope
	if err := json.Unmarshal(msg.Payload, &e); err != nil {
		return nil, err
	}

	verb, ok := l.verbFor(&e)
	if !ok {
		return nil, nil
	}

	act := &Activity{Verb: verb}
	if e.Doer != nil {
		act.ActorID = e.Doer.ID
	}

	if e.Task != nil {
		act.TaskID = e.Task.ID
		act.ProjectID = e.Task.ProjectID
		act.Summary = e.Task.Title
	}

	// A task_deleted entry is a project-level tombstone: the task no longer
	// exists, so keep only its title in the summary and drop the reference. A
	// non-zero task_id here would make the feed link to a 404.
	if verb == ActivityVerbTaskDeleted {
		act.TaskID = 0
	}
	if e.Project != nil {
		act.ProjectID = e.Project.ID
		if act.Summary == "" {
			act.Summary = e.Project.Title
		}
	}

	// A partial task update (e.g. a bare done-toggle) can carry a task without
	// its project id or title; backfill from the DB so the feed still resolves.
	if act.TaskID != 0 && (act.ProjectID == 0 || act.Summary == "") {
		stored, err := GetTaskByIDSimple(s, act.TaskID)
		if err != nil {
			return nil, err
		}
		if act.ProjectID == 0 {
			act.ProjectID = stored.ProjectID
		}
		if act.Summary == "" {
			act.Summary = stored.Title
		}
	}

	if act.ProjectID == 0 {
		return nil, nil
	}

	return act, nil
}

func (l *ActivityCaptureListener) verbFor(e *activityEventEnvelope) (string, bool) {
	switch l.EventName {
	case (&TaskCreatedEvent{}).Name():
		return ActivityVerbTaskCreated, true
	case (&TaskUpdatedEvent{}).Name():
		return ActivityVerbTaskUpdated, true
	case (&TaskDeletedEvent{}).Name():
		return ActivityVerbTaskDeleted, true
	case (&TaskDoneChangedEvent{}).Name():
		if e.Done {
			return ActivityVerbTaskCompleted, true
		}
		return ActivityVerbTaskReopened, true
	case (&TaskAssigneeCreatedEvent{}).Name():
		return ActivityVerbAssigneeAdded, true
	case (&TaskAssigneeDeletedEvent{}).Name():
		return ActivityVerbAssigneeRemoved, true
	case (&TaskCommentCreatedEvent{}).Name():
		return ActivityVerbCommentCreated, true
	case (&TaskAttachmentCreatedEvent{}).Name():
		return ActivityVerbAttachmentAdded, true
	case (&TaskRelationCreatedEvent{}).Name():
		return ActivityVerbRelationAdded, true
	case (&ProjectUpdatedEvent{}).Name():
		return ActivityVerbProjectUpdated, true
	}
	return "", false
}

// pruneActivities deletes activity entries older than the retention window.
// A retention of 0 disables pruning; the return value is the number of rows
// removed (used by tests).
func pruneActivities(s *xorm.Session, retentionDays int, now time.Time) (int64, error) {
	if retentionDays <= 0 {
		return 0, nil
	}
	cutoff := now.AddDate(0, 0, -retentionDays)
	return s.Where("created < ?", cutoff).Delete(&Activity{})
}

// RegisterActivityCleanupCron prunes activity feed entries older than the
// configured retention window once a day. It must be registered in
// pkg/initialize/init.go alongside the other crons, or it is dead code.
func RegisterActivityCleanupCron() {
	const logPrefix = "[Activity Cleanup Cron] "

	err := cron.Schedule("0 0 * * *", func() {
		retentionDays := config.ServiceActivityRetentionDays.GetInt()
		if retentionDays <= 0 {
			return
		}

		s := db.NewSession()
		defer s.Close()

		deleted, err := pruneActivities(s, retentionDays, time.Now())
		if err != nil {
			log.Errorf(logPrefix+"Could not prune old activity entries: %s", err)
			return
		}
		if deleted > 0 {
			log.Debugf(logPrefix+"Pruned %d old activity entries", deleted)
		}

		if err := s.Commit(); err != nil {
			log.Errorf(logPrefix+"Could not commit: %s", err)
		}
	})
	if err != nil {
		log.Fatalf("Could not register activity cleanup cron: %s", err)
	}
}

// activityCapturedEvents lists every event the activity feed records, paired
// with the listener registration. It is the single source of truth for both
// RegisterListeners and tests.
func activityCapturedEventNames() []string {
	return []string{
		(&TaskCreatedEvent{}).Name(),
		(&TaskUpdatedEvent{}).Name(),
		(&TaskDeletedEvent{}).Name(),
		(&TaskDoneChangedEvent{}).Name(),
		(&TaskAssigneeCreatedEvent{}).Name(),
		(&TaskAssigneeDeletedEvent{}).Name(),
		(&TaskCommentCreatedEvent{}).Name(),
		(&TaskAttachmentCreatedEvent{}).Name(),
		(&TaskRelationCreatedEvent{}).Name(),
		(&ProjectUpdatedEvent{}).Name(),
	}
}
