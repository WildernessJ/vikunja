import {describe, it, expect, vi, beforeEach} from 'vitest'
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

const taskStoreUpdateMock = vi.fn()
vi.mock('@/stores/tasks', () => ({
	useTaskStore: () => ({
		update: taskStoreUpdateMock,
	}),
}))

import DeferTask from './DeferTask.vue'

const i18n = createI18n({legacy: false, locale: 'en', messages: {en}})

function mountDeferTask(task: ITask) {
	return mount(DeferTask, {
		props: {modelValue: task},
		global: {
			plugins: [i18n],
			stubs: ['flat-pickr'],
		},
	})
}

describe('DeferTask', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		taskServiceUpdateMock.mockReset()
		taskServiceUpdateMock.mockResolvedValue({id: 1, dueDate: new Date('2026-07-02T10:00:00.000Z')})
		taskStoreUpdateMock.mockReset()
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
})
