import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'
import {createDefaultViews} from '../project/prepareProjects'

test.describe('Task estimated duration', () => {
	test.beforeEach(async () => {
		await ProjectFactory.create(1, {id: 1})
	})

	test('parses and persists a human duration, rendering it compactly', async ({authenticatedPage: page}) => {
		const [task] = await TaskFactory.create(1, {id: 1, done: false}, false)
		await page.goto(`/tasks/${task.id}`)
		await page.waitForLoadState('networkidle')

		const setButton = page.locator('.task-view .action-buttons .button').filter({hasText: 'Set Estimated Duration'})
		await expect(setButton).toBeVisible({timeout: 10000})
		await setButton.click()

		const input = page.locator('[data-cy="taskDetail.estimatedDuration"]')
		await expect(input).toBeVisible()

		const save = page.waitForResponse(r =>
			r.url().includes(`/tasks/${task.id}`) && r.request().method() === 'POST',
		)
		await input.fill('1h30m')
		await input.blur()

		const r = await save
		expect(r.request().postDataJSON().estimated_duration).toBe(5400)
		await expect(page.locator('.global-notification')).toContainText('Success')

		await page.reload()
		await page.waitForLoadState('networkidle')
		await expect(page.locator('[data-cy="taskDetail.estimatedDuration"]')).toHaveValue('1h 30m')
	})

	test('shows an inline error and saves nothing for garbage input', async ({authenticatedPage: page}) => {
		const [task] = await TaskFactory.create(1, {id: 1, done: false}, false)
		await page.goto(`/tasks/${task.id}`)
		await page.waitForLoadState('networkidle')

		const setButton = page.locator('.task-view .action-buttons .button').filter({hasText: 'Set Estimated Duration'})
		await expect(setButton).toBeVisible({timeout: 10000})
		await setButton.click()

		const input = page.locator('[data-cy="taskDetail.estimatedDuration"]')
		await expect(input).toBeVisible()

		let sawSave = false
		page.on('request', req => {
			if (req.url().includes(`/tasks/${task.id}`) && req.method() === 'POST') {
				sawSave = true
			}
		})

		await input.fill('banana')
		await input.blur()

		await expect(page.locator('[data-cy="taskDetail.estimatedDurationError"]')).toBeVisible()
		expect(sawSave).toBe(false)
	})

	test('clear button zeroes a previously-set duration', async ({authenticatedPage: page}) => {
		const [task] = await TaskFactory.create(1, {id: 1, done: false, estimated_duration: 3600}, false)
		await page.goto(`/tasks/${task.id}`)
		await page.waitForLoadState('networkidle')

		const input = page.locator('[data-cy="taskDetail.estimatedDuration"]')
		await expect(input).toBeVisible({timeout: 10000})
		await expect(input).toHaveValue('1h')

		const save = page.waitForResponse(r =>
			r.url().includes(`/tasks/${task.id}`) && r.request().method() === 'POST',
		)
		await page.locator('[data-cy="taskDetail.estimatedDurationClear"]').click()

		const r = await save
		expect(r.request().postDataJSON().estimated_duration).toBe(0)
		await expect(input).toHaveValue('')

		// After a reload the stored value is 0, so the field collapses back to
		// inactive (like deadline / progress) and the "Set" action reappears —
		// proof the duration was actually persisted as cleared.
		await page.reload()
		await page.waitForLoadState('networkidle')
		await expect(page.locator('.task-view .action-buttons .button').filter({hasText: 'Set Estimated Duration'})).toBeVisible({timeout: 10000})
		await expect(page.locator('[data-cy="taskDetail.estimatedDuration"]')).toHaveCount(0)
	})

	test('renders a duration chip on the list view when set', async ({authenticatedPage: page}) => {
		await createDefaultViews(1)
		await TaskFactory.create(1, {id: 1, project_id: 1, title: 'estimated task', estimated_duration: 5400}, false)

		await page.goto('/projects/1/1')
		await page.waitForLoadState('networkidle')

		await expect(page.locator('.tasks .estimated-duration')).toContainText('1h 30m')
	})
})
