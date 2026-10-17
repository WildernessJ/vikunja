// https://github.com/you-dont-need/You-Dont-Need-Lodash-Underscore#_isnil
export function isNil(value: unknown) {
	return value == null
}

export function omitBy(obj: Record<string, unknown>, check: (value: unknown) => boolean) {
	if (isNil(obj)) {
		return {}
	}

	return Object.fromEntries(
		Object.entries(obj).filter(([, value]) => !check(value)),
	)
}
