import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {ProjectViewFactory} from '../../factories/project_view'
import {TaskFactory} from '../../factories/task'
import {UserFactory} from '../../factories/user'
import {LinkShareFactory} from '../../factories/link_sharing'
import {setupApiUrl} from '../../support/authenticateUser'
import type {Locator, Page} from '@playwright/test'

const VIEW_KIND_CALENDAR = 4

// Playwright's mouse-based dragTo does not reliably drive native HTML5
// drag-and-drop, so dispatch the real drag sequence with a shared DataTransfer.
async function html5DragTo(page: Page, source: Locator, target: Locator) {
	const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
	await source.dispatchEvent('dragstart', {dataTransfer})
	await target.dispatchEvent('dragover', {dataTransfer})
	// The drop handler reschedules the task, which moves the chip off the source
	// cell — so no dragend on the (now-relocated) source afterwards.
	await target.dispatchEvent('drop', {dataTransfer})
}

// The e2e backend runs in GMT, so local time == UTC here. We still anchor
// every date at noon to keep it clear of the midnight boundary where a
// timezone offset would flip the calendar day.
function noonUTC(year: number, month1: number, day: number): string {
	return new Date(Date.UTC(year, month1 - 1, day, 12, 0, 0)).toISOString()
}

async function createCalendarProject() {
	const projects = await ProjectFactory.create(1)
	await ProjectViewFactory.create(1, {
		id: 1,
		project_id: projects[0].id,
		view_kind: VIEW_KIND_CALENDAR,
	})
	return projects[0]
}

test.describe('Project View Calendar', () => {
	test.beforeEach(async ({page}) => {
		// Pin "today" to July 2026 so month navigation is deterministic.
		await page.clock.install({time: new Date(Date.UTC(2026, 6, 8, 12, 0, 0))})
	})

	test('Renders the month grid for the current month', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		await page.goto(`/projects/${project.id}/1`)

		await expect(page.locator('.project-calendar')).toBeVisible()
		await expect(page.locator('.calendar-period-label')).toContainText('July 2026')
		await expect(page.locator('.calendar-day[data-date="2026-07-08"]')).toBeVisible()
	})

	test('Places a task on its due-date cell', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		const tasks = await TaskFactory.create(1, {
			project_id: project.id,
			due_date: noonUTC(2026, 7, 10),
		})
		await page.goto(`/projects/${project.id}/1`)

		const cell = page.locator('.calendar-day[data-date="2026-07-10"]')
		await expect(cell.locator('.calendar-task')).toContainText(tasks[0].title)
	})

	test('Spans a ranged task across the covered days', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		const tasks = await TaskFactory.create(1, {
			project_id: project.id,
			start_date: noonUTC(2026, 7, 13),
			end_date: noonUTC(2026, 7, 15),
		})
		await page.goto(`/projects/${project.id}/1`)

		for (const day of ['2026-07-13', '2026-07-14', '2026-07-15']) {
			await expect(
				page.locator(`.calendar-day[data-date="${day}"] .calendar-task`),
			).toContainText(tasks[0].title)
		}
	})

	test('Lists dateless tasks in the unscheduled panel', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		const tasks = await TaskFactory.create(1, {
			project_id: project.id,
			due_date: null,
			start_date: null,
			end_date: null,
		})
		await page.goto(`/projects/${project.id}/1`)

		await expect(page.locator('.calendar-unscheduled')).toContainText(tasks[0].title)
		await expect(page.locator('.calendar-grid')).not.toContainText(tasks[0].title)
	})

	test('Drag to another day persists the new due date', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		const tasks = await TaskFactory.create(1, {
			project_id: project.id,
			due_date: noonUTC(2026, 7, 10),
		})
		await page.goto(`/projects/${project.id}/1`)

		const chip = page.locator('.calendar-day[data-date="2026-07-10"] .calendar-task', {hasText: tasks[0].title})
		const target = page.locator('.calendar-day[data-date="2026-07-21"]')
		await expect(chip).toBeVisible()

		const updatePromise = page.waitForResponse(response =>
			response.url().includes('/tasks/') && response.request().method() === 'POST',
		)
		await html5DragTo(page, chip, target)
		await updatePromise

		await expect(
			page.locator('.calendar-day[data-date="2026-07-21"] .calendar-task'),
		).toContainText(tasks[0].title)
	})

	test('Drag from the unscheduled panel sets a due date', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		const tasks = await TaskFactory.create(1, {
			project_id: project.id,
			due_date: null,
			start_date: null,
			end_date: null,
		})
		await page.goto(`/projects/${project.id}/1`)

		const chip = page.locator('.calendar-unscheduled .calendar-task', {hasText: tasks[0].title})
		const target = page.locator('.calendar-day[data-date="2026-07-17"]')
		await expect(chip).toBeVisible()

		const updatePromise = page.waitForResponse(response =>
			response.url().includes('/tasks/') && response.request().method() === 'POST',
		)
		await html5DragTo(page, chip, target)
		await updatePromise

		await expect(
			page.locator('.calendar-day[data-date="2026-07-17"] .calendar-task'),
		).toContainText(tasks[0].title)
	})

	test('Click a day to quick-create a task with that due date', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		await page.goto(`/projects/${project.id}/1`)

		const cell = page.locator('.calendar-day[data-date="2026-07-22"]')
		await cell.locator('.calendar-day-body').click()

		const input = cell.locator('.add-task-textarea')
		await expect(input).toBeVisible()
		await input.fill('dentist')
		await input.press('Enter')

		await expect(
			page.locator('.calendar-day[data-date="2026-07-22"] .calendar-task'),
		).toContainText('dentist')
	})

	test('Switches to week mode showing seven day columns', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		await page.goto(`/projects/${project.id}/1`)

		await page.locator('.calendar-mode-week').click()

		await expect(page.locator('.calendar-grid.is-week .calendar-day')).toHaveCount(7)
	})

	test('Read-only link share shows tasks but no drag handles', async ({page}) => {
		await setupApiUrl(page)
		await UserFactory.create()
		const project = await ProjectFactory.create(1)
		await ProjectViewFactory.create(1, {
			id: 1,
			project_id: project[0].id,
			view_kind: VIEW_KIND_CALENDAR,
		})
		const tasks = await TaskFactory.create(1, {
			project_id: project[0].id,
			due_date: noonUTC(2026, 7, 10),
		})
		const linkShares = await LinkShareFactory.create(1, {
			project_id: project[0].id,
			permission: 0,
		})

		await page.goto(`/share/${linkShares[0].hash}/auth`)

		await expect(page.locator('.project-calendar')).toBeVisible()
		await expect(
			page.locator('.calendar-day[data-date="2026-07-10"] .calendar-task'),
		).toContainText(tasks[0].title)
		await expect(page.locator('.calendar-task[draggable="true"]')).toHaveCount(0)
	})
})
