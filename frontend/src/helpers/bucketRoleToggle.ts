import type {IBucket} from '@/modelTypes/IBucket'
import type {ProjectView} from '@/client/generated'

export type BucketRole = 'done' | 'default'

// A bucket may be the default bucket, the done bucket, or neither — never both
// (enforced by the backend and a migration). Enabling the role a bucket doesn't
// yet hold is blocked when it already holds the other one; un-setting a role the
// bucket already has is always allowed.
export function bucketRoleToggleDisabled(
	bucket: Pick<IBucket, 'id'>,
	view: Pick<ProjectView, 'default_bucket_id' | 'done_bucket_id'> | null | undefined,
	role: BucketRole,
): boolean {
	if (role === 'done') {
		return bucket.id !== view?.done_bucket_id && bucket.id === view?.default_bucket_id
	}

	return bucket.id !== view?.default_bucket_id && bucket.id === view?.done_bucket_id
}
