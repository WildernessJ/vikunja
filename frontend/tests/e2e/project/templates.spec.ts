import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'
import {createDefaultViews} from './prepareProjects'
import {updateUserSettings} from '../../support/updateUserSettings'

test.describe('Project Templates', () => {
	test('save as template, appears in library, instantiate into a new project', async ({authenticatedPage: page, apiContext, userToken}) => {
		// A duplicated/instantiated project's views are created in Go-map (random)
		// order, so the default "first view" is non-deterministic. Pin the default
		// to the List view by kind so the instantiated project reliably opens there.
		await updateUserSettings(apiContext, userToken, {
			frontendSettings: {defaultView: 'list'},
		})

		await ProjectFactory.create(1, {id: 1, title: 'Trip source'})
		await createDefaultViews(1)
		// Three tasks, the first one already done in the source.
		await TaskFactory.create(3, {
			id: '{increment}',
			project_id: 1,
			title: (i: number) => `pack item ${i + 1}`,
			done: (i: number) => i === 0,
		})

		// Save the project as a template named "Packing".
		await page.goto('/projects/1/1')
		await page.locator('.project-title-dropdown .project-title-button').click()
		await page.getByText('Save as template').click()
		await expect(page).toHaveURL(/\/settings\/save-template/)
		await page.locator('dialog[open] input[name="templateName"]').fill('Packing')
		await page.locator('dialog[open]').getByRole('button', {name: 'Save as template'}).click()

		// The template shows up in the library.
		await page.goto('/templates')
		await expect(page.locator('.template-library')).toContainText('Packing')

		// Create a new project "Japan trip" from the template.
		await page.goto('/projects/new')
		await page.locator('dialog[open] select[name="template"]').selectOption({label: 'Packing'})
		await page.locator('dialog[open] input[name="projectTitle"]').fill('Japan trip')
		await page.locator('dialog[open]').getByRole('button', {name: 'Create'}).click()

		// The new project opens on its List view as a normal project with all tasks
		// reset to not-done.
		await expect(page.locator('.project-title')).toContainText('Japan trip')
		await expect(page.locator('.tasks .task').first()).toBeVisible()
		await expect(page.locator('.tasks .task')).toHaveCount(3)
		await expect(page.locator('.tasks .task.done')).toHaveCount(0)
	})

	test('template is hidden from the project sidebar', async ({authenticatedPage: page}) => {
		await ProjectFactory.create(1, {id: 1, title: 'Trip source'})
		await createDefaultViews(1)

		await page.goto('/projects/1/1')
		await page.locator('.project-title-dropdown .project-title-button').click()
		await page.getByText('Save as template').click()
		await page.locator('dialog[open] input[name="templateName"]').fill('Packing')
		await page.locator('dialog[open]').getByRole('button', {name: 'Save as template'}).click()

		await page.goto('/')
		// The template must not appear in the navigation project list.
		await expect(page.locator('.menu-container')).not.toContainText('Packing')
	})
})
