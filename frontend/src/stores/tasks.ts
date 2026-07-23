import {computed, ref} from 'vue'
import {acceptHMRUpdate, defineStore} from 'pinia'
import router from '@/router'

import TaskService from '@/services/task'
import TaskAssigneeService from '@/services/taskAssignee'
import LabelTaskService from '@/services/labelTask'
import TaskDuplicateService from '@/services/taskDuplicateService'
import TaskDuplicateModel from '@/models/taskDuplicateModel'

import {cleanupItemText, parseTaskText, PREFIXES} from '@/modules/quickAddMagic'

import TaskAssigneeModel from '@/models/taskAssignee'
import LabelTaskModel from '@/models/labelTask'
import LabelTask from '@/models/labelTask'
import TaskModel from '@/models/task'
import LabelModel from '@/models/label'
import TaskReminderModel from '@/models/taskReminder'

import type {IAbstract} from '@/modelTypes/IAbstract'
import type {ILabel} from '@/modelTypes/ILabel'
import type {ITask} from '@/modelTypes/ITask'
import type {ITaskReminder} from '@/modelTypes/ITaskReminder'
import type {IUser} from '@/modelTypes/IUser'
import type {IAttachment} from '@/modelTypes/IAttachment'
import type {IProject} from '@/modelTypes/IProject'

import {REMINDER_PERIOD_RELATIVE_TO_TYPES} from '@/types/IReminderPeriodRelativeTo'

import {setModuleLoading} from '@/stores/helper'
import {useConfigStore} from '@/stores/config'
import {useLabelStore} from '@/stores/labels'
import {useProjectStore} from '@/stores/projects'
import {useKanbanStore} from '@/stores/kanban'
import {useProjectCountsStore} from '@/stores/projectCounts'
import {useBaseStore} from '@/stores/base'
import ProjectUserService from '@/services/projectUsers'
import {useAuthStore} from '@/stores/auth'
import TaskCollectionService, {type TaskFilterParams} from '@/services/taskCollection'
import {getRandomColorHex} from '@/helpers/color/randomColor'
import {REPEAT_TYPES} from '@/types/IRepeatAfter'
import {TASK_REPEAT_MODES} from '@/types/IRepeatMode'
import type {Priority} from '@/constants/priorities'
import {resolveOverride} from '@/helpers/resolveOverride'
import {error, translate} from '@/message'

interface MatchedAssignee extends IUser {
	match: string,
}

// Structured values from the quick add composer's chip pickers. See
// resolveOverride for the present-vs-absent precedence rule these follow.
export interface CreateNewTaskOverrides {
	dueDate?: Date | string | null,
	priority?: number | null,
	labels?: ILabel[],
	projectId?: IProject['id'] | null,
	description?: string,
	reminders?: ITaskReminder[],
}

export function buildDefaultRemindersForQuickAdd(
	defaults: readonly ITaskReminder[] | undefined,
	dueDate: string | null,
): ITaskReminder[] {
	if (!dueDate) {
		return []
	}
	if (!defaults || defaults.length === 0) {
		return []
	}
	return defaults.map(d => new TaskReminderModel({
		reminder: null,
		relativePeriod: d.relativePeriod,
		relativeTo: REMINDER_PERIOD_RELATIVE_TO_TYPES.DUEDATE,
	}))
}

// runWrites applies a write to each item. SQLite deadlocks on concurrent writes
// (read-then-write upgrade conflict), so callers pass concurrent=false to serialize.
export async function runWrites<T>(
	items: readonly T[],
	write: (item: T) => Promise<unknown>,
	concurrent: boolean,
): Promise<void> {
	if (concurrent) {
		await Promise.all(items.map(item => write(item)))
		return
	}
	for (const item of items) {
		await write(item)
	}
}

