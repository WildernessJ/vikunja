import type {IRepeatAfter} from '@/types/IRepeatAfter'
import type {TASK_REPEAT_MODES} from '@/types/IRepeatMode'

// IRRuleRepeat carries a calendar-pattern recurrence parsed from quick-add text
// (weekday sets, ordinals, month-days, …). It is mutually exclusive with the
// legacy interval `repeats` field: a parse yields one or the other, never both.
export interface IRRuleRepeat {
	mode: typeof TASK_REPEAT_MODES.REPEAT_MODE_RRULE,
	rrule: string,
	fromCompletion: boolean,
	// Set from a "starting <date>" bound; becomes the task's due date anchor.
	startDate: Date | null,
}

export interface repeatParsedResult {
	textWithoutMatched: string,
	repeats: IRepeatAfter | null,
	rruleRepeat: IRRuleRepeat | null,
}

export interface ParsedTaskText {
	text: string,
	date: Date | null,
	labels: string[],
	project: string | null,
	priority: number | null,
	assignees: string[],
	repeats: IRepeatAfter | null,
	rruleRepeat: IRRuleRepeat | null,
}

export interface Prefixes {
	label: string,
	project: string,
	priority: string,
	assignee: string,
}
