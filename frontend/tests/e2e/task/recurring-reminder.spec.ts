import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'

test.describe('Recurring reminders', () => {
	test.beforeEach(async () => {
		await ProjectFactory.create(1, {id: 1})
	})

	test('sets a weekly reminder recurrence and round-trips it on reload', async ({authenticatedPage: page}) => {
		const [task] = await TaskFactory.create(1, {id: 1, project_id: 1, done: false}, false)
		await page.goto(`/tasks/${task.id}`)

		await page.locator('.task-view .action-buttons .button').filter({hasText: 'Set Reminders'}).click()
		await page.locator('.task-view .columns.details .column button').filter({hasText: 'Add a reminder'}).click()

		// The task has no due/start/end date, so the reminder editor opens directly
		// in absolute mode. The recurrence picker is only offered for absolute reminders.
		const openPopup = page.locator('.reminder-options-popup.is-open')
		await expect(openPopup.locator('.recurrence-pattern-picker')).toBeVisible()

		await expect(openPopup.locator('.datepicker__quick-select-date').first()).toBeVisible()
		await openPopup.locator('.datepicker__quick-select-date').filter({hasText: 'Tomorrow'}).click()

		// Weekly is the picker's default frequency; pick Tuesday.
		await openPopup.locator('.weekday-option').filter({hasText: 'Tue'}).locator('input').check()

		const save = page.waitForResponse(r =>
			r.url().includes(`/tasks/${task.id}`) &&
			r.request().method() === 'POST',
		)
		await openPopup.locator('button').filter({hasText: 'Confirm'}).click()
		const response = await save
		const body = response.request().postDataJSON()
		expect(body.reminders).toHaveLength(1)
		expect(body.reminders[0].repeat_rrule).toBe('FREQ=WEEKLY;BYDAY=TU')

		await expect(page.locator('.reminder-options-popup.is-open')).not.toBeVisible()

		// Reload and confirm the stored rule survives the round-trip: the reminder
		// button flags the recurrence, and reopening the editor shows Tuesday checked.
		await page.goto(`/tasks/${task.id}`)
		const reminderButton = page.locator('.task-view .columns.details .column button').filter({hasText: '(repeats)'})
		await expect(reminderButton).toBeVisible()

		await reminderButton.click()
		const reopened = page.locator('.reminder-options-popup.is-open')
		await expect(reopened.locator('.weekday-option').filter({hasText: 'Tue'}).locator('input')).toBeChecked()
		await expect(reopened.locator('.weekday-option').filter({hasText: 'Wed'}).locator('input')).not.toBeChecked()
	})

	test('relative reminders offer no recurrence option', async ({authenticatedPage: page}) => {
		const [task] = await TaskFactory.create(1, {
			id: 1,
			project_id: 1,
			done: false,
			due_date: (new Date()).toISOString(),
		}, false)
		await page.goto(`/tasks/${task.id}`)

		await page.locator('.task-view .action-buttons .button').filter({hasText: 'Set Reminders'}).click()
		await page.locator('.task-view .columns.details .column button').filter({hasText: 'Add a reminder'}).click()

		const openPopup = page.locator('.reminder-options-popup.is-open')
		await openPopup.locator('.option-button').filter({hasText: 'Custom'}).click()

		// The relative-period form has no recurrence picker (recurrence is
		// absolute-only, matching the backend's 400 for a relative rule).
		await expect(openPopup.locator('.reminder-period')).toBeVisible()
		await expect(openPopup.locator('.recurrence-pattern-picker')).toHaveCount(0)
	})
})
