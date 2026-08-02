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
	"crypto/ecdh"
	"encoding/base64"
	"strings"
	"time"

	"code.vikunja.io/api/pkg/user"
	"code.vikunja.io/api/pkg/web"

	"xorm.io/xorm"
)

// maxPushSubscriptionsPerUser caps how many devices one account may register.
// Every subscription costs the badge cron one blocking HTTP send per run, so an
// unbounded list is a way for a single account to monopolise the sender.
const maxPushSubscriptionsPerUser = 20

// pushAuthSecretLength is the length RFC 8291 fixes the auth secret at.
const pushAuthSecretLength = 16

// PushSubscription is one browser's Web Push channel, as returned by
// PushManager.subscribe(). One user can have many — one per device/browser.
type PushSubscription struct {
	ID int64 `xorm:"bigint autoincr not null unique pk" json:"id" readOnly:"true" doc:"The unique, numeric id of this subscription."`

	// Owner is derived from the authenticated user, never the request body.
	UserID int64 `xorm:"bigint not null index" json:"-"`

	Endpoint string    `xorm:"varchar(500) not null unique" json:"endpoint" valid:"required,url" minLength:"1" maxLength:"500" doc:"The push service URL from PushSubscription.endpoint. Re-subscribing with an endpoint that already exists updates that subscription instead of creating a second one."`
	P256dh   string    `xorm:"varchar(255) not null" json:"p256dh" valid:"required" minLength:"1" maxLength:"255" doc:"The base64url-encoded p256dh key from PushSubscription.getKey('p256dh'), used to encrypt the payload."`
	Auth     string    `xorm:"varchar(255) not null" json:"auth" valid:"required" minLength:"1" maxLength:"255" doc:"The base64url-encoded auth secret from PushSubscription.getKey('auth'), used to encrypt the payload."`
	Created  time.Time `xorm:"created not null" json:"created" readOnly:"true" doc:"A timestamp when this subscription was registered. You cannot change this value."`

	web.Permissions `xorm:"-" json:"-"`
	web.CRUDable    `xorm:"-" json:"-"`
}

func (*PushSubscription) TableName() string {
	return "push_subscriptions"
}

// Create registers a push subscription for the authenticated user. Endpoints
// are globally unique: a browser handed the same endpoint again (re-subscribe
// after a permission reset, or a second account on a shared device) updates
// the existing row and takes ownership of it, rather than colliding on the
// unique index.
func (p *PushSubscription) Create(s *xorm.Session, a web.Auth) (err error) {
	caller, err := user.GetFromAuth(a)
	if err != nil {
		return err
	}

	// govalidator's `url` accepts any scheme. Anything but https would put the
	// VAPID JWT on the wire in cleartext and turns the recurring sender into a
	// way to aim authenticated outbound traffic at arbitrary hosts.
	if !strings.HasPrefix(strings.ToLower(p.Endpoint), "https://") {
		return InvalidFieldErrorWithMessage(
			[]string{"endpoint: must be an https:// URL"},
			"A push endpoint must be an https:// URL.",
		)
	}

	if err := validatePushSubscriptionKeys(p.P256dh, p.Auth); err != nil {
		return err
	}

	p.ID = 0
	p.UserID = caller.ID

	existing := &PushSubscription{}
	has, err := s.Where("endpoint = ?", p.Endpoint).Get(existing)
	if err != nil {
		return err
	}

	if has {
		p.ID = existing.ID
		p.Created = existing.Created
		_, err = s.
			Where("id = ?", existing.ID).
			Cols("user_id", "p256dh", "auth").
			Update(p)
		return err
	}

	registered, err := s.Where("user_id = ?", caller.ID).Count(&PushSubscription{})
	if err != nil {
		return err
	}
	if registered >= maxPushSubscriptionsPerUser {
		return ErrTooManyPushSubscriptions{UserID: caller.ID, Max: maxPushSubscriptionsPerUser}
	}

	_, err = s.Insert(p)
	return err
}

// decodePushSubscriptionKey mirrors webpush-go's decodeSubscriptionKey: pad,
// try the standard alphabet, fall back to base64url. Anything stricter would
// reject keys the sender can encrypt against perfectly well.
func decodePushSubscriptionKey(key string) ([]byte, error) {
	if rem := len(key) % 4; rem != 0 {
		key += strings.Repeat("=", 4-rem)
	}
	if decoded, err := base64.StdEncoding.DecodeString(key); err == nil {
		return decoded, nil
	}
	return base64.URLEncoding.DecodeString(key)
}

// validatePushSubscriptionKeys rejects a device whose keys the sender could
// never encrypt against. Such a send fails before any HTTP request exists, so
// the push service never answers 404/410, the subscription is never pruned, and
// it logs an error every interval forever. Registration is the only point where
// the failure can still be reported to somebody able to fix it.
func validatePushSubscriptionKeys(p256dh, auth string) error {
	publicKey, err := decodePushSubscriptionKey(p256dh)
	if err == nil {
		_, err = ecdh.P256().NewPublicKey(publicKey)
	}
	if err != nil {
		return InvalidFieldErrorWithMessage(
			[]string{"p256dh: must be a base64url-encoded P-256 public key"},
			"The p256dh key must be a base64url-encoded P-256 public key.",
		)
	}

	authSecret, err := decodePushSubscriptionKey(auth)
	if err != nil || len(authSecret) != pushAuthSecretLength {
		return InvalidFieldErrorWithMessage(
			[]string{"auth: must be a base64url-encoded 16 byte secret"},
			"The auth secret must be a base64url-encoded 16 byte value.",
		)
	}

	return nil
}

// Delete removes a single device's subscription. Ownership is verified in
// CanDelete.
func (p *PushSubscription) Delete(s *xorm.Session, _ web.Auth) (err error) {
	_, err = s.Where("id = ?", p.ID).Delete(&PushSubscription{})
	return err
}

// getPushSubscriptionsForUser returns every subscription belonging to a user.
func getPushSubscriptionsForUser(s *xorm.Session, userID int64) (subs []*PushSubscription, err error) {
	subs = []*PushSubscription{}
	err = s.Where("user_id = ?", userID).Find(&subs)
	return
}

// getUserIDsWithPushSubscriptions returns the ids of all users with at least
// one registered subscription.
func getUserIDsWithPushSubscriptions(s *xorm.Session) (userIDs []int64, err error) {
	userIDs = []int64{}
	err = s.Table(&PushSubscription{}).Distinct("user_id").Find(&userIDs)
	return
}
