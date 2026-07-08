<template>
	<draggable
		v-model="availableProjects"
		animation="100"
		ghost-class="ghost"
		group="projects"
		handle=".handle"
		tag="menu"
		item-key="id"
		:disabled="!canEditOrder"
		filter=".drag-disabled"
		:component-data="{
			type: 'transition-group',
			name: !drag ? 'flip-list' : null,
			class: [
				'menu-list can-be-hidden',
				{ 'dragging-disabled': !canEditOrder, 'nest-drop-zone': dropZone }
			],
		}"
		@start="onDragStart"
		@end="saveProjectPosition"
	>
		<template #item="{element: project}">
			<ProjectsNavigationItem
				:class="{'drag-disabled': project.id < 0}"
				:project="project"
				:is-loading="projectUpdating[project.id]"
				:can-collapse="canCollapse"
				:can-edit-order="canEditOrder"
				:data-project-id="project.id"
			/>
		</template>
	</draggable>
</template>

<script lang="ts" setup>
import {ref, watch} from 'vue'
import draggable from 'zhyswan-vuedraggable'
import type {SortableEvent} from 'sortablejs'

import ProjectsNavigationItem from '@/components/home/ProjectsNavigationItem.vue'

import {calculateItemPosition} from '@/helpers/calculateItemPosition'
import type {IProject} from '@/modelTypes/IProject'

import {useProjectStore} from '@/stores/projects'

const props = defineProps<{
	modelValue?: IProject[],
	canEditOrder: boolean,
	canCollapse?: boolean,
	// When true this list is an empty nest drop-zone: give it a visible, droppable
	// min-height + affordance so a project can be dropped onto an otherwise 0px list.
	dropZone?: boolean,
}>()
const emit = defineEmits<{
	(e: 'update:modelValue', projects: IProject[]): void
}>()

const drag = ref(false)

const projectStore = useProjectStore()

// Vue draggable will modify the projects list as it changes their position which will not work on a prop.
// Hence, we'll clone the prop and work on the clone.
const availableProjects = ref<IProject[]>([])
watch(
	() => props.modelValue,
	projects => {
		availableProjects.value = projects || []
	},
	{immediate: true},
)

const projectUpdating = ref<{ [id: IProject['id']]: boolean }>({})

function onDragStart(e: SortableEvent) {
	drag.value = true
	const id = e.item.dataset.projectId
	projectStore.setDraggedProjectId(id ? parseInt(id) : null)
}

async function saveProjectPosition(e: SortableEvent) {
	drag.value = false
	// Clear before the early-return below so a cancelled drag never leaves the
	// nest drop-zones stuck visible.
	projectStore.setDraggedProjectId(null)
	if (!e.newIndex && e.newIndex !== 0) return

	const projectsActive = availableProjects.value
	// If the project was dragged to the last position, Safari will report e.newIndex as the size of the projectsActive
	// array instead of using the position. Because the index is wrong in that case, dragging the project will fail.
	// To work around that we're explicitly checking that case here and decrease the index.
	const newIndex = e.newIndex === projectsActive.length ? e.newIndex - 1 : e.newIndex

	const projectIdStr = e.item.dataset.projectId
	if (!projectIdStr) return

	const projectId = parseInt(projectIdStr)
	const project = projectStore.projects[projectId]
	if (!project) return

	const parentNode = e.to.parentNode as HTMLElement | null
	const parentProjectIdFromDom = parentNode?.dataset?.projectId ? parseInt(parentNode.dataset.projectId) : 0
	const parentProjectId = projectStore.getEffectiveParentProjectId(project, parentProjectIdFromDom)
	const projectBefore = projectsActive[newIndex - 1] ?? null
	const projectAfter = projectsActive[newIndex + 1] ?? null
	projectUpdating.value[project.id] = true

	const position = calculateItemPosition(
		projectBefore !== null ? projectBefore.position : null,
		projectAfter !== null ? projectAfter.position : null,
	)

	try {
		// create a copy of the project in order to not violate pinia manipulation
		await projectStore.updateProject({
			...project,
			position,
			parentProjectId,
		} as IProject)
		emit('update:modelValue', availableProjects.value)
	} catch (err) {
		// vuedraggable reordered availableProjects in place. Since we only emit on success,
		// props.modelValue still holds the prior order — reset the clone to it so the sidebar
		// doesn't keep a reordering that was never persisted.
		availableProjects.value = props.modelValue ? [...props.modelValue] : []
		throw err
	} finally {
		projectUpdating.value[project.id] = false
	}
}
</script>

<style lang="scss" scoped>
// An empty nest drop-zone needs a real drop area — a 0px list can't receive a drop.
.nest-drop-zone {
	min-block-size: 2rem;
	margin-block: .15rem;
	border: 2px dashed hsla(var(--primary-hsl), 0.4);
	border-radius: $radius;
	background-color: hsla(var(--primary-hsl), 0.08);
}
</style>
