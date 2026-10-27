// Walkthrough: deleting a tile from its Edit Tile dialog asked twice (the dialog's own confirm, with
// stale "undo only by re-creating it" wording, then the editor's), while right-click › Delete asked
// once. Every delete now asks exactly once, with the same words, and is undoable until saved.
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

let made: string | null = null;

// Cleanup is checked, never silent: a delete needs the stored revision, and a leftover dashboard
// changes later specs' navbar (it once failed silently here and cascaded into the switcher specs).
test.afterEach(async ({ page, context }) => {
	if (!made) return;
	const id = made;
	made = null;
	const cfg = await (await page.request.get('/api/config')).json();
	const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
	expect(typeof rev, `cleanup: dashboard ${id} has a revision`).toBe('number');
	const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
		headers: { 'X-CSRF-Token': await getCsrfToken(context) }
	});
	expect(r.ok(), `cleanup: delete dashboard ${id}: ${r.status()} ${await r.text()}`).toBeTruthy();
});

async function seedDash(page: Page, context: BrowserContext) {
	const p = `delc${Date.now().toString(36)}`;
	const id = (s: string) => `${p}-${s}`;
	const tile = (key: string, name: string, x: number) => ({
		id: id(key), kind: 'tile', type: 'link', name, url: `https://${key}.example.lan/`, icon: 'mdi:lan',
		openMode: 'newtab', size: 'medium', order: 0, placement: { x, y: 0, w: 2, h: 2 }
	});
	const dash = {
		id: id('dash'), name: `Delete confirm ${p}`, order: 0, path: `/${p}`, revision: 1,
		settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
		tabs: [{ id: id('tab'), name: 'Main', order: 0, root: { columns: 24, children: [tile('a', 'Alpha', 0), tile('b', 'Bravo', 2)] } }]
	};
	const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
	const r = await page.request.post('/api/config/import', {
		headers: { 'X-CSRF-Token': await getCsrfToken(context) },
		multipart: { file: { name: 'd.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
	});
	expect(r.status(), await r.text()).toBe(200);
	made = id('dash');
	await page.goto(`/${p}`);
	await expect(page.locator(`[data-node-id="${id('a')}"]`)).toBeVisible();
	await page.locator('[aria-label="Enter Edit Mode"]').click();
	await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
	return id;
}

const confirmDialog = (page: Page) => page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /^Delete / }));

test('Edit Tile › Delete asks once, with the undo wording, and deletes', async ({ page, context }) => {
	const id = await seedDash(page, context);
	await page.locator(`[data-node-id="${id('a')}"]`).dblclick();
	const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
	await dlg.getByRole('button', { name: /Delete/ }).click();
	const ask = confirmDialog(page);
	await expect(ask).toHaveCount(1);
	await expect(ask).toContainText('You can undo this (Ctrl+Z) until you save.');
	await expect(ask).not.toContainText('re-creating');
	await ask.getByRole('button', { name: 'Delete', exact: true }).click();
	// No second confirmation: the tile is gone and nothing else asks.
	await expect(page.locator(`[data-node-id="${id('a')}"]`)).toHaveCount(0);
	await expect(confirmDialog(page)).toHaveCount(0);
	await expect(dlg).toHaveCount(0);
	// Undoable like any edit.
	await page.keyboard.press('ControlOrMeta+z');
	await expect(page.locator(`[data-node-id="${id('a')}"]`)).toBeVisible();
});

test('right-click › Delete asks once, with the same words', async ({ page, context }) => {
	const id = await seedDash(page, context);
	await page.locator(`[data-node-id="${id('b')}"]`).click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Delete' }).click();
	const ask = confirmDialog(page);
	await expect(ask).toHaveCount(1);
	await expect(ask).toContainText('You can undo this (Ctrl+Z) until you save.');
	await ask.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(page.locator(`[data-node-id="${id('b')}"]`)).toHaveCount(0);
	await expect(confirmDialog(page)).toHaveCount(0);
});
