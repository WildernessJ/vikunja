import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'
import {createDefaultViews} from '../project/prepareProjects'

test('task subscription survives reload and can be removed', async ({authenticatedPage: page, apiContext, userToken}) => {
	const [project] = await ProjectFactory.create(1)
	await createDefaultViews(project.id)
	const [task] = await TaskFactory.create(1, {project_id: project.id})
	const headers = {Authorization: `Bearer ${userToken}`}
	await page.goto(`/tasks/${task.id}`)
	// The fork keeps subscribe/unsubscribe in the task detail's More Actions menu.
	const menu = page.locator('.task-view .task-detail-menu')
	const openMenu = () => menu.getByRole('button', {name: 'More Actions'}).click()
	await openMenu()
	await menu.getByRole('button', {name: 'Subscribe', exact: true}).click()
	await openMenu()
	await expect(menu.getByRole('button', {name: 'Unsubscribe', exact: true})).toBeVisible()
	await page.reload()
	await openMenu()
	await menu.getByRole('button', {name: 'Unsubscribe', exact: true}).click()
	await openMenu()
	await expect(menu.getByRole('button', {name: 'Subscribe', exact: true})).toBeVisible()
	await page.reload()
	await openMenu()
	await expect(menu.getByRole('button', {name: 'Subscribe', exact: true})).toBeVisible()
	const stored = await apiContext.get(`tasks/${task.id}`, {headers})
	expect(stored.ok()).toBeTruthy()
	expect((await stored.json()).subscription).toBeFalsy()
})
