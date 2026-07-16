import {describe, expect, it} from 'vitest'
import {mount} from '@vue/test-utils'

import QuickAddAutocompleteResults from './QuickAddAutocompleteResults.vue'
import type {AutocompleteItem} from '@/composables/useQuickAddAutocomplete'

const ITEMS: AutocompleteItem[] = [
	{kind: 'project', id: 1, display: 'ProjectOne', insertValue: 'ProjectOne'},
	{kind: 'project', id: 2, display: 'ProjectTwo', insertValue: 'ProjectTwo'},
]

function mountResults(items: AutocompleteItem[]) {
	return mount(QuickAddAutocompleteResults, {
		props: {items, listboxId: 'qac-listbox-test'},
		global: {
			mocks: {$t: (key: string) => key},
		},
	})
}

function keydown(key: string) {
	return new KeyboardEvent('keydown', {key, cancelable: true})
}

describe('QuickAddAutocompleteResults', () => {
	it('does not consume Enter when there are no results, so the host can submit', () => {
		const wrapper = mountResults([])

		const event = keydown('Enter')
		const consumed = (wrapper.vm as unknown as {onKeyDown: (e: KeyboardEvent) => boolean}).onKeyDown(event)

		expect(consumed).toBe(false)
		expect(event.defaultPrevented).toBe(false)
	})

	it('does not consume Tab when there are no results, so the host can tab away', () => {
		const wrapper = mountResults([])

		const consumed = (wrapper.vm as unknown as {onKeyDown: (e: KeyboardEvent) => boolean}).onKeyDown(keydown('Tab'))

		expect(consumed).toBe(false)
	})

	it('does not throw and does not consume ArrowDown/ArrowUp when there are no results', () => {
		const wrapper = mountResults([])
		const onKeyDown = (wrapper.vm as unknown as {onKeyDown: (e: KeyboardEvent) => boolean}).onKeyDown

		expect(() => onKeyDown(keydown('ArrowDown'))).not.toThrow()
		expect(onKeyDown(keydown('ArrowDown'))).toBe(false)
		expect(() => onKeyDown(keydown('ArrowUp'))).not.toThrow()
		expect(onKeyDown(keydown('ArrowUp'))).toBe(false)
	})

	it('still consumes and closes on Escape when there are no results', () => {
		const wrapper = mountResults([])
		const event = keydown('Escape')

		const consumed = (wrapper.vm as unknown as {onKeyDown: (e: KeyboardEvent) => boolean}).onKeyDown(event)

		expect(consumed).toBe(true)
		expect(event.defaultPrevented).toBe(true)
		expect(wrapper.emitted('close')).toHaveLength(1)
	})

	it('shows the dedicated empty-state translation key', () => {
		const wrapper = mountResults([])

		expect(wrapper.text()).toContain('task.quickAdd.autocompleteNoResults')
	})

	it('still handles ArrowDown/Enter normally when there are results', () => {
		const wrapper = mountResults(ITEMS)
		const onKeyDown = (wrapper.vm as unknown as {onKeyDown: (e: KeyboardEvent) => boolean}).onKeyDown

		expect(onKeyDown(keydown('ArrowDown'))).toBe(true)
		expect(onKeyDown(keydown('Enter'))).toBe(true)
		expect(wrapper.emitted('select')?.[0]).toEqual([ITEMS[1]])
	})
})
