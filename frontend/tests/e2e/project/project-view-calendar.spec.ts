import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {ProjectViewFactory} from '../../factories/project_view'
import {TaskFactory} from '../../factories/task'
import {UserFactory} from '../../factories/user'
import {LinkShareFactory} from '../../factories/link_sharing'
import {setupApiUrl} from '../../support/authenticateUser'
import type {Locator, Page} from '@playwright/test'

const VIEW_KIND_CALENDAR = 4

// Playwright's mouse-based dragTo does not reliably drive native HTML5
// drag-and-drop, so dispatch the real drag sequence with a shared DataTransfer.
async function html5DragTo(page: Page, source: Locator, target: Locator) {
	const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
	await source.dispatchEvent('dragstart', {dataTransfer})
	await target.dispatchEvent('dragover', {dataTransfer})
	// The drop handler reschedules the task, which moves the chip off the source
	// cell — so no dragend on the (now-relocated) source afterwards.
	await target.dispatchEvent('drop', {dataTransfer})
}

// The e2e backend runs in GMT, so local time == UTC here. We still anchor
// every date at noon to keep it clear of the midnight boundary where a
// timezone offset would flip the calendar day.
function noonUTC(year: number, month1: number, day: number): string {
	return new Date(Date.UTC(year, month1 - 1, day, 12, 0, 0)).toISOString()
}

async function createCalendarProject() {
	const projects = await ProjectFactory.create(1)
	await ProjectViewFactory.create(1, {
		id: 1,
		project_id: projects[0].id,
		view_kind: VIEW_KIND_CALENDAR,
	})
	return projects[0]
}

// Two projects, each with its own calendar view (ids 1 and 2), so the same
// ProjectCalendar.vue instance gets reused (not remounted) when navigating
// between them client-side — see project.view route in router/index.ts.
async function createTwoCalendarProjects() {
	const projects = await ProjectFactory.create(2, {
		title: i => `Calendar Bleed Project ${i}`,
	})
	for (let i = 0; i < projects.length; i++) {
		await ProjectViewFactory.create(1, {
			id: i + 1,
			project_id: projects[i].id,
			view_kind: VIEW_KIND_CALENDAR,
		}, i === 0)
	}
	return projects
}

// A pure client-side router-link click — unlike page.goto(), this reuses the
// existing route component instance instead of remounting it, which is the
// precondition for the cross-project data-bleed bug this file guards against.
async function navigateViaSidebar(page: Page, projectTitle: string) {
	await page.locator('.menu-list .list-menu-link', {
		has: page.locator('.project-menu-title', {hasText: new RegExp(`^${projectTitle}$`)}),
	}).first().click()
}

