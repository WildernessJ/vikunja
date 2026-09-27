<template>
	<ProjectDraggable
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
			name: !isDraggingProject ? 'flip-list' : null,
			class: [
				'menu-list can-be-hidden',
				{ 'dragging-disabled': !canEditOrder, 'nest-drop-zone': dropZone }
			],
		}"
		@start="onDragStart"
		@end="saveProjectPosition"
	>
		<template #item="itemSlotProps">
			<ProjectsNavigationItem
				:class="{'drag-disabled': getItemSlotProps(itemSlotProps).element.id < 0}"
				:project="getItemSlotProps(itemSlotProps).element"
				:is-loading="projectUpdating[getItemSlotProps(itemSlotProps).element.id]"
				:can-collapse="canCollapse"
				:can-edit-order="canEditOrder"
				:data-project-id="getItemSlotProps(itemSlotProps).element.id"
			/>
		</template>
	</ProjectDraggable>
</template>

<script lang="ts" setup>
import {ref, watch} from 'vue'
import draggable from 'zhyswan-vuedraggable'
import type {SortableEvent} from 'sortablejs'

import ProjectsNavigationItem from '@/components/home/ProjectsNavigationItem.vue'

import {calculateItemPosition} from '@/helpers/calculateItemPosition'
import {useUpdateProjectMutation, type ProjectResponse} from '@/client/queries/projects'

import {useProjects} from '@/composables/useProjects'
import {draggedProjectId} from '@/composables/useDraggedProject'
import {useProjectDragState} from '@/composables/useProjectDragState'

const props = defineProps<{
	modelValue?: ProjectResponse[],
	canEditOrder: boolean,
	canCollapse?: boolean,
	// When true this list is an empty nest drop-zone: give it a visible, droppable
	// min-height + affordance so a project can be dropped onto an otherwise 0px list.
	dropZone?: boolean,
}>()
const emit = defineEmits<{
	(e: 'update:modelValue', projects: ProjectResponse[]): void
}>()

// zhyswan-vuedraggable ships no slot types, so the #item scoped slot props type as {}.
// This reflects the shape it actually passes at runtime (SortableJS list item).
interface ItemSlotProps {
	element: ProjectResponse,
}

function getItemSlotProps(slotProps: unknown): ItemSlotProps {
	return slotProps as ItemSlotProps
}

// Omit + re-add $slots (rather than intersect over the original) so vue-tsc's
// `T extends { $slots: infer Slots }` check resolves to our slot, not `{}`.
const ProjectDraggable = draggable as unknown as new () => Omit<InstanceType<typeof draggable>, '$slots'> & {
	$slots: {
		item(props: ItemSlotProps): unknown,
	},
}

const {isDraggingProject} = useProjectDragState()

const projectList = useProjects()
const updateMutation = useUpdateProjectMutation()

// Vue draggable will modify the projects list as it changes their position which will not work on a prop.
// Hence, we'll clone the prop and work on the clone.
const availableProjects = ref<ProjectResponse[]>([])
// Mid-drag, Sortable has moved the dragged item's DOM node, possibly into another list. Patching
// the list then anchors on that node, throws NotFoundError and leaves the sidebar half patched.
let projectsChangedDuringDrag: ProjectResponse[] | null = null
watch(
	() => props.modelValue,
	projects => {
		if (isDraggingProject.value) {
			projectsChangedDuringDrag = projects || []
			return
		}
		availableProjects.value = projects || []
	},
	{immediate: true},
)
watch(isDraggingProject, dragging => {
	if (dragging || projectsChangedDuringDrag === null) {
		return
	}
	availableProjects.value = projectsChangedDuringDrag
	projectsChangedDuringDrag = null
})

const projectUpdating = ref<Record<number, boolean>>({})

function onDragStart(e: SortableEvent) {
	isDraggingProject.value = true
	const id = e.item.dataset.projectId
	draggedProjectId.value = id ? parseInt(id) : null
}

async function saveProjectPosition(e: SortableEvent) {
	isDraggingProject.value = false
	// Clear before the early-return below so a cancelled drag never leaves the
	// nest drop-zones stuck visible.
	draggedProjectId.value = null
	if (!e.newIndex && e.newIndex !== 0) return

	const projectsActive = availableProjects.value
	// If the project was dragged to the last position, Safari will report e.newIndex as the size of the projectsActive
	// array instead of using the position. Because the index is wrong in that case, dragging the project will fail.
	// To work around that we're explicitly checking that case here and decrease the index.
	const newIndex = e.newIndex === projectsActive.length ? e.newIndex - 1 : e.newIndex

	const projectIdStr = e.item.dataset.projectId
	if (!projectIdStr) return

	const projectId = parseInt(projectIdStr)
	const project = projectList.projects[projectId]
	if (!project) return

	const parentNode = e.to.parentNode as HTMLElement | null
	const parentProjectIdFromDom = parentNode?.dataset?.projectId ? parseInt(parentNode.dataset.projectId) : 0
	const parentProjectId = projectList.getEffectiveParentProjectId(project, parentProjectIdFromDom)
	const projectBefore = projectsActive[newIndex - 1] ?? null
	const projectAfter = projectsActive[newIndex + 1] ?? null
	projectUpdating.value[project.id] = true

	const position = calculateItemPosition(
		projectBefore !== null ? projectBefore.position : null,
		projectAfter !== null ? projectAfter.position : null,
	)

	try {
		await updateMutation.mutateAsync({
			...project,
			position,
			parent_project_id: parentProjectId,
		})
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
