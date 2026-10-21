import { test, expect } from '@playwright/test';
import { getCsrfToken, uniqueName, openSettings, deleteDashboardsNamed } from '../helpers';

// Config round-trip. The bug class here is "export silently drops a
// field that the save pipeline requires, or the save silently rejects a
// shape that GET produces." v3 saves one dashboard at a time
// (PUT /api/dashboards/{id} with {schema: 3, dashboard, revision, gridUnit: 2}); we
// exercise GET → PUT → GET through that pipeline (the one the editor uses
// on every save), plus the admin-export endpoint to confirm it returns a
// usable bundle.

const made: string[] = [];

test.afterEach(async ({ page }) => {
  await deleteDashboardsNamed(page, made.splice(0));
});

test('GET /api/config → PUT /api/dashboards/{id} round-trip preserves the dashboard', async ({ page, context, request }) => {
  // Create a known dashboard (from Settings, the admin home) so there's something distinctive
  const dashName = uniqueName('Roundtrip');
  await openSettings(page);
  await page.click('button:has-text("New Dashboard")');
  await page.fill('input#new-name', dashName);
  await page.click('.new-dashboard-form button.btn-primary:has-text("Save")');
  await expect(page.getByRole('heading', { name: dashName, level: 3 })).toBeVisible();
  made.push(dashName); // created: cleaned up afterwards

  const csrf = await getCsrfToken(context);

  // GET current config
  const getResp = await request.get('/api/config');
  expect(getResp.status()).toBe(200);
  const config = await getResp.json();
  const dash = config.dashboards.find((d: { name: string }) => d.name === dashName);
  expect(dash).toBeTruthy();

  // PUT the same dashboard back at its revision — the save pipeline the frontend uses
  const putResp = await request.put(`/api/dashboards/${encodeURIComponent(dash.id)}`, {
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    data: JSON.stringify({ schema: 3, dashboard: dash, revision: dash.revision, gridUnit: 2 }),
  });
  expect(putResp.ok(), `${putResp.status()} ${await putResp.text()}`).toBeTruthy();
  const put = await putResp.json();
  expect(put.revision).toBe(dash.revision + 1);

  // Re-fetch + verify the dashboard survived, unchanged apart from its revision
  const verify = await request.get('/api/config');
  const after = (await verify.json()).dashboards.find((d: { id: string }) => d.id === dash.id);
  expect(after).toBeTruthy();
  expect({ ...after, revision: 0 }).toEqual({ ...dash, revision: 0 });
});

test('admin export endpoint returns a self-contained bundle', async ({ request }) => {
  const r = await request.get('/api/config/export');
  expect(r.status()).toBe(200);
  const body = await r.json();
  // The v3 export envelope nests the config (dashboards) inside it
  expect(body.format).toBe('hops-export');
  expect(body.schemaVersion).toBe(3);
  expect(body).toHaveProperty('config.dashboards');
  expect(Array.isArray(body.config.dashboards)).toBe(true);
  const live = await (await request.get('/api/config')).json();
  expect(body.config.dashboards.map((d: { id: string }) => d.id).sort())
    .toEqual(live.dashboards.map((d: { id: string }) => d.id).sort());
});
