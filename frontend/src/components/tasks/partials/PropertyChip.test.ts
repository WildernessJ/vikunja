import {describe, it, expect} from 'vitest'
import {mount} from '@vue/test-utils'
import {createI18n} from 'vue-i18n'

import en from '@/i18n/lang/en.json'
import PropertyChip from './PropertyChip.vue'

const i18n = createI18n({legacy: false, locale: 'en', messages: {en}})

function mountChip(props: Partial<InstanceType<typeof PropertyChip>['$props']> = {}) {
	return mount(PropertyChip, {
		props: {
			icon: 'tags',
			label: 'Labels',
			...props,
		},
		slots: {
			default: '<div class="editor-stub">editor</div>',
		},
		global: {
			plugins: [i18n],
		},
	})
}

describe('PropertyChip', () => {
	it('renders the icon and label when unset', () => {
		const wrapper = mountChip({isSet: false})

		expect(wrapper.text()).toContain('Labels')
		expect(wrapper.find('.property-chip').classes()).not.toContain('is-unset')
	})

	it('renders a ghost/dashed state when unset and ghostWhenUnset is enabled', () => {
		const wrapper = mountChip({isSet: false, ghostWhenUnset: true})

		expect(wrapper.find('.property-chip').classes()).toContain('is-unset')
	})

	it('does not show the ghost state when set, even with ghostWhenUnset enabled', () => {
		const wrapper = mountChip({isSet: true, ghostWhenUnset: true})

		expect(wrapper.find('.property-chip').classes()).not.toContain('is-unset')
	})

	it('opens the popup with the editor slot content on click', async () => {
		const wrapper = mountChip()

		expect(wrapper.find('.editor-stub').exists()).toBe(false)

		await wrapper.find('.property-chip-button').trigger('click')

		expect(wrapper.find('.editor-stub').exists()).toBe(true)
	})

	it('shows the clear button only when showClear is true', () => {
		const shown = mountChip({showClear: true})
		const hidden = mountChip({showClear: false})

		expect(shown.find('.qac-chip-clear').exists()).toBe(true)
		expect(hidden.find('.qac-chip-clear').exists()).toBe(false)
	})

	it('emits clear when the clear button is clicked', async () => {
		const wrapper = mountChip({showClear: true})

		await wrapper.find('.qac-chip-clear').trigger('click')

		expect(wrapper.emitted('clear')).toBeTruthy()
	})

	it('disables the trigger button when disabled is true', () => {
		const wrapper = mountChip({disabled: true})

		expect(wrapper.find('.property-chip-button').attributes('disabled')).toBeDefined()
	})
})
