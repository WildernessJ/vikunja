import {test, expect} from '../../support/fixtures'

const HOME_HREF = '/'
const UPCOMING_HREF = '/tasks/by/upcoming'
const TODAY_HREF = '/tasks/today'
const PROJECTS_HREF = '/projects'
const LABELS_HREF = '/labels'
const TEMPLATES_HREF = '/templates'
const TEAMS_HREF = '/teams'

const ALL_TOGGLEABLE_HREFS = [UPCOMING_HREF, TODAY_HREF, PROJECTS_HREF, LABELS_HREF, TEMPLATES_HREF, TEAMS_HREF]

test.describe('Sidebar nav visibility', () => {
	test('shows all seven top-nav links by default for a fresh user', async ({authenticatedPage: page}) => {
		await page.goto('/')

		await expect(page.locator('.top-menu .menu-list a[href="' + HOME_HREF + '"]')).toBeVisible()
		for (const href of ALL_TOGGLEABLE_HREFS) {
			await expect(page.locator(`.top-menu .menu-list a[href="${href}"]`)).toBeVisible()
		}
	})

	test('has no hide control for Overview but has one for every toggleable item', async ({authenticatedPage: page}) => {
		await page.goto('/user/settings/general')
		await page.waitForLoadState('networkidle')

		await expect(page.locator('[data-cy="navVisibility-overview"]')).toHaveCount(0)

		for (const key of ['upcoming', 'today', 'projects', 'labels', 'templates', 'teams']) {
			await expect(page.locator(`[data-cy="navVisibility-${key}"]`)).toBeVisible()
		}
	})

	test('hiding a link from settings removes it from the sidebar and persists across reload', async ({authenticatedPage: page}) => {
		await page.goto('/user/settings/general')
		await page.waitForLoadState('networkidle')

		const projectsToggle = page.locator('[data-cy="navVisibility-projects"]')
		await expect(projectsToggle).toBeVisible({timeout: 10000})
		await projectsToggle.click()

		const saveButton = page.locator('[data-cy="saveGeneralSettings"]')
		await expect(saveButton).toBeVisible({timeout: 10000})

		const settingsUpdatePromise = page.waitForResponse(response =>
			response.url().includes('user/settings/general') && response.request().method() === 'POST',
		)
		await saveButton.click()
		const response = await settingsUpdatePromise
		expect(response.ok()).toBe(true)
		await expect(page.locator('.global-notification')).toContainText('Success', {timeout: 10000})

		await page.reload()
		await page.waitForLoadState('networkidle')
		await page.goto('/')

		await expect(page.locator(`.top-menu .menu-list a[href="${PROJECTS_HREF}"]`)).toHaveCount(0)
		await expect(page.locator('.top-menu .menu-list a[href="' + HOME_HREF + '"]')).toBeVisible()
		for (const href of [UPCOMING_HREF, TODAY_HREF, LABELS_HREF, TEMPLATES_HREF, TEAMS_HREF]) {
			await expect(page.locator(`.top-menu .menu-list a[href="${href}"]`)).toBeVisible()
		}
	})

	test('re-showing a hidden link restores it in the sidebar', async ({authenticatedPage: page}) => {
		await page.goto('/user/settings/general')
		await page.waitForLoadState('networkidle')

		const labelsToggle = page.locator('[data-cy="navVisibility-labels"]')
		await expect(labelsToggle).toBeVisible({timeout: 10000})
		await labelsToggle.click()

		let saveButton = page.locator('[data-cy="saveGeneralSettings"]')
		await expect(saveButton).toBeVisible({timeout: 10000})
		let settingsUpdatePromise = page.waitForResponse(response =>
			response.url().includes('user/settings/general') && response.request().method() === 'POST',
		)
		await saveButton.click()
		await settingsUpdatePromise
		await expect(page.locator('.global-notification')).toContainText('Success', {timeout: 10000})

		await page.reload()
		await page.waitForLoadState('networkidle')
		await expect(page.locator(`.top-menu .menu-list a[href="${LABELS_HREF}"]`)).toHaveCount(0)

		await labelsToggle.click()
		saveButton = page.locator('[data-cy="saveGeneralSettings"]')
		await expect(saveButton).toBeVisible({timeout: 10000})
		settingsUpdatePromise = page.waitForResponse(response =>
			response.url().includes('user/settings/general') && response.request().method() === 'POST',
		)
		await saveButton.click()
		await settingsUpdatePromise
		await expect(page.locator('.global-notification')).toContainText('Success', {timeout: 10000})

		await page.reload()
		await page.waitForLoadState('networkidle')
		await page.goto('/')
		await expect(page.locator(`.top-menu .menu-list a[href="${LABELS_HREF}"]`)).toBeVisible()
	})

	test('hiding a link takes effect in the sidebar without a reload', async ({authenticatedPage: page}) => {
		await page.goto('/user/settings/general')
		await page.waitForLoadState('networkidle')
		await expect(page.locator(`.top-menu .menu-list a[href="${TEAMS_HREF}"]`)).toBeVisible()

		const teamsToggle = page.locator('[data-cy="navVisibility-teams"]')
		await expect(teamsToggle).toBeVisible({timeout: 10000})
		await teamsToggle.click()

		const saveButton = page.locator('[data-cy="saveGeneralSettings"]')
		await expect(saveButton).toBeVisible({timeout: 10000})
		const settingsUpdatePromise = page.waitForResponse(response =>
			response.url().includes('user/settings/general') && response.request().method() === 'POST',
		)
		await saveButton.click()
		await settingsUpdatePromise
		await expect(page.locator('.global-notification')).toContainText('Success', {timeout: 10000})

		// No reload: the reactive store update must remove the link on its own.
		await expect(page.locator(`.top-menu .menu-list a[href="${TEAMS_HREF}"]`)).toHaveCount(0)
	})
})
