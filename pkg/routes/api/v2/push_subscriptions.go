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

package apiv2

import (
	"context"
	"net/http"

	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/models"
	"code.vikunja.io/api/pkg/web/handler"

	"github.com/danielgtaylor/huma/v2"
)

// pushPublicKeyBody tells the client whether it can subscribe at all and, if
// so, which application server key to hand PushManager.subscribe().
type pushPublicKeyBody struct {
	Body struct {
		Enabled   bool   `json:"enabled" readOnly:"true" doc:"Whether this instance has Web Push configured. When false the client should hide the subscribe UI; public_key is then empty."`
		PublicKey string `json:"public_key" readOnly:"true" doc:"The base64url-encoded VAPID public key to pass as applicationServerKey when subscribing."`
	}
}

// RegisterPushSubscriptionRoutes wires the Web Push endpoints onto the Huma API.
func RegisterPushSubscriptionRoutes(api huma.API) {
	tags := []string{"notifications"}

	Register(api, huma.Operation{
		OperationID: "notifications-push-public-key",
		Summary:     "Get the Web Push public key",
		Description: "Returns this instance's VAPID public key together with whether Web Push is configured at all. Clients should call this before offering to subscribe, and skip the feature when enabled is false.",
		Method:      http.MethodGet,
		Path:        "/notifications/push/public-key",
		Tags:        tags,
	}, pushPublicKey)

	Register(api, huma.Operation{
		OperationID: "push-subscriptions-create",
		Summary:     "Register a device for push notifications",
		Description: "Registers a browser's push subscription for the authenticated user. Endpoints are unique across the instance: posting one that already exists refreshes its keys and transfers it to the authenticated user instead of creating a duplicate, so a device re-subscribing after a permission reset is safe to POST again.",
		Method:      http.MethodPost,
		Path:        "/push-subscriptions",
		Tags:        tags,
	}, pushSubscriptionsCreate)

	Register(api, huma.Operation{
		OperationID: "push-subscriptions-delete",
		Summary:     "Remove a device's push subscription",
		Description: "Removes a push subscription. Only its owner may remove it; other users' subscriptions are indistinguishable from ones that do not exist.",
		Method:      http.MethodDelete,
		Path:        "/push-subscriptions/{id}",
		Tags:        tags,
	}, pushSubscriptionsDelete)
}

func init() { AddRouteRegistrar(RegisterPushSubscriptionRoutes) }

// pushPublicKey is authenticated but reads no user state: the key is per
// instance, and gating it behind auth keeps the config off the public surface.
func pushPublicKey(ctx context.Context, _ *struct{}) (*pushPublicKeyBody, error) {
	if _, err := authFromCtx(ctx); err != nil {
		return nil, err
	}

	publicKey := config.WebPushPublicKey.GetString()
	enabled := config.WebPushEnabled.GetBool() && publicKey != "" && config.WebPushPrivateKey.GetString() != ""

	out := &pushPublicKeyBody{}
	out.Body.Enabled = enabled
	if enabled {
		out.Body.PublicKey = publicKey
	}
	return out, nil
}

func pushSubscriptionsCreate(ctx context.Context, in *struct {
	Body models.PushSubscription
}) (*singleBody[models.PushSubscription], error) {
	a, err := authFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	if err := handler.DoCreate(ctx, &in.Body, a); err != nil {
		return nil, translateDomainError(err)
	}
	return &singleBody[models.PushSubscription]{Body: &in.Body}, nil
}

func pushSubscriptionsDelete(ctx context.Context, in *struct {
	ID int64 `path:"id"`
}) (*emptyBody, error) {
	a, err := authFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	if err := handler.DoDelete(ctx, &models.PushSubscription{ID: in.ID}, a); err != nil {
		return nil, translateDomainError(err)
	}
	return &emptyBody{}, nil
}
