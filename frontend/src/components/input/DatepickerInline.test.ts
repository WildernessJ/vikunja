import {describe, it, expect, vi, beforeEach} from 'vitest'
import {mount} from '@vue/test-utils'

// useDateOnly is a shared composable wrapping a computed, so the mocked settings have to be
// genuinely reactive — a plain object would let the computed cache the first test's value.
const settingsMock = vi.hoisted((): {dateOnly: {value: boolean}, defaultDueTime: {value: string | undefined}} => ({
	dateOnly: {value: false},
	defaultDueTime: {value: undefined},
}))

vi.mock('@/stores/auth', async () => {
	const {ref} = await import('vue')
	settingsMock.dateOnly = ref(false)
	settingsMock.defaultDueTime = ref<string | undefined>(undefined)

	return {
		useAuthStore: () => ({
			settings: {
				weekStart: 1,
				frontendSettings: {
					timeFormat: '24',
					get dateOnly() {
						return settingsMock.dateOnly.value
					},
					get defaultDueTime() {
						return settingsMock.defaultDueTime.value
					},
				},
			},
		}),
	}
})

import DatepickerInline from './DatepickerInline.vue'

function mountPicker(props: Record<string, unknown> = {}) {
	return mount(DatepickerInline, {
		props: {modelValue: null, ...props},
		global: {
			mocks: {$t: (key: string) => key},
			stubs: {Icon: true},
			directives: {tooltip: {}},
		},
	})
}

// The 15th appears exactly once in a six-week month grid.
function clickDay15(wrapper: ReturnType<typeof mountPicker>) {
	const day = wrapper.findAll('.calendar-month__day').find(b => b.text() === '15')
	expect(day).toBeDefined()
	return day!.trigger('click')
}

function clickTomorrow(wrapper: ReturnType<typeof mountPicker>) {
	const button = wrapper.findAll('.date-shortcuts__item')
		.find(b => b.text().includes('input.datepicker.tomorrow'))
	expect(button).toBeDefined()
	return button!.trigger('click')
}

function lastEmittedDate(wrapper: ReturnType<typeof mountPicker>): Date {
	const emitted = wrapper.emitted('update:modelValue')
	expect(emitted).toBeTruthy()
	return emitted![emitted!.length - 1][0] as Date
}

function timeOf(date: Date) {
	return [date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]
}

describe('DatepickerInline date-only mode', () => {
	beforeEach(() => {
		settingsMock.dateOnly.value = false
		settingsMock.defaultDueTime.value = undefined
	})

	it('hides the time control when the setting is on', () => {
		settingsMock.dateOnly.value = true
		const wrapper = mountPicker()

		expect(wrapper.find('.time-control').exists()).toBe(false)
	})

	it('keeps the time control when the setting is off', () => {
		const wrapper = mountPicker()

		expect(wrapper.find('.time-control').exists()).toBe(true)
	})

	it('keeps the time control when the consumer forces a time', () => {
		settingsMock.dateOnly.value = true
		const wrapper = mountPicker({forceTime: true})

		expect(wrapper.find('.time-control').exists()).toBe(true)
	})

	it('gives a calendar pick the canonical end of day', async () => {
		settingsMock.dateOnly.value = true
		const wrapper = mountPicker()

		await clickDay15(wrapper)

		const date = lastEmittedDate(wrapper)
		expect(date.getDate()).toBe(15)
		expect(timeOf(date)).toEqual([23, 59, 59, 999])
	})

	it('gives a start-boundary calendar pick the start of day', async () => {
		settingsMock.dateOnly.value = true
		const wrapper = mountPicker({boundary: 'start'})

		await clickDay15(wrapper)

		expect(timeOf(lastEmittedDate(wrapper))).toEqual([0, 0, 0, 0])
	})

	it('gives a quick-selected date the canonical end of day', async () => {
		settingsMock.dateOnly.value = true
		const wrapper = mountPicker()

		await clickTomorrow(wrapper)

		expect(timeOf(lastEmittedDate(wrapper))).toEqual([23, 59, 59, 999])
	})

	it('gives a start-boundary quick-selected date the start of day', async () => {
		settingsMock.dateOnly.value = true
		const wrapper = mountPicker({boundary: 'start'})

		await clickTomorrow(wrapper)

		expect(timeOf(lastEmittedDate(wrapper))).toEqual([0, 0, 0, 0])
	})

	it('lets date-only win over the default due time', async () => {
		settingsMock.dateOnly.value = true
		settingsMock.defaultDueTime.value = '09:30'
		const wrapper = mountPicker()

		await clickDay15(wrapper)

		expect(timeOf(lastEmittedDate(wrapper))).toEqual([23, 59, 59, 999])
	})

	it('keeps a real time for a forced-time consumer in date-only mode', async () => {
		settingsMock.dateOnly.value = true
		settingsMock.defaultDueTime.value = '09:30'
		const wrapper = mountPicker({forceTime: true})

		await clickDay15(wrapper)

		expect(timeOf(lastEmittedDate(wrapper))).toEqual([9, 30, 0, 0])
	})

	it('uses the default due time for a calendar pick when the setting is off', async () => {
		settingsMock.defaultDueTime.value = '09:30'
		const wrapper = mountPicker()

		await clickDay15(wrapper)

		expect(timeOf(lastEmittedDate(wrapper))).toEqual([9, 30, 0, 0])
	})
})
