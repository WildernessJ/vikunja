<template>
	<Modal
		:overflow="true"
		:wide="wide"
		:aria-label="title"
		@close="$router.back()"
	>
		<Card
			:title="title"
			:shadow="false"
			:padding="false"
			class="has-text-start"
			:loading="currentLoading"
			:show-close="true"
			@close="$router.back()"
		>
			<div class="p-4">
				<slot />
			</div>

			<template #footer>
				<slot name="footer">
					<XButton
						v-if="tertiary !== ''"
						:shadow="false"
						variant="tertiary"
						@click.prevent.stop="$emit('tertiary', $event)"
					>
						{{ tertiary }}
					</XButton>
					<XButton
						variant="secondary"
						@click.prevent.stop="$router.back()"
					>
						{{ $t('misc.cancel') }}
					</XButton>
					<XButton
						v-if="hasPrimaryAction"
						variant="primary"
						:icon="primaryIcon ?? 'plus'"
						:disabled="isBusy"
						class="mis-2"
						:loading="currentLoading"
						@click.prevent.stop="primary"
					>
						{{ primaryLabel || $t('misc.create') }}
					</XButton>
				</slot>
			</template>
		</Card>
	</Modal>
</template>

<script setup lang="ts">
import type {IconProp} from '@fortawesome/fontawesome-svg-core'

import {computed, ref, toRef, watch} from 'vue'

// withDefaults' generic instantiation blows up (TS2590) once an IconProp-typed prop
// is in the mix, regardless of whether IconProp itself gets a default. So this prop
// set skips withDefaults entirely; defaults for props whose fallback isn't already
// safe via `||`/`??` at their use site are re-applied below as same-named computeds,
// which shadow the raw (defaultless) prop in the template.
const props = defineProps<{
	title: string,
	primaryLabel?: string,
	primaryIcon?: IconProp,
	primaryDisabled?: boolean,
	hasPrimaryAction?: boolean,
	tertiary?: string,
	wide?: boolean,
	loading?: boolean,
}>()

const emit = defineEmits<{
	'create': [event: MouseEvent],
	'primary': [event: MouseEvent],
	'tertiary': [event: MouseEvent],
	'update:loading': [value: boolean],
}>()

const tertiary = computed(() => props.tertiary ?? '')
const hasPrimaryAction = computed(() => props.hasPrimaryAction ?? true)

const loadingProp = toRef(props, 'loading')
const currentLoading = ref(false)

watch(
	loadingProp,
	(value) => {
		if (value !== undefined) {
			currentLoading.value = value
		}
	},
	{immediate: true},
)

const isBusy = computed(() => props.primaryDisabled || currentLoading.value)

function setLoading(value: boolean) {
	currentLoading.value = value
	emit('update:loading', value)
}

function primary(event: MouseEvent) {
	if (isBusy.value) {
		return
	}

	emit('create', event)
	emit('primary', event)
	setLoading(true)
}
</script>
