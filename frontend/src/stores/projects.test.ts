import {setActivePinia, createPinia} from 'pinia'
import {describe, it, expect, beforeEach, vi} from 'vitest'

import {useProjectStore} from './projects'

import type {IProject} from '@/modelTypes/IProject'

// Mock the dependencies that the store imports
vi.mock('vue-router', () => ({
	useRouter: () => ({
		push: vi.fn(),
	}),
}))

vi.mock('vue-i18n', () => ({
	useI18n: () => ({
		t: (key: string) => key,
	}),
	createI18n: () => ({
		global: {
			t: (key: string) => key,
		},
	}),
}))

vi.mock('@/stores/base', () => ({
	useBaseStore: () => ({
		currentProject: null,
		setCurrentProject: vi.fn(),
	}),
}))

const projectUpdateMock = vi.fn()
vi.mock('@/services/project', () => ({
	default: class {
		update = projectUpdateMock
	},
}))

function createMockProject(overrides: Partial<IProject>): IProject {
	return {
		id: 1,
		title: 'Test Project',
		description: '',
		owner: {id: 1, username: 'test', name: '', email: '', created: new Date(), updated: new Date()},
		tasks: [],
		isArchived: false,
		hexColor: '',
		identifier: '',
		backgroundInformation: null,
		isFavorite: false,
		subscription: null as any,
		position: 0,
		backgroundBlurHash: '',
		parentProjectId: 0,
		views: [],
		created: new Date(),
		updated: new Date(),
		...overrides,
	} as IProject
}

