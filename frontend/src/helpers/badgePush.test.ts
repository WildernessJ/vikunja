import {beforeEach, describe, expect, it, vi} from 'vitest'

import {handleBadgePush} from './badgePush'

const BASE_URL = 'https://vikunja.example.com/'

const showNotification = vi.fn()
const setAppBadge = vi.fn()
const clearAppBadge = vi.fn()

const registration = {showNotification}
const nav = {setAppBadge, clearAppBadge}

function pushEvent(json: () => unknown) {
	return {data: {json}}
}

describe('handleBadgePush', () => {
	beforeEach(() => {
		showNotification.mockReset().mockResolvedValue(undefined)
		setAppBadge.mockReset().mockResolvedValue(undefined)
		clearAppBadge.mockReset().mockResolvedValue(undefined)
	})

	it('shows the pushed notification and sets the badge', async () => {
		await handleBadgePush(
			pushEvent(() => ({title: 'Vikunja', body: '3 tasks are due', badgeCount: 3, type: 'badge-count'})),
			registration,
			nav,
			BASE_URL,
		)

		expect(showNotification).toHaveBeenCalledWith('Vikunja', expect.objectContaining({
			body: '3 tasks are due',
			tag: 'vikunja-badge',
			data: {type: 'badge-count'},
		}))
		expect(setAppBadge).toHaveBeenCalledWith(3)
		expect(clearAppBadge).not.toHaveBeenCalled()
	})

	it('clears the badge at zero', async () => {
		await handleBadgePush(pushEvent(() => ({badgeCount: 0})), registration, nav, BASE_URL)

		expect(clearAppBadge).toHaveBeenCalled()
		expect(setAppBadge).not.toHaveBeenCalled()
	})

	// ADR-0010's load-bearing invariant: iOS revokes the push subscription of an
	// app that receives a push and shows nothing. A payload that never arrived,
	// or arrived as something the worker cannot read, is still an accepted push —
	// so it must still surface a notification rather than return early.
	describe('always shows a notification', () => {
		const cases: Record<string, {data?: {json: () => unknown} | null}> = {
			'no payload at all': {},
			'a null payload': {data: null},
			'an unparseable payload': pushEvent(() => {
				throw new SyntaxError('Unexpected token')
			}),
			'a payload that is not an object': pushEvent(() => 'garbage'),
			'a null json payload': pushEvent(() => null),
			'an empty object': pushEvent(() => ({})),
		}

		for (const [name, event] of Object.entries(cases)) {
			it(name, async () => {
				await handleBadgePush(event, registration, nav, BASE_URL)

				expect(showNotification).toHaveBeenCalledWith('Vikunja', expect.objectContaining({body: ''}))
			})
		}
	})

	// Nothing to say about the badge means the number already on the icon is
	// still the best one available; clearing it would wipe a correct count.
	it('leaves the badge alone when the payload carries no count', async () => {
		await handleBadgePush(pushEvent(() => ({title: 'Vikunja'})), registration, nav, BASE_URL)

		expect(setAppBadge).not.toHaveBeenCalled()
		expect(clearAppBadge).not.toHaveBeenCalled()
	})

	// The Badging API is missing on most desktop browsers, and rejects on iOS
	// depending on install state — neither may cost the user the notification.
	it('still resolves when the badge cannot be set', async () => {
		setAppBadge.mockRejectedValue(new Error('not allowed'))

		await expect(handleBadgePush(pushEvent(() => ({badgeCount: 2})), registration, nav, BASE_URL))
			.resolves.not.toThrow()
		expect(showNotification).toHaveBeenCalled()
	})

	it('does not need the Badging API to be present', async () => {
		await expect(handleBadgePush(pushEvent(() => ({badgeCount: 2})), registration, {}, BASE_URL))
			.resolves.not.toThrow()
		expect(showNotification).toHaveBeenCalled()
	})
})
