import type {IBucket} from '@/modelTypes/IBucket'
import type {IProjectView} from '@/modelTypes/IProjectView'

export type BucketRole = 'done' | 'default'

// A bucket may be the default bucket, the done bucket, or neither — never both
// (enforced by the backend and a migration). Enabling the role a bucket doesn't
// yet hold is blocked when it already holds the other one; un-setting a role the
// bucket already has is always allowed.
export function bucketRoleToggleDisabled(
	bucket: Pick<IBucket, 'id'>,
	view: Pick<IProjectView, 'defaultBucketId' | 'doneBucketId'> | null | undefined,
	role: BucketRole,
): boolean {
	if (role === 'done') {
		return bucket.id !== view?.doneBucketId && bucket.id === view?.defaultBucketId
	}

	return bucket.id !== view?.defaultBucketId && bucket.id === view?.doneBucketId
}
