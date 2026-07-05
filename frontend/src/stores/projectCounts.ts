import {computed, ref} from 'vue'
import {acceptHMRUpdate, defineStore} from 'pinia'

import {getProjectCounts} from '@/services/projectCounts'
import type {IProjectCount} from '@/modelTypes/IProjectCount'
import type {IProject} from '@/modelTypes/IProject'

export const useProjectCountsStore = defineStore('projectCounts', () => {
	const counts = ref<Record<number, IProjectCount>>({})

	const todayTotal = computed(() => Object.values(counts.value)
		.reduce((sum, count) => sum + count.dueOverdue, 0))

	function getForProject(id: IProject['id']): IProjectCount | undefined {
		return counts.value[id]
	}

	async function loadCounts() {
		counts.value = await getProjectCounts()
	}

	return {
		counts,
		todayTotal,
		getForProject,
		loadCounts,
	}
})

// support hot reloading
if (import.meta.hot) {
	import.meta.hot.accept(acceptHMRUpdate(useProjectCountsStore, import.meta.hot))
}
