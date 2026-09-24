import {computed} from 'vue'
import {useRouter} from 'vue-router'
import type {Task, Label} from '@/client/generated'
import {
	useCreateTaskMutation,
	useBulkCreateTasksMutation,
	useAddTaskAssigneeMutation,
	useAddTaskLabelMutation,
} from '@/client/queries/taskMutations'
import {ensureLabels, refreshLabels, getLabelByExactTitle, useCreateLabelMutation} from '@/client/queries/labels'
import {ensureProjects, findProjectByExactTitle} from '@/client/queries/projects'
import {searchProjectUsers} from '@/client/queries/userSearch'
import {useAuthStore} from '@/stores/auth'
import {useConfigStore} from '@/stores/config'
import {parseTaskText, PREFIXES} from '@/modules/quickAddMagic'
import {buildQuickAddTask, hasQuickAddOverrides, type QuickAddOverrides} from '@/helpers/task'
import {resolveOverride} from '@/helpers/resolveOverride'
import {getRandomColorHex} from '@/helpers/color/randomColor'
import {runWrites} from '@/helpers/runWrites'
import {error} from '@/message'
import {i18n} from '@/i18n'
import {taskRemindersFromSettings} from '@/modelTypes/IUserSettings'
import {
	assertClientRequestContext,
	captureClientRequestContext,
	type ClientRequestContext,
} from '@/client/requestContext'

interface ResolvedLabels {
	labels: Label[]
	skipped: string[]
}

export function reportSkippedLabels(skipped: string[]) {
	if (!skipped.length) return
	error({message: i18n.global.t('task.label.createFailed', {labels: skipped.join(', ')})})
}

