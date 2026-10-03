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

		const durationChip = page.locator('.task-view [data-chip="duration"] .property-chip-button')
		await expect(durationChip).toBeVisible({timeout: 10000})
		await durationChip.click()

		const input = page.locator('[data-cy="taskDetail.estimatedDuration"]')
		await expect(input).toBeVisible()

		const save = page.waitForResponse(r =>
			r.url().includes(`/tasks/${task.id}`) && r.request().method() === 'PATCH',
		)
		await input.fill('1h30m')
		await input.blur()

		// The v2 client sends a Request object, so Playwright sees no request body; read the saved task.
		const r = await save
		expect((await r.json()).estimated_duration).toBe(5400)
		await expect(page.locator('.global-notification')).toContainText('Success')

		await page.reload()
		await page.waitForLoadState('networkidle')
		await durationChip.click()
		await expect(page.locator('[data-cy="taskDetail.estimatedDuration"]')).toHaveValue('1h 30m')
	})

	test('shows an inline error and saves nothing for garbage input', async ({authenticatedPage: page}) => {
		const [task] = await TaskFactory.create(1, {id: 1, done: false}, false)
		await page.goto(`/tasks/${task.id}`)
		await page.waitForLoadState('networkidle')

		const durationChip = page.locator('.task-view [data-chip="duration"] .property-chip-button')
		await expect(durationChip).toBeVisible({timeout: 10000})
		await durationChip.click()

		const input = page.locator('[data-cy="taskDetail.estimatedDuration"]')
		await expect(input).toBeVisible()

		let sawSave = false
		page.on('request', req => {
			if (req.url().includes(`/tasks/${task.id}`) && req.method() === 'PATCH') {
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

		const durationChip = page.locator('.task-view [data-chip="duration"]')
		await expect(durationChip).toBeVisible({timeout: 10000})
		await durationChip.locator('.property-chip-button').click()
		const input = page.locator('[data-cy="taskDetail.estimatedDuration"]')
		await expect(input).toBeVisible()
		await expect(input).toHaveValue('1h')

		const save = page.waitForResponse(r =>
			r.url().includes(`/tasks/${task.id}`) && r.request().method() === 'PATCH',
		)
		await page.locator('[data-cy="taskDetail.estimatedDurationClear"]').click()

		const r = await save
		expect((await r.json()).estimated_duration ?? 0).toBe(0)
		await expect(input).toHaveValue('')

		// After a reload the stored value is 0, so the duration chip renders as
		// unset again and its editor is empty — proof the duration was actually
		// persisted as cleared.
		await page.reload()
		await page.waitForLoadState('networkidle')
		await expect(durationChip).toHaveClass(/is-unset/, {timeout: 10000})
		await durationChip.locator('.property-chip-button').click()
		await expect(input).toHaveValue('')
	})

	test('renders a duration chip on the list view when set', async ({authenticatedPage: page}) => {
		await createDefaultViews(1)
		await TaskFactory.create(1, {id: 1, project_id: 1, title: 'estimated task', estimated_duration: 5400}, false)

		await page.goto('/projects/1/1')
		await page.waitForLoadState('networkidle')

		await expect(page.locator('.tasks .estimated-duration')).toContainText('1h 30m')
	})
})
