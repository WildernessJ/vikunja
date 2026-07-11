import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {setActivePinia, createPinia} from 'pinia'
import {defineComponent, h, nextTick} from 'vue'
import {mount, type VueWrapper} from '@vue/test-utils'

import {useAppearance} from './useAppearance'
import {useAuthStore} from '@/stores/auth'
import UserSettingsModel from '@/models/userSettings'
import {FONT_FAMILIES, FONT_SIZES, DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY} from '@/helpers/appearance'

// A component whose only job is to instantiate the shared composable so its
// watch/tryOnMounted wiring runs against the real <html> element.
const Host = defineComponent({
	setup() {
		useAppearance()
		return () => h('div')
	},
})

// store.settings is exposed readonly, so drive changes through the same public
// API the app uses (saveUserSettings -> setUserSettings -> loadSettings).
function setAppearance(fontSize: string, fontFamily: string) {
	useAuthStore().setUserSettings(new UserSettingsModel({
		frontendSettings: {fontSize, fontFamily},
	} as never))
}

const html = () => document.documentElement

describe('useAppearance DOM application', () => {
	let wrapper: VueWrapper | undefined

	beforeEach(() => {
		setActivePinia(createPinia())
		html().style.fontSize = ''
		html().style.removeProperty('--body-family')
	})

	afterEach(() => {
		// Unmount drops the last subscriber so createSharedComposable disposes its
		// scope — the next test re-initialises against a fresh pinia store.
		wrapper?.unmount()
		wrapper = undefined
	})

	it('applies the stored font size and family to <html> on mount', async () => {
		setAppearance('125', 'monospace')
		wrapper = mount(Host)
		await nextTick()

		expect(html().style.fontSize).toBe(FONT_SIZES['125'])
		expect(html().style.getPropertyValue('--body-family')).toBe(FONT_FAMILIES.monospace)
	})

	it('reacts to a settings change after mount', async () => {
		setAppearance(DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY)
		wrapper = mount(Host)
		await nextTick()

		setAppearance('87.5', 'serif')
		await nextTick()

		expect(html().style.fontSize).toBe(FONT_SIZES['87.5'])
		expect(html().style.getPropertyValue('--body-family')).toBe(FONT_FAMILIES.serif)
	})

	// The mechanism issue #44 relies on: when the store is reset to defaults (as
	// logout does), the composable re-fires and restores default styling rather
	// than leaving the previous user's choices stuck on <html>.
	it('restores defaults when settings reset to model defaults', async () => {
		setAppearance('125', 'serif')
		wrapper = mount(Host)
		await nextTick()

		setAppearance(DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY)
		await nextTick()

		expect(html().style.fontSize).toBe(FONT_SIZES[DEFAULT_FONT_SIZE])
		expect(html().style.getPropertyValue('--body-family')).toBe(FONT_FAMILIES[DEFAULT_FONT_FAMILY])
	})
})
