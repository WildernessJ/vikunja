import { createRouter, createWebHistory } from 'vue-router'
import type { RouteLocation, RouterScrollBehavior } from 'vue-router'
import {saveLastVisited} from '@/helpers/saveLastVisited'

import {getProjectViewId} from '@/helpers/projectView'
import {parseDateOrString} from '@/helpers/time/parseDateOrString'
import {getNextWeekDate} from '@/helpers/time/getNextWeekDate'
import {getStartOfTomorrowInTimezone} from '@/helpers/time/startOfTomorrow'
import {LINK_SHARE_HASH_PREFIX} from '@/constants/linkShareHash'
import {REDIRECT_HASH_PREFIX} from '@/constants/redirectHash'
import {AUTH_ROUTE_NAMES} from '@/constants/authRouteNames'
import {PRO_FEATURE} from '@/constants/proFeatures'

import {useAuthStore} from '@/stores/auth'
import {useBaseStore} from '@/stores/base'
import {useConfigStore} from '@/stores/config'

import {useGlobalNow} from '@/composables/useGlobalNow'

import Login from '@/views/user/Login.vue'
import Register from '@/views/user/Register.vue'
import LinkSharingAuth from '@/views/sharing/LinkSharingAuth.vue'
import OpenIdAuth from '@/views/user/OpenIdAuth.vue'
import UpcomingTasks from '@/views/tasks/ShowTasks.vue'

import NotFoundComponent from '@/views/404.vue'

