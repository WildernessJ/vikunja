<template>
	<Multiselect
		v-model="labels"
		:loading="loading"
		:placeholder="$t('task.label.placeholder')"
		:multiple="true"
		:search-results="foundLabels as unknown as Record<string, unknown>[]"
		label="title"
		:creatable="creatable"
		:creation-disabled-message="creationDisabledMessage"
		:create-placeholder="$t('task.label.createPlaceholder')"
		:search-delay="10"
		:close-after-select="false"
		:disabled="disabled"
		@search="findLabel"
		@select="(value) => addLabel(value as unknown as ILabel)"
		@create="createAndAddLabel"
	>
		<template #tag="{item: label}">
			<span
				:style="getLabelStyles(label)"
				class="tag"
			>
				<span>{{ label.title }}</span>
				<BaseButton
					v-if="!disabled"
					v-cy="'taskDetail.removeLabel'"
					:aria-label="$t('task.label.removeLabel', {label: label.title})"
					class="delete is-small"
					@click="removeLabel(label)"
				/>
			</span>
		</template>
		<template #searchResult="{option}">
			<span
				v-if="typeof option === 'string'"
				class="tag search-result"
			>
				<span>{{ option }}</span>
			</span>
			<span
				v-else
				:style="getLabelStyles(option as unknown as ILabel)"
				class="tag search-result"
			>
				<span>{{ option.title }}</span>
			</span>
		</template>
	</Multiselect>
</template>

<script setup lang="ts">
import {ref, computed, shallowReactive, watch} from 'vue'
import {useI18n} from 'vue-i18n'

import LabelModel from '@/models/label'
import LabelTaskService from '@/services/labelTask'
import {success} from '@/message'

import BaseButton from '@/components/base/BaseButton.vue'
import Multiselect from '@/components/input/Multiselect.vue'
import type {ILabel} from '@/modelTypes/ILabel'
import {useLabelStore} from '@/stores/labels'
import {useTaskStore} from '@/stores/tasks'
import {getRandomColorHex} from '@/helpers/color/randomColor'
import {useLabelStyles} from '@/composables/useLabelStyles'

const props = withDefaults(defineProps<{
	modelValue: ILabel[] | undefined
	taskId?: number
	disabled?: boolean
	creatable?: boolean
	creationDisabledMessage?: string
}>(), {
	taskId: 0,
	disabled: false,
	creatable: true,
	creationDisabledMessage: '',
})

const emit = defineEmits<{
	'update:modelValue': [labels: ILabel[]],
}>()

const {t} = useI18n({useScope: 'global'})

const labelTaskService = shallowReactive(new LabelTaskService())
const labels = ref<ILabel[]>([])
const query = ref('')

watch(
	() => props.modelValue,
	(value) => {
		labels.value = Array.from(new Map((value ?? []).map(label => [label.id, label])).values())
	},
	{
		immediate: true,
		deep: true,
	},
)

const taskStore = useTaskStore()
const labelStore = useLabelStore()
const {getLabelStyles} = useLabelStyles()

const foundLabels = computed(() => labelStore.filterLabelsByQuery(labels.value, query.value))
const loading = computed(() => labelTaskService.loading || labelStore.isLoading)

// taskId 0 means there's no persisted task yet to relate labels to (e.g. the
// quick-add composer) - label add/remove then only touches local state.
const hasPersistedTask = computed(() => props.taskId !== 0)

function findLabel(newQuery: string) {
	query.value = newQuery
}

async function addLabel(label: ILabel, showNotification = true) {
	if (!hasPersistedTask.value) {
		emit('update:modelValue', labels.value)
		return
	}

	await taskStore.addLabel({label, taskId: props.taskId})
	emit('update:modelValue', labels.value)
	if (showNotification) {
		success({message: t('task.label.addSuccess')})
	}
}

async function removeLabel(label: ILabel) {
	if (hasPersistedTask.value) {
		await taskStore.removeLabel({label, taskId: props.taskId})
	}

	const idx = labels.value.findIndex(l => l.id === label.id)
	if (idx !== -1) {
		labels.value.splice(idx, 1)
	}
	emit('update:modelValue', labels.value)
	success({message: t('task.label.removeSuccess')})
}

async function createAndAddLabel(title: string) {
	const newLabel = await labelStore.createLabel(new LabelModel({
		title,
		hexColor: getRandomColorHex(),
	}))

	if (!hasPersistedTask.value) {
		labels.value.push(newLabel)
		emit('update:modelValue', labels.value)
		success({message: t('task.label.addCreateSuccess')})
		return
	}

	addLabel(newLabel, false)
	labels.value.push(newLabel)
	success({message: t('task.label.addCreateSuccess')})
}
</script>

<style lang="scss" scoped>
.tag {
	margin: .25rem !important;
}

.tag.search-result {
	margin: 0 !important;
}

:deep(.input-wrapper) {
	padding: .25rem !important;
}

:deep(input.input) {
	padding: 0 .5rem;
}
</style>
