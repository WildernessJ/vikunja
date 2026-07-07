import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'
import {createDefaultViews} from '../project/prepareProjects'

test.describe('Task deadline', () => {
	test.beforeEach(async () => {
		await ProjectFactory.create(1, {id: 1})
	})

	test('sets a deadline from the detail view', async ({authenticatedPage: page}) => {
		const [task] = await TaskFactory.create(1, {id: 1, done: false}, false)
		await page.goto(`/tasks/${task.id}`)
		await page.waitForLoadState('networkidle')

		const setDeadlineButton = page.locator('.task-view .action-buttons .button').filter({hasText: 'Set Deadline'})
		await expect(setDeadlineButton).toBeVisible({timeout: 10000})
		await setDeadlineButton.click()

		const datepickerShow = page.locator('.task-view .columns.details .column').filter({hasText: 'Deadline'}).locator('.date-input .datepicker .show')
		await expect(datepickerShow).toBeVisible()
		await datepickerShow.click()

		const tomorrowButton = page.locator('.datepicker .datepicker-popup button').filter({hasText: 'Tomorrow'})
		await expect(tomorrowButton).toBeVisible()

		const save = page.waitForResponse(r =>
			r.url().includes(`/tasks/${task.id}`) && r.request().method() === 'POST',
		)
		await tomorrowButton.click()
		const confirmButton = page.locator('[data-cy="closeDatepicker"]').filter({hasText: 'Confirm'})
		await expect(confirmButton).toBeVisible()
		await confirmButton.click()

		const r = await save
		const body = r.request().postDataJSON()
		expect(body.deadline).toBeTruthy()
		expect(body.deadline).not.toBe('0001-01-01T00:00:00Z')
		await expect(page.locator('.global-notification')).toContainText('Success')
	})

	test('renders the overdue-deadline chip style on an overdue task', async ({authenticatedPage: page}) => {
		await createDefaultViews(1)
		// Deadline one day in the past, task not done → overdue deadline.
		const pastDeadline = new Date(Date.now() - 86_400_000).toISOString()
		await TaskFactory.create(1, {
			id: 1,
			project_id: 1,
			done: false,
			deadline: pastDeadline,
		}, false)

		await page.goto('/projects/1/1')
		await page.waitForLoadState('networkidle')

		const overdueChip = page.locator('.tasks .deadline.is-overdue')
		await expect(overdueChip).toBeVisible()
	})

	test('filters tasks by deadline window in a view', async ({authenticatedPage: page}) => {
		await createDefaultViews(1)

		const soon = new Date(Date.now() + 3 * 86_400_000).toISOString()
		const far = new Date(Date.now() + 30 * 86_400_000).toISOString()
		await TaskFactory.create(1, {id: 1, project_id: 1, title: 'deadline soon', deadline: soon}, false)
		await TaskFactory.create(1, {id: 2, project_id: 1, title: 'deadline far', deadline: far}, false)

		const query = new URLSearchParams({filter: 'deadline < now+7d'}).toString()
		await page.goto(`/projects/1/1?${query}`)
		await page.waitForLoadState('networkidle')

		await expect(page.locator('.tasks').getByText('deadline soon')).toBeVisible()
		await expect(page.locator('.tasks').getByText('deadline far')).toHaveCount(0)
	})
})
