import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'
import {SavedFilterFactory} from '../../factories/saved_filter'
import {updateUserSettings} from '../../support/updateUserSettings'
import {createDefaultViews} from '../project/prepareProjects'

// The seeded project has three undone tasks: two overdue and one due in the
// future. The counts endpoint therefore reports open = 3 and dueOverdue = 2,
// which lets us tell the 'all' and 'dueOverdue' modes apart.
const OPEN_COUNT = '3'
const DUE_OVERDUE_COUNT = '2'

function daysFromNow(days: number): Date {
	return new Date(new Date().setDate(new Date().getDate() + days))
}

async function seedProjectWithCounts(userId: number, title: string) {
	const project = (await ProjectFactory.create(1, {owner_id: userId, title}))[0]
	await createDefaultViews(project.id)

	const now = new Date()
	const dueDates = [daysFromNow(-3), daysFromNow(-1), daysFromNow(14)]
	const tasks = dueDates.map((dueDate, i) => ({
		id: i + 1,
		index: i + 1,
		project_id: project.id,
		done: false,
		created_by_id: userId,
		title: 'Task ' + i,
		due_date: dueDate.toISOString(),
		created: now.toISOString(),
		updated: now.toISOString(),
	}))
	await TaskFactory.seed(TaskFactory.table, tasks)

	return project
}

test.describe('The project sidebar count badges', () => {
	test('shows no badge when the setting is "none"', async ({authenticatedPage: page, apiContext, currentUser, userToken}) => {
		const project = await seedProjectWithCounts(currentUser.id, 'Count Project')
		await updateUserSettings(apiContext, userToken, {
			frontendSettings: {projectSidebarCount: 'none'},
		})

		await page.goto('/')
		await expect(page.locator(`[data-project-id="${project.id}"] .project-menu-title`)).toBeVisible({timeout: 10000})

		await expect(page.locator(`[data-project-id="${project.id}"] .count-badge`)).toHaveCount(0)
	})

	test('shows the due & overdue count when the setting is "dueOverdue"', async ({authenticatedPage: page, apiContext, currentUser, userToken}) => {
		const project = await seedProjectWithCounts(currentUser.id, 'Count Project')
		await updateUserSettings(apiContext, userToken, {
			frontendSettings: {projectSidebarCount: 'dueOverdue'},
		})

		await page.goto('/')

		const badge = page.locator(`[data-project-id="${project.id}"] .count-badge`)
		await expect(badge).toHaveText(DUE_OVERDUE_COUNT, {timeout: 10000})
	})

	test('shows the open task count when the setting is "all"', async ({authenticatedPage: page, apiContext, currentUser, userToken}) => {
		const project = await seedProjectWithCounts(currentUser.id, 'Count Project')
		await updateUserSettings(apiContext, userToken, {
			frontendSettings: {projectSidebarCount: 'all'},
		})

		await page.goto('/')

		const badge = page.locator(`[data-project-id="${project.id}"] .count-badge`)
		await expect(badge).toHaveText(OPEN_COUNT, {timeout: 10000})
	})

	test('never shows a badge on a saved-filter pseudo-project', async ({authenticatedPage: page, apiContext, currentUser, userToken}) => {
		const project = await seedProjectWithCounts(currentUser.id, 'Count Project')
		await SavedFilterFactory.create(1, {
			title: 'Pseudo Filter',
			is_favorite: false,
			filters: '{"filter":"done = false","filter_include_nulls":false,"s":""}',
		})
		await updateUserSettings(apiContext, userToken, {
			frontendSettings: {projectSidebarCount: 'all'},
		})

		await page.goto('/')

		// The real project badge confirms badges are enabled for this run.
		await expect(page.locator(`[data-project-id="${project.id}"] .count-badge`)).toHaveText(OPEN_COUNT, {timeout: 10000})

		const filterRow = page.locator('.list-menu').filter({hasText: 'Pseudo Filter'})
		await expect(filterRow).toBeVisible()
		await expect(filterRow.locator('.count-badge')).toHaveCount(0)
	})

	test('never shows a badge on the Favorites pseudo-project', async ({authenticatedPage: page, apiContext, currentUser, userToken}) => {
		const project = await seedProjectWithCounts(currentUser.id, 'Count Project')
		// The Favorites pseudo-project (id -1) is returned by GET /projects only
		// once the user has a favorite *task* — favoriting a project merely
		// re-lists that real project (keeping its real id and badge). Task id 1
		// is one of the tasks seeded by seedProjectWithCounts. kind 1 == FavoriteKindTask.
		await TaskFactory.seed('favorites', [{
			entity_id: 1,
			user_id: currentUser.id,
			kind: 1,
		}], false)
		await updateUserSettings(apiContext, userToken, {
			frontendSettings: {projectSidebarCount: 'all'},
		})

		await page.goto('/')
		// The real project badge confirms badges are enabled for this run.
		await expect(page.locator(`[data-project-id="${project.id}"] .count-badge`)).toHaveText(OPEN_COUNT, {timeout: 10000})

		const favoritesRow = page.locator('[data-project-id="-1"]')
		await expect(favoritesRow).toBeVisible()
		await expect(favoritesRow.locator('.count-badge')).toHaveCount(0)
	})

	test('persists and applies the setting changed via General settings', async ({authenticatedPage: page, currentUser}) => {
		const project = await seedProjectWithCounts(currentUser.id, 'Count Project')

		await page.goto('/user/settings/general')

		const select = page.locator('label.two-col')
			.filter({hasText: 'Task count badges in the project sidebar'})
			.locator('select')
		await select.selectOption('all')
		await page.locator('[data-cy="saveGeneralSettings"]').click()

		await page.goto('/')
		await expect(page.locator(`[data-project-id="${project.id}"] .count-badge`)).toHaveText(OPEN_COUNT, {timeout: 10000})

		// The change is persisted server-side, so a full reload keeps the badge.
		await page.reload()
		await expect(page.locator(`[data-project-id="${project.id}"] .count-badge`)).toHaveText(OPEN_COUNT, {timeout: 10000})
	})
})
