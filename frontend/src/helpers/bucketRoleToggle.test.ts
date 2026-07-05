import {describe, it, expect} from 'vitest'
import {bucketRoleToggleDisabled} from './bucketRoleToggle'

const bucket = {id: 5}
const otherBucket = {id: 9}

describe('bucketRoleToggleDisabled', () => {
	it('disables the done toggle for a default-only bucket, leaves default enabled', () => {
		const view = {defaultBucketId: bucket.id, doneBucketId: 0}
		expect(bucketRoleToggleDisabled(bucket, view, 'done')).toBe(true)
		expect(bucketRoleToggleDisabled(bucket, view, 'default')).toBe(false)
	})

	it('disables the default toggle for a done-only bucket, leaves done enabled', () => {
		const view = {defaultBucketId: 0, doneBucketId: bucket.id}
		expect(bucketRoleToggleDisabled(bucket, view, 'default')).toBe(true)
		expect(bucketRoleToggleDisabled(bucket, view, 'done')).toBe(false)
	})

	it('enables both toggles for a bucket with neither role', () => {
		const view = {defaultBucketId: otherBucket.id, doneBucketId: otherBucket.id}
		expect(bucketRoleToggleDisabled(bucket, view, 'done')).toBe(false)
		expect(bucketRoleToggleDisabled(bucket, view, 'default')).toBe(false)
	})

	it('keeps the done toggle enabled when the bucket already is the done bucket (can un-set)', () => {
		const view = {defaultBucketId: 0, doneBucketId: bucket.id}
		expect(bucketRoleToggleDisabled(bucket, view, 'done')).toBe(false)
	})

	it('keeps the default toggle enabled when the bucket already is the default bucket (can un-set)', () => {
		const view = {defaultBucketId: bucket.id, doneBucketId: 0}
		expect(bucketRoleToggleDisabled(bucket, view, 'default')).toBe(false)
	})

	it('handles a null view by enabling both toggles', () => {
		expect(bucketRoleToggleDisabled(bucket, null, 'done')).toBe(false)
		expect(bucketRoleToggleDisabled(bucket, null, 'default')).toBe(false)
	})
})
