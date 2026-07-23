import {describe, it, expect, vi, beforeEach} from 'vitest'
import {defineComponent, h} from 'vue'
import {mount, flushPromises} from '@vue/test-utils'
import {createPinia, setActivePinia} from 'pinia'
import {createRouter, createMemoryHistory} from 'vue-router'
import {createI18n} from 'vue-i18n'
import en from '@/i18n/lang/en.json'

import {PERMISSIONS} from '@/constants/permissions'

// Regression for F-C: the hidden field-open shortcut buttons (KeyL/P/C/A/M,
// reminders, KeyF/KeyR) used to render unconditionally, so v-shortcut could
// pop open editors on a read-only task even though they were inert on `main`
// (gated behind canWrite there). Full-mounting the real view is the seam that
// matters since the bug is about what actually lands in the DOM.
const getMock = vi.hoisted(() => vi.fn())
vi.mock('@/services/task', () => ({
	default: class {
		loading = false
		get = getMock
	},
}))

// Reactions.vue pulls in vuemoji-picker, which drags a browser-only
// emoji-picker-element import path that vitest/happy-dom can't resolve -
// stub it at the module level so its script never runs.
vi.mock('@/components/input/Reactions.vue', () => ({
	default: {name: 'Reactions', template: '<div />'},
}))

import TaskDetailView from './TaskDetailView.vue'
import {useAuthStore} from '@/stores/auth'

const i18n = createI18n({legacy: false, locale: 'en', messages: {en}})

function taskFixture(maxPermission: number) {
	return {
		id: 1,
		title: 'Test task',
		projectId: 1,
		maxPermission,
		labels: [],
		assignees: [],
		reminders: [],
		attachments: [],
		relatedTasks: {},
		reactions: {},
		comments: [],
		repeatAfter: {amount: 0, type: 'days'},
		repeatMode: 0,
		percentDone: 0,
		estimatedDuration: 0,
		dueDate: null,
		startDate: null,
		endDate: null,
		deadline: null,
		hexColor: '',
		done: false,
		isFavorite: false,
		subscription: null,
		isUnread: false,
	}
}

async function mountTaskDetail(maxPermission: number) {
	getMock.mockResolvedValue(taskFixture(maxPermission))

	const router = createRouter({
		history: createMemoryHistory(),
		routes: [
			{path: '/', name: 'home', component: {render: () => null}},
			{path: '/projects/:projectId', name: 'project.index', component: {render: () => null}},
			{path: '/tasks/:id', name: 'task.detail', component: {render: () => null}},
			{path: '/not-found', name: 'not-found', component: {render: () => null}},
		],
	})
	await router.push('/')
	await router.isReady()

	const Harness = defineComponent({
		setup() {
			return () => h(TaskDetailView, {taskId: 1})
		},
	})

	const wrapper = mount(Harness, {
		global: {
			plugins: [router, i18n],
			stubs: {
				Heading: true,
				TaskTitleField: true,
				BucketSelect: true,
				ChecklistSummary: true,
				TaskPropertyChips: true,
				Description: true,
				Reactions: true,
				Attachments: true,
				RelatedTasks: true,
				Comments: true,
				TaskTimeTracking: true,
				CreatedUpdated: true,
				Dropdown: true,
				DropdownItem: true,
				TaskSubscription: true,
				Modal: true,
			},
		},
	})

	await flushPromises()
	await flushPromises()

	return wrapper
}

describe('TaskDetailView field-open shortcut buttons (F-C)', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		useAuthStore().setAuthenticated(true)
		getMock.mockReset()
	})

	it('does not render the hidden field-open shortcut buttons when the task is read-only', async () => {
		const wrapper = await mountTaskDetail(PERMISSIONS.READ)

		expect(wrapper.find('button[tabindex="-1"]').exists()).toBe(false)
	})

	it('renders the hidden field-open shortcut buttons when the task is writable', async () => {
		const wrapper = await mountTaskDetail(PERMISSIONS.READ_WRITE)

		expect(wrapper.findAll('button[tabindex="-1"]').length).toBeGreaterThan(0)
	})
})
