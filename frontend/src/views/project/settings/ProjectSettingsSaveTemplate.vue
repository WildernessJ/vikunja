<template>
	<CreateEdit
		v-model:loading="isSaving"
		:title="$t('project.template.saveTitle')"
		primary-icon="copy"
		:primary-label="$t('project.template.saveAction')"
		:primary-disabled="name === ''"
		@primary="save"
	>
		<p>{{ $t('project.template.saveText') }}</p>
		<FormField
			v-model="name"
			v-focus
			:label="$t('project.template.name')"
			:placeholder="$t('project.template.namePlaceholder')"
			type="text"
			name="templateName"
		/>
		<FormField
			:label="$t('project.template.description')"
		>
			<textarea
				v-model="description"
				class="input"
				name="templateDescription"
				:placeholder="$t('project.template.descriptionPlaceholder')"
			/>
		</FormField>
	</CreateEdit>
</template>

<script setup lang="ts">
import {ref} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import {useI18n} from 'vue-i18n'

import CreateEdit from '@/components/misc/CreateEdit.vue'
import FormField from '@/components/input/FormField.vue'

import {success} from '@/message'
import {useTitle} from '@/composables/useTitle'
import {saveProjectAsTemplate} from '@/services/template'

const {t} = useI18n({useScope: 'global'})
useTitle(() => t('project.template.saveTitle'))

const route = useRoute()
const router = useRouter()

const name = ref('')
const description = ref('')
const isSaving = ref(false)

async function save() {
	if (name.value === '' || isSaving.value) {
		return
	}
	isSaving.value = true
	try {
		await saveProjectAsTemplate(Number(route.params.projectId), name.value, description.value)
		success({message: t('project.template.saveSuccess')})
		await router.push({name: 'templates.index'})
	} finally {
		isSaving.value = false
	}
}
</script>
