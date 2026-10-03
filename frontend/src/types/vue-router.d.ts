import 'vue-router'

declare module 'vue-router' {
	interface RouteMeta {
		/**
		 * Whether a user may be sent to this route without asking for it. Absent
		 * means yes; both other values exclude it from the task detail back button,
		 * and differ only in what the auth guard stores as the last visited route:
		 *
		 * - `'no'` - never: one-shot auth URLs re-fire their already-consumed code,
		 *   and the 404 pages are only ever reached by accident.
		 * - `'no-but-restore'` - still restored after a login that interrupted it,
		 *   because the code we would land on then is a fresh, unconsumed one. Only
		 *   the migration callback needs this - see its route.
		 *
		 * Never compare against this field directly: both halves of the rule live
		 * in `@/helpers/returnability`, and only going through it keeps the two
		 * readers from classifying a future value differently.
		 */
		returnability?: 'no' | 'no-but-restore'

		/**
		 * An auth page: it renders in the logged-out shell (`App.vue`), and the
		 * auth guard does not send an anonymous visitor from it to login.
		 *
		 * A separate question from `returnability`: every `authPage` route is
		 * `returnability: 'no'`, but not the reverse - the 404s, `oauth.authorize`
		 * and `migrate.service` still need the login gate.
		 */
		authPage?: true

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
