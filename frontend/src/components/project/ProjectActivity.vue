<template>
	<ProjectWrapper
		class="project-activity-wrapper"
		:is-loading-project="isLoadingProject"
		:project-id="projectId"
		:view-id="0"
	>
		<div class="project-activity">
			<div class="activity-filter">
				<div class="select">
					<select
						name="actor"
						:value="actorFilter"
						@change="setActorFilter(($event.target as HTMLSelectElement).value)"
					>
						<option value="">
							{{ $t('project.activity.allActors') }}
						</option>
						<option
							v-for="actor in knownActors"
							:key="actor.id"
							:value="String(actor.id)"
						>
							{{ actor.name }}
						</option>
					</select>
				</div>
				<div class="select">
					<select
						name="verb"
						:value="verbFilter"
						@change="setVerbFilter(($event.target as HTMLSelectElement).value)"
					>
						<option value="">
							{{ $t('project.activity.allActions') }}
						</option>
						<option
							v-for="verb in VERBS"
							:key="verb"
							:value="verb"
						>
							{{ $t(`project.activity.verbs.${verb}`) }}
						</option>
					</select>
				</div>
			</div>

			<p
				v-if="!loading && entries.length === 0"
				class="activity-empty is-italic has-text-grey"
			>
				{{ $t('project.activity.empty') }}
			</p>

			<ul class="activity-list">
				<li
					v-for="entry in entries"
					:key="entry.id"
					class="activity-entry"
				>
					<User
						v-if="entry.actor"
						:user="entry.actor"
						:avatar-size="28"
						:show-username="true"
					/>
					<span class="activity-verb">
						{{ verbPhrase(entry.verb) }}
					</span>
					<RouterLink
						v-if="entry.taskId"
						class="activity-task"
						:to="{name: 'task.detail', params: {id: entry.taskId}}"
					>
						{{ entry.summary }}
					</RouterLink>
					<span
						v-else
						class="activity-summary"
					>
						{{ entry.summary }}
					</span>
					<time
						class="activity-time has-text-grey"
						:datetime="entry.created.toISOString()"
					>
						{{ formatDateSince(entry.created) }}
					</time>
				</li>
			</ul>

			<BaseButton
				v-if="nextCursor !== ''"
				class="activity-load-more"
				:disabled="loading"
				@click="loadMore"
			>
				{{ $t('project.activity.loadMore') }}
			</BaseButton>
		</div>
	</ProjectWrapper>
</template>

<script setup lang="ts">
import {ref, computed, watch} from 'vue'
import {useI18n} from 'vue-i18n'

import ProjectWrapper from '@/components/project/ProjectWrapper.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import User from '@/components/misc/User.vue'

import ProjectService from '@/services/project'
import ProjectModel from '@/models/project'
import {useActivityService} from '@/services/activity'
import {formatDateSince} from '@/helpers/time/formatDate'

import {useProjectStore} from '@/stores/projects'
import {useBaseStore} from '@/stores/base'

import type {IActivity} from '@/modelTypes/IActivity'
import type {IUser} from '@/modelTypes/IUser'

const props = defineProps<{
	projectId: number,
}>()

const {t} = useI18n()
const projectStore = useProjectStore()
const baseStore = useBaseStore()
const activityService = useActivityService()

// The verb order shown in the filter dropdown. Kept in sync with the backend
// activity verb constants.
const VERBS = [
	'task_created',
	'task_updated',
	'task_completed',
	'task_reopened',
	'task_deleted',
	'assignee_added',
	'assignee_removed',
	'comment_created',
	'attachment_added',
	'relation_added',
	'project_updated',
] as const

const isLoadingProject = ref(false)
const loading = ref(false)
const entries = ref<IActivity[]>([])
const nextCursor = ref('')
const actorFilter = ref('')
const verbFilter = ref('')

const knownActors = computed<Pick<IUser, 'id' | 'name'>[]>(() => {
	const seen = new Map<number, string>()
	for (const e of entries.value) {
		if (e.actor && !seen.has(e.actor.id)) {
			seen.set(e.actor.id, e.actor.name || e.actor.username || String(e.actor.id))
		}
	}
	return Array.from(seen, ([id, name]) => ({id, name}))
})

function verbPhrase(verb: string): string {
	const key = `project.activity.verbs.${verb}`
	const phrase = t(key)
	// Fall back to the raw verb if a new backend verb has no translation yet.
	return phrase === key ? verb : phrase
}

async function loadProject() {
	isLoadingProject.value = true
	try {
		const loaded = await new ProjectService().get(new ProjectModel({id: props.projectId}))
		projectStore.setProject(loaded)
		baseStore.handleSetCurrentProject({project: loaded})
	} finally {
		isLoadingProject.value = false
	}
}

async function loadFeed(reset: boolean) {
	loading.value = true
	try {
		const result = await activityService.getForProject(props.projectId, {
			cursor: reset ? undefined : nextCursor.value,
			actorId: actorFilter.value ? Number(actorFilter.value) : undefined,
			verb: verbFilter.value || undefined,
		})
		entries.value = reset ? result.items : [...entries.value, ...result.items]
		nextCursor.value = result.nextCursor
	} finally {
		loading.value = false
	}
}

function loadMore() {
	return loadFeed(false)
}

function setActorFilter(value: string) {
	actorFilter.value = value
	loadFeed(true)
}

function setVerbFilter(value: string) {
	verbFilter.value = value
	loadFeed(true)
}

watch(
	() => props.projectId,
	async () => {
		await loadProject()
		await loadFeed(true)
	},
	{immediate: true},
)
</script>

<style lang="scss" scoped>
.project-activity {
	background: var(--white);
	border-radius: $radius;
	padding: 1rem;
	box-shadow: var(--shadow-sm);
}

.activity-filter {
	display: flex;
	gap: .5rem;
	margin-block-end: 1rem;
	flex-wrap: wrap;
}

.activity-list {
	list-style: none;
	margin: 0;
	padding: 0;
}

.activity-entry {
	display: flex;
	align-items: center;
	gap: .5rem;
	flex-wrap: wrap;
	padding-block: .5rem;

	&:not(:last-child) {
		border-block-end: 1px solid var(--grey-200);
	}
}

.activity-time {
	margin-inline-start: auto;
	font-size: .85rem;
}

.activity-load-more {
	margin-block-start: 1rem;
	display: inline-block;
	color: var(--primary);
}
</style>