describe('project store', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		projectUpdateMock.mockReset()
	})

	describe('notArchivedRootProjects', () => {
		it('should include root projects (parentProjectId === 0)', () => {
			const store = useProjectStore()
			const rootProject = createMockProject({id: 1, parentProjectId: 0, title: 'Root'})

			store.setProject(rootProject)

			expect(store.notArchivedRootProjects).toHaveLength(1)
			expect(store.notArchivedRootProjects[0].title).toBe('Root')
		})

		it('should exclude archived projects', () => {
			const store = useProjectStore()
			const archivedProject = createMockProject({id: 1, parentProjectId: 0, isArchived: true})

			store.setProject(archivedProject)

			expect(store.notArchivedRootProjects).toHaveLength(0)
		})

		it('should exclude saved filters (id < 0)', () => {
			const store = useProjectStore()
			const savedFilter = createMockProject({id: -2, parentProjectId: 0})

			store.setProject(savedFilter)

			expect(store.notArchivedRootProjects).toHaveLength(0)
		})

		it('should exclude sub-projects when parent is accessible', () => {
			const store = useProjectStore()
			const parentProject = createMockProject({id: 1, parentProjectId: 0, title: 'Parent'})
			const childProject = createMockProject({id: 2, parentProjectId: 1, title: 'Child'})

			store.setProject(parentProject)
			store.setProject(childProject)

			// Only parent should be in root projects
			expect(store.notArchivedRootProjects).toHaveLength(1)
			expect(store.notArchivedRootProjects[0].title).toBe('Parent')
		})

		it('should include orphaned sub-projects (parent not accessible)', () => {
			const store = useProjectStore()
			// Sub-project with parentProjectId pointing to a project not in the store
			const orphanedProject = createMockProject({id: 2, parentProjectId: 999, title: 'Orphaned'})

			store.setProject(orphanedProject)

			// Orphaned project should appear as a root project
			expect(store.notArchivedRootProjects).toHaveLength(1)
			expect(store.notArchivedRootProjects[0].title).toBe('Orphaned')
		})

		it('should handle mixed scenario with root, child, and orphaned projects', () => {
			const store = useProjectStore()
			const rootProject = createMockProject({id: 1, parentProjectId: 0, title: 'Root', position: 1})
			const childProject = createMockProject({id: 2, parentProjectId: 1, title: 'Child', position: 2})
			const orphanedProject = createMockProject({id: 3, parentProjectId: 999, title: 'Orphaned', position: 3})

			store.setProject(rootProject)
			store.setProject(childProject)
			store.setProject(orphanedProject)

			// Root and orphaned should be in root projects, but not child
			expect(store.notArchivedRootProjects).toHaveLength(2)
			const titles = store.notArchivedRootProjects.map(p => p.title)
			expect(titles).toContain('Root')
			expect(titles).toContain('Orphaned')
			expect(titles).not.toContain('Child')
		})
	})

	describe('updateProject', () => {
		it('does not flip isFavorite when the update fails', async () => {
			const store = useProjectStore()
			const project = createMockProject({id: 1, isFavorite: true, title: 'Original'})
			store.setProject(project)

			projectUpdateMock.mockRejectedValueOnce(new Error('network down'))

			await expect(store.updateProject({...project, title: 'Renamed'})).rejects.toThrow()

			// A failed non-favorite update must restore the last-known-good state,
			// not corrupt the favorite star.
			expect(store.projects[1].isFavorite).toBe(true)
			expect(store.projects[1].title).toBe('Original')
		})

		it('does not roll back a concurrent successful update when a later one fails', async () => {
			const store = useProjectStore()
			const original = createMockProject({id: 1, title: 'Original'})
			store.setProject(original)

			// First call succeeds; second is left pending so it settles after the first.
			let rejectSecond: (e: Error) => void = () => {}
			projectUpdateMock
				.mockResolvedValueOnce(createMockProject({id: 1, title: 'First'}))
				.mockImplementationOnce(() => new Promise((_, reject) => {
					rejectSecond = reject
				}))

			const p1 = store.updateProject({...original, title: 'First'})
			const p2 = store.updateProject({...original, title: 'Second'})

			await p1
			rejectSecond(new Error('network down'))
			await expect(p2).rejects.toThrow()

			// The failed second call must not revert the store over the first's
			// committed success.
			expect(store.projects[1].title).toBe('First')
		})
	})

	describe('isOrphanedSubProject', () => {
		it('should return false for root projects', () => {
			const store = useProjectStore()
			const rootProject = createMockProject({id: 1, parentProjectId: 0})

			store.setProject(rootProject)

			expect(store.isOrphanedSubProject(rootProject)).toBe(false)
		})

		it('should return false for sub-projects with accessible parent', () => {
			const store = useProjectStore()
			const parentProject = createMockProject({id: 1, parentProjectId: 0})
			const childProject = createMockProject({id: 2, parentProjectId: 1})

			store.setProject(parentProject)
			store.setProject(childProject)

			expect(store.isOrphanedSubProject(childProject)).toBe(false)
		})

		it('should return true for sub-projects with inaccessible parent', () => {
			const store = useProjectStore()
			const orphanedProject = createMockProject({id: 2, parentProjectId: 999})

			store.setProject(orphanedProject)

			expect(store.isOrphanedSubProject(orphanedProject)).toBe(true)
		})
	})

	describe('getEffectiveParentProjectId', () => {
		it('should return DOM parentProjectId for root projects', () => {
			const store = useProjectStore()
			const rootProject = createMockProject({id: 1, parentProjectId: 0})

			store.setProject(rootProject)

			// Dragged within root level
			expect(store.getEffectiveParentProjectId(rootProject, 0)).toBe(0)
			// Dragged into a sub-project
			expect(store.getEffectiveParentProjectId(rootProject, 5)).toBe(5)
		})

		it('should return DOM parentProjectId for sub-projects with accessible parent', () => {
			const store = useProjectStore()
			const parentProject = createMockProject({id: 1, parentProjectId: 0})
			const childProject = createMockProject({id: 2, parentProjectId: 1})

			store.setProject(parentProject)
			store.setProject(childProject)

			// Dragged to root level - allow reparenting
			expect(store.getEffectiveParentProjectId(childProject, 0)).toBe(0)
			// Dragged to another parent
			expect(store.getEffectiveParentProjectId(childProject, 5)).toBe(5)
		})

		it('should preserve original parentProjectId for orphaned sub-projects at root level', () => {
			const store = useProjectStore()
			const orphanedProject = createMockProject({id: 2, parentProjectId: 999})

			store.setProject(orphanedProject)

			// Dragged within root level (DOM says 0) - preserve original to prevent detachment
			expect(store.getEffectiveParentProjectId(orphanedProject, 0)).toBe(999)
		})

		it('should allow orphaned sub-projects to be moved to an accessible parent', () => {
			const store = useProjectStore()
			const accessibleParent = createMockProject({id: 5, parentProjectId: 0})
			const orphanedProject = createMockProject({id: 2, parentProjectId: 999})

			store.setProject(accessibleParent)
			store.setProject(orphanedProject)

			// Dragged to an accessible parent - allow reparenting
			expect(store.getEffectiveParentProjectId(orphanedProject, 5)).toBe(5)
		})
	})
})
