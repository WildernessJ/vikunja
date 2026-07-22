import {describe, it, expect} from 'vitest'
import {mount} from '@vue/test-utils'
import {createI18n} from 'vue-i18n'

import SortPopup from '@/components/project/partials/SortPopup.vue'
import en from '@/i18n/lang/en.json'

const i18n = createI18n({legacy: false, locale: 'en', messages: {en}})

// Render the Popup's content slot unconditionally, and XButton as a plain button, so the
// assertion depends only on the canSaveDefault gate — not on popup open/close behaviour.
function mountSort(canSaveDefault: boolean | undefined) {
	return mount(SortPopup, {
		props: {modelValue: {position: 'asc'}, canSaveDefault},
		global: {
			plugins: [i18n],
			stubs: {
				Popup: {template: '<div><slot name="content" :close="() => {}" /></div>'},
				XButton: {template: '<button class="xbtn"><slot /></button>'},
			},
		},
	})
}

// Resolve through the i18n instance rather than reading en.sorting.* directly:
// @intlify/unplugin-vue-i18n compiles en.json leaf strings into message-AST objects at
// import, so en.sorting.saveAsDefault is not the plain string.
const SAVE_LABEL = i18n.global.t('sorting.saveAsDefault')
const APPLY_LABEL = i18n.global.t('sorting.apply')

describe('SortPopup "Set as default sort" gating', () => {
	it('shows the button when canSaveDefault is true', () => {
		expect(mountSort(true).html()).toContain(SAVE_LABEL)
	})

	it('hides the button when canSaveDefault is false', () => {
		const html = mountSort(false).html()
		expect(html).not.toContain(SAVE_LABEL)
		// The other actions still render — proves the gate hides only the save button,
		// not that the content failed to render.
		expect(html).toContain(APPLY_LABEL)
	})

	it('hides the button when canSaveDefault is omitted (undefined)', () => {
		expect(mountSort(undefined).html()).not.toContain(SAVE_LABEL)
	})
})
