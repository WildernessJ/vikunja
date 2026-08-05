import {describe, it, expect, beforeEach} from 'vitest'
import type {RouteLocation} from 'vue-router'

import router, {getAuthForRoute} from './index'
import {getLastVisited} from '@/helpers/saveLastVisited'
import {AUTH_ROUTE_NAMES} from '@/constants/authRouteNames'
import type {useAuthStore} from '@/stores/auth'

// getAuthForRoute only ever reads these two fields off the store.
const ANONYMOUS = {authUser: null, authLinkShare: null} as unknown as ReturnType<typeof useAuthStore>
const AUTHENTICATED = {authUser: {id: 1}, authLinkShare: null} as unknown as ReturnType<typeof useAuthStore>

function resolve(path: string) {
	return router.resolve(path) as unknown as RouteLocation
}

describe('returnability route meta', () => {
	it.each([
		'/login',
		'/register',
		'/get-password-reset',
		'/password-reset',
		'/share/abc123/auth',
		'/auth/openid/gitlab',
		'/oauth/authorize',
		'/some-garbage-path',
	])('flags %s', path => {
		expect(resolve(path).meta.returnability).toBe('no')
	})

	// The one route excluded from the back button yet still restored after login.
	it('flags /migrate/trello as restorable', () => {
		expect(resolve('/migrate/trello').meta.returnability).toBe('no-but-restore')
	})

	it.each([
		'/',
		'/projects/1/10',
		'/tasks/1',
		'/tasks/today',
		'/user/settings/general',
		'/user/settings/migrate',
		'/migrate/csv',
	])('does not flag %s', path => {
		expect(resolve(path).meta.returnability).toBeUndefined()
	})

	// A route can drop out of AUTH_ROUTE_NAMES' twin set only by hand, and the failure is
	// silent: redirectIfSaved() would restore an authenticated user onto an auth page,
	// rendered in the wrong shell.
	it('flags every auth route', () => {
		const authRoutes = router.getRoutes().filter(route => AUTH_ROUTE_NAMES.has(route.name as string))

		expect(authRoutes).toHaveLength(AUTH_ROUTE_NAMES.size)
		authRoutes.forEach(route => {
			expect(route.meta.returnability, `${String(route.name)} is missing meta.returnability`).toBe('no')
		})
	})
})

// Both of these sit under `/projects/:projectId/...` and would be swallowed by the
// `/projects/:projectId/:viewId` catch-all if route order ever changed - the task detail
// breadcrumb reads `parentProjectId` off the first one to know which project it belongs to.
describe('route ranking below /projects/:projectId', () => {
	it('resolves the project create form ahead of the view route', () => {
		expect(resolve('/projects/5/new').name).toBe('project.createFromParent')
	})

	it('resolves the share settings ahead of the view route', () => {
		expect(resolve('/projects/5/settings/share').name).toBe('project.settings.share')
	})
})

