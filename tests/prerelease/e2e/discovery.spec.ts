import { test, expect } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// Network Discovery — the 2.0 headline feature. We don't run an actual
// scan against the LAN (slow, and the test instance has no LAN
// peers). Instead we exercise the surfaces that don't need real hosts:
//   - the scan-list page loads
//   - creating a scan against 127.0.0.1/32 returns a scan id
//   - the detector list loads and the bundled detector count is sane

test('discovery index page loads', async ({ page }) => {
  await page.goto('/admin/discovery');
  // Either the empty-state message or the scan-list table
  await expect(
    page.getByRole('heading', { name: /discovery/i }).or(
      page.getByText(/network discovery/i).first(),
    ),
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
  await page.goto('/admin/discovery/detectors');
  await expect(page.getByText(/detector/i).first()).toBeVisible({ timeout: 10_000 });
});

test('create a discovery scan against loopback and confirm it lands', async ({ page, context, request }) => {
  const csrf = await getCsrfToken(context);

  const create = await request.post('/api/discovery/scans', {
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    data: JSON.stringify({
      cidr: '127.0.0.1/32',
      intensity: 'light',
    }),
  });
  expect(create.ok()).toBeTruthy();
  const created = await create.json();
  expect(created.id).toBeTruthy();

  // The detail page should be reachable
  await page.goto(`/admin/discovery/${created.id}`);
  await expect(page.getByText(/discovery draft|scanning/i).first()).toBeVisible({ timeout: 10_000 });
});
