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

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'HOPS Admin Panel' })).toBeVisible();

  // @iconify/svelte renders each icon as an inline <svg>. With the API blocked,
  // any icon that rendered must have come from the embedded bundle. The logo is
  // an <img>, not inline svg, so inline <svg> count ≈ Iconify icons drawn.
  await expect.poll(() => page.locator('svg').count(), { timeout: 5_000 }).toBeGreaterThan(5);

  // The admin header buttons (Settings=mdi:cog, Discovery=mdi:radar, …) must
  // each have drawn their icon.
  await expect(page.locator('.header-actions svg').first()).toBeVisible();

  // Even if some request was attempted and aborted, the icons rendered — but in
  // practice nothing should have reached out at all.
  expect(blocked, `app attempted Iconify API calls: ${blocked.join(', ')}`).toHaveLength(0);
});
