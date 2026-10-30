import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// The icon-name field in "Edit icon" has a readable
// placeholder and hint, and type-ahead suggestions drawn from the icons HOPS has offline
// (the bundled Iconify set + the imported dashboard-icons). Driven with the real keyboard.

const ICONIFY_HOSTS = /(api\.)?(iconify\.design|simplesvg\.com|unisvg\.com)/;

let made = '';

interface IconifyRequest { host: string; prefix: string; names: string[] }

/** An Iconify API request: https://<host>/<prefix>.json?icons=a,b */
function parseIconifyRequest(url: string): IconifyRequest {
	const u = new URL(url);
	return {
		host: u.host,
		prefix: u.pathname.replace(/^\//, '').replace(/\.json$/, ''),
		names: (u.searchParams.get('icons') || '').split(',').filter(Boolean)
	};
}

/** A successful Iconify answer drawing a square for every requested name. */
function svgResponse(r: IconifyRequest) {
	return {
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({
			prefix: r.prefix, width: 24, height: 24,
			icons: Object.fromEntries(r.names.map((n) => [n, { body: '<path d="M2 2h20v20H2z" fill="currentColor"/>' }]))
		})
	};
}

/** Waits until every suggestion's picture slot shows an icon or the "unavailable" glyph (with
 *  the given label) — never loading, never blank. Returns the unavailable names (no prefix). */
async function expectEveryPictureSettled(options: Locator, unavailableLabel: string): Promise<{ unavailable: string[] }> {
	const unavailable: string[] = [];
	const n = await options.count();
	for (let i = 0; i < n; i++) {
		const opt = options.nth(i);
		const slot = opt.locator('[data-preview]');
		await expect(slot).toHaveAttribute('data-preview', /^(ready|unavailable|offline)$/, { timeout: 15_000 });
		await expect(slot.locator('svg')).toBeVisible();
		const state = await slot.getAttribute('data-preview');
		if (state !== 'ready') {
			await expect(slot).toHaveAttribute('aria-label', unavailableLabel);
			await expect(slot).toHaveAttribute('title', unavailableLabel);
			const label = (await opt.locator('.suggestion-label').textContent()) || '';
			unavailable.push(label.replace(/^[^:]+:/, ''));
		}
	}
	return { unavailable };
}

/** Requests hold only names from the visible list, at most one batch per prefix per API host
 *  (Iconify tries its fallback hosts when one is unreachable), and every expected name was asked. */
function expectBatched(reqs: IconifyRequest[], expected: string[], visible: string[]) {
	const perHostPrefix = new Map<string, number>();
	for (const r of reqs) {
		const k = `${r.host}|${r.prefix}`;
		perHostPrefix.set(k, (perHostPrefix.get(k) || 0) + 1);
		for (const n of r.names) expect(visible).toContain(`${r.prefix}:${n}`);
	}
	for (const [k, c] of perHostPrefix) expect(c, `requests for ${k}`).toBe(1);
	const asked = new Set(reqs.flatMap((r) => r.names));
	for (const n of expected) expect(asked.has(n), `${n} was asked for`).toBe(true);
}

async function seedAndOpenIconEditor(page: Page, context: BrowserContext): Promise<Locator> {
	const p = `m6ta${Date.now().toString(36)}`;
	const id = (s: string) => `${p}-${s}`;
	const dash = {
		id: id('dash'), name: `Typeahead ${p}`, order: 0, path: `/${p}`, revision: 1,
		settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
		tabs: [{ id: id('tab'), name: 'Main', order: 0, root: { columns: 24, children: [
			{ id: id('t'), kind: 'tile', type: 'link', name: 'Anchor', url: 'https://anchor.example.lan/', icon: 'mdi:lan',
				openMode: 'newtab', size: 'medium', order: 0, placement: { x: 0, y: 0, w: 2, h: 2 } }
		] } }]
	};
	const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
	const r = await page.request.post('/api/config/import', {
		headers: { 'X-CSRF-Token': await getCsrfToken(context) },
		multipart: { file: { name: 'ta.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
	});
	expect(r.status(), await r.text()).toBe(200);
	made = id('dash');
	await page.goto(`/${p}`);
	await page.locator('[aria-label="Enter Edit Mode"]').click();
	await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
	await page.locator(`[data-node-id="${id('t')}"]`).dblclick();
	const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
	await expect(dlg).toBeVisible();
	await dlg.getByRole('button', { name: 'Edit icon' }).click();
	const field = page.getByRole('combobox', { name: /Iconify icon name/ });
	await expect(field).toBeVisible();
	return field;
}

// No test here may reach the internet: Iconify hosts are refused unless a test routes them
// itself (a later page.route takes precedence).
test.beforeEach(async ({ page }) => {
	await page.route(ICONIFY_HOSTS, (route) => route.abort());
});

test.afterEach(async ({ page, context }) => {
	if (!made) return;
	const id = made;
	made = '';
	const cfg = await (await page.request.get('/api/config')).json();
	const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
	const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
		headers: { 'X-CSRF-Token': await getCsrfToken(context) }
	});
	expect(r.ok(), await r.text()).toBe(true);
});

/** WCAG contrast ratio between two CSS rgb()/rgba() colours (alpha ignored: all are opaque here). */
async function contrast(page: Page, fg: string, bg: string): Promise<number> {
	return page.evaluate(([a, b]) => {
		const lum = (c: string) => {
			const [r, g, bl] = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map((v) => {
				const s = v / 255;
				return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
			});
			return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
		};
		const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
		return (l1 + 0.05) / (l2 + 0.05);
	}, [fg, bg]);
}

test.describe('icon field is readable', () => {
	for (const theme of ['dark', 'light'] as const) {
		test(`placeholder, hint and hint link reach 4.5:1 (${theme} theme)`, async ({ page, context }) => {
			await page.addInitScript((t) => localStorage.setItem('hops_theme', t), theme);
			const field = await seedAndOpenIconEditor(page, context);
			await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
			await field.fill('');
			const ph = await field.evaluate((el) => getComputedStyle(el, '::placeholder').color);
			const phOpacity = await field.evaluate((el) => getComputedStyle(el, '::placeholder').opacity);
			const fieldBg = await field.evaluate((el) => getComputedStyle(el).backgroundColor);
			expect(Number(phOpacity)).toBe(1);
			expect(await contrast(page, ph, fieldBg)).toBeGreaterThanOrEqual(4.5);

			const dialog = page.getByRole('dialog', { name: 'Edit icon' });
			const hint = dialog.locator('.hint');
			await expect(hint).toContainText('Type a name for suggestions');
			const dialogBg = await dialog.locator('.body').evaluate((el) => {
				let n: Element | null = el;
				while (n) {
					const c = getComputedStyle(n).backgroundColor;
					if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
					n = n.parentElement;
				}
				return 'rgb(255, 255, 255)';
			});
			const hintColor = await hint.evaluate((el) => getComputedStyle(el).color);
			const linkColor = await hint.locator('a').evaluate((el) => getComputedStyle(el).color);
			expect(await contrast(page, hintColor, dialogBg)).toBeGreaterThanOrEqual(4.5);
			expect(await contrast(page, linkColor, dialogBg)).toBeGreaterThanOrEqual(4.5);
		});
	}
});

test.describe('icon type-ahead', () => {
	test('suggests the top 5 from every icon name and narrows as you type; pictures load after a pause (Iconify API blocked)', async ({ page, context }) => {
		const external: IconifyRequest[] = [];
		await page.route(ICONIFY_HOSTS, (route) => { external.push(parseIconifyRequest(route.request().url())); return route.abort(); });
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		// The spec's example: mdi:ser gives the top 5 of every mdi name, exact name first.
		await page.keyboard.type('mdi:ser');
		// Nothing goes online while typing.
		expect(external).toEqual([]);
		const list = page.getByRole('listbox', { name: 'Icon suggestions' });
		await expect(list).toBeVisible();
		await expect(field).toHaveAttribute('aria-expanded', 'true');
		const options = list.getByRole('option');
		const labels = () => options.locator('.suggestion-label').allTextContents();
		await expect(options).toHaveCount(5);
		await expect(options.first()).toHaveAttribute('aria-selected', 'true');
		const first = await labels();
		expect(first).toEqual(['mdi:server', 'mdi:server-off', 'mdi:serial-port', 'mdi:server-plus', 'mdi:server-minus']);
		// A bundled icon draws straight away.
		await expect(options.first().locator('[data-preview="ready"] svg')).toBeVisible();
		// After the pause the others were asked for in one batch; the API is unreachable, so each
		// shows the "unavailable" glyph — never an empty box.
		const stage1 = await expectEveryPictureSettled(options, 'Preview unavailable');
		expect(stage1.unavailable.length).toBeGreaterThan(0);
		expectBatched(external, stage1.unavailable, first);
		const stage1Count = external.length;

		// Narrows as typing continues; again nothing while typing.
		await page.keyboard.type('ver-m');
		expect(external.length).toBe(stage1Count);
		await expect(options).toHaveCount(2);
		const second = await labels();
		expect(second).toEqual(['mdi:server-minus', 'mdi:server-minus-outline']);
		const stage2 = await expectEveryPictureSettled(options, 'Preview unavailable');
		await page.waitForTimeout(800);
		// Only names not tried before were asked for (failures are remembered), only from this list,
		// and the half-typed text never went online.
		const fresh = external.slice(stage1Count);
		const tried = new Set(stage1.unavailable);
		expectBatched(fresh, stage2.unavailable.filter((n) => !tried.has(n)), second);
		for (const r of external) expect(r.names).not.toContain('server-m');
		await expect(list.locator('.suggestion-placeholder')).toHaveCount(0);
	});

	test('a half name is never fetched; the visible suggestions are, after a pause; a known name previews', async ({ page, context }) => {
		const requested: IconifyRequest[] = [];
		await page.route(ICONIFY_HOSTS, (route) => {
			const r = parseIconifyRequest(route.request().url());
			requested.push(r);
			return route.fulfill(svgResponse(r));
		});
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:account-cowb');
		expect(requested).toEqual([]); // nothing while typing
		const options = page.getByRole('listbox', { name: 'Icon suggestions' }).getByRole('option');
		await expect(options.first()).toBeVisible();
		await page.waitForTimeout(1200); // well past the pause
		const visible = await options.locator('.suggestion-label').allTextContents();
		const names = requested.flatMap((r) => r.names);
		expect(names).not.toContain('account-cowb');
		for (const n of names) expect(visible).toContain(`mdi:${n}`);
		await expect(page.locator('#icon-preview-status')).toContainText('not a known icon name');
		await page.keyboard.type('oy-hat');
		await expect(page.locator('.icon-preview svg')).toBeVisible();
		expect(requested.flatMap((r) => r.names).filter((n) => n === 'account-cowboy-hat')).toHaveLength(1);
		expect(requested.flatMap((r) => r.names)).not.toContain('account-cowb');
		await expect(page.locator('#icon-preview-status')).toBeEmpty();
	});

	test('API unreachable: a known name that is not bundled shows "preview unavailable (offline)", never a blank', async ({ page, context }) => {
		const requested: IconifyRequest[] = [];
		await page.route(ICONIFY_HOSTS, (route) => { requested.push(parseIconifyRequest(route.request().url())); return route.abort(); });
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:account-cowboy-hat');
		await expect(page.locator('#icon-preview-status')).toContainText('Preview unavailable (offline)', { timeout: 15_000 });
		await expect(page.locator('.icon-preview svg')).toHaveCount(0);
		const options = page.getByRole('listbox', { name: 'Icon suggestions' }).getByRole('option');
		const visible = await options.locator('.suggestion-label').allTextContents();
		const names = new Set(requested.flatMap((r) => r.names));
		expect(names.has('account-cowboy-hat')).toBe(true);
		for (const n of names) expect(visible).toContain(`mdi:${n}`);
		await expectEveryPictureSettled(options, 'Preview unavailable');
		// A bundled icon still previews at once.
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:server');
		await expect(page.locator('.icon-preview svg')).toBeVisible();
		await expect(page.locator('#icon-preview-status')).toBeEmpty();
	});

	test('browser offline: suggestions request nothing and show "Preview unavailable (offline)"', async ({ page, context }) => {
		const requested: IconifyRequest[] = [];
		await page.route(ICONIFY_HOSTS, (route) => { requested.push(parseIconifyRequest(route.request().url())); return route.abort(); });
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		// Let the names list and the dashboard-icons list load while online.
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:serv');
		const options = page.getByRole('listbox', { name: 'Icon suggestions' }).getByRole('option');
		await expect(options.first()).toContainText('mdi:server');
		await expect(page.locator('#icon-suggest-status')).not.toContainText('Loading dashboard-icons');
		await page.waitForTimeout(800);
		requested.length = 0;
		await context.setOffline(true);
		try {
			await page.keyboard.press('ControlOrMeta+a');
			await page.keyboard.type('mdi:account-cowb');
			await expect(options.first()).toBeVisible();
			const settled = await expectEveryPictureSettled(options, 'Preview unavailable (offline)');
			expect(settled.unavailable.length).toBeGreaterThan(0);
			await page.waitForTimeout(800);
			expect(requested).toEqual([]);
		} finally {
			await context.setOffline(false);
		}
	});

	test('with the API answering, every suggestion draws its icon after the pause; retyping asks again for nothing', async ({ page, context }) => {
		const requested: IconifyRequest[] = [];
		await page.route(ICONIFY_HOSTS, (route) => {
			const r = parseIconifyRequest(route.request().url());
			requested.push(r);
			return route.fulfill(svgResponse(r));
		});
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:ser');
		expect(requested).toEqual([]);
		const options = page.getByRole('listbox', { name: 'Icon suggestions' }).getByRole('option');
		await expect(options).toHaveCount(5);
		for (let i = 0; i < 5; i++) await expect(options.nth(i).locator('[data-preview="ready"] svg')).toBeVisible();
		const visible = await options.locator('.suggestion-label').allTextContents();
		// One batched request for the prefix, holding only names from the list.
		expect(requested).toHaveLength(1);
		expect(requested[0].prefix).toBe('mdi');
		expect(requested[0].names.length).toBeGreaterThan(0);
		for (const n of requested[0].names) expect(visible).toContain(`mdi:${n}`);
		// Retype the same prefix: the pictures are in memory, nothing is asked again.
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('mdi:ser');
		for (let i = 0; i < 5; i++) await expect(options.nth(i).locator('[data-preview="ready"] svg')).toBeVisible();
		await page.waitForTimeout(800);
		expect(requested).toHaveLength(1);
	});

	test('a slow API shows the loading mark, then the icons', async ({ page, context }) => {
		await page.route(ICONIFY_HOSTS, async (route) => {
			await new Promise((r) => setTimeout(r, 1500));
			await route.fulfill(svgResponse(parseIconifyRequest(route.request().url()))).catch(() => {});
		});
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:account-cowb');
		const options = page.getByRole('listbox', { name: 'Icon suggestions' }).getByRole('option');
		await expect(options.first()).toBeVisible();
		await page.waitForTimeout(500); // past the pause, before the answer
		await expect(options.locator('[data-preview="loading"]').first()).toBeVisible();
		await expect(options.locator('[data-preview="loading"]').first()).toHaveAttribute('aria-label', 'Loading preview');
		const n = await options.count();
		for (let i = 0; i < n; i++) await expect(options.nth(i).locator('[data-preview="ready"] svg')).toBeVisible({ timeout: 10_000 });
	});

	test('the names list is its own chunk: not loaded with the dashboard, loaded when the icon editor opens', async ({ page, context }) => {
		const chunks: { url: string; names: boolean }[] = [];
		page.on('response', async (res) => {
			if (!/\/_app\/immutable\/.*\.js$/.test(res.url())) return;
			const body = await res.text().catch(() => '');
			chunks.push({ url: res.url(), names: body.includes('account-cowboy-hat') });
		});
		const field = await seedAndOpenIconEditor(page, context);
		await expect(field).toBeVisible();
		await expect.poll(() => chunks.filter((c) => c.names).length).toBe(1);
		const namesChunk = chunks.find((c) => c.names)!.url;
		// Reload the dashboard in view mode: the names chunk is not fetched.
		chunks.length = 0;
		await page.reload();
		await expect(page.locator('[aria-label="Enter Edit Mode"]')).toBeVisible();
		await page.waitForLoadState('networkidle');
		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks.some((c) => c.url === namesChunk || c.names)).toBe(false);
	});

	test('a failure to load the full names list is shown, bundled names still suggested', async ({ page, context }) => {
		// The names list is a hashed chunk; recognise it by its content and refuse it.
		await page.route('**/_app/immutable/**/*.js', async (route) => {
			const res = await route.fetch();
			const body = await res.text();
			if (body.includes('account-cowboy-hat')) return route.abort();
			return route.fulfill({ response: res, body });
		});
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:serv');
		const list = page.getByRole('listbox', { name: 'Icon suggestions' });
		await expect(list.getByRole('option').first()).toContainText('mdi:server');
		await expect(page.locator('#icon-suggest-status')).toContainText("Couldn't load the full icon names list");
	});

	test('arrow keys move, Tab accepts the highlighted suggestion', async ({ page, context }) => {
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:server-m');
		const options = page.getByRole('listbox', { name: 'Icon suggestions' }).getByRole('option');
		await expect(options).toHaveCount(2);
		await page.keyboard.press('ArrowDown');
		await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
		await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');
		const activeId = await options.nth(1).getAttribute('id');
		await expect(field).toHaveAttribute('aria-activedescendant', activeId!);
		await page.keyboard.press('ArrowDown'); // wraps
		await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('ArrowUp'); // wraps back
		await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('Tab');
		await expect(field).toHaveValue('mdi:server-minus-outline');
		await expect(field).toBeFocused();
		await expect(page.getByRole('listbox', { name: 'Icon suggestions' })).toHaveCount(0);
		await expect(field).toHaveAttribute('aria-expanded', 'false');
		// With the list closed, Tab moves on as usual.
		await page.keyboard.press('Tab');
		await expect(field).not.toBeFocused();

		// The tile editor picked the accepted icon up: Done, then the tile preview shows it.
		await page.getByRole('dialog', { name: 'Edit icon' }).getByRole('button', { name: 'Done' }).click();
		await page.getByRole('dialog', { name: 'Edit Tile' }).getByRole('button', { name: 'Edit icon' }).click();
		await expect(page.getByRole('combobox', { name: /Iconify icon name/ })).toHaveValue('mdi:server-minus-outline');
	});

	test('Enter accepts, Escape closes the list but not the dialog', async ({ page, context }) => {
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:serv');
		const list = page.getByRole('listbox', { name: 'Icon suggestions' });
		await expect(list.getByRole('option').first()).toContainText('mdi:server');
		await page.keyboard.press('Escape');
		await expect(list).toHaveCount(0);
		await expect(page.getByRole('dialog', { name: 'Edit icon' })).toBeVisible();
		await expect(field).toHaveValue('mdi:serv');
		// ArrowDown reopens; Enter accepts the top suggestion.
		await page.keyboard.press('ArrowDown');
		await expect(list).toBeVisible();
		await page.keyboard.press('Enter');
		await expect(field).toHaveValue('mdi:server');
		await expect(list).toHaveCount(0);
		await expect(page.getByRole('dialog', { name: 'Edit icon' })).toBeVisible();
		await expect(page.getByRole('dialog', { name: 'Edit Tile' })).toBeVisible();
		// A second Escape with the list closed closes the Edit icon dialog as before.
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'Edit icon' })).toHaveCount(0);
	});

	test('says so when no names match', async ({ page, context }) => {
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:zzqqxx');
		await expect(page.locator('#icon-suggest-status')).toContainText('No matching icons');
		await expect(page.getByRole('listbox', { name: 'Icon suggestions' })).toHaveCount(0);
		// Tab is not swallowed when there is nothing to accept.
		await page.keyboard.press('Tab');
		await expect(field).toHaveValue('mdi:zzqqxx');
		await expect(field).not.toBeFocused();
	});

	test('suggests imported dashboard-icons; accepting one sets the picture', async ({ page, context }) => {
		await page.route(ICONIFY_HOSTS, (route) => route.abort());
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('proxmo');
		const options = page.getByRole('listbox', { name: 'Icon suggestions' }).getByRole('option');
		await expect(options.first()).toContainText('proxmox');
		await expect(options.first()).toContainText('dashboard-icons');
		await expect(options.first().locator('img')).toHaveAttribute('src', '/api/icons/dashboard/proxmox.svg');
		await page.keyboard.press('Enter');
		const dialog = page.getByRole('dialog', { name: 'Edit icon' });
		await expect(dialog.locator('img.custom-icon-preview')).toHaveAttribute('src', '/api/icons/dashboard/proxmox.svg');
	});

	test('a failure to load the dashboard-icons list is shown, bundled names still suggested', async ({ page, context }) => {
		await page.route('**/api/icons', (route) => route.fulfill({ status: 500, body: 'boom' }));
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:serv');
		const list = page.getByRole('listbox', { name: 'Icon suggestions' });
		await expect(list.getByRole('option').first()).toContainText('mdi:server');
		await expect(page.locator('#icon-suggest-status')).toContainText("Couldn't load the icon list");
	});
});
