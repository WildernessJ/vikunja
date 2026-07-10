<template>
	<Multiselect
		class="control is-expanded"
		:multiple="true"
		:placeholder="$t('project.search')"
		:search-results="foundProjects"
		label="title"
		:select-placeholder="$t('project.searchSelect')"
		:model-value="modelValue"
		@update:modelValue="(val) => emit('update:modelValue', (val ?? []) as IProject[])"
		@search="findProjects"
	>
		<template #searchResult="{option}">
			<span
				v-if="projectStore.getAncestors(option as IProject).length > 1"
				class="has-text-grey"
			>
				{{ projectStore.getAncestors(option as IProject).filter(p => p.id !== (option as IProject).id).map(p => getProjectTitle(p)).join(' > ') }} >
			</span>
			{{ getProjectTitle(option as IProject) }}
		</template>
	</Multiselect>
</template>

<script lang="ts" setup>
import {ref} from 'vue'

import type {IProject} from '@/modelTypes/IProject'

import {useProjectStore} from '@/stores/projects'
import {getProjectTitle} from '@/helpers/getProjectTitle'

import Multiselect from '@/components/input/Multiselect.vue'

const props = withDefaults(defineProps<{
	modelValue?: IProject[]
}>(), {
	modelValue: () => [],
})

const emit = defineEmits<{
	'update:modelValue': [value: IProject[]]
}>()

const projectStore = useProjectStore()

const foundProjects = ref<IProject[]>([])
function findProjects(query: string) {
	if (query === '') {
		foundProjects.value = []
		return
	}
	const selectedIds = new Set(props.modelValue.map(p => p.id))
	foundProjects.value = projectStore.searchProject(query).filter(p => !selectedIds.has(p.id))
}
</script>
