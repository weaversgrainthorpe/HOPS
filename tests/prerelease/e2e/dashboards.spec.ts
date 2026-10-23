import { test, expect, type Page } from '@playwright/test';
import { uniqueName, createDashboardViaUI, deleteDashboardsNamed, openSettings } from '../helpers';

// The bug class the user described: changes elsewhere in the app
// silently broke group (v3: folder) background colours even though the
// folder code hadn't changed. These tests exercise the full create → save →
// reload path and assert the rendered DOM picks up colours, so any regression
// in the colour-cascade pipeline is caught before release.

const made: string[] = [];

test.afterEach(async ({ page }) => {
  await deleteDashboardsNamed(page, made.splice(0));
});

test('Settings (the admin home) loads with the core admin controls', async ({ page }) => {
  await openSettings(page);
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /new dashboard/i })).toBeVisible();
  // Each other admin control is one sidebar click away, on its own page (M5 §9).
  const side = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(side.getByRole('link', { name: 'Discovery', exact: true })).toHaveAttribute('href', '/admin/discovery');
  await expect(side.getByRole('button', { name: 'Log out' })).toBeVisible();
  for (const [item, path, control] of [
    ['Backups', '/settings/backups', /open backups/i],
    ['Password', '/settings/password', /change password/i],
    ['Factory reset', '/settings/reset', /factory reset/i],
  ] as const) {
    await side.getByRole('link', { name: item, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('button', { name: control })).toBeVisible();
  }
});

test('dashboard CRUD round-trip via UI: create → rename → delete', async ({ page }) => {
  const original = uniqueName('Dash');
  const renamed = `${original}-renamed`;

  await openSettings(page);
  await page.click('button:has-text("New Dashboard")');
  await page.fill('input#new-name', original);
  await page.click('.new-dashboard-form button.btn-primary:has-text("Save")');
  await expect(page.getByRole('heading', { name: original, level: 3 })).toBeVisible();
  made.push(original); // cleaned up if the test fails before its own delete

  // Rename via the row's pencil button. While editing, the inline form
  // replaces the heading, so target the form's Save button directly rather
  // than filtering rows by the post-rename name.
  await page.locator('.dashboard-item', { hasText: original }).getByRole('button', { name: /rename/i }).click();
  await page.locator('input[placeholder="Dashboard name"]').fill(renamed);
  await page.locator('.dashboard-edit-form button.btn-primary:has-text("Save")').click();
  await expect(page.getByRole('heading', { name: renamed, level: 3 })).toBeVisible();
  made.splice(made.indexOf(original), 1, renamed);

  // Delete via the row's bin button. HOPS uses a custom confirm modal, not
  // the browser's native dialog — click the modal's danger-styled Delete.
  await page.locator('.dashboard-item', { hasText: renamed }).getByRole('button', { name: /delete/i }).click();
  await page.locator('.confirm-modal-actions button.danger, .modal-content button.btn-danger:has-text("Delete")').first().click();
  await expect(page.getByRole('heading', { name: renamed, level: 3 })).not.toBeVisible();
  const cfg = await (await page.request.get('/api/config')).json();
  expect(cfg.dashboards.map((d: { name: string }) => d.name)).not.toContain(renamed);
  made.splice(made.indexOf(renamed), 1); // deleted by the test itself
});

async function saveDraft(page: Page) {
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
}

test('dashboard hierarchy + folder background colour renders after reload (the regression class)', async ({ page }) => {
  const dashName = uniqueName('Colours');
  const tabName = 'Test Tab';
  const folderName = 'Coloured Folder';

  await createDashboardViaUI(page, dashName, undefined, made);

  // Add a tab (the New Tab dialog uses input#name); it becomes the shown tab.
  await page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: 'Add tab' }).click();
  const tabDlg = page.getByRole('dialog', { name: 'New Tab' });
  await tabDlg.locator('input#name').fill(tabName);
  await tabDlg.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('tab', { name: `Switch to ${tabName} tab` })).toHaveAttribute('aria-selected', 'true');

  // Add a folder with a colour from the preset palette.
  await page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: 'Add folder' }).click();
  const folderDlg = page.getByRole('dialog', { name: 'New Folder' });
  await folderDlg.locator('#folder-name').fill(folderName);
  await folderDlg.getByRole('button', { name: 'Pink', exact: true }).click();
  await folderDlg.getByRole('button', { name: /Create/ }).click();
  await expect(folderDlg).toHaveCount(0);
  await expect(page.getByRole('group', { name: `${folderName} folder` })).toBeVisible();
  await saveDraft(page);

  // Exit edit mode so we get the rendered (not-editing) appearance
  await page.locator('[aria-label="Exit Edit Mode"]').click();

  // Reload — this is the key step. The bug class is "save works, reload
  // surfaces the regression because the rendered tree is rebuilt fresh
  // from the persisted data."
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: `Switch to ${tabName} tab` }).click();

  // The folder colour is applied via the --group-bg CSS variable. Read the inline custom
  // property directly — if the colour cascade pipeline broke, this will be empty or fall back
  // to the theme default.
  const folder = page.getByRole('group', { name: `${folderName} folder` });
  await expect(folder).toBeVisible();
  const inlineBg = await folder.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--group-bg'));
  expect(inlineBg).not.toBe('');
  expect(inlineBg).not.toBe('var(--bg-secondary)');
  // The picked Pink swatch is #ec4899.
  expect(inlineBg.toLowerCase()).toBe('#ec4899');
});
