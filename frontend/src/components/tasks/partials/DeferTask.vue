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
		<flat-pickr
			v-model="dueDate"
			:class="{ disabled: saving }"
			:config="flatPickerConfig"
			:disabled="saving || undefined"
			class="input"
		/>
	</div>
</template>

<script setup lang="ts">
import {ref, computed, watch, onMounted, onBeforeUnmount} from 'vue'
import {useI18n} from 'vue-i18n'
import flatPickr from 'vue-flatpickr-component'

import {useTaskStore} from '@/stores/tasks'
import type {ITask} from '@/modelTypes/ITask'
import {useFlatpickrLanguage} from '@/helpers/useFlatpickrLanguage'
import {useTimeFormat} from '@/composables/useTimeFormat'
import {useDateOnly} from '@/composables/useDateOnly'
import {TIME_FORMAT} from '@/constants/timeFormat'
import {roundToNaturalDayBoundary} from '@/helpers/time/roundToNaturalDayBoundary'
import {createDateFromString} from '@/helpers/time/createDateFromString'

const props = defineProps<{
	modelValue: ITask,
}>()

const emit = defineEmits<{
	'update:modelValue': [value: ITask]
}>()

const {t} = useI18n({useScope: 'global'})
const {store: timeFormat} = useTimeFormat()
const {store: dateOnly} = useDateOnly()

const taskStore = useTaskStore()
const task = ref<ITask>()
// Scope the loading indicator to this widget's own save; taskStore.isLoading is
// global and would flip on any app-wide task activity.
const saving = ref(false)

// We're saving the due date separately to prevent null errors in very short periods where the task is null.
// flatpickr writes a 'Y-m-d' string back into the v-model, so this is not always a Date.
const dueDate = ref<Date | string | null>(null)
const lastValue = ref<Date | null>(null)
const changeInterval = ref<ReturnType<typeof setInterval>>()

// The only place a picker value is read: a bare `new Date('YYYY-MM-DD')` is UTC midnight,
// which is the previous evening west of UTC.
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

onMounted(() => {
	// Because we don't really have other ways of handling change since if we let flatpickr
	// change events trigger updates, it would trigger a flatpickr change event which would trigger
	// an update which would trigger a change event and so on...
	// This is either a bug in flatpickr or in the vue component of it.
	// To work around that, we're only updating if something changed and check each second and when closing the popup.
	if (changeInterval.value) {
		clearInterval(changeInterval.value)
	}

	changeInterval.value = setInterval(updateDueDate, 1000)
})

onBeforeUnmount(() => {
	if (changeInterval.value) {
		clearInterval(changeInterval.value)
	}
	updateDueDate()
})

const flatPickerConfig = computed(() => ({
	altFormat: dateOnly.value ? t('date.altFormatShort') : t('date.altFormatLong'),
	altInput: true,
	dateFormat: dateOnly.value ? 'Y-m-d' : 'Y-m-d H:i',
	enableTime: !dateOnly.value,
	time_24hr: timeFormat.value === TIME_FORMAT.HOURS_24,
	inline: true,
	locale: useFlatpickrLanguage().value,
}))

function deferDays(days: number) {
	const newDate = normalise(dueDate.value) ?? new Date()
	newDate.setDate(newDate.getDate() + days)
	dueDate.value = newDate
	updateDueDate()
}

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

	@media screen and (max-width: ($defer-task-max-width)) {
		inset-inline-start: .5rem;
		inset-inline-end: .5rem;
		max-inline-size: 100%;
		inline-size: calc(100vw - 1rem - 2rem);
	}
}

.defer-days {
	justify-content: space-between;
	display: flex;
	margin: .5rem 0;
}

:deep() {
	input.input {
		display: none;
	}

	.flatpickr-calendar {
		margin: 0 auto;
		box-shadow: none;

		@media screen and (max-width: ($defer-task-max-width)) {
			max-inline-size: 100%;
		}

		span {
			inline-size: auto !important;
		}

	}

	.flatpickr-innerContainer {
		@media screen and (max-width: ($defer-task-max-width)) {
			overflow: scroll;
		}
	}
}
</style>
