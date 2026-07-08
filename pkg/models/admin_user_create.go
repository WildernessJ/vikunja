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
	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/events"
	"code.vikunja.io/api/pkg/log"
	"code.vikunja.io/api/pkg/user"

	"xorm.io/xorm"
)

// reloadUserAfterCreate is the post-commit reload, wired as a variable so tests can
// force a reload failure and assert the account and its events survive it.
var reloadUserAfterCreate = user.GetUserByID

// CreateUserBody wraps user.APIUserPassword with admin-only fields.
type CreateUserBody struct {
	// The full name of the new user. Optional.
	Name string `json:"name" doc:"The full name of the new user. Optional."`
	// The language of the new user. Must be a valid IETF BCP 47 language code and exist in Vikunja.
	Language string `json:"language" valid:"language" doc:"IETF BCP 47 language code; must exist in Vikunja."`
	user.APIUserPassword
	// Mark the new user as an instance admin.
	IsAdmin bool `json:"is_admin" doc:"Mark the new user as an instance admin."`
	// Activate the new user immediately without email confirmation.
	SkipEmailConfirm bool `json:"skip_email_confirm" doc:"Activate the new user immediately, skipping email confirmation."`
}

// CreateUserAsAdmin provisions a new local account on behalf of an instance admin,
// honouring the admin-only is_admin and skip_email_confirm fields and bypassing the
// public-registration toggle. It commits s and returns the persisted user reloaded
// so the status reflects what was actually stored.
func CreateUserAsAdmin(s *xorm.Session, doer *user.User, body *CreateUserBody) (*user.User, error) {
	newUser, err := RegisterUser(s, &user.User{
		Username: body.Username,
		Password: body.Password,
		Email:    body.Email,
		Name:     body.Name,
		Language: body.Language,
	})
	if err != nil {
		return nil, err
	}

	if body.IsAdmin {
		if _, err := s.ID(newUser.ID).Cols("is_admin").Update(&user.User{IsAdmin: true}); err != nil {
			return nil, err
		}
		newUser.IsAdmin = true
	}

	// Force Active when the admin asked to skip, or when no mailer exists to send the confirmation.
	if body.SkipEmailConfirm || !config.MailerEnabled.GetBool() {
		if err := user.SetUserStatus(s, newUser, user.StatusActive); err != nil {
			return nil, err
		}
		newUser.Status = user.StatusActive
	} else {
		// RegisterUser already persisted StatusEmailConfirmationRequired but returned
		// the pre-update in-memory copy (still StatusActive). Sync it so the fallback
		// below reports the real status if the post-commit reload fails.
		newUser.Status = user.StatusEmailConfirmationRequired
	}

	// Queued alongside the user.created event RegisterUser dispatched; both
	// fire when the caller runs DispatchPending after this commit.
	events.DispatchOnCommit(s, &AdminUserCreatedEvent{User: newUser, Doer: doer})

	if err := s.Commit(); err != nil {
		return nil, err
	}

	// The account is durably created now. Reload on a fresh session so the returned
	// status reflects what was actually persisted, but a failed reload must not report
	// failure — that would make the caller roll back (a no-op) and drop the queued
	// user.created/admin.user.created events for an account that already exists,
	// leaving it unaudited and unannounced and a retry blocked on a duplicate username.
	// Fall back to the in-memory user, whose status was synced above.
	rs := db.NewSession()
	defer rs.Close()
	reloaded, err := reloadUserAfterCreate(rs, newUser.ID)
	if err != nil {
		log.Errorf("User %d created by admin %d but post-commit reload failed; returning in-memory copy: %s", newUser.ID, doer.ID, err)
		return newUser, nil
	}
	return reloaded, nil
}
