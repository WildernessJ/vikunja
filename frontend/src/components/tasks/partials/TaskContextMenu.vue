<template>
	<Teleport to="body">
		<div
			v-if="open"
			ref="menuRef"
			class="task-context-menu dropdown-menu"
			role="menu"
			:style="menuStyle"
		>
			<div class="dropdown-content">
				<DropdownItem
					icon="check"
					@click="onToggleDone"
				>
					{{ task.done ? $t('task.contextMenu.markUndone') : $t('task.contextMenu.complete') }}
				</DropdownItem>

				<div class="context-menu-section">
					<DropdownItem
						icon="exclamation"
						@click.stop="toggleSection('priority')"
					>
						<span class="context-menu-item-label">
							{{ $t('task.contextMenu.priority') }}
							<Icon
								icon="angle-right"
								class="context-menu-caret"
							/>
						</span>
					</DropdownItem>
					<div
						v-if="activeSection === 'priority'"
						class="flyout-panel"
						@click.stop
					>
						<button
							v-for="level in priorityLevels"
							:key="level.value"
							type="button"
							class="flyout-option"
							:class="{'is-active': task.priority === level.value}"
							@click="selectPriority(level.value)"
						>
							<span>{{ $t(level.labelKey) }}</span>
							<Icon
								v-if="task.priority === level.value"
								icon="check"
							/>
						</button>
					</div>
				</div>

				<div class="context-menu-section">
					<DropdownItem
						icon="calendar"
						@click.stop="toggleSection('dueDate')"
					>
						<span class="context-menu-item-label">
							{{ $t('task.contextMenu.dueDate') }}
							<Icon
								icon="angle-right"
								class="context-menu-caret"
							/>
						</span>
					</DropdownItem>
					<div
						v-if="activeSection === 'dueDate'"
						class="flyout-panel"
						@click.stop
					>
						<button
							type="button"
							class="flyout-option"
							@click="selectDueDateInterval('today')"
						>
							{{ $t('task.contextMenu.dueToday') }}
						</button>
						<button
							type="button"
							class="flyout-option"
							@click="selectDueDateInterval('tomorrow')"
						>
							{{ $t('task.contextMenu.dueTomorrow') }}
						</button>
						<button
							type="button"
							class="flyout-option"
							@click="selectDueDateInterval('nextWeek')"
						>
							{{ $t('task.contextMenu.dueNextWeek') }}
						</button>
						<button
							type="button"
							class="flyout-option"
							@click="selectDueDate(null)"
						>
							{{ $t('task.contextMenu.dueNoDate') }}
						</button>
						<button
							type="button"
							class="flyout-option"
							@click.stop="showDatePicker = !showDatePicker"
						>
							{{ $t('task.contextMenu.pickDate') }}
						</button>
						<div
							v-if="showDatePicker"
							class="flyout-datepicker"
							@click.stop
						>
							<DatepickerInline
								:model-value="task.dueDate"
								:show-shortcuts="false"
								@update:modelValue="pickDueDate"
							/>
						</div>
					</div>
				</div>

				<div class="context-menu-section">
					<DropdownItem
						icon="list"
						@click.stop="toggleSection('project')"
					>
						{{ $t('task.contextMenu.moveProject') }}
					</DropdownItem>
					<div
						v-if="activeSection === 'project'"
						class="popover-panel"
						@click.stop
					>
						<ProjectSearch
							:filter="(project: IProject) => project.id !== task.projectId"
							@update:modelValue="selectProject"
						/>
					</div>
				</div>

				<div class="context-menu-section">
					<DropdownItem
						icon="tags"
						@click.stop="toggleSection('labels')"
					>
						{{ $t('task.contextMenu.labels') }}
					</DropdownItem>
					<div
						v-if="activeSection === 'labels'"
						class="popover-panel"
						@click.stop
					>
						<EditLabels
							:model-value="task.labels"
							:task-id="task.id"
							@update:modelValue="onLabelsUpdated"
						/>
					</div>
				</div>

				<div class="context-menu-section">
					<DropdownItem
						icon="user"
						@click.stop="toggleSection('assignees')"
					>
						{{ $t('task.contextMenu.assignees') }}
					</DropdownItem>
					<div
						v-if="activeSection === 'assignees'"
						class="popover-panel"
						@click.stop
					>
						<EditAssignees
							:model-value="task.assignees"
							:task-id="task.id"
							:project-id="task.projectId"
							@update:modelValue="onAssigneesUpdated"
						/>
					</div>
				</div>

				<hr class="dropdown-divider">

				<DropdownItem
					icon="trash-alt"
					class="has-text-danger"
					@click="showDeleteModal = true"
				>
					{{ $t('task.contextMenu.delete') }}
				</DropdownItem>
			</div>
		</div>
	</Teleport>

	<Modal
		:enabled="showDeleteModal"
		@close="showDeleteModal = false"
		@submit="confirmDelete"
	>
		<template #header>
			<span>{{ $t('task.detail.delete.header') }}</span>
		</template>

		<template #text>
			<p>{{ $t('task.detail.delete.text1') }}</p>
			<p>{{ $t('task.detail.delete.text2') }}</p>
		</template>
	</Modal>
