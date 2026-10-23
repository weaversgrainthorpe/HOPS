import { test, expect, type Page, type Browser, type BrowserContext } from '@playwright/test';
import { getCsrfToken, signInDialog, openDiscovery } from '../helpers';

// M5 §11 (design/specs/2026-10-22-hops-v3-m5-folders-design.md): Discovery is a normal Settings
// section. It and its sub-pages live at /settings/discovery…, inside the settings layout: the
// sidebar stays, with Discovery highlighted on every sub-page; the title, width and header actions
// match the other sections; no back arrow. Old /admin/discovery… addresses redirect. In a REAL
// browser: layout, history and redirects need Chromium.

const sidebar = (p: Page) => p.getByRole('navigation', { name: 'Settings sections' });

async function scanId(page: Page): Promise<string> {
	const r = await page.request.post('/api/discovery/scans', {
		headers: { 'X-CSRF-Token': await getCsrfToken(page.context()), 'Content-Type': 'application/json' },
		data: JSON.stringify({ cidr: '127.0.0.1/32', intensity: 'light' })
	});
	expect(r.ok(), await r.text()).toBeTruthy();
	return (await r.json()).id;
}

/** On a Discovery page inside the settings layout: the sidebar with Discovery current, the h2 title, no back arrow. */
async function expectDiscoveryPage(page: Page, path: RegExp, heading: string) {
	await expect(page).toHaveURL(path);
	await expect(sidebar(page)).toBeVisible();
	await expect(sidebar(page).locator('[aria-current="page"]')).toHaveCount(1);
	await expect(sidebar(page).getByRole('link', { name: 'Discovery', exact: true })).toHaveAttribute('aria-current', 'page');
	const h2 = page.locator('.settings-content h2.section-title');
	await expect(h2).toHaveCount(1);
	await expect(h2).toHaveText(heading);
	await expect(page.getByRole('heading', { level: 1, name: heading })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /^Back to/ })).toHaveCount(0);
}

async function anonPage(browser: Browser): Promise<{ page: Page; ctx: BrowserContext }> {
	const ctx = await browser.newContext({
		baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }
	});
	return { page: await ctx.newPage(), ctx };
}