const router = createRouter({
	history: createWebHistory(import.meta.env.BASE_URL),
	scrollBehavior(to, from, savedPosition) {
		// If the user is using their forward/backward keys to navigate, we want to restore the scroll view
		if (savedPosition) {
			return savedPosition
		}

		// Scroll to anchor should still work
		if (to.hash && !to.hash.startsWith(LINK_SHARE_HASH_PREFIX) && !to.hash.startsWith(REDIRECT_HASH_PREFIX)) {
			return {el: to.hash}
		}

		// Otherwise just scroll to the top
		return {
			'inset-inline-start': 0,
			'inset-block-start': 0,
		} as unknown as ReturnType<RouterScrollBehavior>
	},
	routes: [
		{
			path: '/',
			name: 'home',
			component: () => import('@/views/Home.vue'),
		},
		{
			path: '/:pathMatch(.*)*',
			name: 'not-found',
			component: NotFoundComponent,
			meta: {
				nonReturnable: true,
			},
		},
		// if you omit the last `*`, the `/` character in params will be encoded when resolving or pushing
		{
			path: '/:pathMatch(.*)',
			name: 'bad-not-found',
			component: NotFoundComponent,
			meta: {
				nonReturnable: true,
			},
		},
		{
			path: '/login',
			name: 'user.login',
			component: Login,
			meta: {
				title: 'user.auth.login',
				nonReturnable: true,
			},
		},
		{
			path: '/get-password-reset',
			name: 'user.password-reset.request',
			component: () => import('@/views/user/RequestPasswordReset.vue'),
			meta: {
				title: 'user.auth.resetPassword',
				nonReturnable: true,
			},
		},
		{
			path: '/password-reset',
			name: 'user.password-reset.reset',
			component: () => import('@/views/user/PasswordReset.vue'),
			meta: {
				title: 'user.auth.resetPassword',
				nonReturnable: true,
			},
		},
		{
			path: '/register',
			name: 'user.register',
			// FIXME: use dynamic imports
			// component: () => import('@/views/user/Register.vue'),
			component: Register,
			meta: {
				title: 'user.auth.createAccount',
				nonReturnable: true,
			},
		},
		{
			path: '/user/settings',
			name: 'user.settings',
			component: () => import('@/views/user/Settings.vue'),
			redirect: {name: 'user.settings.general'},
			children: [
				{
					path: '/user/settings/avatar',
					name: 'user.settings.avatar',
					component: () => import('@/views/user/settings/Avatar.vue'),
				},
				{
					path: '/user/settings/caldav',
					name: 'user.settings.caldav',
					component: () => import('@/views/user/settings/Caldav.vue'),
					beforeEnter: async () => {
						const {useConfigStore} = await import('@/stores/config')
						if (!useConfigStore().caldavEnabled) {
							return {name: 'user.settings.general'}
						}
					},
				},
				{
					path: '/user/settings/data-export',
					name: 'user.settings.data-export',
					component: () => import('@/views/user/settings/DataExport.vue'),
				},
				{
					path: '/user/settings/feeds',
					name: 'user.settings.feeds',
					component: () => import('@/views/user/settings/AtomFeed.vue'),
				},
				{
					path: '/user/settings/deletion',
					name: 'user.settings.deletion',
					component: () => import('@/views/user/settings/Deletion.vue'),
				},
				{
					path: '/user/settings/email-update',
					name: 'user.settings.email-update',
					component: () => import('@/views/user/settings/EmailUpdate.vue'),
				},
				{
					path: '/user/settings/general',
					name: 'user.settings.general',
					component: () => import('@/views/user/settings/General.vue'),
				},
				{
					path: '/user/settings/password-update',
					name: 'user.settings.password-update',
					component: () => import('@/views/user/settings/PasswordUpdate.vue'),
				},
				{
					path: '/user/settings/totp',
					name: 'user.settings.totp',
					component: () => import('@/views/user/settings/TOTP.vue'),
					beforeEnter: async () => {
						const {useConfigStore} = await import('@/stores/config')
						if (!useConfigStore().totpEnabled || !useAuthStore().info?.isLocalUser) {
							return {name: 'user.settings.general'}
						}
					},
				},
				{
					path: '/user/settings/api-tokens',
					name: 'user.settings.apiTokens',
					component: () => import('@/views/user/settings/ApiTokens.vue'),
				},
				{
					path: '/user/settings/sessions',
					name: 'user.settings.sessions',
					component: () => import('@/views/user/settings/Sessions.vue'),
				},
				{
					path: '/user/settings/webhooks',
					name: 'user.settings.webhooks',
					component: () => import('@/views/user/settings/Webhooks.vue'),
				},
				{
					path: '/user/settings/bots',
					name: 'user.settings.bots',
					component: () => import('@/views/user/settings/BotUsers.vue'),
				},
				{
					path: '/user/settings/migrate',
					name: 'migrate.start',
					component: () => import('@/views/migrate/Migration.vue'),
				},
				{
					path: '/migrate/csv',
					name: 'migrate.csv',
					component: () => import('@/views/migrate/MigrationCSV.vue'),
				},
				{
					path: '/migrate/:service',
					name: 'migrate.service',
					component: () => import('@/views/migrate/MigrationHandler.vue'),
					// Consumes the migration provider's one-shot OAuth code: navigating back here
					// re-fires a code that is already spent. Restoring it after login is the opposite
					// case - the session expired mid provider round-trip, so the code we'd land on is
					// the fresh one the provider just handed us and nothing has consumed it yet.
					meta: {
						nonReturnable: true,
						restoreAfterLogin: true,
					},
					props: route => ({
						service: route.params.service as string,
						code: route.query.code as string,
					}),
				},
			],
		},
		{
			path: '/user/stats',
			name: 'user.stats',
			component: () => import('@/views/user/UserStatistics.vue'),
		},
		{
			path: '/user/export/download',
			name: 'user.export.download',
			component: () => import('@/views/user/DataExportDownload.vue'),
		},
		{
			path: '/share/:share/auth',
			name: 'link-share.auth',
			// FIXME: use dynamic imports
			// component: () => import('@/views/sharing/LinkSharingAuth.vue'),
			component: LinkSharingAuth,
			meta: {
				nonReturnable: true,
			},
		},
		{
			path: '/tasks/:id',
			name: 'task.detail',
			component: () => import('@/views/tasks/TaskDetailView.vue'),
			props: route => ({ taskId: Number(route.params.id as string) }),
		},
		{
			path: '/tasks/by/upcoming',
			name: 'tasks.range',
			component: UpcomingTasks,
			props: route => ({
				dateFrom: parseDateOrString(route.query.from as string, new Date()),
				dateTo: parseDateOrString(route.query.to as string, getNextWeekDate()),
				showNulls: route.query.showNulls === 'true',
				showOverdue: route.query.showOverdue === 'true',
			}),
		},
		{
			path: '/tasks/today',
			name: 'tasks.today',
			component: UpcomingTasks,
			// dateFrom is an inert placeholder: ShowTasks lists *all* undone tasks
			// unless both bounds are set, and with showOverdue the lower bound is
			// ignored. dateTo is start-of-tomorrow in the account timezone so the
			// `due_date < dateTo` filter matches the backend's overdue+today cutoff.
			props: () => ({
				dateFrom: new Date(),
				dateTo: getStartOfTomorrowInTimezone(useAuthStore().settings.timezone),
				showNulls: false,
				showOverdue: true,
			}),
		},
		{
			// Redirect old list routes to the respective project routes
			// see: https://router.vuejs.org/guide/essentials/dynamic-matching.html#catch-all-404-not-found-route
			path: '/lists:pathMatch(.*)*',
			name: 'lists',
			redirect(to) {
				return {
					path: to.path.replace('/lists', '/projects'),
					query: to.query,
					hash: to.hash,
				}
			},
		},
		{
			path: '/projects',
			name: 'projects.index',
			component: () => import('@/views/project/ListProjects.vue'),
		},
		{
			path: '/projects/new',
			name: 'project.create',
			component: () => import('@/views/project/NewProject.vue'),
			meta: {
				showAsModal: true,
			},
		},
		{
			path: '/projects/:parentProjectId/new',
			name: 'project.createFromParent',
			component: () => import('@/views/project/NewProject.vue'),
			props: route => ({ parentProjectId: Number(route.params.parentProjectId as string) }),
			meta: {
				showAsModal: true,
			},
		},
		{
			path: '/projects/:projectId/settings/edit',
			name: 'project.settings.edit',
			component: () => import('@/views/project/settings/ProjectSettingsEdit.vue'),
			props: route => ({ projectId: Number(route.params.projectId as string) }),
			meta: {
				showAsModal: true,
			},
		},
		{
			path: '/projects/:projectId/settings/background',
			name: 'project.settings.background',
			component: () => import('@/views/project/settings/ProjectSettingsBackground.vue'),
			meta: {
				showAsModal: true,
			},
		},
		{
			path: '/projects/:projectId/settings/duplicate',
			name: 'project.settings.duplicate',
			component: () => import('@/views/project/settings/ProjectSettingsDuplicate.vue'),
			meta: {
				showAsModal: true,
			},
		},
		{
			path: '/projects/:projectId/settings/save-template',
			name: 'project.settings.saveTemplate',
			component: () => import('@/views/project/settings/ProjectSettingsSaveTemplate.vue'),
			meta: {
				showAsModal: true,
			},
		},
		{
			path: '/projects/:projectId/settings/share',
			name: 'project.settings.share',
			component: () => import('@/views/project/settings/ProjectSettingsShare.vue'),
			meta: {
				showAsModal: true,
			},
		},
		{
			path: '/projects/:projectId/settings/webhooks',
			name: 'project.settings.webhooks',
			component: () => import('@/views/project/settings/ProjectSettingsWebhooks.vue'),
			meta: {
				showAsModal: true,
			},
		},
		{
			path: '/projects/:projectId/settings/delete',
			name: 'project.settings.delete',
			component: () => import('@/views/project/settings/ProjectSettingsDelete.vue'),
			meta: {
				showAsModal: true,
			},
		},
		{
			path: '/projects/:projectId/settings/archive',
			name: 'project.settings.archive',
			component: () => import('@/views/project/settings/ProjectSettingsArchive.vue'),
			meta: {
				showAsModal: true,
			},
		},
		{
			path: '/projects/:projectId/settings/views',
			name: 'project.settings.views',
			component: () =>  import('@/views/project/settings/ProjectSettingsViews.vue'),
			meta: {
				showAsModal: true,
			},
			props: route => ({ projectId: Number(route.params.projectId as string) }),
		},
		{
			path: '/projects/:projectId/settings/edit',
			name: 'filter.settings.edit',
			component: () => import('@/views/filters/FilterEdit.vue'),
			meta: {
				showAsModal: true,
			},
			props: route => ({ projectId: Number(route.params.projectId as string) }),
		},
		{
			path: '/projects/:projectId/settings/delete',
			name: 'filter.settings.delete',
			component: () => import('@/views/filters/FilterDelete.vue'),
			meta: {
				showAsModal: true,
			},
			props: route => ({ projectId: Number(route.params.projectId as string) }),
		},
		{
			path: '/projects/:projectId/info',
			name: 'project.info',
			component: () => import('@/views/project/ProjectInfo.vue')			,
			meta: {
				showAsModal: true,
			},
			props: route => ({ projectId: Number(route.params.projectId as string) }),
		},
		{
			path: '/projects/:projectId',
			name: 'project.index',
			redirect(to) {
				const viewId = getProjectViewId(Number(to.params.projectId as string))

				if (viewId) {
					console.debug('Replaced list view with', viewId)
				}

				return {
					name: 'project.view',
					params: {
						projectId: parseInt(to.params.projectId as string),
						viewId: viewId ?? 0,
					},
				}
			},
		},
		{
			path: '/projects/:projectId/activity',
			name: 'project.activity',
			component: () => import('@/components/project/ProjectActivity.vue'),
			props: route => ({projectId: parseInt(route.params.projectId as string)}),
		},
		{
			path: '/projects/:projectId/:viewId',
			name: 'project.view',
			component: () => import('@/views/project/ProjectView.vue'),
			props: route => ({ 
				projectId: parseInt(route.params.projectId as string),
				viewId: route.params.viewId ? parseInt(route.params.viewId as string): undefined,
			}),
		},
		{
			path: '/teams',
			name: 'teams.index',
			component: () => import('@/views/teams/ListTeams.vue'),
		},
		{
			path: '/teams/new',
			name: 'teams.create',
			component: () =>  import('@/views/teams/NewTeam.vue'),
			meta: {
				showAsModal: true,
			},
		},
		{
			path: '/teams/:id/edit',
			name: 'teams.edit',
			component: () => import('@/views/teams/EditTeam.vue'),
		},
		{
			path: '/labels',
			name: 'labels.index',
			component: () => import('@/views/labels/ListLabels.vue'),
		},
		{
			path: '/templates',
			name: 'templates.index',
			component: () => import('@/views/templates/TemplateLibrary.vue'),
		},
		{
			path: '/labels/new',
			name: 'labels.create',
			component: () => import('@/views/labels/NewLabel.vue'),
			meta: {
				showAsModal: true,
			},
		},
		{
			path: '/filters/new',
			name: 'filters.create',
			component: () => import('@/views/filters/FilterNew.vue'),
			meta: {
				showAsModal: true,
			},
		},
		{
			path: '/auth/openid/:provider',
			name: 'openid.auth',
			component: OpenIdAuth,
			meta: {
				nonReturnable: true,
			},
		},
		{
			path: '/oauth/authorize',
			name: 'oauth.authorize',
			component: () => import('@/views/user/OAuthAuthorize.vue'),
			meta: {
				nonReturnable: true,
			},
		},
		{
			path: '/about',
			name: 'about',
			component: () => import('@/views/About.vue'),
		},
		{
			path: '/time-tracking',
			name: 'time-tracking',
			component: () => import('@/views/time-tracking/TimeTracking.vue'),
			meta: {
				requiresTimeTracking: true,
				title: 'timeTracking.title',
			},
		},
		{
			path: '/admin',
			component: () => import('@/views/admin/AdminShell.vue'),
			meta: {
				requiresAdminPanel: true,
				adminMode: true,
			},
			children: [
				{
					path: '',
					name: 'admin.overview',
					component: () => import('@/views/admin/OverviewView.vue'),
				},
				{
					path: 'users',
					name: 'admin.users',
					component: () => import('@/views/admin/UsersView.vue'),
				},
				{
					path: 'projects',
					name: 'admin.projects',
					component: () => import('@/views/admin/ProjectsView.vue'),
				},
			],
		},
	],
})

