// Overview is excluded — it's never hideable. Time-tracking is excluded — it's Pro-gated only.
// `as const` narrows each key to a literal so `ToggleableNavKey` can guard the hardcoded
// literals in Navigation.vue's template against a rename here.
export const TOGGLEABLE_NAV_ITEMS = [
	{key: 'upcoming', labelKey: 'navigation.upcoming'},
	{key: 'today', labelKey: 'navigation.today'},
	{key: 'projects', labelKey: 'project.projects'},
	{key: 'labels', labelKey: 'label.title'},
	{key: 'templates', labelKey: 'project.template.libraryTitle'},
	{key: 'teams', labelKey: 'team.title'},
] as const

export type ToggleableNavKey = typeof TOGGLEABLE_NAV_ITEMS[number]['key']

// frontend_settings is free-form JSON stored verbatim, so a tampered value could be a
// non-array. Normalize to a fresh mutable string[]: reads never throw, and readonly-escape
// sites get the clone they need.
export function normalizeHiddenNavItems(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((key): key is string => typeof key === 'string')
		: []
}
