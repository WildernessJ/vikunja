import {ref} from 'vue'

// UI state, not server state: the sidebar project being dragged, or null. Drives the nest drop-zones.
export const draggedProjectId = ref<number | null>(null)
