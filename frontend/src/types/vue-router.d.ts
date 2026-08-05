import 'vue-router'

declare module 'vue-router' {
	interface RouteMeta {
		/**
		 * Routes a user must never be sent back to or restored onto: one-shot auth
		 * URLs re-fire their already-consumed code, and the 404 pages are only ever
		 * reached by accident. Read by the task detail back button and by the auth
		 * guard when it stores the last visited route.
		 */
		nonReturnable?: boolean

		/**
		 * Overrides `nonReturnable` for the last-visited store only: the route stays
		 * unreachable by the back button but is still restored after a login that
		 * interrupted it. Only the migration callback needs this - see its route.
		 */
		restoreAfterLogin?: boolean

		/**
		 * i18n key for the page title, rendered by AppHeader and NoAuthWrapper.
		 */
		title?: string

		/**
		 * Gated on the admin panel pro feature plus an admin user; the global guard
		 * sends everyone else to the not-found page.
		 */
		requiresAdminPanel?: boolean

		/**
		 * Gated on the time tracking pro feature; the global guard sends everyone
		 * else to the not-found page.
		 */
		requiresTimeTracking?: boolean
	}
}
