// M6 §7.8–7.11 (design/specs/2026-10-23-hops-v3-m6-folder-shapes-design.md):
//  - Discovery and every settings page use the full content width; one rule for all of them:
//    prose and boxes alike use the full width (no 75ch cap: Jonathan's ruling, Discovery sub-menu
//    round); only a Global settings row's description column keeps its measure (Ruling 4, below).
//  - Discovery's sub-pages have a "‹ Discovery" link back at the top.
//  - The sidebar is always there, at the left edge, on Discovery pages (no sideways shift).
//  - Factory reset is an emergency-stop button (CSS/SVG only) and still asks for confirmation.
// Real browser: widths, fonts and :active need Chromium.
import { test, expect, type Page } from '@playwright/test';
import { getCsrfToken } from '../helpers';

let scanId = '';

async function ensureScan(page: Page): Promise<string> {
	if (scanId) return scanId;
	await page.goto('/settings/discovery');
	const r = await page.request.post('/api/discovery/scans', {
		headers: { 'X-CSRF-Token': await getCsrfToken(page.context()), 'Content-Type': 'application/json' },
		data: JSON.stringify({ cidr: '127.0.0.1/32', intensity: 'light' })
	});
	expect(r.ok(), await r.text()).toBeTruthy();
	scanId = (await r.json()).id;
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

/** The content area (the settings column inside its padding), the widest box in it, and every
 *  paragraph wider than ~75ch of its own font. */
async function measure(page: Page) {
	return page.evaluate(() => {
		const main = document.querySelector('.settings-main') as HTMLElement;
		const cs = getComputedStyle(main);
		const area = main.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
		const body = document.querySelector('.page-body') as HTMLElement;
		const left = body.getBoundingClientRect().left;
		let widest = 0;
		const tooWide: string[] = [];
		const isPara = (el: Element) => el.matches('p, .lede, .lede-aside, .hint, .desc');
		const isRowDesc = (el: Element) => el.matches('.row .desc');
		for (const el of Array.from(body.querySelectorAll('*')) as HTMLElement[]) {
			const r = el.getBoundingClientRect();
			if (!r.width || !r.height) continue;
			if (isPara(el)) {
				const probe = document.createElement('span');
				probe.textContent = '0'.repeat(100);
				probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
				probe.style.font = getComputedStyle(el).font;
				document.body.appendChild(probe);
				const ch = probe.getBoundingClientRect().width / 100;
				probe.remove();
				const pcs = getComputedStyle(el);
				const textW = r.width - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight);
				if (isRowDesc(el) && textW > 76 * ch) tooWide.push(`${el.tagName}.${el.className} ${Math.round(textW)}px > 76ch (${Math.round(76 * ch)}px)`);
			} else if (r.left - left < 2) {
				widest = Math.max(widest, r.width);
			}
		}
		return { area, widest, ratio: widest / area, tooWide };
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
				expect(m.tooWide).toEqual([]);
				// No sideways scroll.
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
			});
		}
	}

	// Ruling 4: each Global settings row is two columns — the description (<= 75ch) with its control
	// right beside it, never ~500 px away at 1920; one column on a narrow screen.
	for (const width of [1280, 1920]) {
		test(`Global settings at ${width}: every control sits right beside its description`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await open(page, '/settings/global', 'Global settings');
			const rows = await page.locator('.row').evaluateAll((els) =>
				els.map((row) => {
					const label = row.querySelector('.row-label')!.getBoundingClientRect();
					const desc = row.querySelector('.desc')!.getBoundingClientRect();
					const input = row.querySelector('.row-input')!.getBoundingClientRect();
					const probe = document.createElement('span');
					probe.textContent = '0'.repeat(100);
					probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
					probe.style.font = getComputedStyle(row.querySelector('.desc')!).font;
					document.body.appendChild(probe);
					const ch = probe.getBoundingClientRect().width / 100;
					probe.remove();
					return {
						name: row.querySelector('.label-text')!.textContent!.trim(),
						gap: input.left - Math.max(desc.right, label.left),
						labelWidth: label.width,
						maxLabel: 76 * ch,
						sideBySide: Math.abs(input.top - label.top) < 4
					};
				})
			);
			expect(rows.length).toBeGreaterThan(5);
			for (const r of rows) {
				expect(r.sideBySide, `${r.name}: control beside its description`).toBe(true);
				expect(r.gap, `${r.name}: gap between description and control`).toBeLessThanOrEqual(40);
				expect(r.gap, `${r.name}: no overlap`).toBeGreaterThanOrEqual(8);
				expect(r.labelWidth, `${r.name}: description column <= 75ch`).toBeLessThanOrEqual(r.maxLabel);
			}
		});
	}

	test('Global settings on a phone: one column, the control under its description', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 800 });
		await open(page, '/settings/global', 'Global settings');
		const rows = await page.locator('.row').evaluateAll((els) =>
			els.map((row) => {
				const label = row.querySelector('.row-label')!.getBoundingClientRect();
				const input = row.querySelector('.row-input')!.getBoundingClientRect();
				return { below: input.top >= label.bottom - 1 };
			})
		);
		expect(rows.length).toBeGreaterThan(5);
		expect(rows.every((r) => r.below)).toBe(true);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
	});

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