</template>

<script setup lang="ts">
import {ref, nextTick, watch, onBeforeUnmount} from 'vue'
import {onClickOutside} from '@vueuse/core'
import {computePosition, offset, flip, shift, type VirtualElement} from '@floating-ui/dom'

import DropdownItem from '@/components/misc/DropdownItem.vue'
import Icon from '@/components/misc/Icon'
import Modal from '@/components/misc/Modal.vue'
import DatepickerInline from '@/components/input/DatepickerInline.vue'
import ProjectSearch from '@/components/tasks/partials/ProjectSearch.vue'
import EditLabels from '@/components/tasks/partials/EditLabels.vue'
import EditAssignees from '@/components/tasks/partials/EditAssignees.vue'

import {PRIORITIES, type Priority} from '@/constants/priorities'
import {calculateDayInterval} from '@/helpers/time/calculateDayInterval'
import {calculateNearestHours} from '@/helpers/time/calculateNearestHours'
import {useTaskStore} from '@/stores/tasks'

import type {ITask} from '@/modelTypes/ITask'
import type {ILabel} from '@/modelTypes/ILabel'
import type {IUser} from '@/modelTypes/IUser'
import type {IProject} from '@/modelTypes/IProject'

const props = defineProps<{
	task: ITask
	open: boolean
	position: {x: number, y: number}
}>()

const emit = defineEmits<{
	'update:open': [open: boolean]
	'taskUpdated': [task: ITask]
	'complete': []
	'deleted': [task: ITask]
}>()

const taskStore = useTaskStore()

type ContextMenuSection = 'priority' | 'dueDate' | 'project' | 'labels' | 'assignees' | null

const activeSection = ref<ContextMenuSection>(null)
const showDatePicker = ref(false)
const showDeleteModal = ref(false)
const menuRef = ref<HTMLElement>()
const menuStyle = ref({left: '0px', top: '0px'})

const priorityLevels: {value: Priority, labelKey: string}[] = [
	{value: PRIORITIES.DO_NOW, labelKey: 'task.priority.doNow'},
	{value: PRIORITIES.URGENT, labelKey: 'task.priority.urgent'},
	{value: PRIORITIES.HIGH, labelKey: 'task.priority.high'},
	{value: PRIORITIES.MEDIUM, labelKey: 'task.priority.medium'},
	{value: PRIORITIES.LOW, labelKey: 'task.priority.low'},
	{value: PRIORITIES.UNSET, labelKey: 'task.priority.unset'},
]

function toggleSection(section: ContextMenuSection) {
	activeSection.value = activeSection.value === section ? null : section
	showDatePicker.value = false
}

async function updatePosition() {
	await nextTick()
	if (!menuRef.value) {
		return
	}

	const reference: VirtualElement = {
		getBoundingClientRect: () => ({
			x: props.position.x,
			y: props.position.y,
			width: 0,
			height: 0,
			top: props.position.y,
			left: props.position.x,
			right: props.position.x,
			bottom: props.position.y,
		}),
	}

	const {x, y} = await computePosition(reference, menuRef.value, {
		placement: 'bottom-start',
		strategy: 'fixed',
		middleware: [offset(4), flip(), shift({padding: 8})],
	})

	menuStyle.value = {left: `${x}px`, top: `${y}px`}
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === 'Escape') {
		close()
	}
}