export function useQuickAddTask() {
	const create = useCreateTaskMutation()
	const bulk = useBulkCreateTasksMutation()
	const addAssignee = useAddTaskAssigneeMutation()
	const addLabel = useAddTaskLabelMutation()
	const createLabel = useCreateLabelMutation()
	const auth = useAuthStore()
	const config = useConfigStore()
	const router = useRouter()

	async function findProjectId({project, projectId}: {project?: string | null, projectId: number}) {
		if (project) {
			const {projects} = await ensureProjects()
			const found = findProjectByExactTitle(projects, project)
				?? projects.find(item => item.identifier?.toLowerCase() === project.toLowerCase())
			if (found?.id) return found.id
		}
		const routeProjectId = Number(router.currentRoute.value.params.projectId)
		const id = routeProjectId > 0 ? routeProjectId : projectId
		if (id <= 0) throw new Error('NO_PROJECT')
		return id
	}

	async function ensureLabelsExist(titles: string[], context = captureClientRequestContext()): Promise<ResolvedLabels> {
		const wanted = [...new Set(titles)]
		if (!wanted.length) return {labels: [], skipped: []}
		assertClientRequestContext(context)
		let labels: Label[] = []
		try {
			labels = await ensureLabels()
			if (wanted.some(title => !getLabelByExactTitle(labels, title))) labels = await refreshLabels()
		} catch {
			assertClientRequestContext(context)
		}
		const found = await Promise.all(wanted.map(async title => {
			assertClientRequestContext(context)
			const existing = getLabelByExactTitle(labels, title)
			if (existing) return {title, label: existing}
			// A label must never fail the task it belongs to; the caller summarises what was skipped.
			try {
				return {title, label: await createLabel.mutateAsync({title, hex_color: getRandomColorHex()})}
			} catch {
				assertClientRequestContext(context)
				return {title, label: undefined}
			}
		}))
		return {
			labels: found.map(({label}) => label).filter((label): label is Label => label !== undefined),
			skipped: found.filter(({label}) => label === undefined).map(({title}) => title),
		}
	}

	async function build(input: Partial<Task>, context: ClientRequestContext, overrides?: QuickAddOverrides) {
		const mode = auth.settings.frontendSettings.quickAddMagicMode
		// This parse produces the API payload; the composer's is only the UI preview.
		const parsed = parseTaskText(input.title ?? '', mode, new Date(), auth.settings.frontendSettings.dateOnly)
		// A title that is only magic stays a literal title: nothing parsed out of it may move or decorate the task,
		// unless the composer's chips supplied values.
		const magicOnly = !parsed.text && !hasQuickAddOverrides(overrides)
		const overrideProjectId = resolveOverride(overrides, 'projectId', undefined)
		const project_id = overrideProjectId ?? await findProjectId({
			project: magicOnly || overrideProjectId === null ? null : parsed.project,
			projectId: input.project_id ?? 0,
		})
		assertClientRequestContext(context)
		const matches = magicOnly ? [] : await Promise.all(parsed.assignees.map(async match => {
			const users = await searchProjectUsers(project_id, match)
			const query = match.toLowerCase()
			const user = users.find(user => [user.username, user.name, user.email].some(value => users.length === 1
				? value?.toLowerCase().includes(query)
				: value?.toLowerCase() === query))
			return user ? {...user, match} : undefined
		}))
		assertClientRequestContext(context)
		const defaults = taskRemindersFromSettings(auth.settings.frontendSettings.quickAddDefaultReminders)
		return {
			task: buildQuickAddTask(
				parsed,
				{...input, project_id},
				PREFIXES[mode],
				matches.filter(user => user !== undefined),
				defaults,
				overrides,
			),
			// A chip override (present, even empty []) wins over labels parsed from magic-text.
			parsedLabels: overrides?.labels !== undefined
				? overrides.labels.map(label => label.title ?? '')
				: magicOnly ? [] : parsed.labels,
		}
	}

	async function addLabelsToTask(
		{task, parsedLabels}: {task: Task, parsedLabels: string[]},
		context = captureClientRequestContext(),
	) {
		const {labels, skipped} = await ensureLabelsExist(parsedLabels, context)
		await runWrites(labels, label => {
			assertClientRequestContext(context)
			return addLabel.mutateAsync({taskId: task.id!, label: {...label, id: label.id!}})
		}, config.concurrentWrites)
		return {task: {...task, labels: [...(task.labels ?? []), ...labels]}, skipped}
	}

	async function finishTask(task: Task, built: Awaited<ReturnType<typeof build>>, context: ClientRequestContext) {
		assertClientRequestContext(context)
		await runWrites(built.task.assignees ?? [], user => {
			assertClientRequestContext(context)
			return addAssignee.mutateAsync({taskId: task.id!, user: {...user, id: user.id!}})
		}, config.concurrentWrites)
		return addLabelsToTask(
			{task: {...task, assignees: built.task.assignees}, parsedLabels: built.parsedLabels},
			context,
		)
	}

	async function createNewTask(input: Partial<Task>, overrides?: QuickAddOverrides) {
		const context = captureClientRequestContext()
		const built = await build(input, context, overrides)
		assertClientRequestContext(context)
		const created = await create.mutateAsync({...built.task, project_id: built.task.project_id!})
		const {task, skipped} = await finishTask(created, built, context)
		reportSkippedLabels(skipped)
		return task
	}

	// A present `labels` entry (even empty) replaces the labels parsed from the title, so callers can pass
	// only pre-resolved labels and a failed one is not reported once per line.
	async function createNewTasksBulk(entries: {title: string, project_id: number, labels?: string[]}[]) {
		const context = captureClientRequestContext()
		const built = await Promise.all(entries.map(async ({labels, ...entry}) => {
			const item = await build(entry, context)
			return labels === undefined ? item : {...item, parsedLabels: labels}
		}))
		assertClientRequestContext(context)
		const result = await bulk.mutateAsync(built.map(item => item.task))
		await runWrites(built.map((item, index) => ({item, index})), async ({item, index}) => {
			const task = result.tasks[index]
			if (!task) return
			// `error` stays reserved for failed creates: the caller restores the typed title on it.
			try {
				result.tasks[index] = (await finishTask(task, item, context)).task
			} catch {
				assertClientRequestContext(context)
			}
		}, config.concurrentWrites)
		return result
	}

	return {
		isLoading: computed(() => [create, bulk, addAssignee, addLabel].some(mutation => mutation.isPending.value)),
		createNewTask,
		createNewTasksBulk,
		findProjectId,
		ensureLabelsExist,
	}
}
