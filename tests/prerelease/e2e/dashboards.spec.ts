import { test, expect } from '@playwright/test';
import { uniqueName, createDashboardViaUI } from '../helpers';

// The bug class the user described: changes elsewhere in the app
// silently broke group background colours even though the group code
// hadn't changed. These tests exercise the full create → save → reload
// path and assert the rendered DOM picks up colours, so any regression
// in the colour-cascade pipeline is caught before release.

test('admin index loads with the four core admin buttons', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'HOPS Admin Panel' })).toBeVisible();
  await expect(page.getByRole('button', { name: /settings/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /discovery/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /change password/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /new dashboard/i })).toBeVisible();
});

test('dashboard CRUD round-trip via UI: create → rename → delete', async ({ page }) => {
  const original = uniqueName('Dash');
  const renamed = `${original}-renamed`;

  await page.goto('/');
  await page.click('button:has-text("New Dashboard")');
  await page.fill('input#new-name', original);
  await page.click('button.btn-primary:has-text("Save")');
  await expect(page.getByRole('heading', { name: original, level: 3 })).toBeVisible();

  // Rename via the row's pencil button. While editing, the inline form
  // replaces the heading, so target the form's Save button directly rather
  // than filtering rows by the post-rename name.
  await page.locator('.dashboard-item', { hasText: original }).getByRole('button', { name: /rename/i }).click();
  await page.locator('input[placeholder="Dashboard name"]').fill(renamed);
  await page.locator('.dashboard-edit-form button.btn-primary:has-text("Save")').click();
  await expect(page.getByRole('heading', { name: renamed, level: 3 })).toBeVisible();

  // Delete via the row's bin button. HOPS uses a custom confirm modal, not
  // the browser's native dialog — click the modal's danger-styled Delete.
  await page.locator('.dashboard-item', { hasText: renamed }).getByRole('button', { name: /delete/i }).click();
  await page.locator('.confirm-modal-actions button.danger, .modal-content button.btn-danger:has-text("Delete")').first().click();
  await expect(page.getByRole('heading', { name: renamed, level: 3 })).not.toBeVisible();
});

test('dashboard hierarchy + group background renders after reload (the regression class)', async ({ page }) => {
  const dashName = uniqueName('Colours');
  const tabName = 'Test Tab';
  const groupName = 'Coloured Group';

  await createDashboardViaUI(page, dashName);

  // Add the first tab. The TabEditModal uses input#name.
  await page.click('button:has-text("Add Your First Tab")');
  await page.fill('input#name', tabName);
  await page.click('button:has-text("Create")');
  await expect(page.getByRole('tab', { name: tabName })).toBeVisible({ timeout: 5_000 });

  // Add a group with a background colour. GroupEditModal also uses input#name.
  // The colour picker is a preset palette (button[title="Pink"], etc.) rather
  // than a free-form input.
  await page.click('button:has-text("Add Group")');
  await page.fill('input#name', groupName);
  await page.locator('button.color-swatch[title="Pink"]').click();
  await page.click('button:has-text("Create")');
  await expect(page.getByText(groupName).first()).toBeVisible({ timeout: 5_000 });

  // Exit edit mode so we get the rendered (not-editing) appearance
  await page.locator('[aria-label="Exit Edit Mode"]').click();

  // Reload — this is the key step. The bug class is "save works, reload
  // surfaces the regression because the rendered tree is rebuilt fresh
  // from the persisted data."
  await page.reload();
  await page.waitForLoadState('networkidle');

  // Group colour is applied to .group-header via the --group-bg CSS variable
  // (the .group wrapper stays transparent). Read the inline-style custom
  // property directly — if the colour cascade pipeline broke, this will be
  // empty or fall back to the theme default.
  const group = page.locator('.group').filter({ hasText: groupName }).first();
  await expect(group).toBeVisible();
  const header = group.locator('.group-header').first();

  const inlineBg = await header.evaluate(el =>
    (el as HTMLElement).style.getPropertyValue('--group-bg'),
  );

  // The picked Pink swatch is `#ec4899`. We don't pin the exact value
  // (it could change), but we do assert the variable isn't empty and
  // isn't the theme-fallback string — both signal the colour didn't
  // make it from the form to the DOM.
  expect(inlineBg).not.toBe('');
  expect(inlineBg).not.toBe('var(--bg-secondary)');
  expect(inlineBg.toLowerCase()).toMatch(/^#[0-9a-f]{3,8}$|^rgb/);
});
