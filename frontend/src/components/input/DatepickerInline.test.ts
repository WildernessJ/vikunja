import {describe, it, expect, vi, beforeEach} from 'vitest'
import {mount} from '@vue/test-utils'

// useDateOnly is a shared composable wrapping a computed, so the mocked setting has to be
// genuinely reactive — a plain object would let the computed cache the first test's value.
const dateOnlyMock = vi.hoisted((): {ref: {value: boolean}} => ({ref: {value: false}}))

vi.mock('@/stores/auth', async () => {
	const {ref} = await import('vue')
	dateOnlyMock.ref = ref(false)

	return {
		useAuthStore: () => ({
			settings: {
				frontendSettings: {
					timeFormat: '24',
					get dateOnly() {
						return dateOnlyMock.ref.value
					},
				},
			},
		}),
	}
})

vi.mock('vue-i18n', () => ({
	useI18n: () => ({t: (key: string) => ({
		'date.altFormatLong': 'j M Y, H:i',
		'date.altFormatShort': 'j M Y',
	}[key] ?? key)}),
	createI18n: () => ({global: {t: (key: string) => key, locale: {value: 'en'}}}),
}))

import DatepickerInline from './DatepickerInline.vue'

function mountPicker(props: Record<string, unknown> = {}) {
	return mount(DatepickerInline, {
		props: {modelValue: null, ...props},
		global: {
			mocks: {$t: (key: string) => key},
			stubs: {Icon: true},
		},
	})
}

// The quick-select buttons are conditionally rendered, so find "tomorrow" by its label.
function clickTomorrow(wrapper: ReturnType<typeof mountPicker>) {
	const button = wrapper.findAll('.datepicker__quick-select-date')
		.find(b => b.text().includes('input.datepicker.tomorrow'))
	expect(button).toBeDefined()
	return button!.trigger('click')
}

function lastEmittedDate(wrapper: ReturnType<typeof mountPicker>): Date {
	const emitted = wrapper.emitted('update:modelValue')
	expect(emitted).toBeTruthy()
	return emitted![emitted!.length - 1][0] as Date
}

describe('DatepickerInline date-only mode', () => {
	beforeEach(() => {
		dateOnlyMock.ref.value = false
	})

	it('hides the time controls when the setting is on', async () => {
		dateOnlyMock.ref.value = true
		const wrapper = mountPicker()

		expect(wrapper.find('.flatpickr-time input.flatpickr-hour').exists()).toBe(false)
	})

	it('keeps the time controls when the setting is off', () => {
		const wrapper = mountPicker()

		expect(wrapper.find('.flatpickr-time input.flatpickr-hour').exists()).toBe(true)
	})

	it('keeps the time controls when the consumer forces a time', () => {
		dateOnlyMock.ref.value = true
		const wrapper = mountPicker({forceTime: true})

		expect(wrapper.find('.flatpickr-time input.flatpickr-hour').exists()).toBe(true)
	})

	it('shows no time in the visible alt input when the setting is on', () => {
		dateOnlyMock.ref.value = true
		const wrapper = mountPicker({modelValue: new Date('2026-01-05T23:59:59.999')})

		const alt = wrapper.findAll('input').find(i => i.attributes('class')?.includes('form-control'))
		expect(alt).toBeDefined()
		expect((alt!.element as HTMLInputElement).value).not.toMatch(/\d{1,2}:\d{2}/)
	})

	it('gives a quick-selected date the canonical end of day', async () => {
		dateOnlyMock.ref.value = true
		const wrapper = mountPicker()

		await clickTomorrow(wrapper)

		const date = lastEmittedDate(wrapper)
		expect([date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()])
			.toEqual([23, 59, 59, 999])
	})

	it('gives a start-boundary quick-selected date the start of day', async () => {
		dateOnlyMock.ref.value = true
		const wrapper = mountPicker({boundary: 'start'})

		await clickTomorrow(wrapper)

		const date = lastEmittedDate(wrapper)
		expect([date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()])
			.toEqual([0, 0, 0, 0])
	})

	it('leaves the quick-select time alone when the setting is off', async () => {
		const wrapper = mountPicker()

		await clickTomorrow(wrapper)

		expect(lastEmittedDate(wrapper).getSeconds()).toBe(0)
		expect(lastEmittedDate(wrapper).getMilliseconds()).not.toBe(999)
	})
})