test.describe('M5 §11 Discovery is a normal Settings section', () => {
	test('the sidebar link opens /settings/discovery, highlighted, with the section header and actions', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/settings/dashboards');
		const link = sidebar(page).getByRole('link', { name: 'Discovery', exact: true });
		await expect(link).toHaveAttribute('href', '/settings/discovery');
		await link.click();
		await expectDiscoveryPage(page, /\/settings\/discovery$/, 'Discovery');
		// Its own actions sit in the section header, on the title's row, like Dashboards' Import / New Dashboard.
		const header = page.locator('.settings-content .section-header');
		for (const name of ['Diagnostics', 'Manage detectors', 'New Scan']) {
			await expect(header.getByRole('button', { name, exact: true })).toBeVisible();
		}
		const title = (await header.locator('h2').boundingBox())!;
		const newScan = (await header.getByRole('button', { name: 'New Scan' }).boundingBox())!;
		expect(Math.abs(title.y + title.height / 2 - (newScan.y + newScan.height / 2)), 'actions on the title row').toBeLessThan(20);
	});

	test('the title matches the other sections (size) and the content uses the same width beside the sidebar', async ({ page }) => {
		await page.setViewportSize({ width: 1920, height: 900 });
		await page.goto('/settings/global');
		const globalH2 = await page.locator('.settings-content h2.section-title').evaluate((el) => getComputedStyle(el).fontSize);
		const globalBox = (await page.locator('.settings-content').boundingBox())!;
		for (const path of ['/settings/discovery', '/settings/discovery/new', '/settings/discovery/diagnostics', '/settings/discovery/detectors']) {
			await page.goto(path);
			const h2 = page.locator('.settings-content h2.section-title');
			await expect(h2).toBeVisible();
			expect(await h2.evaluate((el) => getComputedStyle(el).fontSize), `${path} title size`).toBe(globalH2);
			const m = await page.evaluate(() => {
				const side = document.querySelector('nav[aria-label="Settings sections"]')!.closest('aside')!.getBoundingClientRect();
				const content = document.querySelector('.settings-content')!.getBoundingClientRect();
				const body = document.querySelector('.settings-content .page-body')!.firstElementChild!.getBoundingClientRect();
				return { view: window.innerWidth, doc: document.documentElement.scrollWidth, sideRight: side.right, content, body };
			});
			expect(m.doc, `${path}: no sideways scroll`).toBeLessThanOrEqual(m.view);
			expect(m.content.left - m.sideRight, `${path}: content beside the sidebar`).toBeLessThanOrEqual(48);
			expect(Math.abs(m.content.width - globalBox.width), `${path}: same content width as Global settings`).toBeLessThanOrEqual(1);
			// No centred narrow column of its own inside the content.
			expect(m.body.left - m.content.left, `${path}: page starts at the content's left edge`).toBeLessThanOrEqual(1);
		}
	});

	// Batch review Minor 7: the draft page lost its own 1180 px width; at 1280 beside the sidebar nothing
	// in it may spill sideways (the page, the content, or any table inside it).
	test('the draft page at 1280: nothing overflows sideways beside the sidebar', async ({ page }) => {
		const id = await scanId(page);
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(`/settings/discovery/${id}`);
		await expectDiscoveryPage(page, new RegExp(`/settings/discovery/${id}$`), 'Discovery draft');
		await expect(page.getByText(/discovery draft|scanning/i).first()).toBeVisible({ timeout: 10_000 });
		const m = await page.evaluate(() => {
			const content = document.querySelector('.settings-content') as HTMLElement;
			const c = content.getBoundingClientRect();
			const spill = [...content.querySelectorAll<HTMLElement>('*')]
				.filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > c.right + 1; })
				.map((e) => `${e.tagName.toLowerCase()}.${e.className}`.slice(0, 60));
			return { view: window.innerWidth, doc: document.documentElement.scrollWidth, content: content.scrollWidth - content.clientWidth, spill };
		});
		expect(m.doc, 'no sideways page scroll').toBeLessThanOrEqual(m.view);
		expect(m.content, 'the content does not scroll sideways').toBeLessThanOrEqual(0);
		expect(m.spill, 'nothing pokes out past the content box').toEqual([]);
	});

	test('every sub-page keeps the sidebar with Discovery highlighted; navigation is by the header and Back', async ({ page }) => {
		await openDiscovery(page);
		await page.locator('.section-header').getByRole('button', { name: 'New Scan', exact: true }).click();
		await expectDiscoveryPage(page, /\/settings\/discovery\/new$/, 'New Discovery Scan');
		await page.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expectDiscoveryPage(page, /\/settings\/discovery$/, 'Discovery');

		await page.locator('.section-header').getByRole('button', { name: 'Diagnostics', exact: true }).click();
		await expectDiscoveryPage(page, /\/settings\/discovery\/diagnostics$/, 'Discovery diagnostics');
		await page.goBack();
		await expectDiscoveryPage(page, /\/settings\/discovery$/, 'Discovery');

		await page.locator('.section-header').getByRole('button', { name: 'Manage detectors', exact: true }).click();
		await expectDiscoveryPage(page, /\/settings\/discovery\/detectors$/, 'Discovery detectors');
		await expect(page.locator('.section-header').getByRole('button', { name: 'Add detector' })).toBeVisible();

		const id = await scanId(page);
		await page.goto(`/settings/discovery/${id}`);
		await expectDiscoveryPage(page, new RegExp(`/settings/discovery/${id}$`), 'Discovery draft');
		await expect(page.locator('.section-header').getByRole('button', { name: 'Delete' })).toBeVisible();

		// Another section from a sub-page: the sidebar moves the highlight.
		await sidebar(page).getByRole('link', { name: 'Backups', exact: true }).click();
		await expect(page).toHaveURL(/\/settings\/backups$/);
		await expect(sidebar(page).getByRole('link', { name: 'Backups', exact: true })).toHaveAttribute('aria-current', 'page');
		await page.goBack();
		await expectDiscoveryPage(page, new RegExp(`/settings/discovery/${id}$`), 'Discovery draft');
	});

	test('old /admin/discovery… addresses redirect to the matching new ones (bookmarks keep working)', async ({ page }) => {
		const id = await scanId(page);
		const cases: [string, RegExp, string][] = [
			['/admin/discovery', /\/settings\/discovery$/, 'Discovery'],
			['/admin/discovery/new', /\/settings\/discovery\/new$/, 'New Discovery Scan'],
			['/admin/discovery/diagnostics', /\/settings\/discovery\/diagnostics$/, 'Discovery diagnostics'],
			['/admin/discovery/detectors', /\/settings\/discovery\/detectors$/, 'Discovery detectors'],
			[`/admin/discovery/${id}`, new RegExp(`/settings/discovery/${id}$`), 'Discovery draft']
		];
		for (const [from, to, heading] of cases) {
			await page.goto(from);
			await expectDiscoveryPage(page, to, heading);
		}
		// The query string survives (Edit & re-scan passes the targets this way).
		await page.goto('/admin/discovery/new?targets=10.9.8.0%2F30&intensity=light');
		await expect(page).toHaveURL(/\/settings\/discovery\/new\?targets=10\.9\.8\.0%2F30&intensity=light$/);
		await expect(page.getByText('10.9.8.0/30').first()).toBeVisible();
		// The redirect replaces the old address: Back never returns to it.
		await page.goto('/settings/global');
		await page.goto('/admin/discovery/diagnostics');
		await expect(page).toHaveURL(/\/settings\/discovery\/diagnostics$/);
		await page.goBack();
		await expect(page).toHaveURL(/\/settings\/global$/);
	});

	test('logged out, a Discovery address asks for the password in place and then shows that page', async ({ browser }) => {
		const { page: anon, ctx } = await anonPage(browser);
		try {
			await anon.goto('/admin/discovery/detectors');
			await expect(anon).toHaveURL(/\/settings\/discovery\/detectors$/);
			await signInDialog(anon);
			await expectDiscoveryPage(anon, /\/settings\/discovery\/detectors$/, 'Discovery detectors');
		} finally {
			await ctx.close();
		}
	});

	test('phone: the section menu is on top and Discovery is current on a sub-page', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/settings/discovery/diagnostics');
		await expectDiscoveryPage(page, /\/settings\/discovery\/diagnostics$/, 'Discovery diagnostics');
		const menu = (await sidebar(page).boundingBox())!;
		const h2 = (await page.locator('h2.section-title').boundingBox())!;
		expect(menu.y + menu.height).toBeLessThanOrEqual(h2.y);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	});
});