test.describe('Project View Calendar', () => {
	test.beforeEach(async ({page}) => {
		// Pin "today" to July 2026 so month navigation is deterministic.
		await page.clock.install({time: new Date(Date.UTC(2026, 6, 8, 12, 0, 0))})
	})

	test('Renders the month grid for the current month', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		await page.goto(`/projects/${project.id}/1`)

		await expect(page.locator('.project-calendar')).toBeVisible()
		await expect(page.locator('.calendar-period-label')).toContainText('July 2026')
		await expect(page.locator('.calendar-day[data-date="2026-07-08"]')).toBeVisible()
	})

	test('Month prev/next/today navigation is visible and changes the month', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		// A July-only task so we can prove the visible window actually moves.
		const julyTask = await TaskFactory.create(1, {
			project_id: project.id,
			due_date: noonUTC(2026, 7, 10),
		})
		await page.goto(`/projects/${project.id}/1`)

		// The nav icons must actually render — an unregistered FontAwesome icon
		// produces no svg, which is exactly the regression this guards.
		await expect(page.locator('.calendar-prev svg')).toBeVisible()
		await expect(page.locator('.calendar-next svg')).toBeVisible()
		await expect(page.locator('.calendar-period-label')).toContainText('July 2026')
		await expect(page.locator('.calendar-day[data-date="2026-07-10"] .calendar-task')).toContainText(julyTask[0].title)

		// Next → August: July's task leaves the visible window.
		await page.locator('.calendar-next').click()
		await expect(page.locator('.calendar-period-label')).toContainText('August 2026')
		await expect(page.locator('.calendar-grid')).not.toContainText(julyTask[0].title)

		// Prev twice → June.
		await page.locator('.calendar-prev').click()
		await page.locator('.calendar-prev').click()
		await expect(page.locator('.calendar-period-label')).toContainText('June 2026')

		// Today → back to July, task visible again.
		await page.locator('.calendar-today').click()
		await expect(page.locator('.calendar-period-label')).toContainText('July 2026')
		await expect(page.locator('.calendar-day[data-date="2026-07-10"] .calendar-task')).toContainText(julyTask[0].title)
	})

	test('Week mode next advances the range by seven days', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		await page.goto(`/projects/${project.id}/1`)

		await page.locator('.calendar-mode-week').click()
		await expect(page.locator('.calendar-grid.is-week .calendar-day')).toHaveCount(7)

		// 2026-07-08 is a Wednesday; the default (Sunday-start) week is Jul 5–11.
		await expect(page.locator('.calendar-day[data-date="2026-07-08"]')).toBeVisible()

		await page.locator('.calendar-next').click()
		// Next week: Jul 12–18. The prior week's Wednesday cell is gone; the new one is present.
		await expect(page.locator('.calendar-day[data-date="2026-07-15"]')).toBeVisible()
		await expect(page.locator('.calendar-day[data-date="2026-07-08"]')).toHaveCount(0)
	})

	test('Places a task on its due-date cell', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		const tasks = await TaskFactory.create(1, {
			project_id: project.id,
			due_date: noonUTC(2026, 7, 10),
		})
		await page.goto(`/projects/${project.id}/1`)

		const cell = page.locator('.calendar-day[data-date="2026-07-10"]')
		await expect(cell.locator('.calendar-task')).toContainText(tasks[0].title)
	})

	test('Spans a ranged task across the covered days', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		const tasks = await TaskFactory.create(1, {
			project_id: project.id,
			start_date: noonUTC(2026, 7, 13),
			end_date: noonUTC(2026, 7, 15),
		})

		// The unscheduled fetch is the request whose filter carries the
		// never-matching 9999 sentinel; capture its response body.
		const unscheduledResponse = page.waitForResponse(response =>
			response.url().includes('/tasks') &&
			response.url().includes('9999-12-31') &&
			response.request().method() === 'GET',
		)
		await page.goto(`/projects/${project.id}/1`)

		for (const day of ['2026-07-13', '2026-07-14', '2026-07-15']) {
			await expect(
				page.locator(`.calendar-day[data-date="${day}"] .calendar-task`),
			).toContainText(tasks[0].title)
		}

		// Server-side proof: a start/end task (null due_date, but start/end set)
		// must NOT be returned by the unscheduled fetch at all — the three-field
		// null filter excludes it before the client guard ever runs.
		const body = await (await unscheduledResponse).json() as Array<{id: number}>
		expect(body.some(task => task.id === tasks[0].id)).toBe(false)

		// And it's absent from the panel.
		await expect(page.locator('.calendar-unscheduled')).not.toContainText(tasks[0].title)
	})

	test('Lists dateless tasks in the unscheduled panel', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		const tasks = await TaskFactory.create(1, {
			project_id: project.id,
			due_date: null,
			start_date: null,
			end_date: null,
		})
		await page.goto(`/projects/${project.id}/1`)

		await expect(page.locator('.calendar-unscheduled')).toContainText(tasks[0].title)
		await expect(page.locator('.calendar-grid')).not.toContainText(tasks[0].title)
	})

	test('Drag to another day persists the new due date', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		const tasks = await TaskFactory.create(1, {
			project_id: project.id,
			due_date: noonUTC(2026, 7, 10),
		})
		await page.goto(`/projects/${project.id}/1`)

		const chip = page.locator('.calendar-day[data-date="2026-07-10"] .calendar-task', {hasText: tasks[0].title})
		const target = page.locator('.calendar-day[data-date="2026-07-21"]')
		await expect(chip).toBeVisible()

		const updatePromise = page.waitForResponse(response =>
			response.url().includes('/tasks/') && response.request().method() === 'POST',
		)
		await html5DragTo(page, chip, target)
		await updatePromise

		await expect(
			page.locator('.calendar-day[data-date="2026-07-21"] .calendar-task'),
		).toContainText(tasks[0].title)
	})

	test('Drag from the unscheduled panel sets a due date', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		const tasks = await TaskFactory.create(1, {
			project_id: project.id,
			due_date: null,
			start_date: null,
			end_date: null,
		})
		await page.goto(`/projects/${project.id}/1`)

		const chip = page.locator('.calendar-unscheduled .calendar-task', {hasText: tasks[0].title})
		const target = page.locator('.calendar-day[data-date="2026-07-17"]')
		await expect(chip).toBeVisible()

		const updatePromise = page.waitForResponse(response =>
			response.url().includes('/tasks/') && response.request().method() === 'POST',
		)
		await html5DragTo(page, chip, target)
		await updatePromise

		await expect(
			page.locator('.calendar-day[data-date="2026-07-17"] .calendar-task'),
		).toContainText(tasks[0].title)
	})

	test('Click a day to quick-create a task with that due date', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		await page.goto(`/projects/${project.id}/1`)

		const cell = page.locator('.calendar-day[data-date="2026-07-22"]')
		await cell.locator('.calendar-day-body').click()

		const input = cell.locator('.add-task-textarea')
		await expect(input).toBeVisible()
		await input.fill('dentist')
		await input.press('Enter')

		await expect(
			page.locator('.calendar-day[data-date="2026-07-22"] .calendar-task'),
		).toContainText('dentist')
	})

	test('Quick-add chip popups are not clipped by the calendar grid', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		await page.goto(`/projects/${project.id}/1`)

		// Bottom-row cell: its popups open downward past the grid edge, where the
		// grid's overflow: hidden would clip them without the :has() escape hatch.
		const cell = page.locator('.calendar-day[data-date="2026-07-29"]')
		await cell.locator('.calendar-day-body').click()
		await expect(cell.locator('.add-task-textarea')).toBeVisible()

		await cell.locator('.qac-chip-button').first().click()
		const searchInput = cell.locator('.popup .qac-chip-popup .multiselect input')
		// A real pointer click hit-tests at the element's coordinates and fails
		// if the popup is painted clipped by an overflow: hidden ancestor.
		await searchInput.click()
		await expect(searchInput).toBeFocused()
	})

	test('Switches to week mode showing seven day columns', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()
		await page.goto(`/projects/${project.id}/1`)

		await page.locator('.calendar-mode-week').click()

		await expect(page.locator('.calendar-grid.is-week .calendar-day')).toHaveCount(7)
	})

	test('Read-only link share shows tasks but no drag handles', async ({page}) => {
		await setupApiUrl(page)
		await UserFactory.create()
		const project = await ProjectFactory.create(1)
		await ProjectViewFactory.create(1, {
			id: 1,
			project_id: project[0].id,
			view_kind: VIEW_KIND_CALENDAR,
		})
		const tasks = await TaskFactory.create(1, {
			project_id: project[0].id,
			due_date: noonUTC(2026, 7, 10),
		})
		const linkShares = await LinkShareFactory.create(1, {
			project_id: project[0].id,
			permission: 0,
		})

		await page.goto(`/share/${linkShares[0].hash}/auth`)

		await expect(page.locator('.project-calendar')).toBeVisible()
		await expect(
			page.locator('.calendar-day[data-date="2026-07-10"] .calendar-task'),
		).toContainText(tasks[0].title)
		await expect(page.locator('.calendar-task[draggable="true"]')).toHaveCount(0)
	})

	// ProjectView.vue renders ProjectCalendar behind `v-if="currentView?.viewKind
	// === 'calendar'"`. The first time a project is visited, its full project+views
	// payload hasn't loaded into projectStore yet, so that v-if transiently goes
	// false and Vue remounts a fresh ProjectCalendar instance — which accidentally
	// clears taskById regardless of any bug. To exercise the actual reuse path (the
	// one the router-has-no-:key bug report is about), both projects must already
	// be cached in the store *before* the navigation under test, so currentView
	// resolves synchronously and the component instance is never unmounted.
	async function primeCalendarProjectsCache(page: Page, projectA: {id: number, title: string}, projectB: {id: number, title: string}) {
		await page.goto(`/projects/${projectA.id}/1`)
		await expect(page.locator('.project-calendar')).toBeVisible()
		await navigateViaSidebar(page, projectB.title)
		await expect(page.locator('.project-calendar')).toBeVisible()
		await navigateViaSidebar(page, projectA.title)
		await expect(page.locator('.project-calendar')).toBeVisible()
	}

	test('Switching projects via the sidebar does not leak the previous project\'s tasks', async ({authenticatedPage: page}) => {
		const [projectA, projectB] = await createTwoCalendarProjects()
		await TaskFactory.create(2, {
			id: '{increment}',
			project_id: i => (i === 1 ? projectA.id : projectB.id),
			title: i => (i === 1 ? 'Bleed Guard Unscheduled A' : 'Bleed Guard Unscheduled B'),
			due_date: null,
			start_date: null,
			end_date: null,
		})

		// Cache both projects first so the upcoming A → B hop reuses the live
		// component instance instead of remounting it.
		await primeCalendarProjectsCache(page, projectA, projectB)
		await expect(page.locator('.calendar-unscheduled')).toContainText('Bleed Guard Unscheduled A')

		// Delay B's task fetches so any stale A data would stay visible long
		// enough to observe — this is the reused-instance hop under test.
		await page.route(`**/projects/${projectB.id}/views/2/tasks**`, async route => {
			await new Promise(resolve => setTimeout(resolve, 1500))
			await route.continue()
		})

		await navigateViaSidebar(page, projectB.title)
		await expect(page).toHaveURL(new RegExp(`/projects/${projectB.id}/`))

		// Checked immediately, well before B's delayed fetches resolve: A's task
		// must already be gone. Without the fix, taskById is never reset on
		// navigation, so A's task would still be showing at this point.
		await expect(page.locator('.calendar-layout')).not.toContainText('Bleed Guard Unscheduled A', {timeout: 400})

		// Once B's fetches finally resolve, its own task must be present and
		// A's must still never have reappeared.
		await expect(page.locator('.calendar-unscheduled')).toContainText('Bleed Guard Unscheduled B')
		await expect(page.locator('.calendar-layout')).not.toContainText('Bleed Guard Unscheduled A')
	})

	test('A slow response from the previous project does not overwrite the new project once it finally resolves', async ({authenticatedPage: page}) => {
		const [projectA, projectB] = await createTwoCalendarProjects()
		await TaskFactory.create(2, {
			id: '{increment}',
			project_id: i => (i === 1 ? projectA.id : projectB.id),
			title: i => (i === 1 ? 'Bleed Guard Race A' : 'Bleed Guard Race B'),
			due_date: null,
			start_date: null,
			end_date: null,
		})

		// Cache both projects first so every hop below reuses the live component
		// instance — required for the out-of-order response to have anywhere to leak into.
		await primeCalendarProjectsCache(page, projectA, projectB)
		await navigateViaSidebar(page, projectB.title)
		await expect(page.locator('.calendar-unscheduled')).toContainText('Bleed Guard Race B')

		// Delay every task fetch for project A's calendar view (both the windowed
		// and unscheduled requests share this path) so it resolves only after
		// we've already navigated away to project B again — reproducing the
		// out-of-order async overwrite the sequence guard defends against.
		await page.route(`**/projects/${projectA.id}/views/1/tasks**`, async route => {
			await new Promise(resolve => setTimeout(resolve, 1500))
			await route.continue()
		})

		await navigateViaSidebar(page, projectA.title)
		// Navigate away immediately, without waiting for A's (delayed) tasks to load.
		await navigateViaSidebar(page, projectB.title)
		await expect(page).toHaveURL(new RegExp(`/projects/${projectB.id}/`))
		await expect(page.locator('.calendar-unscheduled')).toContainText('Bleed Guard Race B')

		// Give A's delayed response time to resolve and attempt (and fail) to merge.
		await page.waitForTimeout(2500)
		await expect(page.locator('.calendar-layout')).not.toContainText('Bleed Guard Race A')
	})

	// SC-002: opening a calendar view must issue exactly one bounded windowed
	// fetch plus one bounded unscheduled fetch — never an unbounded full-project
	// task pull. This invariant previously had only manual verification.
	test('Opens with exactly one windowed fetch and one unscheduled fetch, both bounded', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()

		// Every request to the tasks collection ({...}/tasks), regardless of the
		// two route shapes (with/without viewId).
		const taskRequests: URL[] = []
		page.on('request', request => {
			if (request.method() !== 'GET') {
				return
			}
			const url = new URL(request.url())
			if (url.pathname.endsWith('/tasks')) {
				taskRequests.push(url)
			}
		})

		const windowResponse = page.waitForResponse(r =>
			r.url().includes('/tasks') &&
			new URL(r.url()).searchParams.get('filter_include_nulls') === 'false' &&
			r.request().method() === 'GET',
		)
		const unscheduledResponse = page.waitForResponse(r =>
			r.url().includes('/tasks') &&
			r.url().includes('9999-12-31') &&
			r.request().method() === 'GET',
		)
		await page.goto(`/projects/${project.id}/1`)
		await expect(page.locator('.project-calendar')).toBeVisible()
		await windowResponse
		await unscheduledResponse

		const isWindowed = (u: URL) =>
			u.searchParams.get('filter_include_nulls') === 'false' &&
			// The 4-clause window filter's distinctive spanning clause.
			(u.searchParams.get('filter') ?? '').includes('start_date <= ') &&
			(u.searchParams.get('filter') ?? '').includes('end_date >= ')
		const isUnscheduled = (u: URL) =>
			u.searchParams.get('filter_include_nulls') === 'true' &&
			(u.searchParams.get('filter') ?? '').includes('9999-12-31')

		const windowed = taskRequests.filter(isWindowed)
		const unscheduled = taskRequests.filter(isUnscheduled)

		expect(windowed).toHaveLength(1)
		expect(unscheduled).toHaveLength(1)

		// No task-collection GET may be unbounded: every one must be either the
		// windowed or the unscheduled request (i.e. carry a date filter), and
		// none may pull the whole project via a missing/huge per_page.
		for (const u of taskRequests) {
			expect(isWindowed(u) || isUnscheduled(u)).toBe(true)
			expect(Number(u.searchParams.get('per_page'))).toBeGreaterThan(0)
			expect(Number(u.searchParams.get('per_page'))).toBeLessThanOrEqual(250)
		}
	})

	// The truncation banners are driven by totalPages > 1, which the frontend
	// reads from the x-pagination-total-pages response header
	// (abstractService.ts). Real fixtures never paginate, so force the header.
	test('Shows the unscheduled truncation banner when that fetch is paginated', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()

		await page.route(`**/projects/${project.id}/views/1/tasks**`, async route => {
			if (!route.request().url().includes('9999-12-31')) {
				await route.continue()
				return
			}
			const response = await route.fetch()
			await route.fulfill({
				response,
				headers: {
					...response.headers(),
					'x-pagination-total-pages': '2',
				},
			})
		})

		await page.goto(`/projects/${project.id}/1`)

		await expect(
			page.locator('.calendar-unscheduled .calendar-truncation-notice'),
		).toBeVisible()
	})

	test('Shows the window truncation banner when the windowed fetch is paginated', async ({authenticatedPage: page}) => {
		const project = await createCalendarProject()

		await page.route(`**/projects/${project.id}/views/1/tasks**`, async route => {
			if (route.request().url().includes('9999-12-31')) {
				await route.continue()
				return
			}
			const response = await route.fetch()
			await route.fulfill({
				response,
				headers: {
					...response.headers(),
					'x-pagination-total-pages': '2',
				},
			})
		})

		await page.goto(`/projects/${project.id}/1`)

		await expect(
			page.locator('.calendar-main .calendar-truncation-notice'),
		).toBeVisible()
	})

	// The e2e backend runs in GMT, so day-boundary bugs for non-UTC users are
	// structurally invisible to every test above. Overriding the browser
	// timezone to UTC+12 exercises the real client-side local-day placement
	// (dayKey/calendarDayDelta use local Date parts, not UTC).
	test.describe('Non-UTC timezone (Pacific/Auckland, UTC+12)', () => {
		test.use({timezoneId: 'Pacific/Auckland'})

		test('Places a task on its LOCAL day cell, not its GMT day', async ({authenticatedPage: page}) => {
			const project = await createCalendarProject()
			// 23:00Z on Jul 20 is 11:00 on Jul 21 in Auckland: GMT day 20, local day 21.
			const tasks = await TaskFactory.create(1, {
				project_id: project.id,
				due_date: new Date(Date.UTC(2026, 6, 20, 23, 0, 0)).toISOString(),
			})

			await page.goto(`/projects/${project.id}/1`)
			await expect(page.locator('.project-calendar')).toBeVisible()

			// Proof the override is live and the two calendar days genuinely differ:
			// the same instant reads as day 21 locally but day 20 in UTC.
			const [localDay, utcDay, tz] = await page.evaluate(() => {
				const d = new Date('2026-07-20T23:00:00Z')
				return [d.getDate(), d.getUTCDate(), Intl.DateTimeFormat().resolvedOptions().timeZone] as const
			})
			expect(tz).toBe('Pacific/Auckland')
			expect(localDay).toBe(21)
			expect(utcDay).toBe(20)

			// The chip must sit on the LOCAL day (21), never the GMT day (20).
			await expect(
				page.locator('.calendar-day[data-date="2026-07-21"] .calendar-task'),
			).toContainText(tasks[0].title)
			await expect(
				page.locator('.calendar-day[data-date="2026-07-20"]'),
			).not.toContainText(tasks[0].title)
		})

		test('Drag-reschedule lands on the intended local day and persists it', async ({authenticatedPage: page}) => {
			const project = await createCalendarProject()
			const tasks = await TaskFactory.create(1, {
				project_id: project.id,
				due_date: new Date(Date.UTC(2026, 6, 20, 23, 0, 0)).toISOString(),
			})

			await page.goto(`/projects/${project.id}/1`)
			const chip = page.locator('.calendar-day[data-date="2026-07-21"] .calendar-task', {hasText: tasks[0].title})
			const target = page.locator('.calendar-day[data-date="2026-07-25"]')
			await expect(chip).toBeVisible()

			const updatePromise = page.waitForResponse(response =>
				response.url().includes('/tasks/') && response.request().method() === 'POST',
			)
			await html5DragTo(page, chip, target)
			const updateResponse = await updatePromise

			// Lands on the intended local cell...
			await expect(
				page.locator('.calendar-day[data-date="2026-07-25"] .calendar-task'),
			).toContainText(tasks[0].title)

			// ...and the persisted due_date is the same local day (noon local =
			// 00:00Z the same date under UTC+12), proving the whole-day delta math
			// held under a non-UTC offset.
			const saved = await updateResponse.json() as {due_date: string}
			const savedLocalDay = await page.evaluate(
				iso => new Date(iso).getDate(),
				saved.due_date,
			)
			expect(savedLocalDay).toBe(25)
		})
	})
})
