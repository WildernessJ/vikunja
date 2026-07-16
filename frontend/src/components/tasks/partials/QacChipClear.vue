<template>
	<BaseButton
		v-if="show"
		class="qac-chip-clear"
		:aria-label="$t('task.quickAdd.clearChip')"
		@click.stop="$emit('clear')"
	>
		<Icon icon="xmark" />
	</BaseButton>
</template>

<script setup lang="ts">
import BaseButton from '@/components/base/BaseButton.vue'

defineProps<{
	show: boolean,
}>()

defineEmits<{
	clear: [],
}>()
</script>
