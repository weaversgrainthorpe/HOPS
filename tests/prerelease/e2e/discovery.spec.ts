import { test, expect } from '@playwright/test';
import { getCsrfToken, openDiscovery, startScan } from '../helpers';

// Network Discovery — the 2.0 headline feature. We don't run an actual
// scan against the LAN (slow, and the test instance has no LAN
// peers). Instead we exercise the surfaces that don't need real hosts:
//   - the scan-list page loads
//   - creating a scan against 127.0.0.1/32 returns a scan id
//   - the detector list loads and the bundled detector count is sane

// M5 §11: Discovery is a Settings section at /settings/discovery… (the old /admin/discovery…
// addresses redirect; m5-discovery-settings.spec.ts covers the layout and the redirects).

test('discovery index page loads', async ({ page }) => {
  await openDiscovery(page);
  // Either the empty-state message or the scan-list table
  await expect(
    page.getByText(/No scans yet/).or(page.locator('table.scans')),
  ).toBeVisible({ timeout: 10_000 });
});

test('detector list returns the bundled set + sortable list page loads', async ({ page, request }) => {
  const resp = await request.get('/api/discovery/detectors');
  expect(resp.ok()).toBeTruthy();
  const body = await resp.json();
  // Bundled count is high — assert at least 30 to keep the test robust
  // to small additions/removals.
  expect(Array.isArray(body.detectors)).toBeTruthy();
  expect(body.detectors.length).toBeGreaterThan(30);

  // Page renders without errors
  await page.goto('/settings/discovery/detectors');
  await expect(page.getByRole('heading', { name: 'Discovery detectors', level: 2 })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/detector/i).first()).toBeVisible({ timeout: 10_000 });
});

test('create a discovery scan against loopback and confirm it lands', async ({ page, context, request }) => {
  const created = { id: await startScan(page) };
  expect(created.id).toBeTruthy();

  // The detail page should be reachable
  await page.goto(`/settings/discovery/${created.id}`);
  await expect(page.getByRole('heading', { name: 'Discovery draft', level: 2 })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/discovery draft|scanning/i).first()).toBeVisible({ timeout: 10_000 });
});
