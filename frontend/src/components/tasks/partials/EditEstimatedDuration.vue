<template>
	<div class="estimated-duration-input">
		<div class="field has-addons">
			<div class="control is-expanded">
				<input
					ref="inputRef"
					v-model="inputValue"
					class="input"
					:class="{'is-danger': hasError}"
					type="text"
					inputmode="text"
					:placeholder="$t('task.detail.estimatedDurationPlaceholder')"
					:disabled="disabled || undefined"
					data-cy="taskDetail.estimatedDuration"
					@keyup.enter="commit"
					@blur="commit"
				>
			</div>
			<div class="control">
				<BaseButton
					v-if="inputValue !== '' && !disabled"
					class="button"
					data-cy="taskDetail.estimatedDurationClear"
					:aria-label="$t('misc.delete')"
					@click="clear"
				>
					<span class="icon is-small">
						<Icon icon="times" />
					</span>
				</BaseButton>
			</div>
		</div>
		<p
			v-if="hasError"
			class="help is-danger"
			data-cy="taskDetail.estimatedDurationError"
		>
			{{ $t('task.detail.estimatedDurationInvalid') }}
		</p>
	</div>
</template>

<script setup lang="ts">
import {ref, watch} from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import {parseDuration, formatDuration} from '@/helpers/time/duration'

const props = withDefaults(defineProps<{
	modelValue: number,
	disabled?: boolean,
}>(), {
	disabled: false,
})

const emit = defineEmits<{
	'update:modelValue': [value: number],
}>()

const inputValue = ref('')
const hasError = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

watch(
	() => props.modelValue,
	value => {
		inputValue.value = formatDuration(value ?? 0)
		hasError.value = false
	},
	{immediate: true},
)

// The parent focuses this field via a ref; expose the native input.
defineExpose({
	focus: () => inputRef.value?.focus(),
})

function commit() {
	const seconds = parseDuration(inputValue.value)
	if (seconds === null) {
		hasError.value = true
		return
	}

	hasError.value = false
	// Normalise the display ("90m" -> "1h 30m") so the field reflects the stored value.
	inputValue.value = formatDuration(seconds)

	if (seconds !== (props.modelValue ?? 0)) {
		emit('update:modelValue', seconds)
	}
}

function clear() {
	inputValue.value = ''
	hasError.value = false
	if ((props.modelValue ?? 0) !== 0) {
		emit('update:modelValue', 0)
	}
}
</script>

<style lang="scss" scoped>
.estimated-duration-input {
	max-inline-size: 20rem;
}
</style>