// IDEA: maybe use a small fuzzy search here to prevent errors
function findPropertyByValue<T>(object: T[], key: keyof T, value: string, fuzzy = false): T | undefined {
	return object.find(l => {
		const propValue = l[key]
		if (typeof propValue !== 'string') {
			return false
		}

		if (fuzzy) {
			return propValue.toLowerCase().includes(value.toLowerCase())
		}

		return propValue.toLowerCase() === value.toLowerCase()
	})
}

// Check if the user exists in the search results
function validateUser<T extends IUser>(
	users: T[],
	query: IUser['username'] | IUser['name'] | IUser['email'],
): T | undefined {
	if (users.length === 1) {
		return (
			findPropertyByValue(users, 'username', query, true) ||
			findPropertyByValue(users, 'name', query, true) ||
			findPropertyByValue(users, 'email', query, true)
		)
	}
	
	return (
		findPropertyByValue(users, 'username', query) ||
		findPropertyByValue(users, 'name', query) ||
		findPropertyByValue(users, 'email', query)
	)
}

// Check if the label exists
function validateLabel(labels: ILabel[], label: string) {
	return findPropertyByValue(labels, 'title', label)
}

async function addLabelToTask(task: ITask, label: ILabel) {
	const labelTask = new LabelTask({
		taskId: task.id,
		labelId: label.id,
	})
	const labelTaskService = new LabelTaskService()
	const response = await labelTaskService.create(labelTask)
	task.labels.push(label)
	return response
}

async function findAssignees(parsedTaskAssignees: string[], projectId: number): Promise<MatchedAssignee[]> {
	if (parsedTaskAssignees.length <= 0) {
		return []
	}

	const userService = new ProjectUserService()
	const assignees = parsedTaskAssignees.map(async a => {
		// ProjectUserService is untyped (extends AbstractService with the default
		// IAbstract model), but its modelFactory always returns UserModel instances.
		const users = (await userService.getAll({projectId} as unknown as IAbstract, {s: a})) as IUser[]
		const matchedUsers = users.map(u => ({
			...u,
			match: a,
		}))
		return validateUser(matchedUsers, a)
	})

	const validatedUsers = await Promise.all(assignees)
	return validatedUsers.filter((item): item is MatchedAssignee => Boolean(item))
}

