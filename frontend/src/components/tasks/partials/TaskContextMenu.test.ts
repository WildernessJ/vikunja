import {describe, it, expect, vi, beforeEach} from 'vitest'
import {mount, flushPromises} from '@vue/test-utils'
import {setActivePinia, createPinia} from 'pinia'
import {createI18n} from 'vue-i18n'

import type {ITask} from '@/modelTypes/ITask'
import {PRIORITIES} from '@/constants/priorities'
import en from '@/i18n/lang/en.json'

const taskServiceUpdateMock = vi.fn()
vi.mock('@/services/task', () => ({
	default: class {
		loading = false
		update = taskServiceUpdateMock
	},
}))

const taskStoreUpdateMock = vi.fn()
const taskStoreDeleteMock = vi.fn()
vi.mock('@/stores/tasks', () => ({
	useTaskStore: () => ({
		update: taskStoreUpdateMock,
		delete: taskStoreDeleteMock,
	}),
}))

// happy-dom reports a 0x0 documentElement, which makes floating-ui's shift()
// middleware clamp any real position to the viewport-edge padding — not a bug
// in the component, just a jsdom/happy-dom layout limitation. We stub
// computePosition so the anchoring test can assert on the virtual-element
// contract (it must return the recorded cursor rect) without depending on
// real layout math.
const computePositionMock = vi.hoisted(() => vi.fn().mockResolvedValue({x: 0, y: 0}))
vi.mock('@floating-ui/dom', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@floating-ui/dom')>()
	return {
		...actual,
		computePosition: computePositionMock,
	}
})

import TaskContextMenu from './TaskContextMenu.vue'

const i18n = createI18n({legacy: false, locale: 'en', messages: {en}})

function makeTask(overrides: Partial<ITask> = {}): ITask {
	return {
		id: 1,
		title: 'Test task',
		done: false,
		priority: PRIORITIES.LOW,
		labels: [],
		assignees: [],
		dueDate: null,
		projectId: 1,
		...overrides,
	} as ITask
}

function mountMenu(task: ITask, position = {x: 100, y: 200}) {
	return mount(TaskContextMenu, {
		props: {
			task,
			open: true,
			position,
		},
		global: {
			plugins: [i18n],
			stubs: {
				Teleport: true,
				RouterLink: true,
				ProjectSearch: true,
				EditLabels: true,
				EditAssignees: true,
				DatepickerInline: true,
				Modal: {
					props: ['enabled'],
					emits: ['close', 'submit'],
					template: `<div v-if="enabled"><button class="stub-modal-submit" @click="$emit('submit')" /></div>`,
				},
			},
		},
		attachTo: document.body,
	})
}

