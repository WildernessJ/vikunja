<template>
	<div class="task-property-chips">
		<!-- Project -->
		<PropertyChip
			ref="projectChipRef"
			icon="list"
			:label="projectChipLabel"
			:is-set="true"
			:disabled="!canWrite"
			ghost-when-unset
		>
			<ProjectSearch
				:filter="p => p.id !== task.projectId"
				@update:modelValue="changeProject"
			/>
		</PropertyChip>

		<!-- Due date - Datepicker owns its own trigger + popup, so it isn't nested
		     inside another PropertyChip popup (that would need two clicks to open). -->
		<div
			class="date-chip"
			:class="{'is-unset': task.dueDate === null}"
		>
			<Datepicker
				ref="dueDateChipRef"
				v-model="task.dueDate"
				:choose-date-label="$t('task.detail.chooseDueDate')"
				:disabled="!canWrite"
				@closeOnChange="saveGeneric"
			/>
			<QacChipClear
				:show="task.dueDate !== null && canWrite"
				@clear="() => { task.dueDate = null; saveGeneric() }"
			/>
		</div>

		<!-- Start date -->
		<div
			class="date-chip"
			:class="{'is-unset': task.startDate === null}"
		>
			<Datepicker
				v-model="task.startDate"
				:choose-date-label="$t('task.detail.chooseStartDate')"
				:disabled="!canWrite"
				@closeOnChange="saveGeneric"
			/>
			<QacChipClear
				:show="task.startDate !== null && canWrite"
				@clear="() => { task.startDate = null; saveGeneric() }"
			/>
		</div>

		<!-- End date -->
		<div
			class="date-chip"
			:class="{'is-unset': task.endDate === null}"
		>
			<Datepicker
				v-model="task.endDate"
				:choose-date-label="$t('task.detail.chooseEndDate')"
				:disabled="!canWrite"
				@closeOnChange="saveGeneric"
			/>
			<QacChipClear
				:show="task.endDate !== null && canWrite"
				@clear="() => { task.endDate = null; saveGeneric() }"
			/>
		</div>

		<!-- Deadline -->
		<div
			class="date-chip"
			:class="{'is-unset': task.deadline === null}"
		>
			<Datepicker
				v-model="task.deadline"
				:choose-date-label="$t('task.detail.chooseDeadline')"
				:disabled="!canWrite"
				@closeOnChange="saveGeneric"
			/>
			<QacChipClear
				:show="task.deadline !== null && canWrite"
				@clear="() => { task.deadline = null; saveGeneric() }"
			/>
		</div>

		<!-- Priority -->
		<PropertyChip
			ref="priorityChipRef"
			:is-set="task.priority !== PRIORITIES.UNSET"
			:show-clear="task.priority !== PRIORITIES.UNSET && canWrite"
			:disabled="!canWrite"
			ghost-when-unset
			@clear="() => savePriority(PRIORITIES.UNSET)"
		>
			<template #trigger>
				<PriorityLabel
					:priority="task.priority"
					:show-all="true"
				/>
			</template>
			<PrioritySelect
				:model-value="task.priority"
				:disabled="!canWrite"
				@update:modelValue="savePriority"
			/>
		</PropertyChip>

		<!-- Labels -->
		<PropertyChip
			ref="labelsChipRef"
			icon="tags"
			:label="labelsChipLabel"
			:is-set="task.labels.length > 0"
			:disabled="!canWrite"
			ghost-when-unset
		>
			<EditLabels
				v-model="task.labels"
				:disabled="!canWrite"
				:task-id="taskId"
				:creatable="!isLinkShareAuth"
				:creation-disabled-message="isLinkShareAuth ? $t('task.label.linkShareCannotCreate') : ''"
			/>
		</PropertyChip>

		<!-- Assignees -->
		<PropertyChip
			ref="assigneesChipRef"
			icon="users"
			:label="assigneesChipLabel"
			:is-set="task.assignees.length > 0"
			:disabled="!canWrite"
			ghost-when-unset
		>
			<EditAssignees
				v-model="task.assignees"
				:project-id="task.projectId"
				:task-id="task.id"
				:disabled="!canWrite"
			/>
		</PropertyChip>

		<!-- Reminders -->
		<PropertyChip
			ref="remindersChipRef"
			:icon="['far', 'clock']"
			:label="remindersChipLabel"
			:is-set="task.reminders.length > 0"
			:disabled="!canWrite"
			has-overflow
			ghost-when-unset
		>
			<Reminders
				v-model="task.reminders"
				:default-relative-to="remindersDefaultRelativeTo"
				:disabled="!canWrite"
				@update:modelValue="saveGeneric"
			/>
		</PropertyChip>

		<!-- Repeat -->
		<PropertyChip
			icon="history"
			:label="repeatChipLabel"
			:is-set="isRepeatSet"
			:show-clear="isRepeatSet && canWrite"
			:disabled="!canWrite"
			ghost-when-unset
			@clear="removeRepeatAfter"
		>
			<RepeatAfter
				v-model="task"
				:disabled="!canWrite"
				@update:modelValue="saveGeneric"
			/>
		</PropertyChip>

		<!-- % Done -->
		<PropertyChip
			icon="percent"
			:label="percentDoneChipLabel"
			:is-set="task.percentDone > 0"
			:disabled="!canWrite"
			ghost-when-unset
		>
			<PercentDoneSelect
				:model-value="task.percentDone"
				:disabled="!canWrite"
				@update:modelValue="savePercentDone"
			/>
		</PropertyChip>

		<!-- Duration -->
		<PropertyChip
			:icon="['far', 'hourglass']"
			:label="durationChipLabel"
			:is-set="task.estimatedDuration > 0"
			:disabled="!canWrite"
			ghost-when-unset
		>
			<EditEstimatedDuration
				:model-value="task.estimatedDuration"
				:disabled="!canWrite"
				@update:modelValue="saveEstimatedDuration"
			/>
		</PropertyChip>

		<!-- Color -->
		<PropertyChip
			ref="colorChipRef"
			icon="fill-drip"
			:label="$t('task.attributes.color')"
			:is-set="taskColor !== ''"
			:disabled="!canWrite"
			ghost-when-unset
		>
			<template #trigger>
				<span
					v-if="taskColor !== ''"
					class="color-chip-swatch"
					:style="{backgroundColor: taskColor}"
				/>
				<span
					v-else
					class="icon is-small"
				><Icon icon="fill-drip" /></span>
				{{ $t('task.attributes.color') }}
			</template>
			<ColorPicker
				v-model="taskColor"
				menu-position="bottom"
				@update:modelValue="saveGeneric"
			/>
		</PropertyChip>
	</div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue'
