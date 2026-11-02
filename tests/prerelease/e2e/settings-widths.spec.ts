// Settings widths:
//  - Discovery and every settings page use the full content width; one rule for all of them:
//    prose and boxes alike use the full width (no 75ch cap), a Global settings row's
//    description too: it takes all the room left of the control (below).
//  - Discovery's sub-pages have a "‹ Discovery" link back at the top.
//  - The sidebar is always there, at the left edge, on Discovery pages (no sideways shift).
//  - Factory reset is an emergency-stop button (CSS/SVG only) and still asks for confirmation.
// Real browser: widths, fonts and :active need Chromium.
import { test, expect, type Page } from '@playwright/test';
import { getCsrfToken, startScan } from '../helpers';

let scanId = '';

async function ensureScan(page: Page): Promise<string> {
	if (scanId) return scanId;
	await page.goto('/settings/discovery');
	scanId = await startScan(page);
	return scanId;
}

const PAGES = [
	{ path: '/settings/dashboards', heading: 'Dashboards' },
	{ path: '/settings/global', heading: 'Global settings' },
	{ path: '/settings/discovery', heading: 'Discovery' },
	{ path: '/settings/discovery/detectors', heading: 'Discovery detectors' },
	{ path: '/settings/discovery/diagnostics', heading: 'Discovery diagnostics' },
	{ path: '/settings/discovery/new', heading: 'New Discovery Scan' },
	{ path: '/settings/discovery/SCAN', heading: 'Discovery draft' },
	{ path: '/settings/backups', heading: 'Backups' },
	{ path: '/settings/logs', heading: 'Logs' },
	{ path: '/settings/icons', heading: 'Icons' },
	{ path: '/settings/password', heading: 'Password' },
	{ path: '/settings/reset', heading: 'Factory reset' }
];

async function open(page: Page, path: string, heading: string) {
	const p = path.includes('SCAN') ? path.replace('SCAN', await ensureScan(page)) : path;
	await page.goto(p);
	await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible();
	// Let the page's own data (tables, rows) arrive.
	await expect(page.getByText(/^Loading…$/)).toHaveCount(0);
}

/** The content area (the settings column inside its padding) and the widest box in it. Paragraphs
 *  are not boxes here: they use the full width like everything else. */
async function measure(page: Page) {
	return page.evaluate(() => {
		const main = document.querySelector('.settings-main') as HTMLElement;
		const cs = getComputedStyle(main);
		const area = main.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
		const body = document.querySelector('.page-body') as HTMLElement;
		const left = body.getBoundingClientRect().left;
		let widest = 0;
		const isPara = (el: Element) => el.matches('p, .lede, .lede-aside, .hint, .desc');
		for (const el of Array.from(body.querySelectorAll('*')) as HTMLElement[]) {
			const r = el.getBoundingClientRect();
			if (!r.width || !r.height || isPara(el)) continue;
			if (r.left - left < 2) widest = Math.max(widest, r.width);
		}
		return { area, widest, ratio: widest / area };
	});
}

