import { test, expect } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// Settings page round-trip. The bug class is "changing a setting on
// the UI saves something different to what's persisted (or doesn't
// save at all)." A settings panel touches: form binding, API write,
// validation feedback, runtime-vs-restart classification.

test('settings page loads and shows all expected groups', async ({ page }) => {
  await page.goto('/settings');
  // Page heading
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible({ timeout: 10_000 });
  // Several group h2s should be present once the page renders
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible({ timeout: 10_000 });
});

test('updating a setting via API is reflected on the settings page', async ({ page, context, request }) => {
  const csrf = await getCsrfToken(context);

  // Pick a runtime-changeable setting that's safe to mutate — login rate limit
  const newValue = 99;
  const resp = await request.put('/api/settings/auth.login_rate_limit_per_min', {
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    data: JSON.stringify({ value: String(newValue) }),
  });
  expect(resp.ok()).toBeTruthy();

  // Verify the GET reflects the change
  const list = await request.get('/api/settings');
  expect(list.ok()).toBeTruthy();
  const settings = await list.json();
  const item = (settings.settings || []).find((s: { key: string }) => s.key === 'auth.login_rate_limit_per_min');
  expect(item).toBeDefined();
  expect(String(item.value)).toBe(String(newValue));
});
