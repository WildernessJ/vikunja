import {describe, it, expect, vi} from 'vitest'
import {runBucketMoveWithCountRevert} from './runBucketMoveWithCountRevert'
import type {IBucket} from '@/modelTypes/IBucket'

function makeBucket(id: number, count: number): IBucket {
	return {id, count, tasks: []} as unknown as IBucket
}

describe('runBucketMoveWithCountRevert', () => {
	it('does not revert when the move succeeds', async () => {
		const setBucketById = vi.fn()
		const oldBucket = makeBucket(1, 4)
		const newBucket = makeBucket(2, 7)

		await runBucketMoveWithCountRevert(async () => {}, {
			bucketHasChanged: true,
			oldBucket,
			newBucket,
			setBucketById,
		})

		expect(setBucketById).not.toHaveBeenCalled()
	})

	it('reverts both buckets and rethrows when the move fails', async () => {
		const setBucketById = vi.fn()
		const oldBucket = makeBucket(1, 4)
		const newBucket = makeBucket(2, 7)
		const err = new Error('bucket move failed')

		await expect(runBucketMoveWithCountRevert(async () => {
			throw err
		}, {
			bucketHasChanged: true,
			oldBucket,
			newBucket,
			setBucketById,
		})).rejects.toBe(err)

		expect(setBucketById).toHaveBeenCalledTimes(2)
		expect(setBucketById).toHaveBeenNthCalledWith(1, oldBucket)
		expect(setBucketById).toHaveBeenNthCalledWith(2, newBucket)
	})

	it('does not revert on failure when the bucket did not change', async () => {
		const setBucketById = vi.fn()
		const newBucket = makeBucket(2, 7)

		await expect(runBucketMoveWithCountRevert(async () => {
			throw new Error('position update failed')
		}, {
			bucketHasChanged: false,
			oldBucket: undefined,
			newBucket,
			setBucketById,
		})).rejects.toThrow('position update failed')

		expect(setBucketById).not.toHaveBeenCalled()
	})

	// Regression guard for the reviewer scenario in PR #23: the bucket move confirms server-side,
	// then a later tie-break update on a DIFFERENT task fails. Because the tie-break lives outside
	// the revert scope, the confirmed bucket state must stay put — no false rollback.
	it('leaves confirmed bucket state intact when a later tie-break update fails', async () => {
		const setBucketById = vi.fn()
		const oldBucket = makeBucket(1, 4)
		const newBucket = makeBucket(2, 7)

		// 1-3: position + bucket move succeed and the store is updated with confirmed state.
		await runBucketMoveWithCountRevert(async () => {}, {
			bucketHasChanged: true,
			oldBucket,
			newBucket,
			setBucketById,
		})

		// 4: the "don't share position 0" tie-break update fails, outside the revert scope.
		const tieBreakUpdate = vi.fn().mockRejectedValue(new Error('conflict'))
		await expect(tieBreakUpdate()).rejects.toThrow('conflict')

		expect(setBucketById).not.toHaveBeenCalled()
	})
})