test.describe('settings widths', () => {
	for (const width of [1280, 1920]) {
		for (const pg of PAGES) {
			test(`${pg.path} at ${width}: content fills the column`, async ({ page }) => {
				await page.setViewportSize({ width, height: 900 });
				await open(page, pg.path, pg.heading);
				const m = await measure(page);
				expect(m.ratio, `widest box ${Math.round(m.widest)} of ${Math.round(m.area)}`).toBeGreaterThanOrEqual(0.85);
				// No sideways scroll.
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
			});
		}
	}

	// Each Global settings row has the same shape: the label and description on the left, using the
	// room; the control in a column of its own; then Reset/Revert/Save right beside it. The control
	// column and the Revert/Save column sit at the same x on every row.
	// 1265 is 1280 less a classic 15px scrollbar: still two columns, not stacked.
	for (const width of [1265, 1280, 1920]) {
		test(`Global settings at ${width}: label | control | buttons, in the same columns on every row`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await open(page, '/settings/global', 'Global settings');
			const rows = await page.locator('.row').evaluateAll((els) =>
				els.map((row) => {
					const label = row.querySelector('.row-label')!.getBoundingClientRect();
					const control = row.querySelector('.row-control')!.getBoundingClientRect();
					const actions = row.querySelector('.row-actions')!.getBoundingClientRect();
					const save = Array.from(row.querySelectorAll('.row-actions button')).find((b) => b.textContent?.trim() === 'Save')!.getBoundingClientRect();
					const num = row.querySelector('input[type=number]') as HTMLElement | null;
					return {
						name: row.querySelector('.label-text')!.textContent!.trim(),
						labelRight: label.right,
						controlLeft: control.left,
						actionsLeft: actions.left,
						saveRight: save.right,
						controlTop: control.top,
						labelTop: label.top,
						actionsTop: actions.top,
						numWidth: num ? num.getBoundingClientRect().width : 0,
						controlWidth: control.width,
						selectWidth: (() => { const sel = row.querySelector('.row-control > select') as HTMLElement | null; return sel ? sel.getBoundingClientRect().width : 0; })()
					};
				})
			);
			expect(rows.length).toBeGreaterThan(5);
			const first = rows[0];
			for (const r of rows) {
				expect(Math.abs(r.controlTop - r.labelTop), `${r.name}: control beside its label`).toBeLessThan(4);
				expect(Math.abs(r.actionsTop - r.controlTop), `${r.name}: buttons on the control's line`).toBeLessThan(4);
				expect(r.controlLeft, `${r.name}: control column is where it is on every row`).toBeCloseTo(first.controlLeft, 0);
				expect(r.actionsLeft, `${r.name}: button column is where it is on every row`).toBeCloseTo(first.actionsLeft, 0);
				expect(r.saveRight, `${r.name}: Save is where it is on every row`).toBeCloseTo(first.saveRight, 0);
				expect(r.controlLeft, `${r.name}: the label does not run under the control`).toBeGreaterThanOrEqual(r.labelRight);
				// A number box is sized to its largest value, never the whole column (14rem = 224px).
				if (r.numWidth) expect(r.numWidth, `${r.name}: number box fits its value`).toBeLessThan(150);
				// A select is as wide as its longest option, narrower than the control column (14rem).
				if (r.selectWidth) expect(r.selectWidth, `${r.name}: select fits its options`).toBeLessThan(r.controlWidth);
			}
		});
	}

	for (const width of [320, 390]) {
		test(`Global settings at ${width}: the text, then the control and its buttons under it`, async ({ page }) => {
			await page.setViewportSize({ width, height: 800 });
			await open(page, '/settings/global', 'Global settings');
			const rows = await page.locator('.row').evaluateAll((els) =>
				els.map((row) => {
					const label = row.querySelector('.row-label')!.getBoundingClientRect();
					const rr = row.getBoundingClientRect();
					const inside = Array.from(row.querySelectorAll('.row-control > *, .row-actions button')).every(
						(c) => c.getBoundingClientRect().right <= rr.right + 0.5 && c.getBoundingClientRect().left >= rr.left - 0.5
					);
					return { below: row.querySelector('.row-input')!.getBoundingClientRect().top >= label.bottom - 1, inside };
				})
			);
			expect(rows.length).toBeGreaterThan(5);
			expect(rows.every((r) => r.below)).toBe(true);
			expect(rows.every((r) => r.inside), 'controls and buttons stay inside their row').toBe(true);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
		});
	}

	// Settings > Dashboards: the header buttons and every row's buttons stay inside the page, even
	// for a dashboard with a very long name and path (a short one never shows a clipping bug).
	for (const width of [320, 390, 1340, 1920]) {
		test(`Dashboards at ${width}: nothing runs past the right edge`, async ({ page, context }) => {
			const id = `wide${Date.now().toString(36)}`;
			const long = 'A very long dashboard name that keeps going '.repeat(3).trim();
			const dash = {
				id, name: long, order: 0, path: `/${id}-${'long-path-'.repeat(12)}`, revision: 1,
				settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
				tabs: [{ id: `${id}-t`, name: 'Main', order: 0, root: { columns: 24, children: [] } }]
			};
			const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
			const imp = await page.request.post('/api/config/import', {
				headers: { 'X-CSRF-Token': await getCsrfToken(context) },
				multipart: { file: { name: 's.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
			});
			expect(imp.status(), await imp.text()).toBe(200);
			try {
				await page.setViewportSize({ width, height: 900 });
				await open(page, '/settings/dashboards', 'Dashboards');
				await expect(page.getByRole('button', { name: `Move ${long} up` })).toBeVisible();
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
				const beyond = await page.evaluate(() => {
					const edge = document.documentElement.clientWidth;
					return Array.from(document.querySelectorAll('.dashboard-list button, .dashboard-list a'))
						.filter((el) => el.getBoundingClientRect().right > edge + 0.5)
						.map((el) => el.getAttribute('aria-label') || el.textContent?.trim());
				});
				expect(beyond).toEqual([]);
			} finally {
				const cfg = await (await page.request.get('/api/config')).json();
				const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
				await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, { headers: { 'X-CSRF-Token': await getCsrfToken(context) } });
			}
		});
	}

	test('the empty Discovery list box uses the full width', async ({ page }) => {
		await page.setViewportSize({ width: 1920, height: 900 });
		await page.route('**/api/discovery/scans', (r) =>
			r.request().method() === 'GET' ? r.fulfill({ json: { scans: [] } }) : r.continue()
		);
		await open(page, '/settings/discovery', 'Discovery');
		const box = page.locator('.empty-state');
		await expect(box).toBeVisible();
		const [b, body] = await Promise.all([box.boundingBox(), page.locator('.page-body').boundingBox()]);
		expect(b!.width).toBeGreaterThan(body!.width * 0.95);
	});
});

