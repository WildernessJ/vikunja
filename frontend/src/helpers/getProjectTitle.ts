import {translate} from '@/message'
import type {IProject} from '@/modelTypes/IProject'

export function getProjectTitle(project: IProject) {
	if (project.id === -1) {
		return translate('project.pseudo.favorites.title')
	}

	if (project.title === 'Inbox') {
		return translate('project.inboxTitle')
	}

	if (project.title === 'My Open Tasks') {
		return translate('project.myOpenTasksFilterTitle')
	}

	return project.title
}
