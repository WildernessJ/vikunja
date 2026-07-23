<template>
	<div
		class="property-chip"
		:class="{'is-unset': (ghostWhenUnset ?? false) && !(isSet ?? false)}"
	>
		<Popup :has-overflow="hasOverflow ?? false">
			<template #trigger="{toggle}">
				<SimpleButton
					class="property-chip-button"
					:disabled="disabled ?? false"
					@click.stop="toggle()"
				>
					<slot name="trigger">
						<span
							v-if="icon"
							class="icon is-small"
						><Icon :icon="icon" /></span>
						{{ label }}
					</slot>
				</SimpleButton>
			</template>
			<template #content="{close}">
				<div class="property-chip-popup">
					<slot :close="close" />
				</div>
			</template>
		</Popup>
		<QacChipClear
			:show="showClear ?? false"
			@clear="$emit('clear')"
		/>
	</div>
</template>

<script setup lang="ts">
import type {IconProp} from '@fortawesome/fontawesome-svg-core'

import Popup from '@/components/misc/Popup.vue'
import SimpleButton from '@/components/input/SimpleButton.vue'
import QacChipClear from '@/components/tasks/partials/QacChipClear.vue'

// withDefaults' generic instantiation blows up (TS2590) once an IconProp-typed
// prop is in the mix (see Dropdown.vue's own note on this) - defaults are
// applied inline in the template instead.
defineProps<{
	icon?: IconProp,
	label?: string,
	isSet?: boolean,
	disabled?: boolean,
	showClear?: boolean,
	hasOverflow?: boolean,
	// Detail page's all-visible chip row needs a ghost/dashed look for unset
	// properties; the composer keeps its current look unchanged (opt-in only).
	ghostWhenUnset?: boolean,
}>()

defineEmits<{
	clear: [],
}>()
</script>

<style lang="scss" scoped>
.property-chip {
	position: relative;
	display: flex;
	align-items: center;
}

.property-chip-button {
	display: inline-flex;
	align-items: center;
	gap: .25rem;
	font-size: .9rem;
	inline-size: auto;
	white-space: nowrap;
}

.property-chip.is-unset .property-chip-button {
	border: 1px dashed var(--grey-300);
	border-radius: $radius;
	padding: .25rem .5rem;
	color: var(--grey-400);
}

.property-chip-popup {
	inline-size: 260px;
	background: var(--white);
	border-radius: $radius;
	box-shadow: $shadow;
	padding: .5rem;
}
</style>
