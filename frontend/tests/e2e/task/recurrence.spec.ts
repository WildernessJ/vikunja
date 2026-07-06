import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'
import {createDefaultViews} from '../project/prepareProjects'

test.describe('Task recurrence', () => {
	test.beforeEach(async () => {
		await ProjectFactory.create(1, {id: 1})
	})

	test('sets repeat-every-day via preset button', async ({authenticatedPage: page}) => {
		const [task] = await TaskFactory.create(1, {
			id: 1,
			project_id: 1,
			due_date: new Date(Date.now() + 86_400_000).toISOString(),
		}, false)
		await page.goto(`/tasks/${task.id}`)

		// Reveal the RepeatAfter component (hidden until the user activates it)
		await page.getByRole('button', {name: 'Set Repeating Interval'}).click()

		const save = page.waitForResponse(r =>
			r.url().includes(`/tasks/${task.id}`) && r.request().method() === 'POST',
		)
		await page.getByRole('button', {name: 'Every Day'}).click()
		const r = await save
		const body = r.request().postDataJSON()
		expect(body.repeat_after).toBe(86400)
	})

	test('completing a recurring task reopens with advanced due date', async ({
		authenticatedPage: page, apiContext, userToken,
	}) => {
		const originalDue = new Date(Date.now() + 86_400_000)
		const [task] = await TaskFactory.create(1, {
			id: 1,
			project_id: 1,
			due_date: originalDue.toISOString(),
			repeat_after: 86400,
		}, false)

		await page.goto(`/tasks/${task.id}`)

		const completed = page.waitForResponse(r =>
			r.url().includes(`/tasks/${task.id}`) && r.request().method() === 'POST',
		)
		await page.locator('.task-view .action-buttons .button').filter({hasText: 'Mark task done!'}).click()
		await completed

		// Fetch fresh state from the API to verify the backend regenerated the task.
		const resp = await apiContext.get(`tasks/${task.id}`, {
			headers: {Authorization: `Bearer ${userToken}`},
		})
		expect(resp.ok()).toBe(true)
		const refreshed = await resp.json()
		expect(refreshed.done).toBe(false)
		const newDue = new Date(refreshed.due_date).getTime()
		// addRepeatIntervalToTime: when the original due date is still in the
		// future, the backend advances it by exactly one interval (86400s here).
		// Tolerance of <5s absorbs sub-second timestamp round-tripping between
		// the JS Date → ISO string → backend time.Time → JSON response path.
		expect(newDue - originalDue.getTime()).toBeCloseTo(86_400_000, -4)
	})

	test('monthly repeat mode hides the amount field', async ({authenticatedPage: page}) => {
		const [task] = await TaskFactory.create(1, {id: 1, project_id: 1}, false)
		await page.goto(`/tasks/${task.id}`)

		// Reveal the RepeatAfter component (hidden until the user activates it)
		await page.getByRole('button', {name: 'Set Repeating Interval'}).click()

		await expect(page.locator('#repeatMode')).toBeVisible()
		// Amount input is visible in the default repeat mode
		await expect(page.locator('input[placeholder*="amount" i]')).toHaveCount(1)

		await page.locator('#repeatMode').selectOption({label: 'Monthly'})

		await expect(page.locator('input[placeholder*="amount" i]')).toHaveCount(0)
	})

	test('sets a weekly Mon+Fri calendar pattern and round-trips it on reload', async ({authenticatedPage: page}) => {
		const [task] = await TaskFactory.create(1, {
			id: 1,
			project_id: 1,
			due_date: new Date(Date.now() + 86_400_000).toISOString(),
		}, false)
		await page.goto(`/tasks/${task.id}`)

		await page.getByRole('button', {name: 'Set Repeating Interval'}).click()
		await page.locator('#repeatMode').selectOption({label: 'Custom pattern'})

		await page.locator('.weekday-option').filter({hasText: 'Mon'}).locator('input').check()

		const save = page.waitForResponse(r =>
			r.url().includes(`/tasks/${task.id}`) &&
			r.request().method() === 'POST' &&
			(r.request().postDataJSON()?.repeat_rrule ?? '').includes('MO,FR'),
		)
		await page.locator('.weekday-option').filter({hasText: 'Fri'}).locator('input').check()
		const r = await save
		const body = r.request().postDataJSON()
		expect(body.repeat_mode).toBe(3)
		expect(body.repeat_rrule).toBe('FREQ=WEEKLY;BYDAY=MO,FR')

		// Reload: an RRULE-mode task auto-expands the repeat editor, which parses
		// the stored rule back into checked weekday boxes.
		await page.goto(`/tasks/${task.id}`)
		const monInput = page.locator('.weekday-option').filter({hasText: 'Mon'}).locator('input')
		const friInput = page.locator('.weekday-option').filter({hasText: 'Fri'}).locator('input')
		await expect(monInput).toBeChecked()
		await expect(friInput).toBeChecked()
		await expect(page.locator('.weekday-option').filter({hasText: 'Tue'}).locator('input')).not.toBeChecked()
	})

	test('quick-add "every mon, fri" creates a calendar-pattern task', async ({authenticatedPage: page}) => {
		await createDefaultViews(1)
		await page.goto('/projects/1/1')

		await page.locator('.input[placeholder="Add a task…"]').fill('water plants every mon, fri')

		const create = page.waitForResponse(r =>
			r.url().includes('/projects/1/tasks') &&
			r.request().method() === 'PUT',
		)
		await page.locator('.button').filter({hasText: 'Add'}).click()
		const r = await create
		const body = r.request().postDataJSON()
		expect(body.title).toBe('water plants')
		expect(body.repeat_mode).toBe(3)
		expect(body.repeat_rrule).toBe('FREQ=WEEKLY;BYDAY=MO,FR')

		// The backend anchors the due date to the first occurrence, so a quick-add
		// pattern task is never left dateless and inert.
		const created = await r.json()
		expect(created.due_date).not.toBe('0001-01-01T00:00:00Z')
		expect(new Date(created.due_date).getTime()).toBeGreaterThan(Date.now() - 60_000)
	})
})
