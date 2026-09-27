<template>
	<CreateEdit
		v-model:loading="isSubmitting"
		:title="$t('project.create.header')"
		:primary-disabled="project.title === ''"
		@create="createProject()"
	>
		<FormField
			v-model="project.title"
			v-focus
			:label="$t('project.title')"
			:disabled="isSubmitting"
			:loading="isSubmitting"
			:placeholder="$t('project.create.titlePlaceholder')"
			type="text"
			name="projectTitle"
			:error="showError && project.title === '' ? $t('project.create.addTitleRequired') : null"
			@keyup.enter="createProject()"
			@keyup.esc="$router.back()"
		/>
		<FormField
			v-if="templates.length > 0"
			:label="$t('project.template.fromTemplate')"
		>
			<div class="select">
				<select
					v-model="selectedTemplateId"
					name="template"
				>
					<option :value="0">
						{{ $t('project.template.fromTemplateNone') }}
					</option>
					<option
						v-for="template in templates"
						:key="template.id"
						:value="template.id"
					>
						{{ template.title }}
					</option>
				</select>
			</div>
		</FormField>
		<FormField
			v-if="projectList.hasProjects"
			:label="$t('project.parent')"
		>
			<ProjectSearch
				:model-value="parentProject ?? undefined"
				@update:modelValue="(val) => parentProject = val ?? null"
			/>
		</FormField>
		<FormField :label="$t('project.color')">
			<ColorPicker v-model="project.hex_color" />
		</FormField>
	</CreateEdit>
</template>

<script setup lang="ts">
import {ref, reactive, watch, onMounted} from 'vue'
import {useI18n} from 'vue-i18n'
import {useRouter} from 'vue-router'

import CreateEdit from '@/components/misc/CreateEdit.vue'
import ColorPicker from '@/components/input/ColorPicker.vue'
import FormField from '@/components/input/FormField.vue'

import {useTitle} from '@/composables/useTitle'
import {useProjects} from '@/composables/useProjects'
import ProjectSearch from '@/components/tasks/partials/ProjectSearch.vue'
import {createProjectDraft, projectKeys, useCreateProjectMutation, type ProjectResponse} from '@/client/queries/projects'
import {getTemplates, instantiateTemplate} from '@/services/template'
import type {ITemplate} from '@/modelTypes/ITemplate'
import {queryClient} from '@/client/queryClient'
import {success} from '@/message'

const props = defineProps<{
	parentProjectId?: number,
}>()

const {t} = useI18n({useScope: 'global'})
const router = useRouter()
const createMutation = useCreateProjectMutation()

useTitle(() => t('project.create.header'))

const showError = ref(false)
const project = reactive(createProjectDraft())
const projectList = useProjects()
const parentProject = ref<ProjectResponse | null>(null)
const isSubmitting = ref(false)

const templates = ref<ITemplate[]>([])
const selectedTemplateId = ref(0)

onMounted(async () => {
	templates.value = await getTemplates()
})

watch(
	() => props.parentProjectId,
	() => parentProject.value = (props.parentProjectId !== undefined ? projectList.projects[props.parentProjectId] : undefined) ?? null,
	{immediate: true},
)

async function createProject() {
	if (project.title === '') {
		showError.value = true
		return
	}
	showError.value = false

	if (isSubmitting.value) {
		return
	}

	isSubmitting.value = true

	if (parentProject.value) {
		project.parent_project_id = parentProject.value.id
	}

	try {
		if (selectedTemplateId.value > 0) {
			const created = await instantiateTemplate(selectedTemplateId.value, project.title, project.parent_project_id ?? 0)
			await queryClient.invalidateQueries({queryKey: projectKeys.list()})
			success({message: t('project.template.instantiateSuccess')})
			await router.push({name: 'project.index', params: {projectId: created.id}})
			return
		}
		const created = await createMutation.mutateAsync(project)
		await router.push({name: 'project.index', params: {projectId: created.id}})
	} finally {
		isSubmitting.value = false
	}
}
</script>
