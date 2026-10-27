import { test, expect } from '@playwright/test';
import { setSetting } from '../helpers';

// Optional idle sign-out (auth.session_idle_hours): Off by default, set in hours or days
// with the same selector as the dead-link threshold, stored in hours.
const KEY = 'auth.session_idle_hours';

test('idle sign-out: Off by default, saves in days, and can be turned Off again', async ({ page }) => {
  let before: string | null = null;
  try {
    await page.goto('/settings/global#sign-in-security');
    const input = page.locator('#setting-auth\\.session_idle_hours');
    const unit = page.locator(`[data-unit-for="${KEY}"]`);
    const row = page.locator('.row', { has: input });
    await expect(row).toContainText('Sign out after being idle for');
    await expect(unit).toHaveValue('off');
    await expect(input).toBeDisabled();

    before = '0';
    await unit.selectOption('days');
    await input.fill('2');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('button', { name: 'Save' })).toBeDisabled();
    const stored = async () =>
      (await (await page.request.get('/api/settings')).json()).settings.find((s: { key: string }) => s.key === KEY).value;
    expect(await stored()).toBe('48');

    await page.reload();
    await expect(input).toHaveValue('2');
    await expect(unit).toHaveValue('days');

    await unit.selectOption('off');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(await stored()).toBe('0');
    before = null;
  } finally {
    if (before !== null) await setSetting(page, KEY, before);
  }
});