test.describe('discovery pages keep the sidebar in place', () => {
	for (const width of [1416, 1600, 1920]) {
		test(`at ${width}: sidebar at the left edge, title fully visible, no sideways scroll`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			for (const pg of PAGES.filter((p) => p.path.includes('discovery'))) {
				await open(page, pg.path, pg.heading);
				const sb = await page.getByRole('navigation', { name: 'Settings sections' }).boundingBox();
				expect(sb!.x).toBeGreaterThanOrEqual(0);
				expect(sb!.x).toBeLessThan(20);
				const h = await page.getByRole('heading', { level: 2, name: pg.heading, exact: true }).boundingBox();
				expect(h!.x).toBeGreaterThan(sb!.x + sb!.width);
				expect(await page.evaluate(() => [scrollX, document.documentElement.scrollWidth - document.documentElement.clientWidth])).toEqual([0, 0]);
			}
		});
	}
});

test.describe('‹ Discovery back link', () => {
	for (const pg of PAGES.filter((p) => p.path.startsWith('/settings/discovery/'))) {
		test(`${pg.heading}: a "‹ Discovery" link at the top goes back to Discovery`, async ({ page }) => {
			await open(page, pg.path, pg.heading);
			const back = page.locator('.page-body').getByRole('link', { name: 'Discovery', exact: true });
			await expect(back).toBeVisible();
			await expect(back).toHaveText(/‹\s*Discovery/);
			const [l, h] = await Promise.all([back.boundingBox(), page.getByRole('heading', { level: 2, name: pg.heading, exact: true }).boundingBox()]);
			expect(l!.y + l!.height).toBeLessThanOrEqual(h!.y + 1);
			await back.click();
			await expect(page).toHaveURL(/\/settings\/discovery$/);
			await expect(page.getByRole('heading', { level: 2, name: 'Discovery', exact: true })).toBeVisible();
		});
	}

	test('the Discovery list itself has no back link', async ({ page }) => {
		await open(page, '/settings/discovery', 'Discovery');
		await expect(page.locator('.page-body').getByRole('link', { name: 'Discovery', exact: true })).toHaveCount(0);
	});
});

