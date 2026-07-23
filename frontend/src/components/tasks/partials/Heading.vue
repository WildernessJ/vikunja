<template>
	<div class="heading">
		<div class="tw:flex tw:items-center md:tw:items-stretch tw:flex-col tw:gap-1 task-properties">
			<div class="tw:flex tw:items-center tw:gap-2">
				<ColorBubble
					v-if="task.hexColor !== ''"
					:color="getHexColor(task.hexColor) ?? ''"
				/>
				<BaseButton @click="copyUrl">
					<span class="title task-id">
						{{ textIdentifier }}
					</span>
				</BaseButton>
			</div>
			<Done
				:is-done="task.done"
			/>
			<BaseButton
				v-if="hasClose"
				:aria-label="$t('task.detail.closeTaskDetail')"
				class="close d-print-none"
				@click="$emit('close')"
			>
				<Icon icon="times" />
			</BaseButton>
		</div>
		<BaseButton
			v-if="hasClose"
			:aria-label="$t('task.detail.closeTaskDetail')"
			class="close d-print-none"
			@click="$emit('close')"
		>
			<Icon icon="times" />
		</BaseButton>
	</div>
</template>

<script setup lang="ts">
import {computed} from 'vue'
import {useRouter} from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import ColorBubble from '@/components/misc/ColorBubble.vue'
import Done from '@/components/misc/Done.vue'

import {useCopyToClipboard} from '@/composables/useCopyToClipboard'

import type {ITask} from '@/modelTypes/ITask'
import {getHexColor, getTaskIdentifier} from '@/models/task'

const props = defineProps<{
	task: ITask,
	hasClose: boolean,
}>()

defineEmits<{
	'close': [],
}>()

const router = useRouter()
const copy = useCopyToClipboard()

async function copyUrl() {
	const route = router.resolve({name: 'task.detail', query: {taskId: props.task.id}})
	const absoluteURL = new URL(route.href, window.location.href).href

	await copy(absoluteURL)
}

const textIdentifier = computed(() => getTaskIdentifier(props.task))
</script>

<style lang="scss" scoped>
.heading {
	display: flex;
	justify-content: flex-start;
	text-transform: none;
	align-items: center;

	@media screen and (max-width: $tablet) {
		flex-direction: column;
		align-items: start;
	}
}

.title {
	margin-block-end: 0;
}

.title.input {
	// 1.8rem is the font-size, 1.125 is the line-height, .3rem padding everywhere, 1px border around the whole thing.
	min-block-size: calc(1.8rem * 1.125 + .6rem + 2px);
	margin-inline-end: 0;

	@media screen and (max-width: $tablet) {
		margin: 0 -.3rem .5rem; // the title has 0.3rem padding - this make the text inside of it align with the rest
	}
}

.title.task-id {
	color: var(--grey-400);
	white-space: nowrap;
}

.color-bubble {
	block-size: .75rem;
	inline-size: .75rem;
}

.close {
	font-size: 2rem;
	margin-inline-start: 0.5rem;
	line-height: 1;

	@media screen and (max-width: $tablet) {
		display: none;
	}
	
	@media screen and (min-width: #{$desktop + 1px}) {
		display: none;
	}
}

.task-properties .close {
	display: none;
	position: absolute;
	inset-inline-end: 1.25rem;
	inset-block-start: 1.1rem;

	@media screen and (max-width: $tablet) {
		display: block;
	}
}

.task-properties {
	@media screen and (max-width: $tablet) {
		flex-direction: row;
	}
}
</style>
