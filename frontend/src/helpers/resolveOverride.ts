// Shared precedence rule for quick-add composer overrides: an override with a
// defined value (`null` counts — a deliberate clear) beats `fallback`; an absent
// key OR an explicit `undefined` value falls back. The value-check (not `key in`)
// matters: a present-`undefined` date field must fall back, not resolve to
// `undefined` and blow up a later `new Date(undefined)`. Keeps the
// useQuickAddComposer/tasks-store layers from drifting on this invariant.
export function resolveOverride<T extends object, K extends keyof T, F>(
	overrides: T | undefined,
	key: K,
	fallback: F,
): Exclude<T[K], undefined> | F {
	return (overrides !== undefined && overrides[key] !== undefined ? overrides[key] : fallback) as Exclude<T[K], undefined> | F
}