describe('TaskContextMenu', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		taskServiceUpdateMock.mockReset()
		taskStoreUpdateMock.mockReset()
		taskStoreDeleteMock.mockReset()
		computePositionMock.mockReset()
		computePositionMock.mockResolvedValue({x: 42, y: 84})
	})

	it('opens anchored to a virtual element at the recorded cursor position', async () => {
		const wrapper = mountMenu(makeTask(), {x: 123, y: 456})
		await flushPromises()

		expect(computePositionMock).toHaveBeenCalled()
		const [reference] = computePositionMock.mock.calls[0]
		expect(reference.getBoundingClientRect()).toMatchObject({x: 123, y: 456, width: 0, height: 0})

		const menu = document.querySelector('.task-context-menu') as HTMLElement
		expect(menu).toBeTruthy()
		expect(menu.style.left).toBe('42px')
		expect(menu.style.top).toBe('84px')

		wrapper.unmount()
	})

	it('closes on Escape', async () => {
		const wrapper = mountMenu(makeTask())
		await flushPromises()

		window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))
		await flushPromises()

		expect(wrapper.emitted('update:open')).toBeTruthy()
		expect(wrapper.emitted('update:open')![0]).toEqual([false])

		wrapper.unmount()
	})

	// Regression guard: priority changes must route through taskStore.update
	// (which triggers projectCountsStore.loadCounts() to keep the Today count
	// and app badge in sync), never call the task service directly.
	it('routes a priority change through taskStore.update, not the raw service', async () => {
		const task = makeTask({priority: PRIORITIES.LOW})
		taskStoreUpdateMock.mockResolvedValueOnce({...task, priority: PRIORITIES.URGENT})

		const wrapper = mountMenu(task)
		await flushPromises()

		const priorityTrigger = wrapper.findAll('.dropdown-item').find(el => el.text().includes('Priority'))
		expect(priorityTrigger).toBeTruthy()
		await priorityTrigger!.trigger('click')

		const urgentOption = wrapper.findAll('.flyout-option').find(el => el.text().includes('Urgent'))
		expect(urgentOption).toBeTruthy()
		await urgentOption!.trigger('click')
		await flushPromises()

		expect(taskStoreUpdateMock).toHaveBeenCalledOnce()
		expect(taskStoreUpdateMock).toHaveBeenCalledWith(expect.objectContaining({priority: PRIORITIES.URGENT}))
		expect(taskServiceUpdateMock).not.toHaveBeenCalled()
		expect(wrapper.emitted('taskUpdated')).toBeTruthy()

		wrapper.unmount()
	})

	// Same regression guard for due dates.
	it('routes a due date change through taskStore.update, not the raw service', async () => {
		const task = makeTask()
		taskStoreUpdateMock.mockResolvedValueOnce({...task, dueDate: new Date()})

		const wrapper = mountMenu(task)
		await flushPromises()

		const dueDateTrigger = wrapper.findAll('.dropdown-item').find(el => el.text().includes('Due date'))
		expect(dueDateTrigger).toBeTruthy()
		await dueDateTrigger!.trigger('click')

		const todayOption = wrapper.findAll('.flyout-option').find(el => el.text().trim() === 'Today')
		expect(todayOption).toBeTruthy()
		await todayOption!.trigger('click')
		await flushPromises()

		expect(taskStoreUpdateMock).toHaveBeenCalledOnce()
		expect(taskServiceUpdateMock).not.toHaveBeenCalled()

		wrapper.unmount()
	})

	it('calls taskStore.delete when the delete confirmation is submitted', async () => {
		const task = makeTask()
		taskStoreDeleteMock.mockResolvedValueOnce(undefined)

		const wrapper = mountMenu(task)
		await flushPromises()

		const deleteTrigger = wrapper.findAll('.dropdown-item').find(el => el.text().includes('Delete'))
		expect(deleteTrigger).toBeTruthy()
		await deleteTrigger!.trigger('click')
		await flushPromises()

		const submitButton = document.querySelector('.stub-modal-submit') as HTMLElement
		expect(submitButton).toBeTruthy()
		submitButton.click()
		await flushPromises()

		expect(taskStoreDeleteMock).toHaveBeenCalledOnce()
		expect(taskStoreDeleteMock).toHaveBeenCalledWith(expect.objectContaining({id: task.id}))

		wrapper.unmount()
	})

	// The List view removes the row without a reload by listening for this
	// event (see SingleTaskInProject.vue -> ProjectList.vue's onTaskDeleted).
	it('emits deleted after the delete confirmation is submitted', async () => {
		const task = makeTask()
		taskStoreDeleteMock.mockResolvedValueOnce(undefined)

		const wrapper = mountMenu(task)
		await flushPromises()

		const deleteTrigger = wrapper.findAll('.dropdown-item').find(el => el.text().includes('Delete'))
		await deleteTrigger!.trigger('click')
		await flushPromises()

		const submitButton = document.querySelector('.stub-modal-submit') as HTMLElement
		submitButton.click()
		await flushPromises()

		expect(wrapper.emitted('deleted')).toBeTruthy()
		expect(wrapper.emitted('deleted')![0]).toEqual([expect.objectContaining({id: task.id})])

		wrapper.unmount()
	})
})
