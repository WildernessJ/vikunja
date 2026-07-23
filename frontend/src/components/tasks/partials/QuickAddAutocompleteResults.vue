<template>
	<div
		:id="listboxId"
		class="qac-autocomplete"
		role="listbox"
	>
		<template v-if="items.length">
			<button
				v-for="(item, index) in items"
				:id="optionId(item)"
				:key="`${item.kind}-${item.id}`"
				type="button"
				role="option"
				class="qac-autocomplete-item"
				:class="{'is-selected': index === selectedIndex}"
				:aria-selected="index === selectedIndex"
				@click="select(index)"
			>
				<ColorBubble
					v-if="item.kind === 'label' && item.color"
					:color="item.color"
					class="qac-autocomplete-item-swatch"
				/>
				<User
					v-else-if="item.kind === 'assignee' && item.user"
					:user="item.user"
					:show-username="false"
					:avatar-size="20"
					is-inline
					class="qac-autocomplete-item-avatar"
				/>
				{{ item.display }}
			</button>
		</template>
		<div
			v-else
			class="qac-autocomplete-item qac-autocomplete-no-results"
		>
			{{ $t('task.quickAdd.autocompleteNoResults') }}
		</div>
	</div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue'

import ColorBubble from '@/components/misc/ColorBubble.vue'
import User from '@/components/misc/User.vue'
import type {TitleAutocompleteItem} from '@/composables/useQuickAddAutocomplete'

// TitleAutocompleteItem is a superset of the composer's own AutocompleteItem
// (adds a 'priority' kind for the task-detail title's dropdown).
const props = defineProps<{
	items: TitleAutocompleteItem[],
	listboxId: string,
}>()

const emit = defineEmits<{
	'select': [item: TitleAutocompleteItem],
	'close': [],
}>()

const selectedIndex = ref(0)

watch(() => props.items, () => {
	selectedIndex.value = 0
})

function optionId(item: TitleAutocompleteItem) {
	return `${props.listboxId}-option-${item.kind}-${item.id}`
}

const activeOptionId = computed(() => {
	const item = props.items[selectedIndex.value]
	return item ? optionId(item) : undefined
})

function select(index: number) {
	const item = props.items[index]
	if (item) {
		emit('select', item)
	}
}

// Returns whether the event was consumed, so the host textarea's own keydown
// handling (submit-on-enter, in particular) can be skipped when it was.
function onKeyDown(event: KeyboardEvent): boolean {
	if (event.key === 'Escape') {
		event.preventDefault()
		emit('close')
		return true
	}

	// The "no results" placeholder keeps the dropdown open but has nothing to
	// navigate or select - Arrow/Enter/Tab must fall through to the textarea's
	// normal behaviour (submit, newline, tab-away) instead of being trapped here.
	if (props.items.length === 0) {
		return false
	}

	if (event.key === 'ArrowUp') {
		event.preventDefault()
		selectedIndex.value = (selectedIndex.value - 1 + props.items.length) % props.items.length
		return true
	}

	if (event.key === 'ArrowDown') {
		event.preventDefault()
		selectedIndex.value = (selectedIndex.value + 1) % props.items.length
		return true
	}

	if (event.key === 'Enter' || event.key === 'Tab') {
		if (event.isComposing) {
			return false
		}
		event.preventDefault()
		select(selectedIndex.value)
		return true
	}

	return false
}

defineExpose({
	onKeyDown,
	selectedIndex,
	activeOptionId,
})
</script>

<style lang="scss" scoped>
.qac-autocomplete {
	position: relative;
	border-radius: $radius;
	background: var(--scheme-main);
	color: var(--grey-900);
	overflow-y: auto;
	font-size: .875rem;
	box-shadow: var(--shadow-md);
	border: 1px solid var(--grey-200);
	max-block-size: 12rem;
	min-inline-size: 12rem;
}

.qac-autocomplete-item {
	display: flex;
	align-items: center;
	gap: .5rem;
	margin: 0;
	inline-size: 100%;
	text-align: start;
	background: transparent;
	color: inherit;
	border: 0;
	padding: .375rem .5rem;
	cursor: pointer;

	&.is-selected,
	&:hover {
		background: var(--grey-100);
	}

	&.qac-autocomplete-no-results {
		color: var(--grey-500);
		cursor: default;

		&:hover {
			background: transparent;
		}
	}
}

.qac-autocomplete-item-swatch {
	flex-shrink: 0;
}

.qac-autocomplete-item-avatar {
	flex-shrink: 0;

	:deep(.avatar-wrapper) {
		margin-inline-end: 0;
	}
}
</style>
