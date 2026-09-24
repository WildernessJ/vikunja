<template>
	<td v-tooltip="!dateIsValid(date) ? '' : formatDateLong(date, dateOnly)">
		<time :datetime="date ? formatISO(date) : undefined">
			{{ !dateIsValid(date) ? '-' : formatDisplayDate(date, dateOnly) }}
		</time>
	</td>
</template>

<script setup lang="ts">
import {dateIsValid, formatISO, formatDateLong, formatDisplayDate} from '@/helpers/time/formatDate'

withDefaults(defineProps<{
	date?: Date | string
	// Only the scheduled-date columns opt in; created/updated/doneAt are activity.
	dateOnly?: boolean
}>(), {
	date: '',
	dateOnly: false,
})
</script>
