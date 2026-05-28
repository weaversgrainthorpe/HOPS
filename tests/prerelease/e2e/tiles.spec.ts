import { test, expect } from '@playwright/test';
import { uniqueName, createDashboardViaUI } from '../helpers';

// Tile CRUD via the UI. The class of regression here is "I changed
// the tile renderer and the round-trip through the modal silently lost
// a field" — exercise create + reload + edit + re-reload.

test('tile CRUD: add Link tile, reload, edit name, save, reload again', async ({ page }) => {
  const dashName = uniqueName('Tiles');
  const tabName = 'T';
  const groupName = 'G';
  const tileName = 'Plex';
  const tileURL = 'https://example.com/plex';
  const renamedTile = 'Plex (renamed)';

  await createDashboardViaUI(page, dashName);
  await page.click('button:has-text("Add Your First Tab")');
  await page.fill('input#name', tabName);
  await page.click('button:has-text("Create")');
  await expect(page.getByRole('tab', { name: tabName })).toBeVisible();
  await page.click('button:has-text("Add Group")');
  await page.fill('input#name', groupName);
  await page.click('button:has-text("Create")');

  // Add tile
  await page.click('button:has-text("Add Tile")');
  await page.fill('input#name', tileName);
  await page.fill('input#url', tileURL);
  await page.click('button:has-text("Create")');
  await expect(page.locator('.entry').filter({ hasText: tileName })).toBeVisible();

  // Reload and confirm tile survived
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.entry').filter({ hasText: tileName })).toBeVisible();

  // Edit: click the tile (edit mode is on after reload? — toggle if not).
  // The page reloads in non-edit mode; turn editing back on.
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await page.locator('.entry').filter({ hasText: tileName }).click();
  await page.fill('input#name', renamedTile);
  await page.click('button:has-text("Save")');
  await expect(page.locator('.entry').filter({ hasText: renamedTile })).toBeVisible();

  // Reload + confirm rename persisted
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.entry').filter({ hasText: renamedTile })).toBeVisible();
});