export const useTaskStore = defineStore('task', () => {
	const baseStore = useBaseStore()
	const kanbanStore = useKanbanStore()
	// Sidebar/Today count refresh is wired into this store's create/update/delete.
	// Call sites that reschedule tasks (DeferTask, Gantt drag) route through
	// update() rather than hitting taskService directly, so the badges stay current.
	const projectCountsStore = useProjectCountsStore()
	const labelStore = useLabelStore()
	const projectStore = useProjectStore()
	const authStore = useAuthStore()
	const configStore = useConfigStore()

	const tasks = ref<{ [id: ITask['id']]: ITask }>({}) // TODO: or is this ITask[]
	const isLoading = ref(false)
	const draggedTask = ref<ITask | null>(null)
	const lastUpdatedTask = ref<ITask | null>(null)

	const hasTasks = computed(() => Object.keys(tasks.value).length > 0)

	function setIsLoading(newIsLoading: boolean) {
		isLoading.value = newIsLoading
	}

	function setDraggedTask(task: ITask | null) {
		draggedTask.value = task
	}

	function setTasks(newTasks: ITask[]) {
		newTasks.forEach(task => {
			tasks.value[task.id] = task
		})
	}

	async function loadTasks(
		params: TaskFilterParams, 
		projectId: IProject['id'] | null = null,
	) {
		
		if (!params.filter_timezone || params.filter_timezone === '') {
			params.filter_timezone = authStore.settings.timezone
		}

		const cancel = setModuleLoading(setIsLoading)
		try {
			const model = new TaskModel({})
			let taskCollectionService: TaskService | TaskCollectionService = new TaskService()
			if (projectId !== null) {
				model.projectId = projectId
				taskCollectionService = new TaskCollectionService()
			}
			tasks.value = await taskCollectionService.getAll(model, params)
			baseStore.setHasTasks(Object.keys(tasks.value).length > 0)
			return tasks.value
		} finally {
			cancel()
		}
	}

	async function update(task: ITask) {
		const cancel = setModuleLoading(setIsLoading)

		const taskService = new TaskService()
		try {
			const updatedTask = await taskService.update(task)
			kanbanStore.ensureTaskIsInCorrectBucket(updatedTask)
			lastUpdatedTask.value = updatedTask
			// Keep the sidebar/Today badges current after done-toggles and
			// due-date edits. Fire-and-forget so it never blocks the update.
			void projectCountsStore.loadCounts()
			return updatedTask
		} finally {
			cancel()
		}
	}

	async function deleteTask(task: ITask) {
		const taskService = new TaskService()
		const response = await taskService.delete(task)
		kanbanStore.removeTaskInBucket(task)
		void projectCountsStore.loadCounts()
		return response
	}

	// Adds a task attachment in store.
	// This is an action to be able to commit other mutations
	function addTaskAttachment({
		taskId,
		attachment,
	}: {
		taskId: ITask['id']
		attachment: IAttachment
	}) {
		const {bucketIndex, taskIndex, task} = kanbanStore.getTaskById(taskId)
		if (task === null || bucketIndex === null || taskIndex === null) {
			return
		}

		const attachments = [
			...task.attachments,
			attachment,
		]

		kanbanStore.setTaskInBucketByIndex({
			bucketIndex,
			taskIndex,
			task: {
				...task,
				attachments,
			},
		})
	}

	async function addAssignee({
		user,
		taskId,
	}: {
		user: IUser,
		taskId: ITask['id']
	}) {
		const cancel = setModuleLoading(setIsLoading)
		
		try {
			const taskAssigneeService = new TaskAssigneeService()
			const r = await taskAssigneeService.create(new TaskAssigneeModel({
				userId: user.id,
				taskId: taskId,
			}))
			const {bucketIndex, taskIndex, task} = kanbanStore.getTaskById(taskId)
			if (task === null || bucketIndex === null || taskIndex === null) {
				// Don't try further adding a label if the task is not in kanban
				// Usually this means the kanban board hasn't been accessed until now.
				// Vuex seems to have its difficulties with that, so we just log the error and fail silently.
				console.debug('Could not add assignee to task in kanban, task not found', {taskId, bucketIndex, taskIndex, task})
				return r
			}

			kanbanStore.setTaskInBucketByIndex({
				bucketIndex,
				taskIndex,
				task: {
					...task,
					assignees: [
						...task.assignees,
						user,
					],
				},
			})

			return r
		} finally {
			cancel()
		}
	}

	async function removeAssignee({
		user,
		taskId,
	}: {
		user: IUser,
		taskId: ITask['id']
	}) {
		const taskAssigneeService = new TaskAssigneeService()
		const response = await taskAssigneeService.delete(new TaskAssigneeModel({
			userId: user.id,
			taskId: taskId,
		}))
		const {bucketIndex, taskIndex, task} = kanbanStore.getTaskById(taskId)
		if (task === null || bucketIndex === null || taskIndex === null) {
			// Don't try further adding a label if the task is not in kanban
			// Usually this means the kanban board hasn't been accessed until now.
			// Vuex seems to have its difficulties with that, so we just log the error and fail silently.
			console.debug('Could not remove assignee from task in kanban, task not found', {taskId, bucketIndex, taskIndex, task})
			return response
		}

		const assignees = task.assignees.filter(({ id }) => id !== user.id)

		kanbanStore.setTaskInBucketByIndex({
			bucketIndex,
			taskIndex,
			task: {
				...task,
				assignees,
			},
		})
		return response

	}

	async function addLabel({
		label,
		taskId,
	} : {
		label: ILabel,
		taskId: ITask['id']
	}) {
		const labelTaskService = new LabelTaskService()
		const r = await labelTaskService.create(new LabelTaskModel({
			taskId,
			labelId: label.id,
		}))
		const {bucketIndex, taskIndex, task} = kanbanStore.getTaskById(taskId)
		if (task === null || bucketIndex === null || taskIndex === null) {
			// Don't try further adding a label if the task is not in kanban
			// Usually this means the kanban board hasn't been accessed until now.
			// Vuex seems to have its difficulties with that, so we just log the error and fail silently.
			console.debug('Could not add label to task in kanban, task not found', {taskId, bucketIndex, taskIndex, task})
			return r
		}

		kanbanStore.setTaskInBucketByIndex({
			bucketIndex,
			taskIndex,
			task: {
				...task,
				labels: [
					...task.labels,
					label,
				],
			},
		})

		return r
	}

	async function removeLabel(
		{label, taskId}:
		{label: ILabel, taskId: ITask['id']},
	) {
		const labelTaskService = new LabelTaskService()
		const response = await labelTaskService.delete(new LabelTaskModel({
			taskId, labelId:
			label.id,
		}))
		const {bucketIndex, taskIndex, task} = kanbanStore.getTaskById(taskId)
		if (task === null || bucketIndex === null || taskIndex === null) {
			// Don't try further adding a label if the task is not in kanban
			// Usually this means the kanban board hasn't been accessed until now.
			// Vuex seems to have its difficulties with that, so we just log the error and fail silently.
			console.debug('Could not remove label from task in kanban, task not found', {taskId, bucketIndex, taskIndex, task})
			return response
		}

		// Remove the label from the project
		const labels = task.labels.filter(({ id }) => id !== label.id)

		kanbanStore.setTaskInBucketByIndex({
			bucketIndex,
			taskIndex,
			task: {
				...task,
				labels,
			},
		})

		return response
	}
	
	async function ensureLabelsExist(labels: string[]): Promise<ILabel[]> {
		const all = [...new Set(labels)]
		const mustCreateLabel = all.map(async labelTitle => {
			let label = validateLabel(Object.values(labelStore.labels), labelTitle)
			if (typeof label === 'undefined') {
				const labelModel = new LabelModel({
					title: labelTitle,
					hexColor: getRandomColorHex(),
				})
				try {
					label = await labelStore.createLabel(labelModel)
				} catch (e) {
					// Link shares may not create labels; skip it instead of aborting task creation.
					console.debug('Could not create label from quick add magic', {labelTitle, e})
					return undefined
				}
			}
			return label
		})
		const resolved = await Promise.all(mustCreateLabel)
		const failedTitles = all.filter((_, i) => typeof resolved[i] === 'undefined')
		if (failedTitles.length > 0) {
			// User-facing toast side-effect: this (and addLabelsToTask, which calls it) must
			// only be invoked from interactive task-creation contexts, never silent/bulk/import paths.
			error({message: translate('task.label.createFailed', {labels: failedTitles.join(', ')})})
		}
		return resolved.filter((label): label is LabelModel => typeof label !== 'undefined')
	}

	// Do everything that is involved in finding, creating and adding the label to the task
	async function addLabelsToTask(
		{ task, parsedLabels }:
		{ task: ITask, parsedLabels: string[] },
	) {
		if (parsedLabels.length <= 0) {
			return task
		}

		const labels = await ensureLabelsExist(parsedLabels)
		await runWrites(labels, l => addLabelToTask(task, l), configStore.concurrentWrites)
		return task
	}

	function findProjectId(
		{ project: projectName, projectId }:
		{ project: string | null, projectId: IProject['id'] }) {
		let foundProjectId = null

		// Uses the following ways to get the project id of the new task:
		//  1. If specified in quick add magic, look in store if it exists and use it if it does
		if (typeof projectName !== 'undefined' && projectName !== null) {
			let project = projectStore.findProjectByExactname(projectName)
			
			if (project === null) {
				project = projectStore.findProjectByIdentifier(projectName)
			}
			
			foundProjectId = project === null ? null : project.id
			if (foundProjectId !== null) {
				return foundProjectId
			}
		}
		
		//  2. Else check if a project was passed as parameter
		if (foundProjectId === null && projectId !== 0) {
			foundProjectId = projectId
		}
	
		//  3. Otherwise use the id from the route parameter
		const projectIdFromRoute = Number(router.currentRoute.value.params.projectId)
		if (typeof router.currentRoute.value.params.projectId !== 'undefined' && projectIdFromRoute > 0) {
			foundProjectId = projectIdFromRoute
		}
		
		//  4. If none of the above worked, reject the promise with an error.
		if (typeof foundProjectId === 'undefined' || projectId === null) {
			throw new Error('NO_PROJECT')
		}
	
		return foundProjectId
	}
	
	async function createNewTask({
		title,
		bucketId,
		projectId,
		position,
		index,
	} :
		// title is required here even though ITask fields are otherwise optional -
		// quick add magic parsing has nothing meaningful to parse without it.
		Partial<ITask> & Pick<ITask, 'title'>,
	overrides?: CreateNewTaskOverrides,
	) {
		const cancel = setModuleLoading(setIsLoading)
		const quickAddMagicMode = authStore.settings.frontendSettings.quickAddMagicMode
		const parsedTask = parseTaskText(title, quickAddMagicMode)

		if(parsedTask.text === '' && !(overrides !== undefined && Object.keys(overrides).length > 0)) {
			const taskService = new TaskService()
			try {
				return taskService.create(new TaskModel({
					title,
					projectId,
					bucketId,
					position,
					index,
				}))
			} finally {
				cancel()
			}
		}

		const overrideProjectId = resolveOverride(overrides, 'projectId', undefined)
		const foundProjectId = overrideProjectId !== undefined
			? (overrideProjectId !== null
				? overrideProjectId
				: await findProjectId({project: null, projectId: projectId || 0}))
			: await findProjectId({project: parsedTask.project, projectId: projectId || 0})

		if(foundProjectId === null || foundProjectId === 0) {
			cancel()
			throw new Error('NO_PROJECT')
		}

		const assignees = await findAssignees(parsedTask.assignees, foundProjectId)

		// A pure-magic input (e.g. just "!3") parses down to empty text; keep the raw
		// title rather than creating a title-less task.
		let cleanedTitle = parsedTask.text !== '' ? parsedTask.text : title
		if (assignees.length > 0) {
			const assigneePrefix = PREFIXES[quickAddMagicMode]?.assignee
			if (assigneePrefix) {
				cleanedTitle = cleanupItemText(cleanedTitle, assignees.map(a  => a.match), assigneePrefix)
			}
		}

		// A calendar-pattern "starting <date>" bound anchors the first occurrence
		// on the task's due date when no explicit due date was parsed.
		const anchorDate = parsedTask.date ?? parsedTask.rruleRepeat?.startDate ?? null
		// I don't know why, but it all goes up in flames when I just pass in the date normally.
		const resolvedDueDate = resolveOverride(overrides, 'dueDate', anchorDate)
		const dueDate = resolvedDueDate !== null ? new Date(resolvedDueDate).toISOString() : null

		const deadline = parsedTask.deadline !== null ? new Date(parsedTask.deadline).toISOString() : null

		const task = new TaskModel({
			title: cleanedTitle,
			projectId: foundProjectId,
			dueDate: dueDate as unknown as Date | null,
			deadline: deadline as unknown as Date | null,
			priority: (resolveOverride(overrides, 'priority', parsedTask.priority) ?? undefined) as Priority | undefined,
			description: overrides?.description ?? undefined,
			assignees,
			bucketId: bucketId || 0,
			position,
			index,
		})
		if (parsedTask.repeats !== null) {
			task.repeatAfter = parsedTask.repeats
		}
		// Precedence: a chip override (present, even empty []) wins; else reminders
		// parsed from `~` magic-text; else the quick-add default reminders derived
		// from the due date. Parsed reminders replace (not stack onto) the defaults —
		// an explicit `~1d` is a deliberate choice, like touching the chip.
		task.reminders = resolveOverride(overrides, 'reminders', undefined)
			?? (parsedTask.reminders.length > 0
				? parsedTask.reminders
				: buildDefaultRemindersForQuickAdd(
					authStore.settings.frontendSettings.quickAddDefaultReminders,
					dueDate,
				))

		if (parsedTask.rruleRepeat !== null) {
			task.repeatMode = TASK_REPEAT_MODES.REPEAT_MODE_RRULE
			task.repeatRrule = parsedTask.rruleRepeat.rrule
			task.repeatFromCompletion = parsedTask.rruleRepeat.fromCompletion
		} else if (parsedTask.repeats?.type === REPEAT_TYPES.Months && parsedTask.repeats?.amount === 1) {
			task.repeatMode = TASK_REPEAT_MODES.REPEAT_MODE_MONTH
		}

		const taskService = new TaskService()
		try {
			const createdTask = await taskService.create(task)
			void projectCountsStore.loadCounts()
			const overrideLabels = resolveOverride(overrides, 'labels', undefined)
			return await addLabelsToTask({
				task: createdTask,
				parsedLabels: overrideLabels !== undefined ? overrideLabels.map(l => l.title) : parsedTask.labels,
			})
		} finally {
			cancel()
		}
	}
	
	async function setCoverImage(task: ITask, attachment: IAttachment | null) {
		return update({
			...task,
			coverImageAttachmentId: attachment ? attachment.id : 0,
		})
	}
	
	async function toggleFavorite(task: ITask) {
		const taskService = new TaskService()
		const wasFavorite = task.isFavorite
		task.isFavorite = !task.isFavorite
		try {
			task = await taskService.update(task)
		} catch (e) {
			task.isFavorite = wasFavorite
			throw e
		}

		// reloading the projects list so that the Favorites project shows up or is hidden when there are (or are not) favorite tasks
		await projectStore.loadAllProjects()

		return task
	}

	async function duplicateTask(taskId: ITask['id']) {
		const cancel = setModuleLoading(setIsLoading)
		try {
			const taskDuplicateService = new TaskDuplicateService()
			const response = await taskDuplicateService.create(new TaskDuplicateModel({taskId}))
			return response.duplicatedTask
		} finally {
			cancel()
		}
	}

	async function markTaskAsRead(taskId: ITask['id']) {
		const taskService = new TaskService()
		await taskService.markTaskAsRead(taskId)
		
		const t = kanbanStore.getTaskById(taskId)
		if (t.task !== null) {
			kanbanStore.setTaskInBucket({
				...t.task,
				isUnread: false,
			})
		}
		
		if (tasks.value[taskId]) {
			tasks.value[taskId] = {
				...tasks.value[taskId],
				isUnread: false,
			}
		}
	}

	return {
		tasks,
		isLoading,
		draggedTask,
		lastUpdatedTask,

		hasTasks,

		setTasks,
		setDraggedTask,
		loadTasks,
		update,
		delete: deleteTask, // since delete is a reserved word we have to alias here
		addTaskAttachment,
		addAssignee,
		removeAssignee,
		addLabel,
		removeLabel,
		addLabelsToTask,
		createNewTask,
		setCoverImage,
		findProjectId,
		ensureLabelsExist,
		toggleFavorite,
		duplicateTask,
		markTaskAsRead,
	}
})

// support hot reloading
if (import.meta.hot) {
	import.meta.hot.accept(acceptHMRUpdate(useTaskStore, import.meta.hot))
}
