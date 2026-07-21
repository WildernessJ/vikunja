<template>
	<Popup>
		<template #trigger="{toggle}">
			<XButton
				variant="secondary"
				icon="sitemap"
				:class="{'has-exclusions': modelValue.enabled && modelValue.excluded.length > 0}"
				@click.prevent.stop="toggle()"
			>
				{{ $t('project.list.showSubprojectTasks') }}
			</XButton>
		</template>
		<template #content>
			<Card class="subproject-rollup-popup">
				<FancyCheckbox
					:model-value="modelValue.enabled"
					is-block
					@update:modelValue="setEnabled"
				>
					{{ $t('project.list.showSubprojectTasks') }}
				</FancyCheckbox>

				<template v-if="modelValue.enabled && projects.length > 0">
					<p class="subproject-rollup-popup__description has-text-grey is-size-7">
						{{ $t('project.list.subprojectRollupDescription') }}
					</p>
					<FancyCheckbox
						v-for="p in projects"
						:key="p.id"
						:model-value="!modelValue.excluded.includes(p.id)"
						is-block
						@update:modelValue="checked => setProjectIncluded(p.id, checked)"
					>
						{{ p.title }}
					</FancyCheckbox>
				</template>
			</Card>
		</template>
	</Popup>
</template>

<script setup lang="ts">
import XButton from '@/components/input/Button.vue'
import Popup from '@/components/misc/Popup.vue'
import Card from '@/components/misc/Card.vue'
import FancyCheckbox from '@/components/input/FancyCheckbox.vue'
import type {IProject} from '@/modelTypes/IProject'
import type {SubprojectRollupState} from '@/helpers/subprojectRollupState'

const props = defineProps<{
	modelValue: SubprojectRollupState,
	projects: IProject[],
}>()

const emit = defineEmits<{
	'update:modelValue': [value: SubprojectRollupState]
}>()

function setEnabled(enabled: boolean) {
	emit('update:modelValue', {...props.modelValue, enabled})
}

function setProjectIncluded(projectId: IProject['id'], included: boolean) {
	const excluded = included
		? props.modelValue.excluded.filter(id => id !== projectId)
		: [...props.modelValue.excluded, projectId]
	emit('update:modelValue', {...props.modelValue, excluded})
}
</script>

<style scoped lang="scss">
.subproject-rollup-popup {
	margin: 0;
	min-inline-size: 18rem;
	max-block-size: 20rem;
	overflow-y: auto;

	&__description {
		margin-block: .5rem;
	}
}

.has-exclusions {
	position: relative;

	&::after {
		content: '';
		position: absolute;
		inset-block-start: .4rem;
		inset-inline-end: .4rem;
		inline-size: .5rem;
		block-size: .5rem;
		border-radius: 50%;
		background: var(--primary);
	}
}
</style>