// The redirect hash sits in a URL anyone can author and mail to a victim, so resolving it is not
// enough - an unrestricted destination gets stored for after login and, for an already-signed-in
// browser, navigated to with zero interaction. The only value ever legitimately written here is the
// oauth.authorize fullPath (see the branch below), so that is the only one accepted back out.
function resolveRedirectHash(hash: string) {
	if (!hash.startsWith(REDIRECT_HASH_PREFIX)) {
		return null
	}

	// vue-router already decoded the hash once, so slicing off the prefix yields the original
	// fullPath (e.g. /oauth/authorize?...) losslessly — no extra decodeURIComponent needed.
	const destination = hash.slice(REDIRECT_HASH_PREFIX.length)
	const resolved = router.resolve(destination)

	return resolved.name === 'oauth.authorize'
		? {destination, resolved}
		: null
}

// `restoreAfterLogin` overrides `nonReturnable`, which is otherwise the same question asked twice:
// the migration callback must never be re-entered by the back button yet has to survive a session
// that expires mid provider round-trip.
function shouldSaveAsLastVisited(to: Pick<RouteLocation, 'meta'>) {
	return !to.meta?.nonReturnable || to.meta?.restoreAfterLogin === true
}

export async function getAuthForRoute(to: RouteLocation, authStore: ReturnType<typeof useAuthStore>) {
	const redirect = resolveRedirectHash(to.hash)

	if (authStore.authUser || authStore.authLinkShare) {
		// An already-signed-in browser that opens a copied /login#redirect=<oauth.authorize> URL
		// must run the OAuth flow with its existing session instead of short-circuiting to home.
		// The destination has no redirect hash, so the second guard pass just early-returns (#2654).
		if (to.name === 'user.login' && redirect) {
			return redirect.destination
		}
		return
	}

	// Check if password reset token is in query params
	const resetToken = to.query.userPasswordReset as string | undefined
	
	// Redirect to password reset page if we have a token stored
	if (resetToken && to.name !== 'user.password-reset.reset') {
		return {name: 'user.password-reset.reset', query: { userPasswordReset: resetToken }}
	}

	if (typeof resetToken === 'undefined' && to.name === 'user.password-reset.reset') {
		return {name: 'user.login'}
	}

	// Check if email confirmation token is in query params
	const emailConfirmToken = to.query.userEmailConfirm as string | undefined
	if (emailConfirmToken) {
		// Save token to localStorage before redirecting
		localStorage.setItem('emailConfirmToken', emailConfirmToken)
		// Redirect to login page where it will be processed
		if (to.name !== 'user.login') {
			return {name: 'user.login'}
		}
	}

	// Keep the destination in the address bar (not just per-browser localStorage) so a native
	// client's /oauth/authorize URL stays copyable into another browser. Hash, not query, so the
	// embedded OAuth params never reach access logs (#2654). Pass fullPath raw: vue-router encodes
	// the hash itself, so an extra encodeURIComponent here would be double-encoded in the URL.
	if (to.name === 'oauth.authorize') {
		return {
			name: 'user.login',
			hash: REDIRECT_HASH_PREFIX + to.fullPath,
		}
	}

	// Fold the hash destination into localStorage: it's the only bridge that survives the
	// external OIDC round-trip out of the SPA, so redirectIfSaved() works after any auth method.
	// Deliberately not gated on `nonReturnable`: resuming oauth.authorize is the entire point
	// of the hash, and resolveRedirectHash() already rejects every other destination.
	if (redirect) {
		saveLastVisited(redirect.resolved.name as string, redirect.resolved.params, redirect.resolved.query)
	}

	// Read here, not earlier: the email confirmation branch above may have just written it.
	const hasEmailConfirmToken = localStorage.getItem('emailConfirmToken') !== null

	// Only worth restoring after login if the user can meaningfully land there again.
	if (shouldSaveAsLastVisited(to) && !hasEmailConfirmToken) {
		saveLastVisited(to.name as string, to.params, to.query)
	}

	// Which routes bounce an unauthenticated visitor to login is deliberately *not*
	// tied to nonReturnable: a 404 or a migration callback still needs the login gate.
	if (!AUTH_ROUTE_NAMES.has(to.name as string) && !hasEmailConfirmToken) {
		return {name: 'user.login'}
	}
	
	if(hasEmailConfirmToken && to.name !== 'user.login') {
		return {name: 'user.login', query: to.query}
	}
}

