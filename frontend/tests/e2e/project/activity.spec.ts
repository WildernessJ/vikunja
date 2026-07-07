import {test, expect} from '../../support/fixtures'
import {TaskFactory} from '../../factories/task'
import {createProjects} from './prepareProjects'

test.describe('Project Activity', () => {
	test('shows a completion entry with actor and task title, filterable by verb', async ({authenticatedPage: page, currentUser}) => {
		await createProjects(1)
		const [task] = await TaskFactory.create(1, {
			id: 1,
			project_id: 1,
			done: false,
			title: 'Activity feed task',
		})

		// Mark the task done through the UI so the update flow dispatches the
		// done-transition event that the capture listener records.
		await page.goto(`/tasks/${task.id}`)
		await page.locator('.task-view .action-buttons .button').filter({hasText: 'Mark task done!'}).click()
		await expect(page.locator('.task-view .is-done')).toBeVisible()

		// Open the project Activity panel.
		await page.goto('/projects/1/activity')

		const feed = page.locator('.project-activity')
		await expect(feed).toBeVisible()

		// Filter to completion entries. (A done-toggle also emits a task_updated
		// entry, so filtering by verb isolates the completion the scenario is
		// about.)
		await feed.locator('.activity-filter select[name="verb"]').selectOption('task_completed')

		const completed = feed.locator('.activity-entry').filter({hasText: 'Activity feed task'})
		await expect(completed).toHaveCount(1)
		await expect(completed).toContainText(currentUser.username)

		// Filtering by a non-matching verb hides the completion entry.
		await feed.locator('.activity-filter select[name="verb"]').selectOption('comment_created')
		await expect(feed.locator('.activity-entry').filter({hasText: 'Activity feed task'})).toHaveCount(0)

		// Filtering back to completion shows it again.
		await feed.locator('.activity-filter select[name="verb"]').selectOption('task_completed')
		await expect(feed.locator('.activity-entry').filter({hasText: 'Activity feed task'})).toHaveCount(1)
	})
})
