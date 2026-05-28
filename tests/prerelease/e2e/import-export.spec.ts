import { test, expect } from '@playwright/test';
import { getCsrfToken, uniqueName } from '../helpers';

// Config round-trip. The bug class here is "export silently drops a
// field that the save pipeline requires, or PUT silently rejects a
// shape that GET produces." We exercise the GET → PUT round-trip
// (the same pipeline the frontend uses on every save), plus the
// admin-export endpoint to confirm it returns a usable bundle.

test('GET /api/config → PUT /api/config round-trip preserves dashboards', async ({ page, context, request }) => {
  // Create a known dashboard so there's something distinctive in the config
  const dashName = uniqueName('Roundtrip');
  await page.goto('/');
  await page.click('button:has-text("New Dashboard")');
  await page.fill('input#new-name', dashName);
  await page.click('button.btn-primary:has-text("Save")');
  await expect(page.getByRole('heading', { name: dashName, level: 3 })).toBeVisible();

  const csrf = await getCsrfToken(context);

  // GET current config
  const getResp = await request.get('/api/config');
  expect(getResp.status()).toBe(200);
  const config = await getResp.json();
  expect(config.dashboards.find((d: { name: string }) => d.name === dashName)).toBeTruthy();

  // PUT the same config back — this is the save pipeline the frontend uses
  const putResp = await request.put('/api/config', {
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    data: JSON.stringify(config),
  });
  expect(putResp.ok()).toBeTruthy();

  // Re-fetch + verify the dashboard survived
  const verify = await request.get('/api/config');
  const after = await verify.json();
  expect(after.dashboards.find((d: { name: string }) => d.name === dashName)).toBeTruthy();
});

test('admin export endpoint returns a self-contained bundle', async ({ request }) => {
  const r = await request.get('/api/config/export');
  expect(r.status()).toBe(200);
  const body = await r.json();
  // The export bundle nests config + assets together
  expect(body).toHaveProperty('dashboards');
});
