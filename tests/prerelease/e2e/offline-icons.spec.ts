import { test, expect } from '@playwright/test';

// TENET 10 (no telemetry, fully offline-capable): the HOPS UI must render with
// no calls to api.iconify.design. HOPS uses Iconify for its own chrome (cog,
// search, arrows…) and service logos; those icons are embedded at build time
// (scripts/generate-icon-bundle.mjs → src/lib/icons/offline-bundle.ts). This
// test blocks every Iconify API host and asserts the icons still render — the
// real, regression-proof guard that the offline bundle is wired up.

const ICONIFY_HOSTS = /(api\.)?(iconify\.design|simplesvg\.com|unisvg\.com)/;

test('UI icons render with the Iconify API fully blocked (offline)', async ({ page }) => {
  const blocked: string[] = [];
  await page.route(ICONIFY_HOSTS, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });

  await page.goto('/settings/global');
  await expect(page.getByRole('heading', { name: 'Global settings', level: 2 })).toBeVisible();

  // @iconify/svelte renders each icon as an inline <svg>. With the API blocked,
  // any icon that rendered must have come from the embedded bundle. The logo is
  // an <img>, not inline svg, so inline <svg> count ≈ Iconify icons drawn.
  await expect.poll(() => page.locator('svg').count(), { timeout: 5_000 }).toBeGreaterThan(5);

  // Every Settings sidebar item (Backups=mdi:backup-restore, Discovery=mdi:radar, …), the
  // section pages' buttons and the navbar gear (mdi:cog) must each have drawn their icon.
  const side = page.getByRole('navigation', { name: 'Settings sections' });
  // The section items only (M6 §10: sub-lists under Global settings / Discovery have no icons and
  // are .sub-item, not .side-item).
  const items = side.locator('.side-item');
  await expect(items).toHaveCount(8);
  for (let i = 0; i < 8; i++) {
    await expect(items.nth(i).locator('svg')).toBeVisible();
  }
  for (const [item, button] of [['Backups', 'Open Backups'], ['Logs', 'Refresh'], ['Password', 'Change Password'], ['Factory reset', 'Factory Reset']]) {
    await side.getByRole('link', { name: item, exact: true }).click();
    await expect(page.getByRole('button', { name: button }).locator('svg')).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Settings', exact: true }).locator('svg')).toBeVisible();

  // Even if some request was attempted and aborted, the icons rendered — but in
  // practice nothing should have reached out at all.
  expect(blocked, `app attempted Iconify API calls: ${blocked.join(', ')}`).toHaveLength(0);
});
