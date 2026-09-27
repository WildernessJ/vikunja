import {translate} from '@/message'
import type {Project} from '@/client/generated'

export function getProjectTitle(project: Required<Pick<Project, 'id' | 'title'>>) {
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
