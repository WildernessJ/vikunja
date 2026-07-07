import {AuthenticatedHTTPFactory, apiV2Url} from '@/helpers/fetcher'
import {objectToCamelCase} from '@/helpers/case'
import type {ITemplate} from '@/modelTypes/ITemplate'
import type {IProject} from '@/modelTypes/IProject'

interface PaginatedResponse<T> {
	items: T[]
	total: number
	page: number
	per_page: number
	total_pages: number
}

// The template endpoints only exist on /api/v2, hence the absolute URLs.

export async function getTemplates(): Promise<ITemplate[]> {
	const http = AuthenticatedHTTPFactory()
	const {data} = await http.get<PaginatedResponse<Record<string, unknown>>>(apiV2Url('templates'))
	return (data?.items ?? []).map(item => objectToCamelCase(item) as ITemplate)
}

export async function saveProjectAsTemplate(projectId: number, name: string, description = ''): Promise<IProject> {
	const http = AuthenticatedHTTPFactory()
	const {data} = await http.post(apiV2Url(`projects/${projectId}/save-as-template`), {name, description})
	return objectToCamelCase(data) as IProject
}

export async function instantiateTemplate(templateId: number, title: string, parentProjectId = 0): Promise<IProject> {
	const http = AuthenticatedHTTPFactory()
	const {data} = await http.post(apiV2Url(`templates/${templateId}/instantiate`), {
		title,
		parent_project_id: parentProjectId,
	})
	return objectToCamelCase(data) as IProject
}

export async function renameTemplate(templateId: number, title: string, description = ''): Promise<ITemplate> {
	const http = AuthenticatedHTTPFactory()
	const {data} = await http.put(apiV2Url(`templates/${templateId}`), {title, description})
	return objectToCamelCase(data) as ITemplate
}

export async function deleteTemplate(templateId: number): Promise<void> {
	const http = AuthenticatedHTTPFactory()
	await http.delete(apiV2Url(`templates/${templateId}`))
}
