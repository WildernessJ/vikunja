import {computed} from 'vue'
import {queryOptions, useQuery} from '@tanstack/vue-query'
import {createSharedComposable} from '@vueuse/core'

import {queryClient} from '@/client/queryClient'
import {getProjectCounts} from '@/services/projectCounts'
import {useAuthStore} from '@/stores/auth'

export const projectCountsKey = ['projectCounts'] as const

export function projectCountsQuery() {
	return queryOptions({
		queryKey: projectCountsKey,
		queryFn: getProjectCounts,
	})
}

// One observer shared by the sidebar badges and the app badge, so they can never disagree.
export const useProjectCounts = createSharedComposable(() => {
	const authStore = useAuthStore()
	// Link shares count as authenticated but get a 403 from the counts endpoint.
	const query = useQuery({...projectCountsQuery(), enabled: computed(() => Boolean(authStore.authUser))}, queryClient)
	const counts = computed(() => query.data.value ?? {})
	const todayTotal = computed(() => Object.values(counts.value)
		.reduce((sum, count) => sum + count.dueOverdue, 0))

	return {
		counts,
		todayTotal,
		getForProject: (id: number) => counts.value[id],
	}
})

export function refreshProjectCounts() {
	return queryClient.invalidateQueries({queryKey: projectCountsKey})
}
