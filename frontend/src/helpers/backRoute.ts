import type {Router} from 'vue-router'

// Every caller resolves history state when it acts, never ahead of time: the state is not
// reactive and this instance is reused across task -> task navigation, so anything cached
// (a computed, a render-time branch) keeps answering for the task we were on before.
export function resolveBackRoute(router: Router): ReturnType<Router['resolve']> | null {
	const backPath = router.options.history.state?.back

	return typeof backPath === 'string' && backPath !== ''
		? router.resolve(backPath)
		: null
}
