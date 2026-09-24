import {describe, it, expect} from 'vitest'
import {bucketRoleToggleDisabled} from './bucketRoleToggle'

const bucket = {id: 5}
const otherBucket = {id: 9}

describe('bucketRoleToggleDisabled', () => {
	it('disables the done toggle for a default-only bucket, leaves default enabled', () => {
		const view = {default_bucket_id: bucket.id, done_bucket_id: 0}
		expect(bucketRoleToggleDisabled(bucket, view, 'done')).toBe(true)
		expect(bucketRoleToggleDisabled(bucket, view, 'default')).toBe(false)
	})

	it('disables the default toggle for a done-only bucket, leaves done enabled', () => {
		const view = {default_bucket_id: 0, done_bucket_id: bucket.id}
		expect(bucketRoleToggleDisabled(bucket, view, 'default')).toBe(true)
		expect(bucketRoleToggleDisabled(bucket, view, 'done')).toBe(false)
	})

	it('enables both toggles for a bucket with neither role', () => {
		const view = {default_bucket_id: otherBucket.id, done_bucket_id: otherBucket.id}
		expect(bucketRoleToggleDisabled(bucket, view, 'done')).toBe(false)
		expect(bucketRoleToggleDisabled(bucket, view, 'default')).toBe(false)
	})

	it('keeps the done toggle enabled when the bucket already is the done bucket (can un-set)', () => {
		const view = {default_bucket_id: 0, done_bucket_id: bucket.id}
		expect(bucketRoleToggleDisabled(bucket, view, 'done')).toBe(false)
	})

	it('keeps the default toggle enabled when the bucket already is the default bucket (can un-set)', () => {
		const view = {default_bucket_id: bucket.id, done_bucket_id: 0}
		expect(bucketRoleToggleDisabled(bucket, view, 'default')).toBe(false)
	})

	it('avoids a lockout for a legacy bucket that is both default and done (both toggles stay enabled)', () => {
		const view = {default_bucket_id: bucket.id, done_bucket_id: bucket.id}
		expect(bucketRoleToggleDisabled(bucket, view, 'done')).toBe(false)
		expect(bucketRoleToggleDisabled(bucket, view, 'default')).toBe(false)
	})

	it('handles a null view by enabling both toggles', () => {
		expect(bucketRoleToggleDisabled(bucket, null, 'done')).toBe(false)
		expect(bucketRoleToggleDisabled(bucket, null, 'default')).toBe(false)
	})
})