test.describe('factory reset: emergency-stop button', () => {
	test('round red mushroom on a yellow housing, named "Factory reset", presses in', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await open(page, '/settings/reset', 'Factory reset');
		const btn = page.getByRole('button', { name: 'Factory reset', exact: true });
		await expect(btn).toBeVisible();
		// No images: inline SVG / CSS only.
		await expect(btn.locator('img')).toHaveCount(0);
		const look = await btn.evaluate((b) => {
			const cap = b.querySelector('.estop-cap') as HTMLElement;
			const housing = b.querySelector('.estop-housing') as HTMLElement;
			const c = getComputedStyle(cap);
			const h = getComputedStyle(housing);
			const r = cap.getBoundingClientRect();
			return { capRadius: c.borderRadius, capW: r.width, capH: r.height, capBg: c.backgroundImage + c.backgroundColor, housingBg: h.backgroundColor, transform: c.transform };
		});
		expect(look.capRadius).toBe('50%');
		expect(Math.abs(look.capW - look.capH)).toBeLessThan(1);
		expect(look.capW).toBeGreaterThanOrEqual(80);
		expect(look.capBg).toMatch(/rgb\((2[0-5]\d|1[5-9]\d), \d{1,2}, \d{1,2}\)/); // red
		const [r, g, b] = look.housingBg.match(/\d+/g)!.map(Number);
		expect(r).toBeGreaterThan(200); expect(g).toBeGreaterThan(160); expect(b).toBeLessThan(80); // yellow

		// Press in with the mouse: the cap moves down while held.
		const box = (await btn.locator('.estop-cap').boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await expect.poll(() => btn.locator('.estop-cap').evaluate((e) => getComputedStyle(e).transform)).not.toBe(look.transform);
		// Release elsewhere so no click happens.
		await page.mouse.move(5, 5);
		await page.mouse.up();
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});

	test('clicking still asks for confirmation; Cancel resets nothing', async ({ page }) => {
		let resets = 0;
		await page.route('**/api/config/reset', (r) => { resets++; return r.abort(); });
		await open(page, '/settings/reset', 'Factory reset');
		await page.getByRole('button', { name: 'Factory reset', exact: true }).click();
		const dlg = page.getByRole('dialog', { name: 'Factory Reset' });
		await expect(dlg).toBeVisible();
		await expect(dlg).toContainText(/cannot be undone/);
		await dlg.getByRole('button', { name: 'Cancel' }).click();
		await expect(dlg).toHaveCount(0);
		expect(resets).toBe(0);
	});

	test('keyboard: Enter on the focused button presses it in and asks for confirmation', async ({ page }) => {
		let resets = 0;
		await page.route('**/api/config/reset', (r) => { resets++; return r.abort(); });
		await open(page, '/settings/reset', 'Factory reset');
		const btn = page.getByRole('button', { name: 'Factory reset', exact: true });
		await btn.focus();
		const before = await btn.locator('.estop-cap').evaluate((e) => getComputedStyle(e).transform);
		await page.keyboard.down('Space');
		await expect.poll(() => btn.locator('.estop-cap').evaluate((e) => getComputedStyle(e).transform)).not.toBe(before);
		await page.keyboard.up('Space');
		const dlg = page.getByRole('dialog', { name: 'Factory Reset' });
		await expect(dlg).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dlg).toHaveCount(0);
		await btn.focus();
		await page.keyboard.press('Enter');
		await expect(dlg).toBeVisible();
		await dlg.getByRole('button', { name: 'Cancel' }).click();
		expect(resets).toBe(0);
	});
});
