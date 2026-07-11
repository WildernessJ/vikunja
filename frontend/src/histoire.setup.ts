import {defineSetupVue3} from '@histoire/plugin-vue'
import type {Component} from 'vue'
import {i18n} from './i18n'

// import './histoire.css' // Import global CSS
import './styles/tailwind.css'
import './styles/global.scss'

import {createPinia} from 'pinia'

import testid from '@/directives/testid'

import FontAwesomeIcon from '@/components/misc/Icon'
import XButton from '@/components/input/Button.vue'
import Modal from '@/components/misc/Modal.vue'
import Card from '@/components/misc/Card.vue'

export const setupVue3 = defineSetupVue3(({ app }) => {
	// Add Pinia store
	const pinia = createPinia()
	app.use(pinia)
	app.use(i18n)

	app.directive('cy', testid)

	app.component('Icon', FontAwesomeIcon)
	app.component('XButton', XButton as unknown as Component)
	// Modal's prop types make the app.component() overload too complex for TS to check; widen to Component.
	app.component('Modal', Modal as unknown as Component)
	app.component('Card', Card)
})
