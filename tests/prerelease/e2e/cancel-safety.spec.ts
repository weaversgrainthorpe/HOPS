import { test, expect, type Page } from '@playwright/test';
import { uniqueName, createDashboardViaUI, deleteDashboardsNamed } from '../helpers';

// TENET 5 (cancel-safe editing): every change is committed only on
// Create/Save — cancelling or closing a modal must leave the draft and the
// persisted state exactly as they were. The mechanism is a local buffer in the
// editor (EntryEditModal copies `{ ...entry }` into editedEntry and only onSave
// writes it into the edit-session draft; the toolbar Save stores the draft);
// these tests guard that behaviour end-to-end so a future refactor can't
// silently start mutating state before the user confirms.

// Scaffold: a dashboard created from Settings (it comes with a Home tab), opened in edit mode.
// The test deletes it afterwards so later specs see the same set of dashboards.
const made: string[] = [];

test.afterEach(async ({ page }) => {
  await deleteDashboardsNamed(page, made.splice(0));
});

async function scaffold(page: Page) {
  const name = uniqueName('CancelSafe');
  await createDashboardViaUI(page, name, undefined, made);
  await expect(page.getByRole('tab', { name: 'Switch to Home tab' })).toBeVisible();
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Editing' });
const tileNamed = (page: Page, name: string) => page.locator('[data-node-id]', { hasText: name });
const unsaved = (page: Page) => page.getByRole('status').filter({ hasText: 'Unsaved changes' });

/** The toolbar Save: the one write of the edit session. */
async function saveDraft(page: Page) {
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await toolbar(page).getByRole('button', { name: /Save/ }).click();
  expect((await saved).status()).toBe(200);
  await expect(unsaved(page)).toHaveCount(0);
}

test('cancel-safe: editing a tile name and cancelling discards the change', async ({ page }) => {
  const original = 'Plex';
  const typed = 'Plex SHOULD NOT PERSIST';

  await scaffold(page);

  // Add the tile (Create puts it in the draft; the toolbar Save stores it).
  await toolbar(page).getByRole('button', { name: 'Add tile' }).click();
  const newDlg = page.getByRole('dialog', { name: 'New Tile' });
  await newDlg.locator('input#name').fill(original);
  await newDlg.locator('input#url').fill('https://example.com/plex');
  await newDlg.getByRole('button', { name: 'Create' }).click();
  await expect(tileNamed(page, original)).toBeVisible();
  await saveDraft(page);

  // Open the editor, change the name, then CANCEL instead of Save.
  await tileNamed(page, original).dblclick();
  const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
  await dlg.locator('input#name').fill(typed);
  await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dlg).toHaveCount(0);

  // Live DOM keeps the original name; the typed value never appears; the draft is untouched.
  await expect(tileNamed(page, original)).toBeVisible();
  await expect(tileNamed(page, typed)).toHaveCount(0);
  await expect(unsaved(page)).toHaveCount(0);

  // And nothing was persisted: a reload still shows the original.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(tileNamed(page, original)).toBeVisible();
  await expect(tileNamed(page, typed)).toHaveCount(0);
});

test('cancel-safe: cancelling "Add tile" creates nothing', async ({ page }) => {
  const ghost = 'Ghost Tile';

  await scaffold(page);

  // Fill the Add tile form, then CANCEL instead of Create.
  await toolbar(page).getByRole('button', { name: 'Add tile' }).click();
  const dlg = page.getByRole('dialog', { name: 'New Tile' });
  await dlg.locator('input#name').fill(ghost);
  await dlg.locator('input#url').fill('https://example.com/ghost');
  await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dlg).toHaveCount(0);

  // No tile in the live DOM, nothing to save, and none after a reload.
  await expect(tileNamed(page, ghost)).toHaveCount(0);
  await expect(unsaved(page)).toHaveCount(0);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(tileNamed(page, ghost)).toHaveCount(0);
});
