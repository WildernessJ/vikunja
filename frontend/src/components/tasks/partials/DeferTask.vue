<template>
	<div
		:class="{ 'is-loading': saving }"
		class="defer-task loading-container"
		@click.stop
		@mousedown.stop
		@pointerdown.stop
		@touchstart.stop
	>
		<label class="label">{{ $t('task.deferDueDate.title') }}</label>
		<div class="defer-days">
			<XButton
				:shadow="false"
				variant="secondary"
				@click.prevent.stop="() => deferDays(1)"
			>
				{{ $t('task.deferDueDate.1day') }}
			</XButton>
			<XButton
				:shadow="false"
				variant="secondary"
				@click.prevent.stop="() => deferDays(3)"
			>
				{{ $t('task.deferDueDate.3days') }}
			</XButton>
			<XButton
				:shadow="false"
				variant="secondary"
				@click.prevent.stop="() => deferDays(7)"
			>
				{{ $t('task.deferDueDate.1week') }}
			</XButton>
		</div>
		<DatepickerInline
			v-model="dueDate"
			:show-shortcuts="false"
			@update:modelValue="onPickerUpdate"
		/>
	</div>
</template>

<script setup lang="ts">
import {ref, watch, onBeforeUnmount} from 'vue'
import {useDebounceFn} from '@vueuse/core'

import DatepickerInline from '@/components/input/DatepickerInline.vue'

import {useTaskStore} from '@/stores/tasks'
import type {ITask} from '@/modelTypes/ITask'
import {useDateOnly} from '@/composables/useDateOnly'
import {roundToNaturalDayBoundary} from '@/helpers/time/roundToNaturalDayBoundary'
import {createDateFromString} from '@/helpers/time/createDateFromString'

const props = defineProps<{
	modelValue: ITask,
}>()

const emit = defineEmits<{
	'update:modelValue': [value: ITask]
}>()

const {store: dateOnly} = useDateOnly()

const taskStore = useTaskStore()
const task = ref<ITask>()
// Scope the loading indicator to this widget's own save; taskStore.isLoading is
// global and would flip on any app-wide task activity.
const saving = ref(false)

// We're saving the due date separately to prevent null errors in very short periods where the task is null.
const dueDate = ref<Date | null>(null)
const lastValue = ref<Date | null>(null)

// Deferring a date-only due date keeps it on the end-of-day boundary.
function normalise(value: Date | string | null | undefined): Date | null {
	if (!value) {
		return null
	}

	const date = new Date(createDateFromString(value))
	return dateOnly.value ? roundToNaturalDayBoundary(date, false, true) : date
}

watch(
	() => props.modelValue,
	(value) => {
		task.value = { ...value }
		dueDate.value = value.dueDate
		lastValue.value = normalise(value.dueDate)
	},
	{immediate: true},
)

function deferDays(days: number) {
	debouncedUpdateDueDate.cancel()
	const deferred = normalise(dueDate.value) ?? new Date()
	deferred.setDate(deferred.getDate() + days)
	dueDate.value = deferred
	updateDueDate()
}

const debouncedUpdateDueDate = useDebounceFn(updateDueDate, 500)

function onPickerUpdate() {
	debouncedUpdateDueDate()
}

onBeforeUnmount(() => debouncedUpdateDueDate.flush())

async function updateDueDate() {
	const next = normalise(dueDate.value)
	if (next === null || !task.value) {
		return
	}

	if (lastValue.value && +next === +lastValue.value) {
		return
	}

	saving.value = true
	try {
		const newTask = await taskStore.update({
			...task.value,
			dueDate: next,
		})
		lastValue.value = normalise(newTask.dueDate)
		task.value = newTask
		emit('update:modelValue', newTask)
	} finally {
		saving.value = false
	}
}
</script>

<style lang="scss" scoped>
// 100px is roughly the size the pane is pulled to the right
$defer-task-max-width: 350px + 100px;

.defer-task {
	inline-size: 100%;
	max-inline-size: $defer-task-max-width;

	.bottom-sheet & {
		max-inline-size: none;
		padding: 0 1rem 1rem;

		> .label {
			display: none;
		}
	}
}

.defer-days {
	justify-content: space-between;
	display: flex;
	gap: .5rem;
	margin: .5rem 0;

	.bottom-sheet & {
		margin-block-start: 0;

		> * {
			flex: 1;
		}
	}
}
</style>
