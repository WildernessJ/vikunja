import {describe, it, expect} from 'vitest'

import TaskModel from './task'
import ProjectModel from './project'
import ProjectViewModel from './projectView'

// Regression guard for the type-error burndown (#21): replacing `field: T = null`
// defaults with `field!: T` silently changed the runtime default from null to
// undefined. That broke `subscription` (undefined tripped a `[Object, null]`
// prop validator) and every `new Date(this.field)` date column (undefined ->
// Invalid Date instead of the epoch that `new Date(null)` produced on main).

describe('model construction defaults', () => {
	it('leaves an absent subscription as null, not undefined', () => {
		expect(new TaskModel({}).subscription).toBeNull()
		expect(new ProjectModel({}).subscription).toBeNull()
	})

	it('converts incoming date strings on ProjectViewModel to Date objects (#46)', () => {
		const raw = '2023-01-15T10:00:00Z'
		const view = new ProjectViewModel({created: raw as unknown as Date, updated: raw as unknown as Date})

		expect(view.created).toBeInstanceOf(Date)
		expect(view.updated).toBeInstanceOf(Date)
		expect(view.created.getTime()).toBe(new Date(raw).getTime())
		expect(view.updated.getTime()).toBe(new Date(raw).getTime())
	})
})

// #47 — one convention for every model's non-null Date column: default to the
// epoch sentinel `new Date(0)` AND convert an incoming API string to a Date in
// the constructor. Auto-enumerates the model directory so a new (or edited)
// model cannot silently opt out — the failure mode a hand-maintained list has.
const modelModules = import.meta.glob('./*.ts', {eager: true}) as Record<string, {default?: unknown}>

type ModelClass = new (data: Record<string, unknown>) => Record<string, unknown>

const models = Object.entries(modelModules)
	.filter(([path]) => !/(\.test\.ts$|\/abstractModel\.ts$)/.test(path))
	.map(([path, mod]) => [path.replace(/^\.\//, '').replace(/\.ts$/, ''), mod.default] as const)
	.filter((entry): entry is [string, ModelClass] => typeof entry[1] === 'function')

describe('#47 model date-column convention', () => {
	for (const [name, Model] of models) {
		let empty: Record<string, unknown>
		try {
			empty = new Model({})
		} catch {
			// Models that require specific constructor data are out of the generic guard's reach.
			continue
		}

		const dateFields = Object.entries(empty)
			.filter(([, v]) => v instanceof Date)
			.map(([k]) => k)

		if (dateFields.length === 0) {
			continue
		}

		it.each(dateFields)(`${name}.%s defaults to epoch and converts incoming strings`, (field) => {
			expect((empty[field] as Date).getTime()).toBe(0)

			const converted = new Model({[field]: '2023-01-15T10:00:00Z'})[field]
			expect(converted).toBeInstanceOf(Date)
			expect(Number.isNaN((converted as Date).getTime())).toBe(false)
		})
	}
})
