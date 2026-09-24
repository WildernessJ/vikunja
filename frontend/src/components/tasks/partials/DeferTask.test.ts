import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {mount, flushPromises} from '@vue/test-utils'
import {setActivePinia, createPinia} from 'pinia'
import {createI18n} from 'vue-i18n'

import type {ITask} from '@/modelTypes/ITask'
import en from '@/i18n/lang/en.json'

const taskServiceUpdateMock = vi.fn()
vi.mock('@/services/task', () => ({
	default: class {
		loading = false
		update = taskServiceUpdateMock
	},
}))

// A real ref: DeferTask reads the toggle through a computed, so a plain object would
// let the first test's value stick.
const dateOnlyMock = vi.hoisted((): {ref: {value: boolean}} => ({ref: {value: false}}))
vi.mock('@/composables/useDateOnly', async () => {
	const {ref} = await import('vue')
	dateOnlyMock.ref = ref(false)
	return {useDateOnly: () => ({store: dateOnlyMock.ref})}
})

const taskStoreUpdateMock = vi.fn()
vi.mock('@/stores/tasks', () => ({
	useTaskStore: () => ({
		update: taskStoreUpdateMock,
	}),
}))

import DeferTask from './DeferTask.vue'

const i18n = createI18n({legacy: false, locale: 'en', messages: {en}})

type DeferVm = {
	deferDays: (days: number) => void
	updateDueDate: () => Promise<void>
	dueDate: Date | null
}

const wrappers: ReturnType<typeof mount>[] = []

function mountDeferTask(task: ITask) {
	const wrapper = mount(DeferTask, {
		props: {modelValue: task},
		global: {
			plugins: [i18n],
			stubs: {DatepickerInline: true},
		},
	})
	wrappers.push(wrapper)
	return wrapper
}

function savedDueDate(call = 0): Date {
	return taskStoreUpdateMock.mock.calls[call][0].dueDate
}

describe('DeferTask', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		taskServiceUpdateMock.mockReset()
		taskServiceUpdateMock.mockResolvedValue({id: 1, dueDate: new Date('2026-07-02T10:00:00.000Z')})
		taskStoreUpdateMock.mockReset()
		// onBeforeUnmount calls updateDueDate(), which reads newTask.dueDate off this mock.
		// Echoing the saved task keeps lastValue in step, so the unmount tick is a no-op.
		taskStoreUpdateMock.mockImplementation(async (task: ITask) => task)
		dateOnlyMock.ref.value = false
	})

	// Unmount flushes the debounced save; do it inside the test's own mocks.
	afterEach(() => {
		wrappers.splice(0).forEach(wrapper => wrapper.unmount())
	})

	// Guards the routing: deferring must call taskStore.update, not the raw
	// service — that store action is where loadCounts() (Today count/badge
	// refresh) is wired. The refresh effect itself is covered by live-verify.
	it('reschedules through the task store, not the raw service', async () => {
		const task = {id: 1, dueDate: new Date('2026-07-01T10:00:00.000Z')} as ITask
		taskStoreUpdateMock.mockResolvedValueOnce({
			...task,
			dueDate: new Date('2026-07-02T10:00:00.000Z'),
		})

		const wrapper = mountDeferTask(task)
		;(wrapper.vm as unknown as {deferDays: (days: number) => void}).deferDays(1)
		await flushPromises()

		expect(taskStoreUpdateMock).toHaveBeenCalledOnce()
		expect(taskServiceUpdateMock).not.toHaveBeenCalled()
	})

	describe('date-only mode', () => {
		it('snaps a deferred date to the canonical end of day', async () => {
			dateOnlyMock.ref.value = true
			const wrapper = mountDeferTask({id: 1, dueDate: new Date(2026, 8, 10, 10, 0)} as ITask)

			;(wrapper.vm as unknown as DeferVm).deferDays(1)
			await flushPromises()

			const saved = savedDueDate()
			expect(saved.getDate()).toBe(11)
			expect(saved.getHours()).toBe(23)
			expect(saved.getMinutes()).toBe(59)
			expect(saved.getSeconds()).toBe(59)
			expect(saved.getMilliseconds()).toBe(999)
		})

		it('does not re-save when the picked value resolves to the stored day', async () => {
			dateOnlyMock.ref.value = true
			const wrapper = mountDeferTask({id: 1, dueDate: new Date(2026, 8, 10, 23, 59, 59, 999)} as ITask)

			;(wrapper.vm as unknown as DeferVm).dueDate = new Date(2026, 8, 10, 12, 0)
			await (wrapper.vm as unknown as DeferVm).updateDueDate()
			await flushPromises()

			expect(taskStoreUpdateMock).not.toHaveBeenCalled()
		})

		it('keeps the existing time when the toggle is off', async () => {
			const wrapper = mountDeferTask({id: 1, dueDate: new Date(2026, 8, 10, 10, 0)} as ITask)

			;(wrapper.vm as unknown as DeferVm).deferDays(1)
			await flushPromises()

			const saved = savedDueDate()
			expect(saved.getDate()).toBe(11)
			expect(saved.getHours()).toBe(10)
			expect(saved.getMinutes()).toBe(0)
		})

		it('opens on a task without a due date without saving', async () => {
			dateOnlyMock.ref.value = true
			const wrapper = mountDeferTask({id: 1, dueDate: null} as unknown as ITask)

			await (wrapper.vm as unknown as DeferVm).updateDueDate()
			await flushPromises()

			expect(taskStoreUpdateMock).not.toHaveBeenCalled()
		})
	})
})
