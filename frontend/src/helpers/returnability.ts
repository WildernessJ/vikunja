import type {RouteLocation, RouteMeta} from 'vue-router'

type Returnability = NonNullable<RouteMeta['returnability']>

// The two questions live in one table rather than in a comparison at each call site: the field was
// collapsed from two booleans so nobody could act on half the rule, and a `Record` keyed on the union
// is what actually holds that - a third value fails to compile until both answers are given for it.
const RETURNABILITY: Record<Returnability, {back: boolean, restore: boolean}> = {
	'no': {back: false, restore: false},
	'no-but-restore': {back: false, restore: true},
}

// Absent means an ordinary route, returnable and restorable both.
function rulesFor(route: Pick<RouteLocation, 'meta'>) {
	const returnability = route.meta?.returnability

	return returnability === undefined
		? {back: true, restore: true}
		: RETURNABILITY[returnability]
}

export function canReturnTo(route: Pick<RouteLocation, 'meta'>) {
	return rulesFor(route).back
}

export function shouldSaveAsLastVisited(route: Pick<RouteLocation, 'meta'>) {
	return rulesFor(route).restore
}