import {useI18n} from 'vue-i18n'

import type {ITask} from '@/modelTypes/ITask'
import type {IProject} from '@/modelTypes/IProject'

import {PRIORITIES} from '@/constants/priorities'
import {TASK_REPEAT_MODES} from '@/types/IRepeatMode'
import type {IReminderPeriodRelativeTo} from '@/types/IReminderPeriodRelativeTo'
import type {IRepeatAfter} from '@/types/IRepeatAfter'

import Datepicker from '@/components/input/Datepicker.vue'
import ColorPicker from '@/components/input/ColorPicker.vue'
import PropertyChip from '@/components/tasks/partials/PropertyChip.vue'
import QacChipClear from '@/components/tasks/partials/QacChipClear.vue'
import ProjectSearch from '@/components/tasks/partials/ProjectSearch.vue'
import EditLabels from '@/components/tasks/partials/EditLabels.vue'
import EditAssignees from '@/components/tasks/partials/EditAssignees.vue'
import PrioritySelect from '@/components/tasks/partials/PrioritySelect.vue'
import PriorityLabel from '@/components/tasks/partials/PriorityLabel.vue'
import Reminders from '@/components/tasks/partials/Reminders.vue'
import RepeatAfter from '@/components/tasks/partials/RepeatAfter.vue'
import PercentDoneSelect from '@/components/tasks/partials/PercentDoneSelect.vue'
import EditEstimatedDuration from '@/components/tasks/partials/EditEstimatedDuration.vue'

import {getProjectTitle} from '@/helpers/getProjectTitle'
import {getDisplayName} from '@/models/user'
import {formatDuration} from '@/helpers/time/duration'
import {useProjectStore} from '@/stores/projects'

