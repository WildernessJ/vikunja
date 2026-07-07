<template>
	<div
		:class="{ 'is-loading': isLoading }"
		class="loader-container"
	>
		<div class="content">
			<h1>{{ $t('project.template.libraryTitle') }}</h1>
			<p v-if="templates.length > 0">
				{{ $t('project.template.libraryDescription') }}
			</p>
			<p
				v-else
				class="has-text-centered has-text-grey is-italic"
			>
				{{ $t('project.template.libraryEmpty') }}
			</p>
		</div>

		<div class="template-library">
			<Card
				v-for="template in templates"
				:key="template.id"
				:title="template.title"
				class="template-card"
			>
				<p v-if="template.description">
					{{ template.description }}
				</p>
				<p class="has-text-grey">
					{{ $t('project.template.taskCount', {count: template.taskCount}) }}
				</p>
				<div class="buttons mbt-2">
					<XButton
						variant="secondary"
						icon="pen"
						@click="startRename(template)"
					>
						{{ $t('project.template.rename') }}
					</XButton>
					<XButton
						variant="secondary"
						icon="trash-alt"
						class="has-text-danger"
						@click="remove(template)"
					>
						{{ $t('misc.delete') }}
					</XButton>
				</div>
			</Card>
		</div>
	</div>
</template>

<script setup lang="ts">
import {ref, onMounted} from 'vue'
import {useI18n} from 'vue-i18n'

import {success} from '@/message'
import {useTitle} from '@/composables/useTitle'
import {getTemplates, renameTemplate, deleteTemplate} from '@/services/template'
import type {ITemplate} from '@/modelTypes/ITemplate'

const {t} = useI18n({useScope: 'global'})
useTitle(() => t('project.template.libraryTitle'))

const templates = ref<ITemplate[]>([])
const isLoading = ref(false)

async function load() {
	isLoading.value = true
	try {
		templates.value = await getTemplates()
	} finally {
		isLoading.value = false
	}
}

onMounted(load)

async function startRename(template: ITemplate) {
	const newName = window.prompt(t('project.template.renameTitle'), template.title)
	if (newName === null || newName.trim() === '' || newName === template.title) {
		return
	}
	await renameTemplate(template.id, newName.trim(), template.description)
	success({message: t('project.template.renameSuccess')})
	await load()
}

async function remove(template: ITemplate) {
	if (!window.confirm(t('project.template.deleteConfirm'))) {
		return
	}
	await deleteTemplate(template.id)
	success({message: t('project.template.deleteSuccess')})
	await load()
}
</script>
