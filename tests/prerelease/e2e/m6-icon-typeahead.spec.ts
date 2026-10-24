import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M6 §7.6–7.7 (walkthrough shot-5): the icon-name field in "Edit icon" has a readable
// placeholder and hint, and type-ahead suggestions drawn from the icons HOPS has offline
// (the bundled Iconify set + the imported dashboard-icons). Driven with the real keyboard.

const ICONIFY_HOSTS = /(api\.)?(iconify\.design|simplesvg\.com|unisvg\.com)/;

let made = '';

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

test.describe('M6 §7.6 icon field is readable', () => {
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

test.describe('M6 §7.7 icon type-ahead', () => {
	test('suggests the top 5 from every icon name and narrows as you type (Iconify API blocked)', async ({ page, context }) => {
		const external: string[] = [];
		await page.route(ICONIFY_HOSTS, (route) => { external.push(route.request().url()); return route.abort(); });
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		// The spec's example: mdi:ser gives the top 5 of every mdi name, exact name first.
		await page.keyboard.type('mdi:ser');
		const list = page.getByRole('listbox', { name: 'Icon suggestions' });
		await expect(list).toBeVisible();
		await expect(field).toHaveAttribute('aria-expanded', 'true');
		const options = list.getByRole('option');
		const labels = () => options.locator('.suggestion-label').allTextContents();
		await expect(options).toHaveCount(5);
		await expect(options.first()).toHaveAttribute('aria-selected', 'true');
		expect(await labels()).toEqual(['mdi:server', 'mdi:server-off', 'mdi:serial-port', 'mdi:server-plus', 'mdi:server-minus']);
		// A bundled icon draws straight away; a name from the full list shows a placeholder
		// rather than fetching its picture.
		await expect(options.first().locator('svg')).toBeVisible();

		// Narrows as typing continues.
		await page.keyboard.type('ver-m');
		await expect(options).toHaveCount(2);
		expect(await labels()).toEqual(['mdi:server-minus', 'mdi:server-minus-outline']);

		// Nothing was fetched while typing: no suggestion and no half-typed name went online.
		await page.waitForTimeout(800);
		expect(external).toEqual([]);
	});

	test('no network request while typing a half name; a known name is fetched once after a pause', async ({ page, context }) => {
		const requested: string[] = [];
		await page.route(ICONIFY_HOSTS, (route) => {
			const icons = new URL(route.request().url()).searchParams.get('icons') || '';
			requested.push(icons);
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ prefix: 'mdi', width: 24, height: 24, icons: Object.fromEntries(icons.split(',').map((n) => [n, { body: '<path d="M2 2h20v20H2z" fill="currentColor"/>' }])) })
			});
		});
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:account-cowb');
		await page.waitForTimeout(1200); // well past the pause: a half name is never fetched
		expect(requested).toEqual([]);
		await expect(page.locator('#icon-preview-status')).toContainText('not a known icon name');
		await page.keyboard.type('oy-hat');
		await expect(page.locator('.icon-preview svg')).toBeVisible();
		expect(requested).toEqual(['account-cowboy-hat']);
		await expect(page.locator('#icon-preview-status')).toBeEmpty();
	});

	test('offline: a known name that is not bundled shows "preview unavailable (offline)", never a blank', async ({ page, context }) => {
		const requested: string[] = [];
		await page.route(ICONIFY_HOSTS, (route) => { requested.push(new URL(route.request().url()).searchParams.get('icons') || ''); return route.abort(); });
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:account-cowboy-hat');
		await expect(page.locator('#icon-preview-status')).toContainText('Preview unavailable (offline)', { timeout: 15_000 });
		await expect(page.locator('.icon-preview svg')).toHaveCount(0);
		expect(new Set(requested.flatMap((r) => r.split(',')))).toEqual(new Set(['account-cowboy-hat']));
		// A bundled icon still previews at once, offline.
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:server');
		await expect(page.locator('.icon-preview svg')).toBeVisible();
		await expect(page.locator('#icon-preview-status')).toBeEmpty();
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
