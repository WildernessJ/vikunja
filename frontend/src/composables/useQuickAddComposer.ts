import {computed, reactive, type Ref} from 'vue'

import {parseTaskText, PrefixMode} from '@/modules/quickAddMagic'
import {useDateOnly} from '@/composables/useDateOnly'
import {parseSubtasksViaIndention} from '@/helpers/parseSubtasksViaIndention'
import {resolveOverride} from '@/helpers/resolveOverride'
import type {Label} from '@/client/generated'
import type {IProject} from '@/modelTypes/IProject'
import type {ITaskReminder} from '@/modelTypes/ITaskReminder'
import type {CreateNewTaskOverrides} from '@/stores/tasks'

// See resolveOverride for the present-vs-absent precedence rule this composer's
// chips rely on.
export interface ComposerOverrides {
	dueDate?: Date | null,
	priority?: number | null,
	labels?: Label[],
	project?: IProject | null,
	description?: string,
	reminders?: ITaskReminder[],
}

const EMPTY_LABEL_LIST: Label[] = []
const EMPTY_REMINDER_LIST: ITaskReminder[] = []

export function useQuickAddComposer(title: Ref<string>, mode: Ref<PrefixMode>) {
	const {store: dateOnly} = useDateOnly()

	const overrides = reactive<ComposerOverrides>({})

	const isMultiline = computed(() => parseSubtasksViaIndention(title.value, mode.value).length > 1)

	const parsed = computed(() => {
		if (mode.value === PrefixMode.Disabled || isMultiline.value) {
			return parseTaskText('', PrefixMode.Disabled)
		}
		return parseTaskText(title.value, mode.value, new Date(), dateOnly.value)
	})

	const effectiveDate = computed<Date | null>(
		() => resolveOverride(overrides, 'dueDate', parsed.value.date),
	)
	const effectivePriority = computed<number | null>(
		() => resolveOverride(overrides, 'priority', parsed.value.priority),
	)
	const effectiveLabels = computed<Label[]>(
		() => overrides.labels ?? (parsed.value.labels.length > 0
			? parsed.value.labels.map(name => ({title: name} as Label))
			: EMPTY_LABEL_LIST),
	)
	const effectiveProject = computed<IProject | null>(
		() => resolveOverride(overrides, 'project', null),
	)
	const effectiveProjectName = computed<string | null>(
		() => overrides.project !== undefined ? null : parsed.value.project,
	)
	const effectiveRepeats = computed(() => parsed.value.repeats ?? parsed.value.rruleRepeat)
	const effectiveReminders = computed<ITaskReminder[]>(
		() => overrides.reminders ?? (parsed.value.reminders.length > 0
			? parsed.value.reminders
			: EMPTY_REMINDER_LIST),
	)

	function setOverride<K extends keyof ComposerOverrides>(key: K, value: ComposerOverrides[K]) {
		overrides[key] = value
	}

	function clearOverride(key: keyof ComposerOverrides) {
		delete overrides[key]
	}

	function clearAll() {
		(Object.keys(overrides) as (keyof ComposerOverrides)[]).forEach(key => delete overrides[key])
	}

	function toStoreOverrides(): CreateNewTaskOverrides {
		const result: CreateNewTaskOverrides = {}
		if (overrides.dueDate !== undefined) {
			result.dueDate = overrides.dueDate
		}
		if (overrides.priority !== undefined) {
			result.priority = overrides.priority
		}
		if (overrides.labels !== undefined) {
			result.labels = overrides.labels
		}
		if (overrides.project !== undefined) {
			result.projectId = overrides.project?.id ?? null
		}
		if (overrides.description !== undefined) {
			result.description = overrides.description
		}
		if (overrides.reminders !== undefined) {
			result.reminders = overrides.reminders
		}
		return result
	}

	return {
		overrides,
		isMultiline,
		effectiveDate,
		effectivePriority,
		effectiveLabels,
		effectiveProject,
		effectiveProjectName,
		effectiveRepeats,
		effectiveReminders,
		setOverride,
		clearOverride,
		clearAll,
		toStoreOverrides,
	}
}
