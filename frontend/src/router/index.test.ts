import {describe, it, expect, beforeEach} from 'vitest'
import type {RouteLocation} from 'vue-router'

import router, {getAuthForRoute} from './index'
import {getLastVisited} from '@/helpers/saveLastVisited'
import type {useAuthStore} from '@/stores/auth'

// getAuthForRoute only ever reads these two fields off the store.
const ANONYMOUS = {authUser: null, authLinkShare: null} as unknown as ReturnType<typeof useAuthStore>

function resolve(path: string) {
	return router.resolve(path) as unknown as RouteLocation
}

describe('nonReturnable route meta', () => {
	it.each([
		'/login',
		'/register',
		'/get-password-reset',
		'/password-reset',
		'/share/abc123/auth',
		'/auth/openid/gitlab',
		'/oauth/authorize',
		'/migrate/trello',
		'/some-garbage-path',
	])('flags %s', path => {
		expect(resolve(path).meta.nonReturnable).toBe(true)
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
		expect(resolve(path).meta.nonReturnable).toBeUndefined()
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
		'/migrate/trello?code=one-shot',
		'/login',
	])('does not save %s as last visited', async path => {
		await getAuthForRoute(resolve(path), ANONYMOUS)

		expect(getLastVisited()).toBeNull()
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

	it.each([
		'/login',
		'/register',
		'/auth/openid/gitlab',
		'/share/abc123/auth',
	])('leaves an unauthenticated visitor on %s', async path => {
		expect(await getAuthForRoute(resolve(path), ANONYMOUS)).toBeUndefined()
	})

	// The OAuth destination is nonReturnable for the back button, but its whole
	// point here is to survive the login round-trip in localStorage (#2654).
	it('still saves the oauth destination carried in the login redirect hash', async () => {
		await getAuthForRoute(resolve('/login#redirect=/oauth/authorize?client_id=1'), ANONYMOUS)

		expect(getLastVisited()?.name).toBe('oauth.authorize')
	})
})
