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
			:disabled="projectService.loading"
			:loading="projectService.loading"
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
			v-if="projectStore.hasProjects"
			:label="$t('project.parent')"
		>
			<ProjectSearch v-model="parentProject" />
		</FormField>
		<FormField :label="$t('project.color')">
			<ColorPicker v-model="project.hexColor" />
		</FormField>
	</CreateEdit>
</template>

<script setup lang="ts">
import {ref, reactive, shallowReactive, watch, onMounted} from 'vue'
import {useI18n} from 'vue-i18n'
import {useRouter} from 'vue-router'

import ProjectService from '@/services/project'
import ProjectModel from '@/models/project'
import CreateEdit from '@/components/misc/CreateEdit.vue'
import ColorPicker from '@/components/input/ColorPicker.vue'
import FormField from '@/components/input/FormField.vue'

import {success} from '@/message'
import {useTitle} from '@/composables/useTitle'
import {useProjectStore} from '@/stores/projects'
import {getTemplates, instantiateTemplate} from '@/services/template'
import ProjectSearch from '@/components/tasks/partials/ProjectSearch.vue'
import type {IProject} from '@/modelTypes/IProject'
import type {ITemplate} from '@/modelTypes/ITemplate'

const props = defineProps<{
	parentProjectId?: number,
}>()

const {t} = useI18n({useScope: 'global'})
const router = useRouter()

useTitle(() => t('project.create.header'))

const showError = ref(false)
const project = reactive(new ProjectModel())
const projectService = shallowReactive(new ProjectService())
const projectStore = useProjectStore()
const parentProject = ref<IProject | null>(null)
const isSubmitting = ref(false)

const templates = ref<ITemplate[]>([])
const selectedTemplateId = ref(0)

onMounted(async () => {
	templates.value = await getTemplates()
})

watch(
	() => props.parentProjectId,
	() => parentProject.value = projectStore.projects[props.parentProjectId],
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
		project.parentProjectId = parentProject.value.id
	}

	try {
		if (selectedTemplateId.value > 0) {
			const created = await instantiateTemplate(selectedTemplateId.value, project.title, project.parentProjectId)
			projectStore.setProject(created)
			success({message: t('project.template.instantiateSuccess')})
			await router.push({name: 'project.index', params: {projectId: created.id}})
			return
		}
		await projectStore.createProject(project)
		success({message: t('project.create.createdSuccess')})
	} finally {
		isSubmitting.value = false
	}
}
</script>
