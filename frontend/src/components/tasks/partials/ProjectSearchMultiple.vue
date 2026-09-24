<template>
	<Multiselect
		class="control is-expanded"
		:multiple="true"
		:placeholder="$t('project.search')"
		:search-results="foundProjects"
		label="title"
		:select-placeholder="$t('project.searchSelect')"
		:model-value="modelValue"
		@update:modelValue="(val) => emit('update:modelValue', (val ?? []) as ProjectResponse[])"
		@search="findProjects"
	>
		<template #searchResult="{option}">
			<span
				v-if="projectList.getAncestors(option as ProjectResponse).length > 1"
				class="has-text-grey"
			>
				{{ projectList.getAncestors(option as ProjectResponse).filter(p => p.id !== (option as ProjectResponse).id).map(p => getProjectTitle(p)).join(' > ') }} >
			</span>
			{{ getProjectTitle(option as ProjectResponse) }}
		</template>
	</Multiselect>
</template>

<script lang="ts" setup>
import {ref} from 'vue'

import type {ProjectResponse} from '@/client/queries/projects'

import {useProjects} from '@/composables/useProjects'
import {getProjectTitle} from '@/helpers/getProjectTitle'

import Multiselect from '@/components/input/Multiselect.vue'

const props = withDefaults(defineProps<{
	modelValue?: ProjectResponse[]
}>(), {
	modelValue: () => [],
})

const emit = defineEmits<{
	'update:modelValue': [value: ProjectResponse[]]
}>()

const projectList = useProjects()

const foundProjects = ref<ProjectResponse[]>([])
function findProjects(query: string) {
	if (query === '') {
		foundProjects.value = []
		return
	}
	const selectedIds = new Set(props.modelValue.map(p => p.id))
	foundProjects.value = projectList.searchProject(query).filter(p => !selectedIds.has(p.id))
}
</script>
