import { test, expect, type Page } from '@playwright/test';
import { getCsrfToken, deleteDashboardsNamed } from '../helpers';

// Settings › Icons, in a REAL browser and server: upload (one and several), rename, recategorise,
// delete (an icon in use lists its places first), the user's categories, search, the sidebar
// position, the offline note, and a failed upload is a visible error. Synthetic images only.

// A 1×1 PNG.
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);
const png = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });

const side = (page: Page) => page.getByRole('navigation', { name: 'Settings sections' });
const grid = (page: Page) => page.getByRole('list', { name: 'Uploaded icons' });
const card = (page: Page, name: string) => grid(page).getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
const tag = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

async function openIcons(page: Page) {
	await page.goto('/settings/icons');
	await expect(page.getByRole('heading', { name: 'Icons', level: 2, exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Your categories', level: 3 })).toBeVisible();
}

test.describe('Settings › Icons', () => {
	const madeIcons: string[] = [];
	const madeCats: string[] = [];
	const madeDashes: string[] = [];

	async function csrf(page: Page) {
		return { 'X-CSRF-Token': await getCsrfToken(page.context()) };
	}

	async function apiUpload(page: Page, name: string, categoryId = 'uploads') {
		const r = await page.request.post('/api/icons/upload', {
			headers: await csrf(page),
			multipart: { categoryId, name, file: png(`${name}.png`) }
		});
		expect(r.status(), await r.text()).toBe(200);
		const body = await r.json();
		madeIcons.push(body.id);
		return body as { id: string; url: string };
	}

	async function apiCategory(page: Page, name: string) {
		const id = `e2e-${tag()}`;
		const r = await page.request.post('/api/icon-categories', { headers: await csrf(page), data: { id, name, icon: 'mdi:folder-outline', order: 99 } });
		expect(r.status(), await r.text()).toBe(200);
		madeCats.push(id);
		return id;
	}

	/** Every icon the user has whose name starts with prefix (the UI-made ones), for cleanup. */
	async function trackByPrefix(page: Page, prefix: string) {
		const all = await (await page.request.get('/api/icons')).json();
		for (const i of all) if (i.name.startsWith(prefix) && !madeIcons.includes(i.id)) madeIcons.push(i.id);
	}

	test.afterEach(async ({ page }) => {
		for (const id of madeIcons.splice(0)) {
			const r = await page.request.delete(`/api/icons/${id}?force=1`, { headers: await csrf(page) });
			expect([200, 404], `cleanup icon ${id}: ${await r.text()}`).toContain(r.status());
		}
		for (const id of madeCats.splice(0)) {
			const r = await page.request.delete(`/api/icon-categories/${id}?moveTo=uploads`, { headers: await csrf(page) });
			expect([200, 404], `cleanup category ${id}: ${await r.text()}`).toContain(r.status());
		}
		if (madeDashes.length) await deleteDashboardsNamed(page, madeDashes.splice(0));
	});

	test('the sidebar has Icons right after Dashboards, and it opens the page', async ({ page }) => {
		await page.goto('/settings/dashboards');
		await expect(side(page).getByRole('link', { name: 'Icons', exact: true })).toBeVisible();
		const labels = (await side(page).locator('a.side-item').allTextContents()).map((t) => t.trim());
		expect(labels.slice(0, 3)).toEqual(['Dashboards', 'Icons', 'Global settings']);
		await side(page).getByRole('link', { name: 'Icons', exact: true }).click();
		await expect(page).toHaveURL(/\/settings\/icons$/);
		await expect(side(page).getByRole('link', { name: 'Icons', exact: true })).toHaveAttribute('aria-current', 'page');
		await expect(page.getByRole('heading', { name: 'Icons', level: 2, exact: true })).toBeVisible();
	});

	test('upload one icon: it appears, unused, in the Uploads category', async ({ page }) => {
		const name = `up1-${tag()}`;
		await openIcons(page);
		await page.getByLabel('Choose icon images to upload').setInputFiles(png(`${name}.png`));
		await expect(page.getByRole('status').filter({ hasText: 'Uploaded 1 icon.' })).toBeVisible();
		await trackByPrefix(page, name);
		await expect(card(page, name)).toBeVisible();
		await expect(card(page, name)).toContainText('Not used');
		await expect(card(page, name)).toContainText('Uploads');
	});

	test('upload several icons at once', async ({ page }) => {
		const p = `multi-${tag()}`;
		await openIcons(page);
		await page.getByLabel('Choose icon images to upload').setInputFiles([png(`${p}-a.png`), png(`${p}-b.png`), png(`${p}-c.png`)]);
		await expect(page.getByText('Uploaded 3 icons.')).toBeVisible();
		await trackByPrefix(page, p);
		for (const s of ['a', 'b', 'c']) await expect(card(page, `${p}-${s}`)).toBeVisible();
	});

	test('a failed upload shows an error naming the file and the reason', async ({ page }) => {
		const p = `bad-${tag()}`;
		await openIcons(page);
		// Not really an image: the server can't decode it.
		await page.getByLabel('Choose icon images to upload').setInputFiles({ name: `${p}.png`, mimeType: 'image/png', buffer: Buffer.from('not an image') });
		const alert = page.getByRole('alert').filter({ hasText: 'The upload failed.' });
		await expect(alert).toBeVisible();
		await expect(alert).toContainText(`${p}.png: failed: This image can't be used`);
		// And a server failure is shown too, never swallowed.
		await page.route((u) => u.pathname === '/api/icons/upload', (route) => route.fulfill({ status: 500, json: { error: 'disk full' } }));
		await page.getByLabel('Choose icon images to upload').setInputFiles(png(`${p}-2.png`));
		await expect(page.getByRole('alert').filter({ hasText: `${p}-2.png: failed: disk full` })).toBeVisible();
		await trackByPrefix(page, p);
		await expect(grid(page).getByText(p)).toHaveCount(0);
	});

	test('rename an icon; the new name is kept after a reload', async ({ page }) => {
		const name = `ren-${tag()}`;
		await apiUpload(page, name);
		await openIcons(page);
		await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
		const dlg = page.getByRole('dialog', { name: 'Edit icon' });
		await dlg.getByLabel('Name').fill(`${name}-renamed`);
		await dlg.getByRole('button', { name: 'Save' }).click();
		await expect(dlg).toHaveCount(0);
		await expect(card(page, `${name}-renamed`)).toBeVisible();
		await page.reload();
		await expect(card(page, `${name}-renamed`)).toBeVisible();
	});

	test('recategorise an icon; the category filter shows it there', async ({ page }) => {
		const name = `cat-${tag()}`;
		const catName = `Recat ${tag()}`;
		await apiCategory(page, catName);
		await apiUpload(page, name);
		await openIcons(page);
		await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
		const dlg = page.getByRole('dialog', { name: 'Edit icon' });
		await dlg.getByLabel('Category').selectOption({ label: catName });
		await dlg.getByRole('button', { name: 'Save' }).click();
		await expect(card(page, name)).toContainText(catName);
		await page.getByLabel('Show category').selectOption({ label: `${catName} (1)` });
		await expect(grid(page).getByRole('listitem')).toHaveCount(1);
		await expect(card(page, name)).toBeVisible();
	});

	test('delete an unused icon after a normal confirmation', async ({ page }) => {
		const name = `del-${tag()}`;
		await apiUpload(page, name);
		await openIcons(page);
		await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
		const dlg = page.getByRole('dialog', { name: 'Delete icon' });
		await expect(dlg).toContainText("isn't used");
		await dlg.getByRole('button', { name: 'Delete', exact: true }).click();
		await expect(card(page, name)).toHaveCount(0);
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Your categories' })).toBeVisible();
		await expect(grid(page).getByText(name, { exact: true })).toHaveCount(0);
	});

	test('deleting an icon in use lists where it is used first', async ({ page }) => {
		const name = `inuse-${tag()}`;
		const icon = await apiUpload(page, name);
		const p = `icn${tag()}`;
		const dashName = `Icons e2e ${p}`;
		const dash = {
			id: `${p}-dash`, name: dashName, order: 0, path: `/${p}`, revision: 1,
			settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
			tabs: [{ id: `${p}-tab`, name: 'Main', order: 0, root: { columns: 24, children: [
				{ id: `${p}-t1`, kind: 'tile', type: 'link', name: 'Synthetic tile', url: 'https://synthetic.example.lan/', iconUrl: icon.url,
					openMode: 'newtab', size: 'small', order: 0, placement: { x: 0, y: 0, w: 1, h: 1 } }
			] } }]
		};
		const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
		const r = await page.request.post('/api/config/import', {
			headers: await csrf(page),
			multipart: { file: { name: 'icons.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
		});
		expect(r.status(), await r.text()).toBe(200);
		madeDashes.push(dashName);

		await openIcons(page);
		await expect(card(page, name)).toContainText(`Used by 1 tile on ${dashName}`);
		await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
		const dlg = page.getByRole('dialog', { name: 'This icon is in use' });
		await expect(dlg.getByRole('list', { name: 'Where it is used' }).getByRole('listitem')).toHaveText([`Tile "Synthetic tile" on ${dashName} › Main`]);
		await dlg.getByRole('button', { name: 'Keep icon' }).click();
		await expect(card(page, name)).toBeVisible();

		await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
		await page.getByRole('dialog', { name: 'This icon is in use' }).getByRole('button', { name: 'Delete anyway' }).click();
		await expect(card(page, name)).toHaveCount(0);
	});

	test('categories: add, rename, see the count, delete moving its icons', async ({ page }) => {
		const t = tag();
		await openIcons(page);
		await page.getByLabel('New category name').fill(`Mine ${t}`);
		await page.getByRole('button', { name: 'Add category' }).click();
		const cats = page.getByRole('list', { name: 'Your categories' });
		const row = cats.getByRole('listitem').filter({ hasText: `Mine ${t}` });
		await expect(row).toContainText('0 icons');
		const all = await (await page.request.get('/api/icon-categories')).json();
		const id = all.find((c: { name: string }) => c.name === `Mine ${t}`).id;
		madeCats.push(id);

		await page.getByRole('button', { name: `Rename Mine ${t}` }).click();
		await page.getByLabel(`New name for Mine ${t}`).fill(`Ours ${t}`);
		await cats.getByRole('button', { name: 'Save' }).click();
		const row2 = cats.getByRole('listitem').filter({ hasText: `Ours ${t}` });
		await expect(row2).toBeVisible();

		const iconName = `incat-${t}`;
		await apiUpload(page, iconName, id);
		await page.reload();
		await expect(row2).toContainText('1 icon');

		await page.getByRole('button', { name: `Delete category Ours ${t}` }).click();
		const dlg = page.getByRole('dialog', { name: 'Delete category' });
		await expect(dlg).toContainText(`"Ours ${t}" has 1 icon`);
		// Uploads is offered first.
		await expect(dlg.getByLabel('Move its icons to')).toHaveValue('uploads');
		await dlg.getByRole('button', { name: 'Move icons and delete' }).click();
		await expect(row2).toHaveCount(0);
		await expect(card(page, iconName)).toContainText('Uploads');
	});

	test('search narrows the grid by name', async ({ page }) => {
		const t = tag();
		await apiUpload(page, `findme-${t}`);
		await apiUpload(page, `other-${t}`);
		await openIcons(page);
		await page.getByLabel('Search icons').fill(`findme-${t}`);
		await expect(grid(page).getByRole('listitem')).toHaveCount(1);
		await expect(card(page, `findme-${t}`)).toBeVisible();
		await page.getByLabel('Search icons').fill(`nothing-${t}`);
		await expect(page.getByText(`No uploaded icons match "nothing-${t}".`)).toBeVisible();
	});

	test('the offline note gives the bundled counts and links to Global settings › Uploads', async ({ page }) => {
		await openIcons(page);
		// The exact counts are checked in packaged-icons.spec.ts.
		await expect(page.getByTestId('shipped-counts')).toContainText(/Shipped with HOPS: [\d,]+ Dashboard Icons .* [\d,]+ Iconify icons in the offline bundle/s);
		await page.getByRole('link', { name: 'Global settings › Uploads' }).click();
		await expect(page).toHaveURL(/\/settings\/global#uploads$/);
		await expect(page.getByRole('heading', { name: 'Uploads' })).toBeVisible();
	});
});
