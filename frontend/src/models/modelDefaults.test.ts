import {describe, it, expect} from 'vitest'

import TaskModel from './task'
import ProjectModel from './project'
import LabelModel from './label'
import ApiTokenModel from './apiTokenModel'
import BucketModel from './bucket'

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

	it('defaults absent date columns to a valid epoch Date, never Invalid Date', () => {
		const models = [
			new TaskModel({}),
			new ProjectModel({}),
			new LabelModel({}),
			new ApiTokenModel({}),
			new BucketModel({}),
		]

		for (const model of models) {
			expect(model.created.getTime()).toBe(0)
			expect(Number.isNaN(model.created.getTime())).toBe(false)
		}

		expect(new ApiTokenModel({}).expiresAt.getTime()).toBe(0)
	})
})
