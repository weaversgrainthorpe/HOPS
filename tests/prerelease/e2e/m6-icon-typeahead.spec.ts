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
	test('suggests the top 5 offline names and narrows as you type (Iconify API blocked)', async ({ page, context }) => {
		const external: string[] = [];
		await page.route(ICONIFY_HOSTS, (route) => { external.push(route.request().url()); return route.abort(); });
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		// The spec's example: every offline match for mdi:ser (three in the bundle), exact name first.
		await page.keyboard.type('mdi:ser');
		const list = page.getByRole('listbox', { name: 'Icon suggestions' });
		await expect(list).toBeVisible();
		await expect(field).toHaveAttribute('aria-expanded', 'true');
		const options = list.getByRole('option');
		const labels = () => options.locator('.suggestion-label').allTextContents();
		await expect(options).toHaveCount(3);
		expect(await labels()).toEqual(['mdi:server', 'mdi:server-network', 'mdi:server-network-outline']);
		await expect(options.first()).toHaveAttribute('aria-selected', 'true');
		// Every suggestion draws its icon from the offline bundle.
		for (let i = 0; i < 3; i++) await expect(options.nth(i).locator('svg')).toBeVisible();

		// A broad query is capped at the top 5, and narrows as typing continues.
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:cl');
		await expect(options).toHaveCount(5);
		await page.keyboard.type('oud-');
		await expect(options).toHaveCount(5);
		expect((await labels()).every((t) => t.startsWith('mdi:cloud-'))).toBe(true);
		await page.keyboard.type('up');
		await expect(options).toHaveCount(2);
		expect(await labels()).toEqual(['mdi:cloud-upload', 'mdi:cloud-upload-outline']);

		// Prefix matches come before contains matches.
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:lan');
		await expect(options).toHaveCount(3);
		const lan = await labels();
		expect(lan.slice(0, 2)).toEqual(['mdi:lan', 'mdi:landscape']);
		expect(lan[2].startsWith('mdi:lan')).toBe(false);
		expect(lan[2]).toContain('lan');
		// No suggestion fetched its icon from the internet. (The field's live preview of a
		// half-typed name, e.g. "mdi:se", still asks the Iconify API for it: that is the
		// pre-existing online-only nicety for names outside the bundle, not the suggestions.)
		const fetched = new Set(external.flatMap((u) => (new URL(u).searchParams.get('icons') || '').split(',')));
		const shown = ['server', 'server-network', 'server-network-outline', 'cloud-upload', 'cloud-upload-outline', 'lan', 'landscape', lan[2].split(':')[1]];
		for (const name of shown) expect(fetched.has(name), `${name} fetched online`).toBe(false);
	});

	test('arrow keys move, Tab accepts the highlighted suggestion', async ({ page, context }) => {
		const field = await seedAndOpenIconEditor(page, context);
		await field.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('mdi:server-net');
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
		await expect(field).toHaveValue('mdi:server-network-outline');
		await expect(field).toBeFocused();
		await expect(page.getByRole('listbox', { name: 'Icon suggestions' })).toHaveCount(0);
		await expect(field).toHaveAttribute('aria-expanded', 'false');
		// With the list closed, Tab moves on as usual.
		await page.keyboard.press('Tab');
		await expect(field).not.toBeFocused();

		// The tile editor picked the accepted icon up: Done, then the tile preview shows it.
		await page.getByRole('dialog', { name: 'Edit icon' }).getByRole('button', { name: 'Done' }).click();
		await page.getByRole('dialog', { name: 'Edit Tile' }).getByRole('button', { name: 'Edit icon' }).click();
		await expect(page.getByRole('combobox', { name: /Iconify icon name/ })).toHaveValue('mdi:server-network-outline');
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
