<template>
	<td v-tooltip="+date === 0 ? '' : formatDateLong(date)">
		<time :datetime="date ? formatISO(date) : undefined">
			{{ +date === 0 ? '-' : formatDisplayDate(date, dateOnly) }}
		</time>
	</td>
</template>

<script setup lang="ts">
import {formatISO, formatDateLong, formatDisplayDate} from '@/helpers/time/formatDate'

withDefaults(defineProps<{
	date?: Date
	// Only the scheduled-date columns opt in; created/updated/doneAt are activity.
	dateOnly?: boolean
}>(), {
	date: () => new Date(0),
	dateOnly: false,
})
</script>
