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
				<template v-if="editingId === template.id">
					<form @submit.prevent="submitRename()">
						<FormField
							v-model="editTitle"
							v-focus
							:label="$t('project.template.name')"
							:placeholder="$t('project.template.namePlaceholder')"
							type="text"
							name="templateRename"
						/>
						<div class="buttons mbt-2">
							<XButton
								:loading="isLoading"
								type="submit"
							>
								{{ $t('misc.save') }}
							</XButton>
							<XButton
								variant="secondary"
								@click="cancelRename()"
							>
								{{ $t('misc.cancel') }}
							</XButton>
						</div>
					</form>
				</template>
				<template v-else>
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
							@click="startDelete(template)"
						>
							{{ $t('misc.delete') }}
						</XButton>
					</div>
				</template>
			</Card>
		</div>

		<Modal
			:enabled="showDeleteModal"
			@close="showDeleteModal = false"
			@submit="confirmDelete()"
		>
			<template #header>
				<span>{{ $t('project.template.deleteHeader') }}</span>
			</template>
			<template #text>
				<p>{{ $t('project.template.deleteConfirm') }}</p>
			</template>
		</Modal>
	</div>
</template>

<script setup lang="ts">
import {ref, onMounted} from 'vue'
import {useI18n} from 'vue-i18n'

import FormField from '@/components/input/FormField.vue'

import {success} from '@/message'
import {useTitle} from '@/composables/useTitle'
import {getTemplates, renameTemplate, deleteTemplate} from '@/services/template'
import type {ITemplate} from '@/modelTypes/ITemplate'

const {t} = useI18n({useScope: 'global'})
useTitle(() => t('project.template.libraryTitle'))

const templates = ref<ITemplate[]>([])
const isLoading = ref(false)

const editingId = ref<number | null>(null)
const editTitle = ref('')

const showDeleteModal = ref(false)
const templateToDelete = ref<ITemplate | null>(null)

async function load() {
	isLoading.value = true
	try {
		templates.value = await getTemplates()
	} finally {
		isLoading.value = false
	}
}

onMounted(load)

function startRename(template: ITemplate) {
	editingId.value = template.id
	editTitle.value = template.title
}

function cancelRename() {
	editingId.value = null
}

async function submitRename() {
	const template = templates.value.find(tpl => tpl.id === editingId.value)
	if (!template || editTitle.value.trim() === '') {
		return
	}
	isLoading.value = true
	try {
		await renameTemplate(template.id, editTitle.value.trim(), template.description)
		success({message: t('project.template.renameSuccess')})
		editingId.value = null
		await load()
	} finally {
		isLoading.value = false
	}
}

function startDelete(template: ITemplate) {
	templateToDelete.value = template
	showDeleteModal.value = true
}

async function confirmDelete() {
	if (!templateToDelete.value) {
		return
	}
	showDeleteModal.value = false
	await deleteTemplate(templateToDelete.value.id)
	success({message: t('project.template.deleteSuccess')})
	templateToDelete.value = null
	await load()
}
</script>