router.beforeEach(async (to, from) => {
	const authStore = useAuthStore()

	await authStore.checkAuth()

	if (to.meta?.requiresAdminPanel) {
		// Await config/auth hydration so the license check doesn't race the empty default
		// on direct /admin navigation. appReady resolves without waiting on router.isReady(),
		// so awaiting it here doesn't deadlock the initial navigation.
		const baseStore = useBaseStore()
		await baseStore.appReady
		const configStore = useConfigStore()
		const featureOn = configStore.isProFeatureEnabled(PRO_FEATURE.ADMIN_PANEL)
		// isAdmin comes from /user, not the JWT; force-fetch in case checkAuth() was debounced.
		if (authStore.info?.isAdmin === undefined) {
			await authStore.refreshUserInfo()
		}
		const isAdmin = authStore.info?.isAdmin === true
		if (!featureOn || !isAdmin) {
			return {name: 'not-found'}
		}
	}

	if (to.meta?.requiresTimeTracking) {
		const baseStore = useBaseStore()
		await baseStore.appReady
		const configStore = useConfigStore()
		if (!configStore.isProFeatureEnabled(PRO_FEATURE.TIME_TRACKING)) {
			return {name: 'not-found'}
		}
	}

	if(from.hash && from.hash.startsWith(LINK_SHARE_HASH_PREFIX)) {
		to.hash = from.hash
	}

	if (to.hash.startsWith(LINK_SHARE_HASH_PREFIX) && !authStore.authLinkShare) {
		if (shouldSaveAsLastVisited(to)) {
			saveLastVisited(to.name as string, to.params, to.query)
		}
		return {
			name: 'link-share.auth',
			params: {
				share: to.hash.replace(LINK_SHARE_HASH_PREFIX, ''),
			},
		}
	}

	const newRoute = await getAuthForRoute(to, authStore)
	if(newRoute) {
		// A string target (the decoded redirect destination for an authed browser) already
		// carries its own query/path and no redirect hash, so navigate to it verbatim — don't
		// re-attach to.hash or it would re-enter the redirect loop.
		if (typeof newRoute === 'string') {
			return newRoute
		}
		return {
			hash: to.hash,
			...newRoute,
		}
	}

	// to.fullPath keeps the redirect hash url-encoded while to.hash is decoded, so the endsWith
	// check below never matches and would re-append the hash forever. The hash is already on the
	// URL here, so skip the re-attach (#2654).
	if (to.hash.startsWith(REDIRECT_HASH_PREFIX)) {
		return
	}

	if(!to.fullPath.endsWith(to.hash)) {
		return to.fullPath + to.hash
	}
})

// Refresh the shared "now" on every navigation so relative dates ("2 days ago") aren't
// stale between the 60s interval ticks. App-lifetime, so it can't be torn down by a
// component unmount the way the old in-composable route guard was (#75).
router.afterEach(() => useGlobalNow().update())

export default router
