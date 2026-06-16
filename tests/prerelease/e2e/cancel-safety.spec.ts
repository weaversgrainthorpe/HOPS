import { test, expect, type Page } from '@playwright/test';
import { uniqueName } from '../helpers';

// TENET 5 (cancel-safe editing): every change is committed only on
// Create/Save — cancelling or closing a modal must leave persisted state
// exactly as it was. The mechanism is a local buffer in the editor
// (EntryEditModal copies `{ ...entry }` into editedEntry and only onSave
// writes it back); these tests guard that behaviour end-to-end so a future
// refactor can't silently start mutating state before the user confirms.

// Self-contained scaffold: create a dashboard, open it, ensure edit mode is
// ON, and add one tab + one group. Deliberately does NOT use
// createDashboardViaUI's "Editing" chip wait — that text also matches a
// CSS-hidden phone-only banner, which makes the helper flaky. Here we gate on
// the Navbar's explicit "Exit Edit Mode" toggle state instead.
async function scaffold(page: Page) {
  const name = uniqueName('CancelSafe');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'HOPS Admin Panel' })).toBeVisible();
  await page.click('button:has-text("New Dashboard")');
  await page.fill('input[placeholder*="e.g., Home"]', name);
  await page.click('button:has-text("Save")');

  // Open the dashboard (navigates to its page, where the edit toggle lives).
  await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible({ timeout: 5_000 });
  await page.getByRole('heading', { name, level: 3 }).click();
  await page.waitForLoadState('networkidle');

  // Ensure edit mode is on. The toggle reads "Enter Edit Mode" when off and
  // "Exit Edit Mode" when on; only click if it's currently off.
  const enter = page.locator('[aria-label="Enter Edit Mode"]');
  if (await enter.isVisible().catch(() => false)) {
    await enter.click();
  }
  await expect(page.locator('[aria-label="Exit Edit Mode"]')).toBeVisible({ timeout: 5_000 });

  // One tab + one group to hang tiles off.
  await page.click('button:has-text("Add Your First Tab")');
  await page.fill('input#name', 'T');
  await page.click('button:has-text("Create")');
  await expect(page.getByRole('tab', { name: 'T' })).toBeVisible();
  await page.click('button:has-text("Add Group")');
  await page.fill('input#name', 'G');
  await page.click('button:has-text("Create")');
}

test('cancel-safe: editing a tile name and cancelling discards the change', async ({ page }) => {
  const original = 'Plex';
  const typed = 'Plex SHOULD NOT PERSIST';

  await scaffold(page);

  // Add the tile (committed via Create).
  await page.click('button:has-text("Add Tile")');
  await page.fill('input#name', original);
  await page.fill('input#url', 'https://example.com/plex');
  await page.click('button:has-text("Create")');
  await expect(page.locator('.entry').filter({ hasText: original })).toBeVisible();

  // Open the editor, change the name, then CANCEL instead of Save.
  await page.locator('.entry').filter({ hasText: original }).click();
  await page.fill('input#name', typed);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Live DOM keeps the original name; the typed value never appears.
  await expect(page.locator('.entry').filter({ hasText: original })).toBeVisible();
  await expect(page.locator('.entry').filter({ hasText: typed })).toHaveCount(0);

  // And nothing was persisted: a reload still shows the original.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.entry').filter({ hasText: original })).toBeVisible();
  await expect(page.locator('.entry').filter({ hasText: typed })).toHaveCount(0);
});

test('cancel-safe: cancelling "Add Tile" creates nothing', async ({ page }) => {
  const ghost = 'Ghost Tile';

  await scaffold(page);

  // Fill the Add Tile form, then CANCEL instead of Create.
  await page.click('button:has-text("Add Tile")');
  await page.fill('input#name', ghost);
  await page.fill('input#url', 'https://example.com/ghost');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // No tile in the live DOM, and none after a reload.
  await expect(page.locator('.entry').filter({ hasText: ghost })).toHaveCount(0);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.entry').filter({ hasText: ghost })).toHaveCount(0);
});
