import {computed, toValue, type MaybeRefOrGetter} from 'vue'

import {useTitle as useTitleVueUse, type UseTitleOptions} from '@vueuse/core'

export function useTitle(
	newTitle: MaybeRefOrGetter<string | null | undefined> = null,
	options?: UseTitleOptions,
) {
	const pageTitle = computed(() => toValue(newTitle))

	const completeTitle = computed(() =>
		!pageTitle.value
			? 'Vikunja'
			: `${pageTitle.value} | Vikunja`,
	)

	return useTitleVueUse(completeTitle, options)
}
