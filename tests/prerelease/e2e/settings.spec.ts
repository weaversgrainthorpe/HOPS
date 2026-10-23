import { test, expect } from '@playwright/test';
import { setSetting } from '../helpers';

// Settings page round-trip. The bug class is "changing a setting on
// the UI saves something different to what's persisted (or doesn't
// save at all)." A settings panel touches: form binding, API write,
// validation feedback, runtime-vs-restart classification.

test('settings page loads and shows all expected groups', async ({ page }) => {
  await page.goto('/settings/global');
  // Page heading
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Global settings', level: 2 })).toBeVisible({ timeout: 10_000 });
  // The setting groups render once the settings have loaded.
  for (const g of ['Server', 'Logging', 'Authentication']) {
    await expect(page.getByRole('heading', { name: g, level: 3, exact: true })).toBeVisible({ timeout: 10_000 });
  }
});

// The setting the second test changes, and its stored value to put back. Restored in afterEach
// (which runs even when the test fails midway): later specs share this server, and a raised
// login limit would hide api/boundaries' rate-limit check.
const KEY = 'auth.login_rate_limit_per_min';
let restoreTo: string | null = null;

test.afterEach(async ({ page }) => {
  if (restoreTo === null) return;
  const v = restoreTo;
  restoreTo = null;
  await setSetting(page, KEY, v);
});

test('updating a setting via API is reflected on the settings page', async ({ page, request }) => {
  // Pick a runtime-changeable setting that's safe to mutate — login rate limit.
  const newValue = 99;
  restoreTo = await setSetting(page, KEY, String(newValue));

  // Verify the GET reflects the change
  const list = await request.get('/api/settings');
  expect(list.ok()).toBeTruthy();
  const settings = await list.json();
  const item = (settings.settings || []).find((s: { key: string }) => s.key === KEY);
  expect(item).toBeDefined();
  expect(String(item.value)).toBe(String(newValue));

  // And the Settings page shows it.
  await page.goto('/settings/global');
  await expect(page.locator(`[id="setting-${KEY}"]`)).toHaveValue(String(newValue));
});
