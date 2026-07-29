<script setup lang="ts">
interface Props {
	modelValue?: boolean
	label?: string
	disabled?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
	'update:modelValue': [value: boolean]
}>()

function handleChange(event: Event) {
	const input = event.target as HTMLInputElement
	emit('update:modelValue', input.checked)

	// The browser has already flipped the box, but modelValue is what the box
	// means. Vue only patches `checked` when that value changes, so a parent
	// that declines the change (async handler that fails, permission prompt the
	// user dismissed) would otherwise leave the box stuck showing a state
	// nothing is in. Re-assert it and let the prop drive it back if it lands.
	input.checked = props.modelValue ?? false
}
</script>

<template>
	<label class="checkbox">
		<input
			type="checkbox"
			:checked="modelValue"
			:disabled="disabled || undefined"
			@change="handleChange"
		>
		<slot>{{ label }}</slot>
	</label>
</template>

<style lang="scss" scoped>
// Ported from bulma-css-variables/sass/form/checkbox-radio.sass
// (the %checkbox-radio placeholder, scoped to .checkbox since this
// component is the sole consumer of that class).
label.checkbox {
	cursor: pointer;
	line-height: 1.25;
	position: relative;

	display: flex;
	align-items: center;
	gap: .5rem;
	inline-size: fit-content;

	&:hover {
		color: var(--input-hover-color);
	}

	&[disabled],
	input[disabled] {
		color: var(--input-disabled-color);
		cursor: not-allowed;
	}

	input {
		cursor: pointer;
	}

	&:not(:last-child) {
		margin-block-end: .75rem;
	}
}
</style>
