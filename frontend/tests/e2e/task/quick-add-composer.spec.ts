import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {UserFactory} from '../../factories/user'
import {createDefaultViews} from '../project/prepareProjects'
import {login} from '../../support/authenticateUser'
import {PRIORITIES} from '../../../src/constants/priorities'

test.describe('Quick add composer', () => {
	test('creates a task via chips only when quick add magic is disabled', async ({page, apiContext}) => {
		const user = (await UserFactory.create(1, {
			frontend_settings: JSON.stringify({
				quickAddMagicMode: 'disabled',
			}),
		}))[0]
		const project = (await ProjectFactory.create(1, {owner_id: user.id}))[0]
		await createDefaultViews(project.id)

		await login(page, apiContext, user)
		await page.goto(`/projects/${project.id}/1`)

		await page.locator('.add-task-textarea').fill('Buy milk')

		// With quick add magic disabled, chips are pure structured pickers - opening the
		// priority chip must not attempt any text parsing of the title.
		await page.locator('.qac-chip-button').filter({hasText: 'No Priority'}).click()
		await page.locator('.popup .qac-chip-popup-priority select').selectOption(String(PRIORITIES.HIGH))

		await page.locator('.qac-chip-button').filter({hasText: 'Labels' }).click()
		// Only the open popup's content is mounted (Popup.vue v-if), so `.popup`
		// uniquely targets it - closed chip popups aren't in the DOM.
		const labelInput = page.locator('.popup .qac-chip-popup .multiselect input')
		await labelInput.fill('errand')
		await labelInput.press('Enter')

		const createTaskPromise = page.waitForResponse(response =>
			response.url().includes('/projects/') &&
			response.url().includes('/tasks') &&
			response.request().method() === 'PUT',
		)
		await page.locator('.button').filter({hasText: 'Add'}).click()
		await createTaskPromise

		const taskLink = page.locator('.tasks .task').filter({hasText: 'Buy milk'}).first().locator('a.task-link')
		await expect(taskLink).toBeVisible({timeout: 10000})
		await taskLink.click()

		await expect(page.locator('.task-view .details.labels-list .multiselect .input-wrapper span.tag').filter({hasText: 'errand'}))
			.toBeVisible({timeout: 10000})
		await expect(page.locator('.task-view .action-buttons, .task-view .details').filter({hasText: 'High'}))
			.toBeVisible({timeout: 10000})
	})

	test('a chip override wins over a text-parsed value from quick add magic', async ({authenticatedPage: page}) => {
		const project = (await ProjectFactory.create(1, {id: 1, title: 'Project A'}))[0]
		await createDefaultViews(project.id)

		await page.goto(`/projects/${project.id}/1`)

		// !3 parses to HIGH priority via vikunja-mode quick add magic.
		await page.locator('.add-task-textarea').fill('Buy milk !3')

		await page.locator('.qac-chip-button').filter({hasText: 'High' }).click()
		await page.locator('.popup .qac-chip-popup-priority select').selectOption(String(PRIORITIES.URGENT))

		const createTaskPromise = page.waitForResponse(response =>
			response.url().includes('/projects/') &&
			response.url().includes('/tasks') &&
			response.request().method() === 'PUT',
		)
		await page.locator('.button').filter({hasText: 'Add'}).click()
		await createTaskPromise

		const taskLink = page.locator('.tasks .task').filter({hasText: 'Buy milk'}).first().locator('a.task-link')
		await expect(taskLink).toBeVisible({timeout: 10000})
		// The !3 token is stripped from the title regardless of the override.
		await expect(taskLink).not.toContainText('!3')
		await taskLink.click()

		await expect(page.locator('.task-view .action-buttons, .task-view .details').filter({hasText: 'Urgent'}))
			.toBeVisible({timeout: 10000})
	})
})
