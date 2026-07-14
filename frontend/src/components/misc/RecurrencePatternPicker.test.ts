import {describe, it, expect} from 'vitest'
import {mount} from '@vue/test-utils'
import {createI18n} from 'vue-i18n'

import RecurrencePatternPicker from './RecurrencePatternPicker.vue'
import en from '@/i18n/lang/en.json'

const i18n = createI18n({legacy: false, locale: 'en', messages: {en}})

function mountPicker(modelValue: string) {
	return mount(RecurrencePatternPicker, {
		props: {modelValue},
		global: {
			plugins: [i18n],
			stubs: ['Datepicker'],
		},
	})
}

describe('RecurrencePatternPicker rendered summary', () => {
	it.each([
		['FREQ=WEEKLY;BYDAY=MO,WE,FR', 'Repeats weekly on Mon, Wed, Fri'],
		['FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', 'Repeats every 2 weeks on Tue'],
		['FREQ=MONTHLY;BYMONTHDAY=15', 'Repeats monthly on day 15'],
		['FREQ=MONTHLY;BYDAY=2TU', 'Repeats monthly on the second Tue'],
		['FREQ=MONTHLY;BYDAY=-1SA', 'Repeats monthly on the last Sat'],
		['FREQ=MONTHLY;BYMONTHDAY=-1', 'Repeats On the last day of the month'],
		['FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', 'Repeats On the last workday of the month'],
	])('renders "%s" as "%s"', (rrule, expected) => {
		const wrapper = mountPicker(rrule)

		expect(wrapper.find('.pattern-summary').text()).toBe(expected)
	})

	it('renders no summary for an empty pattern', () => {
		const wrapper = mountPicker('')

		expect(wrapper.find('.pattern-summary').exists()).toBe(false)
	})
})
