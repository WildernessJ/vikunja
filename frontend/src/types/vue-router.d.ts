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
	}
}
