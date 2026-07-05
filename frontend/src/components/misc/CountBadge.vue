<template>
	<span
		v-if="count > 0"
		class="count-badge"
	>
		{{ count }}
	</span>
</template>

<script setup lang="ts">
defineProps<{
	count: number,
}>()
</script>

<style lang="scss" scoped>
.count-badge {
	display: inline-block;
	min-inline-size: 1.25rem;
	padding: 0.05rem 0.4rem;
	margin-inline-start: 0.5rem;
	border-radius: 999px;
	background: var(--grey-200);
	color: var(--grey-700);
	font-size: 0.75rem;
	font-weight: 600;
	line-height: 1.1;
	text-align: center;
	vertical-align: middle;
}
</style>
