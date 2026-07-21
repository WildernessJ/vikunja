import type {IProject} from '@/modelTypes/IProject'
import type {IUser} from '@/modelTypes/IUser'

const LEGACY_KEY_PREFIX = 'showSubprojectTasks:'
const KEY_PREFIX = 'subprojectRollup:'

export interface SubprojectRollupState {
	enabled: boolean,
	excluded: IProject['id'][],
}

const DEFAULT_STATE: SubprojectRollupState = {enabled: false, excluded: []}

function storageKey(userId: IUser['id'], projectId: IProject['id']) {
	return `${KEY_PREFIX}${userId}:${projectId}`
}

export function getSubprojectRollupState(userId: IUser['id'], projectId: IProject['id']): SubprojectRollupState {
	const raw = localStorage.getItem(storageKey(userId, projectId))
	if (raw !== null) {
		try {
			const parsed = JSON.parse(raw)
			return {
				enabled: parsed.enabled === true,
				// Drop non-numeric entries so a tampered/corrupt value degrades to
				// "no exclusions" instead of 400ing the whole task list request.
				excluded: Array.isArray(parsed.excluded)
					? parsed.excluded.filter((id: unknown): id is number => typeof id === 'number' && Number.isFinite(id))
					: [],
			}
		} catch {
			return {...DEFAULT_STATE}
		}
	}

	// Migrate the legacy non-namespaced boolean key (#55 shared-browser caveat).
	const legacyKey = `${LEGACY_KEY_PREFIX}${projectId}`
	if (localStorage.getItem(legacyKey) === 'true') {
		const migrated: SubprojectRollupState = {enabled: true, excluded: []}
		saveSubprojectRollupState(userId, projectId, migrated)
		localStorage.removeItem(legacyKey)
		return migrated
	}

	return {...DEFAULT_STATE}
}

export function saveSubprojectRollupState(userId: IUser['id'], projectId: IProject['id'], state: SubprojectRollupState) {
	if (!state.enabled) {
		localStorage.removeItem(storageKey(userId, projectId))
		return
	}
	localStorage.setItem(storageKey(userId, projectId), JSON.stringify(state))
}
