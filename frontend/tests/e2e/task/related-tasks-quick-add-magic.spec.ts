import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'
import {UserFactory} from '../../factories/user'
import {createDefaultViews} from '../project/prepareProjects'
import {login} from '../../support/authenticateUser'

// The fork always shows the relation search on a task without relations; no button opens it.
async function openRelatedTasksForm(page) {
	const input = page.locator('.task-relations .multiselect input').first()
	await expect(input).toBeVisible()
	return input
}

function relationSearchResults(page) {
	return page.locator('.task-relations .multiselect .search-results .search-result-button')
}

function relationTaskSearchResults(page) {
	return page.locator('.task-relations .multiselect .search-results .search-result-button:not(.is-create-option)')
}

test.describe('Related tasks quick add magic', () => {
	test('Opening a task leaves focus off the always-shown relation search until asked', async ({authenticatedPage: page}) => {
		const project = (await ProjectFactory.create(1, {id: 1}))[0]
		await createDefaultViews(project.id)
		const task = (await TaskFactory.create(1, {id: 1, project_id: project.id}, false))[0]

		await page.goto(`/tasks/${task.id}`)
		const input = page.locator('.task-relations .multiselect input').first()
		await expect(input).toBeVisible()
		// Autofocus here swallowed single-key shortcuts (d, l, …) as typed text.
		await expect(input).not.toBeFocused()

		await page.locator('body').press('r')
		await expect(input).toBeFocused()
	})

	test('Applies a label parsed via *prefix to the new related task', async ({authenticatedPage: page}) => {
		const project = (await ProjectFactory.create(1, {id: 1, title: 'Project A'}))[0]
		await createDefaultViews(project.id)
		const parent = (await TaskFactory.create(1, {id: 1, title: 'Parent task', project_id: project.id}, false))[0]

		await page.goto(`/tasks/${parent.id}`)
		const input = await openRelatedTasksForm(page)
		await input.fill('Subtask one *Urgent')
		await input.press('Enter')

		const relatedTaskLink = page.locator('.task-relations .related-tasks .task a').filter({hasText: 'Subtask one'})
		await expect(relatedTaskLink).toBeVisible({timeout: 10000})
		// Quick add magic strips the *Urgent prefix from the title
		await expect(relatedTaskLink).not.toContainText('*Urgent')

		await relatedTaskLink.click()
		await expect(page).toHaveURL(/\/tasks\/\d+/)
		// The related task opens in a modal over the parent task's detail view.
		const relatedTaskView = page.locator('.task-detail-view-modal .task-view')
		await relatedTaskView.locator('[data-chip="labels"] .property-chip-button').click()
		await expect(relatedTaskView.locator('[data-chip="labels"] .property-chip-popup .multiselect .input-wrapper span.tag').filter({hasText: 'Urgent'}))
			.toBeVisible({timeout: 10000})
	})

	test('Applies a priority parsed via !prefix to the new related task', async ({authenticatedPage: page}) => {
		const project = (await ProjectFactory.create(1, {id: 1, title: 'Project A'}))[0]
		await createDefaultViews(project.id)
		const parent = (await TaskFactory.create(1, {id: 1, title: 'Parent task', project_id: project.id}, false))[0]

		await page.goto(`/tasks/${parent.id}`)
		const input = await openRelatedTasksForm(page)
		await input.fill('Important work !4')
		const createOption = relationSearchResults(page).and(page.locator('.is-create-option'))
		await expect(createOption.locator('.search-result')).toHaveText('Important work !4')
		await expect(createOption.locator('.hint-text')).toHaveText('Add this as related task')
		await input.press('Enter')

		const relatedTaskLink = page.locator('.task-relations .related-tasks .task a').filter({hasText: 'Important work'})
		await expect(relatedTaskLink).toBeVisible({timeout: 10000})
		await expect(relatedTaskLink).not.toContainText('!4')

		await relatedTaskLink.click()
		// The related task opens in a modal over the parent task's detail view.
		const relatedTaskView = page.locator('.task-detail-view-modal .task-view')
		// Priority 4 is "Urgent"
		await relatedTaskView.locator('[data-chip="priority"] .property-chip-button').click()
		await expect(relatedTaskView.locator('[data-chip="priority"] .property-chip-popup .select select')).toHaveValue('4', {timeout: 10000})
	})

	test('Creates the related task in another project via +project prefix', async ({authenticatedPage: page}) => {
		const projectA = (await ProjectFactory.create(1, {id: 1, title: 'Source'}))[0]
		await createDefaultViews(projectA.id)
		const projectB = (await ProjectFactory.create(1, {id: 2, title: 'TargetProject'}, false))[0]
		await createDefaultViews(projectB.id, 5)
		const parent = (await TaskFactory.create(1, {id: 1, title: 'Parent task', project_id: projectA.id}, false))[0]

		await page.goto(`/tasks/${parent.id}`)
		const input = await openRelatedTasksForm(page)
		await input.fill('Cross task +TargetProject')
		await input.press('Enter')

		const relatedTaskRow = page.locator('.task-relations .related-tasks .task').filter({hasText: 'Cross task'})
		await expect(relatedTaskRow).toBeVisible({timeout: 10000})
		await expect(relatedTaskRow.locator('a')).not.toContainText('+TargetProject')
		// Cross-project marker shows the other project name
		await expect(relatedTaskRow.locator('.different-project')).toContainText('TargetProject')
	})

	test('Shows task identifiers in relation search results', async ({authenticatedPage: page}) => {
		const project = (await ProjectFactory.create(1, {id: 1, title: 'Project A', identifier: 'PA'}))[0]
		await createDefaultViews(project.id)
		const parent = (await TaskFactory.create(1, {id: 10, title: 'Parent task', project_id: project.id}, false))[0]
		await TaskFactory.create(1, {
			id: 11,
			title: 'Identifier search candidate',
			project_id: project.id,
			index: 42,
		}, false)

		await page.goto(`/tasks/${parent.id}`)
		const input = await openRelatedTasksForm(page)
		await input.pressSequentially('Identifier search candidate')

		const firstResult = relationTaskSearchResults(page).filter({hasText: 'Identifier search candidate'}).first()
		await expect(firstResult).toBeVisible({timeout: 10000})
		await expect(firstResult).toContainText('PA-42')
	})

	test('Prioritizes tasks from the current project in relation search results', async ({authenticatedPage: page}) => {
		const currentProject = (await ProjectFactory.create(1, {id: 1, title: 'Current Project'}))[0]
		await createDefaultViews(currentProject.id)
		const otherProject = (await ProjectFactory.create(1, {id: 2, title: 'Other Project'}, false))[0]
		await createDefaultViews(otherProject.id, 5)

		const currentProjectParent = (await TaskFactory.create(1, {
			id: 30,
			title: 'Parent task',
			project_id: currentProject.id,
		}, false))[0]
		await TaskFactory.create(1, {
			id: 5,
			title: 'Queue candidate other',
			project_id: otherProject.id,
		}, false)
		await TaskFactory.create(1, {
			id: 80,
			title: 'Queue candidate current',
			project_id: currentProject.id,
		}, false)

		await page.goto(`/tasks/${currentProjectParent.id}`)
		const input = await openRelatedTasksForm(page)
		await input.pressSequentially('Queue candidate')

		const results = relationTaskSearchResults(page)
		await expect(results).toHaveCount(2, {timeout: 10000})
		await expect(results.first()).toContainText('Queue candidate current')
		await expect(results.first().locator('.different-project')).toHaveCount(0)
		await expect(results.nth(1)).toContainText('Other Project')
		await expect(results.nth(1)).toContainText('Queue candidate other')
	})

	test('Keeps the title literal when quick add magic is disabled', async ({page, apiContext}) => {
		const user = (await UserFactory.create(1, {
			frontend_settings: JSON.stringify({
				quickAddMagicMode: 'disabled',
			}),
		}))[0]
		const project = (await ProjectFactory.create(1, {id: 1, title: 'Project A', owner_id: user.id}))[0]
		await createDefaultViews(project.id)
		const parent = (await TaskFactory.create(1, {id: 1, title: 'Parent task', project_id: project.id, created_by_id: user.id}, false))[0]

		await login(page, apiContext, user)
		await page.goto(`/tasks/${parent.id}`)

		const input = await openRelatedTasksForm(page)
		await input.fill('Buy milk *Urgent')
		await input.press('Enter')

		// With magic disabled, the prefix stays in the title verbatim
		await expect(page.locator('.task-relations .related-tasks .task a').filter({hasText: 'Buy milk *Urgent'}))
			.toBeVisible({timeout: 10000})
	})
})
