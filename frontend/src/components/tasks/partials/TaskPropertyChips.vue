<template>
	<div class="task-property-chips">
		<!-- Project -->
		<PropertyChip
			data-chip="project"
			ref="projectChipRef"
			icon="list"
			:label="projectChipLabel"
			:is-set="true"
			:disabled="!canWrite"
			ghost-when-unset
		>
			<ProjectSearch
				:filter="p => p.id !== task.project_id"
				@update:modelValue="changeProject"
			/>
		</PropertyChip>

		<!-- Due date - Datepicker owns its own trigger + popup, so it isn't nested
		     inside another PropertyChip popup (that would need two clicks to open). -->
		<div
			data-chip="due"
			class="date-chip"
			:class="{'is-unset': dueDateModel === null}"
		>
			<Datepicker
				ref="dueDateChipRef"
				v-model="dueDateModel"
				:choose-date-label="$t('task.detail.chooseDueDate')"
				:disabled="!canWrite"
				@closeOnChange="saveGeneric()"
			/>
			<QacChipClear
				:show="dueDateModel !== null && canWrite"
				@clear="() => { task.due_date = ''; saveGeneric() }"
			/>
		</div>

		<!-- Start date -->
		<div
			data-chip="start"
			class="date-chip"
			:class="{'is-unset': startDateModel === null}"
		>
			<Datepicker
				v-model="startDateModel"
				boundary="start"
				:choose-date-label="$t('task.detail.chooseStartDate')"
				:disabled="!canWrite"
				@closeOnChange="saveGeneric()"
			/>
			<QacChipClear
				:show="startDateModel !== null && canWrite"
				@clear="() => { task.start_date = ''; saveGeneric() }"
			/>
		</div>

		<!-- End date -->
		<div
			data-chip="end"
			class="date-chip"
			:class="{'is-unset': endDateModel === null}"
		>
			<Datepicker
				v-model="endDateModel"
				:choose-date-label="$t('task.detail.chooseEndDate')"
				:disabled="!canWrite"
				@closeOnChange="saveGeneric()"
			/>
			<QacChipClear
				:show="endDateModel !== null && canWrite"
				@clear="() => { task.end_date = ''; saveGeneric() }"
			/>
		</div>

		<!-- Deadline -->
		<div
			data-chip="deadline"
			class="date-chip"
			:class="{'is-unset': deadlineModel === null}"
		>
			<Datepicker
				v-model="deadlineModel"
				:choose-date-label="$t('task.detail.chooseDeadline')"
				:disabled="!canWrite"
				@closeOnChange="saveGeneric()"
			/>
			<QacChipClear
				:show="deadlineModel !== null && canWrite"
				@clear="() => { task.deadline = ''; saveGeneric() }"
			/>
		</div>

		<!-- Priority -->
		<PropertyChip
			data-chip="priority"
			ref="priorityChipRef"
			:is-set="task.priority !== PRIORITIES.UNSET"
			:show-clear="task.priority !== PRIORITIES.UNSET && canWrite"
			:disabled="!canWrite"
			ghost-when-unset
			@clear="() => savePriority(PRIORITIES.UNSET)"
		>
			<template #trigger>
				<PriorityLabel
					:priority="task.priority ?? 0"
					:show-all="true"
				/>
			</template>
			<PrioritySelect
				:model-value="task.priority ?? 0"
				:disabled="!canWrite"
				@update:modelValue="savePriority"
			/>
		</PropertyChip>

		<!-- Labels -->
		<PropertyChip
			data-chip="labels"
			ref="labelsChipRef"
			icon="tags"
			:label="labelsChipLabel"
			:is-set="(task.labels?.length ?? 0) > 0"
			:disabled="!canWrite"
			ghost-when-unset
		>
			<EditLabels
				:model-value="task.labels ?? []"
				:disabled="!canWrite"
				:task-id="taskId"
				:creatable="!isLinkShareAuth"
				:creation-disabled-message="isLinkShareAuth ? $t('task.label.linkShareCannotCreate') : ''"
				@update:modelValue="labels => task = {...task, labels}"
			/>
		</PropertyChip>

		<!-- Assignees -->
		<PropertyChip
			data-chip="assignees"
			ref="assigneesChipRef"
			icon="users"
			:label="assigneesChipLabel"
			:is-set="(task.assignees?.length ?? 0) > 0"
			:disabled="!canWrite"
			ghost-when-unset
		>
			<EditAssignees
				:model-value="task.assignees ?? []"
				:project-id="task.project_id ?? 0"
				:task-id="task.id ?? 0"
				:disabled="!canWrite"
				@update:modelValue="assignees => task = {...task, assignees: assignees ?? []}"
			/>
		</PropertyChip>

		<!-- Reminders -->
		<PropertyChip
			data-chip="reminders"
			ref="remindersChipRef"
			:icon="['far', 'clock']"
			:label="remindersChipLabel"
			:is-set="(task.reminders?.length ?? 0) > 0"
			:disabled="!canWrite"
			ghost-when-unset
		>
			<Reminders
				:model-value="task.reminders ?? []"
				:default-relative-to="remindersDefaultRelativeTo"
				:disabled="!canWrite"
				@update:modelValue="reminders => { task = {...task, reminders}; saveGeneric() }"
			/>
		</PropertyChip>

		<!-- Repeat -->
		<PropertyChip
			data-chip="repeat"
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
				@update:modelValue="saveGeneric()"
			/>
		</PropertyChip>

		<!-- % Done -->
		<PropertyChip
			data-chip="percent-done"
			icon="percent"
			:label="percentDoneChipLabel"
			:is-set="(task.percent_done ?? 0) > 0"
			:disabled="!canWrite"
			ghost-when-unset
		>
			<PercentDoneSelect
				:model-value="task.percent_done ?? 0"
				:disabled="!canWrite"
				@update:modelValue="savePercentDone"
			/>
		</PropertyChip>

		<!-- Duration -->
		<PropertyChip
			data-chip="duration"
			:icon="['far', 'hourglass']"
			:label="durationChipLabel"
			:is-set="(task.estimated_duration ?? 0) > 0"
			:disabled="!canWrite"
			ghost-when-unset
		>
			<EditEstimatedDuration
				:model-value="task.estimated_duration ?? 0"
				:disabled="!canWrite"
				@update:modelValue="saveEstimatedDuration"
			/>
		</PropertyChip>

		<!-- Color -->
		<PropertyChip
			data-chip="color"
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
				@update:modelValue="saveGeneric()"
			/>
		</PropertyChip>
	</div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue'
