import {AuthenticatedHTTPFactory, apiV2Url} from '@/helpers/fetcher'

export interface IPushPublicKey {
	enabled: boolean
	publicKey: string
}

export interface IPushSubscriptionPayload {
	endpoint: string
	p256dh: string
	auth: string
}

// The push endpoints only exist on /api/v2, hence the absolute URLs.

export async function getPushPublicKey(): Promise<IPushPublicKey> {
	const http = AuthenticatedHTTPFactory()
	const {data} = await http.get<{enabled: boolean, public_key: string}>(apiV2Url('notifications/push/public-key'))

	return {
		enabled: data?.enabled ?? false,
		publicKey: data?.public_key ?? '',
	}
}

// Posting an endpoint the server already knows updates it in place and returns
// the existing id, so this doubles as "resolve the id of this device".
export async function createPushSubscription(payload: IPushSubscriptionPayload): Promise<number> {
	const http = AuthenticatedHTTPFactory()
	const {data} = await http.post<{id: number}>(apiV2Url('push-subscriptions'), payload)

	return data.id
}

export async function deletePushSubscription(id: number): Promise<void> {
	const http = AuthenticatedHTTPFactory()
	await http.delete(apiV2Url(`push-subscriptions/${id}`))
}
