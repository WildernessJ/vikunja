import { ref } from 'vue'
import { createGlobalState, useIntervalFn } from '@vueuse/core'

import { MILLISECONDS_A_SECOND } from '@/constants/date'

const GLOBAL_NOW_INTERVAL = 60 * MILLISECONDS_A_SECOND

/**
 * A global shared state that provides the current time, updated at a regular interval.
 *
 * Sharing this state globally ensures that all components accessing this hook use the same time reference, avoiding redundant intervals and ensuring consistency across the application.
 *
 * Keep this factory context-agnostic: createGlobalState runs it once, bound to whoever
 * calls first — which is often a render-time helper (formatDateSince), not a component
 * setup. Registering component lifecycle / route hooks here tripped #75. Route-change
 * refresh is wired app-wide via router.afterEach instead (see router/index.ts).
 */
export const useGlobalNow = createGlobalState(() => {
	const now = ref(new Date())

	const update = () => now.value = new Date()

	useIntervalFn(update, GLOBAL_NOW_INTERVAL, { immediate: true })

	return {
		now,
		update,
	}
})
