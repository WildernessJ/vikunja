import type {IBucket} from '@/modelTypes/IBucket'

interface BucketMoveRevertOptions {
	bucketHasChanged: boolean
	oldBucket: IBucket | undefined
	newBucket: IBucket
	setBucketById: (bucket: IBucket) => void
}

// Runs the actual bucket-move server calls and restores the optimistic count bump on failure.
// The revert is scoped to `move` alone: callers MUST keep follow-up work (e.g. the position-0
// tie-break update on a neighbouring task) outside this call, so an unrelated later failure can't
// discard bucket state the server already confirmed.
export async function runBucketMoveWithCountRevert(
	move: () => Promise<void>,
	{bucketHasChanged, oldBucket, newBucket, setBucketById}: BucketMoveRevertOptions,
): Promise<void> {
	try {
		await move()
	} catch (e) {
		if (bucketHasChanged && oldBucket !== undefined) {
			setBucketById(oldBucket)
			setBucketById(newBucket)
		}
		throw e
	}
}