const {
	canWrite,
	taskId,
	isLinkShareAuth,
	remindersDefaultRelativeTo,
	savePriority,
	savePercentDone,
	saveEstimatedDuration,
	// Used after edits to widgets that mutate `task` directly (dates, labels,
	// assignees, reminders, repeat, color) - mirrors saveTask() in the parent.
	saveGeneric,
	changeProject,
	removeRepeatAfter,
} = defineProps<{
	canWrite: boolean,
	taskId: number,
	isLinkShareAuth: boolean,
	remindersDefaultRelativeTo: IReminderPeriodRelativeTo | null,
	savePriority: (priority: number) => Promise<void>,
	savePercentDone: (percentDone: number) => Promise<void>,
	saveEstimatedDuration: (estimatedDuration: number) => Promise<void>,
	saveGeneric: () => Promise<void>,
	changeProject: (project: IProject | null, title?: string) => Promise<void>,
	removeRepeatAfter: () => Promise<void>,
}>()
const task = defineModel<ITask>('task', {required: true})
const taskColor = defineModel<string>('taskColor', {required: true})

const {t} = useI18n({useScope: 'global'})
const projectStore = useProjectStore()

const projectChipRef = ref<InstanceType<typeof PropertyChip> | null>(null)
const dueDateChipRef = ref<InstanceType<typeof Datepicker> | null>(null)
const priorityChipRef = ref<InstanceType<typeof PropertyChip> | null>(null)
const labelsChipRef = ref<InstanceType<typeof PropertyChip> | null>(null)
const assigneesChipRef = ref<InstanceType<typeof PropertyChip> | null>(null)
const remindersChipRef = ref<InstanceType<typeof PropertyChip> | null>(null)
const colorChipRef = ref<InstanceType<typeof PropertyChip> | null>(null)

// Only the chips the field-open shortcuts (KeyL, KeyP, ...) actually target -
// see the hidden shortcut buttons in TaskDetailView.vue.
const chipRefs = {
	project: projectChipRef,
	dueDate: dueDateChipRef,
	priority: priorityChipRef,
	labels: labelsChipRef,
	assignees: assigneesChipRef,
	reminders: remindersChipRef,
	color: colorChipRef,
}

defineExpose({
	openChip(key: keyof typeof chipRefs) {
		chipRefs[key].value?.open()
	},
})

const projectChipLabel = computed(() => {
	const project = projectStore.projects[task.value.projectId]
	return project ? getProjectTitle(project) : t('task.detail.actions.moveProject')
})

const labelsChipLabel = computed(() => {
	if (task.value.labels.length === 0) {
		return t('task.attributes.labels')
	}
	return task.value.labels.map(l => l.title).join(', ')
})

const assigneesChipLabel = computed(() => {
	if (task.value.assignees.length === 0) {
		return t('task.attributes.assignees')
	}
	return task.value.assignees.map(a => getDisplayName(a)).join(', ')
})

const remindersChipLabel = computed(() => {
	if (task.value.reminders.length === 0) {
		return t('task.attributes.reminders')
	}
	return t('task.quickAdd.remindersChipCount', task.value.reminders.length)
})

const isRepeatSet = computed(() => (
	(task.value.repeatAfter as IRepeatAfter).amount > 0 ||
	task.value.repeatMode !== TASK_REPEAT_MODES.REPEAT_MODE_DEFAULT
))

// Repeat has 4 modes (legacy interval, monthly, from-current-date, RRULE) with
// different underlying shapes; rather than re-deriving each one's summary text
// here (RepeatAfter already renders the full picker in the popup), the chip
// just shows a static label and relies on ghost/fill state for at-a-glance status.
const repeatChipLabel = computed(() => t('task.attributes.repeat'))

const percentDoneChipLabel = computed(() => (
	task.value.percentDone > 0
		? `${Math.round(task.value.percentDone * 100)}%`
		: t('task.attributes.percentDone')
))

const durationChipLabel = computed(() => (
	task.value.estimatedDuration > 0
		? formatDuration(task.value.estimatedDuration)
		: t('task.attributes.estimatedDuration')
))

</script>

<style lang="scss" scoped>
.task-property-chips {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: .5rem;
	margin-block: .5rem;
}

.date-chip {
	position: relative;
	display: flex;
	align-items: center;

	&.is-unset :deep(.show) {
		border: 1px dashed var(--grey-300);
		border-radius: $radius;
		color: var(--grey-400);
	}
}

.color-chip-swatch {
	display: inline-block;
	inline-size: .9rem;
	block-size: .9rem;
	border-radius: 50%;
	border: 1px solid var(--grey-300);
}
</style>
