import {computed, defineAsyncComponent, h, shallowRef, type AsyncComponentLoader, type VNode, watchEffect} from 'vue'
import {useRoute, useRouter, type RouteComponent, type RouteLocationNormalizedGeneric} from 'vue-router'
import {useBaseStore} from '@/stores/base'
import {resolveBackRoute} from '@/helpers/backRoute'

export function useRouteWithModal() {
	const router = useRouter()
	const route = useRoute()
	const backdropView = computed(() => route.fullPath ? window.history.state?.backdropView : undefined)
	const baseStore = useBaseStore()

	const routeWithModal = computed(() => {
		return backdropView.value
			? router.resolve(backdropView.value) as RouteLocationNormalizedGeneric
			: route
	})

	const currentModal = shallowRef<VNode>()
	watchEffect(() => {
		if (!backdropView.value) {
			currentModal.value = undefined
			return
		}

		// this is adapted from vue-router
		// https://github.com/vuejs/vue-router-next/blob/798cab0d1e21f9b4d45a2bd12b840d2c7415f38a/src/RouterView.ts#L125
		const routePropsOption = route.matched[0]?.props.default
		let routeProps = undefined
		if (routePropsOption) {
			if (routePropsOption === true) {
				routeProps = route.params
			} else {
				if (typeof routePropsOption === 'function') {
					routeProps = routePropsOption(route)
				} else {
					routeProps = routePropsOption
				}
			}
		}

		if (typeof routeProps === 'undefined') {
			currentModal.value = undefined
			return
		}

		routeProps.backdropView = backdropView.value

		let component = route.matched[0]?.components?.default

		if (typeof component === 'function') {
			// Route components can be functional/constructor components, which are also
			// `typeof === 'function'` but aren't loaders; the route-view lazy-load path is.
			component = defineAsyncComponent(component as AsyncComponentLoader<RouteComponent>)
		}

		if (!component) {
			currentModal.value = undefined
			return
		}
		currentModal.value = h(component, routeProps)
	})

	const historyState = computed(() => route.fullPath ? window.history.state : undefined)

	function closeModal() {
		// If the current project was changed because the user moved the currently opened task while coming from kanban,
		// we need to reflect that change in the route when they close the task modal.
		// Only numeric project and view ids qualify: a saved filter (negative id) goes back instead.
		const backRoute = resolveBackRoute(router)
		const isNumericId = (param: unknown) => typeof param === 'string' && /^\d+$/.test(param)
		if (
			backRoute?.name === 'project.view'
			&& isNumericId(backRoute.params.projectId)
			&& isNumericId(backRoute.params.viewId)
			&& baseStore.currentProjectId !== 0
		) {
			// Preserve query parameters (e.g., date range) from the backdrop view
			const backdropRoute = historyState.value?.backdropView && router.resolve(historyState.value.backdropView)
			router.push({
				name: 'project.view',
				params: {
					projectId: baseStore.currentProjectId,
					viewId: backRoute.params.viewId,
				},
				query: backdropRoute?.query || {},
			})
			return
		}

		// Try browser history first
		if (historyState.value?.back) {
			router.back()
			return
		}

		// Try backdrop view
		const backdropRoute = historyState.value?.backdropView && router.resolve(historyState.value.backdropView)
		if (backdropRoute && backdropRoute.params?.projectId !== '0') {
			router.push(backdropRoute)
			return
		}

		// Fallback to current project or home
		if (baseStore.currentProjectId !== 0) {
			router.push({
				name: 'project.index',
				params: {projectId: baseStore.currentProjectId},
			})
		} else {
			router.push({ name: 'home' })
		}
	}

	return {routeWithModal, currentModal, closeModal}
}
