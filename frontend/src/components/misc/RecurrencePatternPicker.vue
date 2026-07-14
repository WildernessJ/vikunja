<template>
	<div class="recurrence-pattern-picker">
		<div class="is-flex is-align-items-center mbe-2">
			<label
				:for="`${idPrefix}-freq`"
				class="is-fullwidth"
			>
				{{ $t('task.repeat.mode') }}:
			</label>
			<div class="control">
				<div class="select">
					<select
						:id="`${idPrefix}-freq`"
						v-model="freq"
						:disabled="disabled || undefined"
						@change="emitPattern"
					>
						<option value="weekly">
							{{ $t('task.repeat.weekly') }}
						</option>
						<option value="monthly">
							{{ $t('task.repeat.monthly') }}
						</option>
					</select>
				</div>
			</div>
		</div>

		<div class="is-flex is-align-items-center mbe-2">
			<label
				:for="`${idPrefix}-interval`"
				class="is-fullwidth"
			>
				{{ $t('task.repeat.repeatEvery') }}:
			</label>
			<input
				:id="`${idPrefix}-interval`"
				v-model.number="interval"
				type="number"
				class="input is-inline-number"
				min="1"
				step="1"
				:disabled="disabled || undefined"
				@change="emitPattern"
			>
			<span class="mis-2">
				{{ freq === 'weekly' ? $t('task.repeat.unitWeeks') : $t('task.repeat.unitMonths') }}
			</span>
		</div>

		<div
			v-if="freq === 'weekly'"
			class="weekday-picker mbe-2"
		>
			<label
				v-for="day in WEEKDAY_ORDER"
				:key="day"
				class="weekday-option"
				:class="{'is-checked': weekdays.includes(day)}"
			>
				<input
					type="checkbox"
					:value="day"
					:checked="weekdays.includes(day)"
					:disabled="disabled || undefined"
					@change="toggleWeekday(day)"
				>
				{{ $t(`task.repeat.weekdayShort.${day.toLowerCase()}`) }}
			</label>
		</div>

		<div
			v-else
			class="monthly-picker mbe-2"
		>
			<div class="control mbe-2">
				<label class="radio">
					<input
						v-model="monthlyMode"
						type="radio"
						value="dayOfMonth"
						:disabled="disabled || undefined"
						@change="emitPattern"
					>
					{{ $t('task.repeat.onDayOfMonth') }}
				</label>
				<input
					v-model.number="monthDay"
					type="number"
					class="input is-inline-number"
					min="1"
					max="31"
					:disabled="disabled || monthlyMode !== 'dayOfMonth' || undefined"
					@change="emitPattern"
				>
			</div>
			<div class="control mbe-2">
				<label class="radio">
					<input
						v-model="monthlyMode"
						type="radio"
						value="nthWeekday"
						:disabled="disabled || undefined"
						@change="emitPattern"
					>
					{{ $t('task.repeat.onTheNth') }}
				</label>
				<div class="select is-small">
					<select
						v-model.number="nthOrdinal"
						:disabled="disabled || monthlyMode !== 'nthWeekday' || undefined"
						@change="emitPattern"
					>
						<option
							v-for="ord in ORDINAL_OPTIONS"
							:key="ord"
							:value="ord"
						>
							{{ $t(`task.repeat.ordinal.${ord === -1 ? 'last' : ord}`) }}
						</option>
					</select>
				</div>
				<div class="select is-small">
					<select
						v-model="nthWeekday"
						:disabled="disabled || monthlyMode !== 'nthWeekday' || undefined"
						@change="emitPattern"
					>
						<option
							v-for="day in WEEKDAY_ORDER"
							:key="day"
							:value="day"
						>
							{{ $t(`task.repeat.weekdayShort.${day.toLowerCase()}`) }}
						</option>
					</select>
				</div>
			</div>
			<div class="control mbe-2">
				<label class="radio">
					<input
						v-model="monthlyMode"
						type="radio"
						value="lastDay"
						:disabled="disabled || undefined"
						@change="emitPattern"
					>
					{{ $t('task.repeat.onLastDay') }}
				</label>
			</div>
			<div class="control">
				<label class="radio">
					<input
						v-model="monthlyMode"
						type="radio"
						value="lastWorkday"
						:disabled="disabled || undefined"
						@change="emitPattern"
					>
					{{ $t('task.repeat.onLastWorkday') }}
				</label>
			</div>
		</div>

		<div class="is-flex is-align-items-center mbe-2">
			<label
				:for="`${idPrefix}-end`"
				class="is-fullwidth"
			>
				{{ $t('task.repeat.endsOn') }}:
			</label>
			<Datepicker
				:id="`${idPrefix}-end`"
				v-model="endDate"
				:disabled="disabled"
				:empty-label="$t('task.repeat.noEndDate')"
				@update:modelValue="emitPattern"
				@close="emitPattern"
			/>
		</div>

		<p
			v-if="summary !== ''"
			class="pattern-summary"
		>
			{{ $t('task.repeat.patternSummary', {summary}) }}
		</p>
	</div>
</template>

<script setup lang="ts">
import {ref, computed, toRef, watch} from 'vue'
import {useI18n} from 'vue-i18n'

import Datepicker from '@/components/input/Datepicker.vue'
import {buildRecurrencePatternSummary} from '@/helpers/recurrencePatternSummary'

const props = withDefaults(defineProps<{
	modelValue: string,
	disabled?: boolean,
	// Distinguishes label/input ids when several pickers render on one page.
	idPrefix?: string,
}>(), {
	disabled: false,
	idPrefix: 'recurrence',
})

