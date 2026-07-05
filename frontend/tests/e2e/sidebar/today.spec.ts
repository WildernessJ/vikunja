import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'
import {createDefaultViews} from '../project/prepareProjects'

const UPCOMING_HREF = '/tasks/by/upcoming'
const TODAY_HREF = '/tasks/today'
const PROJECTS_HREF = '/projects'

async function seedProjectWithTasks(userId: number, count: number, dueDate: Date) {
	const project = (await ProjectFactory.create(1, {owner_id: userId}))[0]
	await createDefaultViews(project.id)

	const now = new Date()
	const tasks = []
	for (let i = 0; i < count; i++) {
		tasks.push({
			id: i + 1,
			index: i + 1,
			project_id: project.id,
			done: false,
			created_by_id: userId,
			title: 'Task ' + i,
			due_date: dueDate.toISOString(),
			created: now.toISOString(),
			updated: now.toISOString(),
		})
	}
	await TaskFactory.seed(TaskFactory.table, tasks)

	return project
}

function daysFromNow(days: number): Date {
	return new Date(new Date().setDate(new Date().getDate() + days))
}

test.describe('The Today sidebar item', () => {
	test('sits between the Upcoming and Projects items', async ({authenticatedPage: page}) => {
		await page.goto('/')

		const hrefs = await page.locator('.top-menu .menu-list li a')
			.evaluateAll(links => links.map(link => link.getAttribute('href')))

		const upcomingIndex = hrefs.indexOf(UPCOMING_HREF)
		const todayIndex = hrefs.indexOf(TODAY_HREF)
		const projectsIndex = hrefs.indexOf(PROJECTS_HREF)

		expect(todayIndex).toBeGreaterThan(-1)
		expect(upcomingIndex).toBeGreaterThan(-1)
		expect(projectsIndex).toBeGreaterThan(-1)
		expect(todayIndex).toBeGreaterThan(upcomingIndex)
		expect(todayIndex).toBeLessThan(projectsIndex)
	})

	test('navigates to a task list when clicked', async ({authenticatedPage: page, currentUser}) => {
		await seedProjectWithTasks(currentUser.id, 3, daysFromNow(-3))

		await page.goto('/')
		await page.locator(`.top-menu a[href="${TODAY_HREF}"]`).click()

		await expect(page).toHaveURL(/\/tasks\/today$/)
		await expect(page.locator('[data-cy="showTasks"]')).toBeAttached({timeout: 30000})
		await expect(page.locator('[data-cy="showTasks"] .card .task').first()).toBeVisible({timeout: 10000})
	})

	test('shows a badge with the overdue/today task count', async ({authenticatedPage: page, currentUser}) => {
		await seedProjectWithTasks(currentUser.id, 3, daysFromNow(-3))

		await page.goto('/')

		const badge = page.locator(`.top-menu a[href="${TODAY_HREF}"] .count-badge`)
		await expect(badge).toHaveText('3', {timeout: 10000})
	})

	test('hides the badge when there are no overdue/today tasks', async ({authenticatedPage: page, currentUser}) => {
		// A future-due task keeps the project present but out of the overdue/today count.
		await seedProjectWithTasks(currentUser.id, 1, daysFromNow(14))

		await page.goto('/')
		await expect(page.locator(`.top-menu a[href="${TODAY_HREF}"]`)).toBeVisible()

		await expect(page.locator(`.top-menu a[href="${TODAY_HREF}"] .count-badge`)).toHaveCount(0)
	})
})
