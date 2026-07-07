import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'
import {createDefaultViews} from '../project/prepareProjects'

test.describe('Personal statistics', () => {
	test('renders the chart, tiles, and project table with non-zero values', async ({authenticatedPage: page, currentUser}) => {
		const project = (await ProjectFactory.create(1, {owner_id: currentUser.id, title: 'Stats Project'}))[0]
		await createDefaultViews(project.id)

		const now = new Date()
		// One completed task (counts toward the completed tile + today's bar) and
		// one open task (counts toward the open tile) so every figure is non-zero.
		await TaskFactory.create(1, {
			id: 1,
			index: 1,
			project_id: project.id,
			created_by_id: currentUser.id,
			title: 'Done task',
			done: true,
			done_at: now.toISOString(),
			created: now.toISOString(),
			updated: now.toISOString(),
		})
		await TaskFactory.create(1, {
			id: 2,
			index: 2,
			project_id: project.id,
			created_by_id: currentUser.id,
			title: 'Open task',
			done: false,
			created: now.toISOString(),
			updated: now.toISOString(),
		}, false)

		await page.goto('/user/stats')
		await page.waitForLoadState('networkidle')

		// The chart is a single-series bar chart; its accessible name uses the
		// honest-labeled string, not "Your completions".
		const chart = page.locator('[data-cy="statsChart"]')
		await expect(chart).toBeVisible({timeout: 10000})
		await expect(chart).toHaveAttribute('aria-label', /completed in your projects/i)

		const completedTile = page.locator('[data-cy="statsCompletedInProjects"]')
		await expect(completedTile).toContainText('1')

		const createdTile = page.locator('[data-cy="statsCreatedByMe"]')
		await expect(createdTile).toContainText('2')

		const openTile = page.locator('[data-cy="statsOpen"]')
		await expect(openTile).toContainText('1')

		// The per-project breakdown lists the seeded project.
		const projectRow = page.locator(`[data-cy="statsProjectRow"][data-project-id="${project.id}"]`)
		await expect(projectRow).toBeVisible()
	})

	test('the window selector only offers values the API accepts (1..52 weeks)', async ({authenticatedPage: page, currentUser}) => {
		const project = (await ProjectFactory.create(1, {owner_id: currentUser.id, title: 'Stats Project'}))[0]
		await createDefaultViews(project.id)

		await page.goto('/user/stats')
		await page.waitForLoadState('networkidle')

		const selector = page.locator('[data-cy="statsWindowSelector"]')
		await expect(selector).toBeVisible({timeout: 10000})

		const values = await selector.locator('option').evaluateAll(
			opts => opts.map(o => Number((o as HTMLOptionElement).value)),
		)
		expect(values.length).toBeGreaterThan(0)
		for (const v of values) {
			expect(v).toBeGreaterThanOrEqual(1)
			expect(v).toBeLessThanOrEqual(52)
		}
	})

	test('changing the window leaves the point-in-time open and overdue totals unchanged', async ({authenticatedPage: page, currentUser}) => {
		const project = (await ProjectFactory.create(1, {owner_id: currentUser.id, title: 'Stats Project'}))[0]
		await createDefaultViews(project.id)

		const now = new Date()
		const overdueDate = new Date(new Date().setDate(now.getDate() - 3))
		// One plain open task and one overdue task: open = 2, overdue = 1, both
		// point-in-time so neither should react to the window selector.
		await TaskFactory.create(1, {
			id: 1,
			index: 1,
			project_id: project.id,
			created_by_id: currentUser.id,
			title: 'Open task',
			done: false,
			created: now.toISOString(),
			updated: now.toISOString(),
		})
		await TaskFactory.create(1, {
			id: 2,
			index: 2,
			project_id: project.id,
			created_by_id: currentUser.id,
			title: 'Overdue task',
			done: false,
			due_date: overdueDate.toISOString(),
			created: now.toISOString(),
			updated: now.toISOString(),
		}, false)

		await page.goto('/user/stats')
		await page.waitForLoadState('networkidle')

		const openTile = page.locator('[data-cy="statsOpen"]')
		const overdueTile = page.locator('[data-cy="statsOverdue"]')
		await expect(openTile).toContainText('2')
		await expect(overdueTile).toContainText('1')

		// Switch the window; a fresh request fires, but open/overdue must not move.
		await page.locator('[data-cy="statsWindowSelector"]').selectOption('4')
		await page.waitForLoadState('networkidle')

		await expect(openTile).toContainText('2')
		await expect(overdueTile).toContainText('1')
	})
})
