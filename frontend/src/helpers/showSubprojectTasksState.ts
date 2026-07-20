import type {IProject} from '@/modelTypes/IProject'

const KEY_PREFIX = 'showSubprojectTasks:'

export function getShowSubprojectTasksState(projectId: IProject['id']): boolean {
	return localStorage.getItem(`${KEY_PREFIX}${projectId}`) === 'true'
}

export function saveShowSubprojectTasksState(projectId: IProject['id'], show: boolean) {
	if (show) {
		localStorage.setItem(`${KEY_PREFIX}${projectId}`, 'true')
	} else {
		localStorage.removeItem(`${KEY_PREFIX}${projectId}`)
	}
}
