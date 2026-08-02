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
	"code.vikunja.io/api/pkg/user"
	"code.vikunja.io/api/pkg/web"

	"xorm.io/xorm"
)

// CanCreate checks if a user can register a push subscription. Ownership
// derives from a verified user principal, never a generic GetID(): link shares
// have no inbox and must not be able to register push channels.
func (p *PushSubscription) CanCreate(_ *xorm.Session, a web.Auth) (bool, error) {
	if _, err := user.GetFromAuth(a); err != nil {
		return false, err
	}
	return true, nil
}

// CanDelete checks if a user owns the subscription they're trying to remove.
func (p *PushSubscription) CanDelete(s *xorm.Session, a web.Auth) (bool, error) {
	caller, err := user.GetFromAuth(a)
	if err != nil {
		return false, err
	}

	existing := &PushSubscription{}
	has, err := s.Where("id = ?", p.ID).Get(existing)
	if err != nil || !has {
		return false, err
	}

	if existing.UserID != caller.ID {
		return false, nil
	}

	*p = *existing
	return true, nil
}