import {useI18n} from 'vue-i18n'

import type {Task as ITask} from '@/client/generated'
import {parseDateOrNull} from '@/helpers/parseDateOrNull'
import type {ProjectResponse} from '@/client/queries/projects'

import {PRIORITIES} from '@/constants/priorities'
import {TASK_REPEAT_MODES} from '@/types/IRepeatMode'
import type {IReminderPeriodRelativeTo} from '@/types/IReminderPeriodRelativeTo'

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
import {useProjects} from '@/composables/useProjects'

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
	changeProject: (project: ProjectResponse | null, title?: string) => Promise<void>,
	removeRepeatAfter: () => Promise<void>,
}>()
const task = defineModel<ITask>('task', {required: true})
const taskColor = defineModel<string>('taskColor', {required: true})

const {t} = useI18n({useScope: 'global'})
const projectList = useProjects()

type DateField = 'due_date' | 'start_date' | 'end_date' | 'deadline'
// The pickers work on Date objects; the task carries ISO strings, and '' clears a date.
function dateModel(field: DateField) {
	return computed({
		get: () => parseDateOrNull(task.value[field]),
		set: (date: Date | string | null) => {
			task.value[field] = parseDateOrNull(date)?.toISOString() ?? ''
		},
	})
}
const dueDateModel = dateModel('due_date')
const startDateModel = dateModel('start_date')
const endDateModel = dateModel('end_date')
const deadlineModel = dateModel('deadline')

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
	const project = projectList.projects[task.value.project_id ?? 0]
	return project ? getProjectTitle(project) : t('task.detail.actions.moveProject')
})

const labelsChipLabel = computed(() => {
	const labels = task.value.labels ?? []
	if (labels.length === 0) {
		return t('task.attributes.labels')
	}
	return labels.map(l => l.title).join(', ')
})

const assigneesChipLabel = computed(() => {
	const assignees = task.value.assignees ?? []
	if (assignees.length === 0) {
		return t('task.attributes.assignees')
	}
	return assignees.map(a => getDisplayName(a)).join(', ')
})

const remindersChipLabel = computed(() => {
	const count = task.value.reminders?.length ?? 0
	if (count === 0) {
		return t('task.attributes.reminders')
	}
	return t('task.quickAdd.remindersChipCount', count)
})

const isRepeatSet = computed(() => (
	(task.value.repeat_after ?? 0) > 0 ||
	(task.value.repeat_mode ?? TASK_REPEAT_MODES.REPEAT_MODE_DEFAULT) !== TASK_REPEAT_MODES.REPEAT_MODE_DEFAULT
))

// Repeat has 4 modes (legacy interval, monthly, from-current-date, RRULE) with
// different underlying shapes; rather than re-deriving each one's summary text
// here (RepeatAfter already renders the full picker in the popup), the chip
// just shows a static label and relies on ghost/fill state for at-a-glance status.
const repeatChipLabel = computed(() => t('task.attributes.repeat'))

const percentDoneChipLabel = computed(() => (
	(task.value.percent_done ?? 0) > 0
		? `${Math.round((task.value.percent_done ?? 0) * 100)}%`
		: t('task.attributes.percentDone')
))

const durationChipLabel = computed(() => (
	(task.value.estimated_duration ?? 0) > 0
		? formatDuration(task.value.estimated_duration ?? 0)
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