const emit = defineEmits<{
	'update:modelValue': [value: string],
}>()

const {t} = useI18n({useScope: 'global'})

const WEEKDAY_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
const ORDINAL_OPTIONS = [1, 2, 3, 4, 5, -1] as const

type MonthlyMode = 'dayOfMonth' | 'nthWeekday' | 'lastDay' | 'lastWorkday'

const freq = ref<'weekly' | 'monthly'>('weekly')
const weekdays = ref<string[]>([])
const monthlyMode = ref<MonthlyMode>('dayOfMonth')
const interval = ref<number>(1)
const monthDay = ref<number>(1)
const nthOrdinal = ref<number>(1)
const nthWeekday = ref<string>('MO')
const endDate = ref<Date | null>(null)

function formatUntil(date: Date): string {
	const y = date.getFullYear()
	const mo = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	return `${y}${mo}${d}T000000Z`
}

function parseUntil(value: string): Date | null {
	const m = /^(\d{4})(\d{2})(\d{2})/.exec(value)
	if (m === null) {
		return null
	}
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function buildRrule(): string {
	let core = ''
	if (freq.value === 'weekly') {
		if (weekdays.value.length === 0) {
			return ''
		}
		const ordered = WEEKDAY_ORDER.filter(d => weekdays.value.includes(d))
		core = `FREQ=WEEKLY;BYDAY=${ordered.join(',')}`
	} else {
		switch (monthlyMode.value) {
			case 'dayOfMonth':
				core = `FREQ=MONTHLY;BYMONTHDAY=${monthDay.value}`
				break
			case 'nthWeekday':
				core = `FREQ=MONTHLY;BYDAY=${nthOrdinal.value}${nthWeekday.value}`
				break
			case 'lastDay':
				core = 'FREQ=MONTHLY;BYMONTHDAY=-1'
				break
			case 'lastWorkday':
				core = 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1'
				break
		}
	}

	// Guard against a non-integer (the number input allows typed decimals): a
	// fractional INTERVAL is an invalid RRULE the backend rejects.
	if (Number.isInteger(interval.value) && interval.value > 1) {
		core = core.replace(/^(FREQ=[A-Z]+)/, `$1;INTERVAL=${interval.value}`)
	}
	if (endDate.value !== null) {
		core += `;UNTIL=${formatUntil(endDate.value)}`
	}
	return core
}

// getPart pulls a single RRULE component's value (e.g. BYDAY) out of a rule string.
function getPart(rule: string, key: string): string | null {
	for (const part of rule.split(';')) {
		const [k, v] = part.split('=')
		if (k === key) {
			return v ?? null
		}
	}
	return null
}

function parseRrule(rule: string) {
	if (rule === '') {
		return
	}

	const until = getPart(rule, 'UNTIL')
	endDate.value = until !== null ? parseUntil(until) : null

	const intervalPart = getPart(rule, 'INTERVAL')
	interval.value = intervalPart !== null ? Number(intervalPart) : 1

	const freqPart = getPart(rule, 'FREQ')
	const byday = getPart(rule, 'BYDAY')
	const bymonthday = getPart(rule, 'BYMONTHDAY')
	const bysetpos = getPart(rule, 'BYSETPOS')

	if (freqPart === 'WEEKLY') {
		freq.value = 'weekly'
		weekdays.value = byday !== null ? byday.split(',') : []
		return
	}

	if (freqPart === 'MONTHLY') {
		freq.value = 'monthly'
		if (bymonthday === '-1') {
			monthlyMode.value = 'lastDay'
		} else if (bysetpos === '-1' && byday !== null) {
			monthlyMode.value = 'lastWorkday'
		} else if (byday !== null) {
			const m = /^(-?\d+)([A-Z]{2})$/.exec(byday)
			if (m !== null) {
				monthlyMode.value = 'nthWeekday'
				nthOrdinal.value = Number(m[1])
				nthWeekday.value = m[2]
			}
		} else if (bymonthday !== null) {
			monthlyMode.value = 'dayOfMonth'
			monthDay.value = Number(bymonthday.split(',')[0])
		}
	}
}

function toggleWeekday(day: string) {
	if (weekdays.value.includes(day)) {
		weekdays.value = weekdays.value.filter(d => d !== day)
	} else {
		weekdays.value = [...weekdays.value, day]
	}
	emitPattern()
}

function emitPattern() {
	emit('update:modelValue', buildRrule())
}

const modelValue = toRef(props, 'modelValue')
watch(
	modelValue,
	value => {
		// Only re-parse external changes; our own emits already match the state.
		if (value !== buildRrule()) {
			parseRrule(value)
		}
	},
	{immediate: true},
)

const summary = computed(() => buildRecurrencePatternSummary(buildRrule(), t))
</script>

<style lang="scss" scoped>
.weekday-picker {
	display: flex;
	flex-wrap: wrap;
	gap: .25rem;
}

.weekday-option {
	display: inline-flex;
	align-items: center;
	gap: .25rem;
	padding: .15rem .4rem;
	border: 1px solid var(--grey-300);
	border-radius: var(--radius);
	cursor: pointer;

	&.is-checked {
		background-color: var(--primary);
		color: var(--white);
	}
}

.is-inline-number {
	inline-size: 5rem;
	margin-inline-start: .5rem;
}

.monthly-picker .select {
	margin-inline-start: .5rem;
}

.pattern-summary {
	font-style: italic;
	color: var(--grey-500);
}
</style>
