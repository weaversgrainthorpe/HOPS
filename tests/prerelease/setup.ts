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
  await page.goto('/');

  // Login form
  await page.fill('input#username', ADMIN_USERNAME);
  await page.fill('input#password', ADMIN_INITIAL_PASSWORD);
  await page.click('button[type="submit"]');

  // Forced password change modal
  await expect(page.getByRole('heading', { name: 'Set a New Password' })).toBeVisible({ timeout: 10_000 });
  await page.fill('input#current-password', ADMIN_INITIAL_PASSWORD);
  await page.fill('input#new-password', ADMIN_TEST_PASSWORD);
  await page.fill('input#confirm-password', ADMIN_TEST_PASSWORD);
  await page.click('button:has-text("Set Password")');

  // Modal auto-dismisses ~1.5s after success. Don't race the success-message
  // animation — just wait for the underlying admin page to be interactive.
  await expect(page.getByRole('heading', { name: 'HOPS Admin Panel' })).toBeVisible({ timeout: 15_000 });
  // Give the modal teardown a beat so its DOM is gone before we save state.
  await page.waitForTimeout(500);

  await page.context().storageState({ path: 'auth.json' });
});
