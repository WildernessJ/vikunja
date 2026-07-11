import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {ProjectViewFactory} from '../../factories/project_view'

async function logout(page) {
	await page.locator('.navbar .username-dropdown-trigger').click()
	await page.locator('.navbar .dropdown-item').filter({hasText: 'Logout'}).click()
}

test.describe('Log out', () => {
	test.use({
		// All tests in this describe block use the authenticatedPage fixture
	})

	test('Logs the user out', async ({authenticatedPage: page}) => {
		await page.goto('/')

		// Check that token exists before logout
		const tokenBefore = await page.evaluate(() => localStorage.getItem('token'))
		expect(tokenBefore).not.toBeNull()

		await logout(page)

		// Check URL redirects to login
		await expect(page).toHaveURL(/\/login/)

		// Check that token is removed after logout
		const tokenAfter = await page.evaluate(() => localStorage.getItem('token'))
		expect(tokenAfter).toBeNull()
	})

	test('Should clear the project history after logging the user out', async ({authenticatedPage: page}) => {
		const projects = await ProjectFactory.create(1)
		await ProjectViewFactory.create(1, {
			id: projects[0].id,
			project_id: projects[0].id,
		}, false)

		// Wait for the project page to load and history to be saved
		const loadProjectPromise = page.waitForResponse(response =>
			response.url().includes(`/projects/${projects[0].id}`) && response.request().method() === 'GET',
		)
		await page.goto(`/projects/${projects[0].id}/${projects[0].id}`)
		await loadProjectPromise

		// Wait for history to be saved to localStorage
		await page.waitForFunction(
			(projectId) => {
				const history = JSON.parse(localStorage.getItem('projectHistory') || '[]')
				return history.some((h: {id: number}) => h.id === projectId)
			},
			projects[0].id,
		)

		// Check that project history exists
		const historyBefore = await page.evaluate(() => localStorage.getItem('projectHistory'))
		expect(historyBefore).not.toBeNull()

		// Logging out resets the settings store, which nudges the task list's params
		// watcher. Guard against it firing a task fetch after the token is gone — that
		// 401s and flashes a stray error toast on the way out (#44 follow-up). A benign
		// still-authenticated (200) fetch during the transition is harmless; only a
		// failed one is the regression, so assert on 401s / aborted task requests.
		const isTaskFetch = (url: string) => /\/projects\/\d+\/(views\/\d+\/)?tasks(\?|$)/.test(url)
		const doomedTaskFetches: string[] = []
		const onResponse = (response) => {
			if (isTaskFetch(response.url()) && response.status() === 401) {
				doomedTaskFetches.push(`401 ${response.url()}`)
			}
		}
		const onRequestFailed = (request) => {
			if (isTaskFetch(request.url())) {
				doomedTaskFetches.push(`failed ${request.url()}`)
			}
		}
		page.on('response', onResponse)
		page.on('requestfailed', onRequestFailed)

		await logout(page)

		// Check URL redirects to login
		await expect(page).toHaveURL(/\/login/)
		page.off('response', onResponse)
		page.off('requestfailed', onRequestFailed)

		expect(doomedTaskFetches, 'no task fetch should 401/fail during logout').toEqual([])

		// Verify the project history is cleared after logout
		const historyAfter = await page.evaluate(() => localStorage.getItem('projectHistory'))
		expect(historyAfter).toBeNull()
	})
})
