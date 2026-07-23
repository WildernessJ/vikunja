import {describe, it, expect} from 'vitest'
import {createApp, defineComponent, h, nextTick} from 'vue'
import {createRouter, createMemoryHistory, RouterView} from 'vue-router'

import {useGlobalNow} from './useGlobalNow'

// Regression guard for #75. The task-detail chips render relative dates
// (formatDateSince → useGlobalNow) on load, so the shared global state's
// one-time init runs during a component *render*, where getCurrentInstance()
// returns the rendering instance but no setup instance exists. Registering a
// component route guard from that context tripped onUnmounted/onActivated/
// onDeactivated "no active component instance" warnings. The factory must stay
// context-agnostic — no component lifecycle hooks tied to whoever calls first.
//
// This must stay the ONLY useGlobalNow caller in the file: createGlobalState
// memoizes at module scope, so a prior call in another test would init the
// factory outside render and mask the regression. Keep it single-test.
describe('useGlobalNow', () => {
	it('initialises from a render context without emitting lifecycle warnings', async () => {
		const warnings: string[] = []

		const RouteComp = defineComponent({
			setup() {
				// Called in the render function (not setup) to mimic template-time
				// formatDateSince, so this is the first useGlobalNow call and it
				// happens during render.
				return () => {
					useGlobalNow()
					return h('div', 'now')
				}
			},
		})

		const router = createRouter({
			history: createMemoryHistory(),
			routes: [{path: '/', name: 'home', component: RouteComp}],
		})

		const app = createApp(defineComponent({render: () => h(RouterView)}))
		app.use(router)
		app.config.warnHandler = msg => { warnings.push(String(msg)) }

		await router.push('/')
		await router.isReady()

		const el = document.createElement('div')
		app.mount(el)
		await nextTick()

		const lifecycleWarnings = warnings.filter(w =>
			/is called when there is no active component instance/.test(w),
		)
		expect(lifecycleWarnings).toEqual([])

		// Sanity: the state is usable and update() advances now.
		const {now, update} = useGlobalNow()
		expect(now.value).toBeInstanceOf(Date)
		const before = now.value.getTime()
		update()
		expect(now.value.getTime()).toBeGreaterThanOrEqual(before)

		app.unmount()
	})
})