watch(() => props.open, (isOpen) => {
	activeSection.value = null
	showDatePicker.value = false
	if (isOpen) {
		showDeleteModal.value = false
		updatePosition()
		window.addEventListener('keydown', handleKeydown)
	} else {
		window.removeEventListener('keydown', handleKeydown)
	}
}, {immediate: true})

watch(() => props.position, () => {
	if (props.open) {
		updatePosition()
	}
})

onBeforeUnmount(() => {
	window.removeEventListener('keydown', handleKeydown)
})

onClickOutside(menuRef, () => {
	if (props.open) {
		close()
	}
})

function close() {
	activeSection.value = null
	showDatePicker.value = false
	emit('update:open', false)
}

function onToggleDone() {
	emit('complete')
	close()
}

async function selectPriority(priority: Priority) {
	const updated = await taskStore.update({...props.task, priority})
	emit('taskUpdated', updated)
	close()
}

function dueDateForInterval(intervalKey: string): Date {
	const interval = calculateDayInterval(intervalKey)
	const date = new Date()
	date.setDate(date.getDate() + interval)
	date.setHours(calculateNearestHours(date))
	date.setMinutes(0)
	date.setSeconds(0)
	return date
}

function selectDueDateInterval(intervalKey: string) {
	selectDueDate(dueDateForInterval(intervalKey))
}

async function selectDueDate(date: Date | null) {
	const updated = await taskStore.update({...props.task, dueDate: date})
	emit('taskUpdated', updated)
	close()
}

// The inline picker emits on every calendar/time change, so it persists without
// closing the menu — letting the user set a specific time before dismissing by
// clicking away. The quick options above commit-and-close via selectDueDate.
async function pickDueDate(date: Date | null) {
	const updated = await taskStore.update({...props.task, dueDate: date})
	emit('taskUpdated', updated)
}

async function selectProject(project: IProject | null) {
	if (project === null) {
		return
	}
	const updated = await taskStore.update({...props.task, projectId: project.id})
	emit('taskUpdated', updated)
	close()
}

function onLabelsUpdated(labels: ILabel[]) {
	emit('taskUpdated', {...props.task, labels})
}

function onAssigneesUpdated(assignees: IUser[] | undefined) {
	emit('taskUpdated', {...props.task, assignees: assignees ?? []})
}

async function confirmDelete() {
	await taskStore.delete(props.task)
	emit('deleted', props.task)
	showDeleteModal.value = false
	close()
}
</script>

<style lang="scss" scoped>
.task-context-menu {
	position: fixed;
	z-index: 100;
	min-inline-size: 14rem;
}

.dropdown-content {
	background-color: var(--scheme-main);
	border-radius: $radius;
	padding-block: .5rem;
	box-shadow: var(--shadow-md);
}

.dropdown-divider {
	background-color: var(--border-light);
	border: none;
	display: block;
	block-size: 1px;
	margin: .5rem 0;
}

.context-menu-section {
	position: relative;
}

.context-menu-item-label {
	display: flex;
	align-items: center;
	justify-content: space-between;
	inline-size: 100%;
}

.context-menu-caret {
	color: var(--grey-300);
}

.flyout-panel,
.popover-panel {
	position: absolute;
	inset-inline-start: 100%;
	inset-block-start: 0;
	z-index: 1;
	background-color: var(--scheme-main);
	border-radius: $radius;
	box-shadow: var(--shadow-md);
}

.flyout-panel {
	min-inline-size: 10rem;
	padding-block: .5rem;
}

.popover-panel {
	min-inline-size: 18rem;
	padding: .75rem;
}

.flyout-option {
	display: flex;
	align-items: center;
	justify-content: space-between;
	inline-size: 100%;
	padding: $item-padding;
	// Reset the UA <button> chrome — without this the native light background
	// shows through and makes light-on-light text unreadable in dark mode.
	background: transparent;
	border: none;
	cursor: pointer;
	color: var(--text);
	font-size: .875rem;
	text-align: start;
	white-space: nowrap;

	&:hover {
		background-color: var(--grey-100);
	}

	&.is-active {
		color: var(--link);
	}
}

.flyout-datepicker {
	padding: .5rem;
	border-block-start: 1px solid var(--border-light);
}
</style>