describe('getAuthForRoute', () => {
	beforeEach(() => localStorage.clear())

	it('saves an ordinary destination as last visited', async () => {
		await getAuthForRoute(resolve('/projects/1/10'), ANONYMOUS)

		expect(getLastVisited()?.name).toBe('project.view')
	})

	it.each([
		'/some-garbage-path',
		'/login',
	])('does not save %s as last visited', async path => {
		await getAuthForRoute(resolve(path), ANONYMOUS)

		expect(getLastVisited()).toBeNull()
	})

	// `returnability` keeps the back button off the migration callback, whose code is spent by
	// then - but a session expiring mid provider round-trip must still resume it, because the
	// code we bounced away from was never consumed.
	it('saves the migration callback so an expired session resumes it after login', async () => {
		await getAuthForRoute(resolve('/migrate/trello?code=one-shot'), ANONYMOUS)

		expect(getLastVisited()).toEqual(expect.objectContaining({
			name: 'migrate.service',
			params: {service: 'trello'},
			query: {code: 'one-shot'},
		}))
	})

	// The flag governs what we save, never who gets bounced to login - a route
	// dropping out of the last-visited set must not change its auth behaviour.
	it.each([
		'/projects/1/10',
		'/some-garbage-path',
		'/migrate/trello?code=one-shot',
	])('still sends an unauthenticated visitor from %s to login', async path => {
		expect(await getAuthForRoute(resolve(path), ANONYMOUS)).toEqual({name: 'user.login'})
	})

	// The save gate (`returnability`) and the login gate (`AUTH_ROUTE_NAMES`) are deliberately two
	// questions about the same route, and the 404 is where they disagree: never worth restoring
	// after a login, yet an anonymous visitor who lands on one still has to be bounced. Merging
	// the two predicates back into one breaks exactly one of the assertions below.
	it('bounces an unauthenticated visitor from a route it refuses to save', async () => {
		const to = resolve('/some-garbage-path')
		expect(AUTH_ROUTE_NAMES.has(to.name as string)).toBe(false)

		expect(await getAuthForRoute(to, ANONYMOUS)).toEqual({name: 'user.login'})
		expect(getLastVisited()).toBeNull()
	})

	it.each([
		'/login',
		'/register',
		'/auth/openid/gitlab',
		'/share/abc123/auth',
	])('leaves an unauthenticated visitor on %s', async path => {
		expect(await getAuthForRoute(resolve(path), ANONYMOUS)).toBeUndefined()
	})

	// The OAuth destination is off limits to the back button, but its whole
	// point here is to survive the login round-trip in localStorage (#2654).
	it('still saves the oauth destination carried in the login redirect hash', async () => {
		await getAuthForRoute(resolve('/login#redirect=/oauth/authorize?client_id=1'), ANONYMOUS)

		expect(getLastVisited()?.name).toBe('oauth.authorize')
	})

	// Anyone can mail a victim a /login#redirect=<anything> URL, so the destination is only
	// trusted where we ourselves write it: the oauth.authorize fullPath.
	it.each([
		'/login#redirect=/migrate/trello?code=attacker',
		'/login#redirect=/projects/1/10',
	])('does not save an attacker-authored redirect hash (%s)', async path => {
		await getAuthForRoute(resolve(path), ANONYMOUS)

		expect(getLastVisited()).toBeNull()
	})

	// A location object, not the raw destination string: only the fields checked here survive into
	// the navigation. The empty hash is load-bearing - beforeEach re-attaches `to.hash` to whatever
	// this returns unless the target names its own, which would carry the redirect hash right back.
	it('navigates an authenticated visitor to the oauth destination in the redirect hash', async () => {
		const target = await getAuthForRoute(resolve('/login#redirect=/oauth/authorize?client_id=1'), AUTHENTICATED)

		expect(target).toEqual({name: 'oauth.authorize', query: {client_id: '1'}, hash: ''})
	})

	// `%23` in the redirect hash decodes to a literal `#`, so the destination can smuggle a second
	// hash past the name check - a link share token there hijacks the victim's session on arrival.
	it.each([
		['anonymous', ANONYMOUS],
		['authenticated', AUTHENTICATED],
	] as const)('rejects a redirect hash whose destination carries a nested hash (%s)', async (_who, authStore) => {
		const target = await getAuthForRoute(resolve('/login#redirect=/oauth/authorize%23share-auth-token=EVIL'), authStore)

		expect(getLastVisited()).toBeNull()
		expect(target).toBeUndefined()
	})

	// The redirect hash is only ever written onto /login, so honouring it anywhere else lets any
	// URL - a 404 included - seed the post-login destination with attacker-authored query params.
	it('does not save a redirect hash carried by a route other than login', async () => {
		await getAuthForRoute(resolve('/some-garbage-path#redirect=/oauth/authorize?client_id=attacker'), ANONYMOUS)

		expect(getLastVisited()).toBeNull()
	})

	// Without the restriction this is a zero-interaction redirect: an already-signed-in browser
	// navigates the raw destination verbatim.
	it('does not navigate an authenticated visitor to an attacker-authored redirect hash', async () => {
		const target = await getAuthForRoute(resolve('/login#redirect=/migrate/trello?code=attacker'), AUTHENTICATED)

		expect(target).toBeUndefined()
	})
})
