import { test as setup, expect } from '@playwright/test';
import { ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD, ADMIN_TEST_PASSWORD } from './constants';

// Test fixtures. The fresh hops process starts with the default admin/admin
// credentials and the forced-password-change modal pinned. This setup walks
// the modal once, then saves the storage state so every spec can reuse the
// authenticated session.
//
// All other specs depend on the 'setup' project (see playwright.config.ts),
// which guarantees this runs first.

setup('authenticate and save state', async ({ page }) => {
  // Settings is the admin home; logged out it asks for the password in place.
  await page.goto('/settings');
  const dlg = page.getByRole('dialog', { name: 'Sign in' });
  await expect(dlg).toBeVisible({ timeout: 10_000 });
  await dlg.getByLabel('Username').fill(ADMIN_USERNAME);
  await dlg.getByLabel('Password').fill(ADMIN_INITIAL_PASSWORD);
  await dlg.getByLabel('Password').press('Enter');
  await expect(dlg).toHaveCount(0);

  // Forced password change modal
  await expect(page.getByRole('heading', { name: 'Set a New Password' })).toBeVisible({ timeout: 10_000 });
  await page.fill('input#current-password', ADMIN_INITIAL_PASSWORD);
  await page.fill('input#new-password', ADMIN_TEST_PASSWORD);
  await page.fill('input#confirm-password', ADMIN_TEST_PASSWORD);
  await page.click('button:has-text("Set Password")');

  // Modal auto-dismisses ~1.5s after success. Don't race the success-message
  // animation — just wait for Settings to load its sections (it waits for the change).
  await expect(page.getByRole('heading', { name: 'Global settings', level: 2 })).toBeVisible({ timeout: 15_000 });
  // Give the modal teardown a beat so its DOM is gone before we save state.
  await page.waitForTimeout(500);

  await page.context().storageState({ path: 'auth.json' });
});
