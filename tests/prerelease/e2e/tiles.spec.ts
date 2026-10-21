import { test, expect, type Page } from '@playwright/test';
import { uniqueName, createDashboardViaUI, deleteDashboardsNamed } from '../helpers';

// Tile CRUD via the UI. The class of regression here is "I changed
// the tile renderer and the round-trip through the modal silently lost
// a field" — exercise create + reload + edit + re-reload.

const made: string[] = [];

test.afterEach(async ({ page }) => {
  await deleteDashboardsNamed(page, made.splice(0));
});

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Editing' });
const tileNamed = (page: Page, name: string) => page.locator('[data-node-id]', { hasText: name });

async function saveDraft(page: Page) {
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await toolbar(page).getByRole('button', { name: /Save/ }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
}

test('tile CRUD: add Link tile, reload, edit name, save, reload again', async ({ page }) => {
  const dashName = uniqueName('Tiles');
  const tileName = 'Plex';
  const tileURL = 'https://example.com/plex';
  const renamedTile = 'Plex (renamed)';
  made.push(dashName);

  // A dashboard made in Settings comes with a Home tab; add the tile there.
  await createDashboardViaUI(page, dashName);
  await toolbar(page).getByRole('button', { name: 'Add tile' }).click();
  const newDlg = page.getByRole('dialog', { name: 'New Tile' });
  await newDlg.locator('input#name').fill(tileName);
  await newDlg.locator('input#url').fill(tileURL);
  await newDlg.getByRole('button', { name: 'Create' }).click();
  await expect(tileNamed(page, tileName)).toBeVisible();
  await saveDraft(page);

  // Reload and confirm tile survived (with its URL)
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(tileNamed(page, tileName)).toBeVisible();
  const stored = JSON.stringify((await (await page.request.get('/api/config')).json()).dashboards.find((d: { name: string }) => d.name === dashName));
  expect(stored).toContain(tileURL);

  // Edit: the page reloads in non-edit mode; turn editing back on, then double-click the tile.
  const enter = page.locator('[aria-label="Enter Edit Mode"]');
  if (await enter.isVisible()) await enter.click();
  await expect(toolbar(page)).toBeVisible();
  await tileNamed(page, tileName).dblclick();
  const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
  await expect(dlg.locator('input#url')).toHaveValue(tileURL);
  await dlg.locator('input#name').fill(renamedTile);
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(tileNamed(page, renamedTile)).toBeVisible();
  await saveDraft(page);

  // Reload + confirm rename persisted
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(tileNamed(page, renamedTile)).toBeVisible();
});
