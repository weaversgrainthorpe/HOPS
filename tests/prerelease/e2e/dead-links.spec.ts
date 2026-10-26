import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// Dead-link report (Settings › Dashboards): tiles failing for longer than the set time, with where
// they live. A real failure needs days, so the report's data is mocked for the listing test; it
// names a real (synthetic) tile so "Show it" lands on it. The checks-off state and the hours/days
// setting run against the real server.

let seq = 0;
const made: string[] = [];

async function setup(page: Page, context: BrowserContext) {
  const p = `dead${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const tile = (tid: string, name: string, extra: Record<string, unknown> = {}) => ({
    id: tid, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
    openMode: 'newtab', size: 'medium', order: 0, ...extra
  });
  const dash = {
    id: id('dash'), name: `Dead ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
    tabs: [
      { id: id('t1'), name: 'Main', order: 0, root: { columns: 24, children: [tile(id('plain'), 'Plainone', { placement: { x: 0, y: 0, w: 2, h: 2 } })] } },
      {
        id: id('t2'), name: 'Media', order: 1,
        root: { columns: 24, children: [{
          id: id('srv'), kind: 'folder', name: 'Servers', display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
          placement: { x: 0, y: 0, w: 12, h: 9 }, content: { children: [tile(id('nas'), 'Deadnas')] }
        }] }
      }
    ]
  };
  const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'd.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(id('dash'));
  return { p, id, path: `/${p}`, name: dash.name };
}

async function setSetting(page: Page, context: BrowserContext, key: string, value: string) {
  const r = await page.request.put(`/api/settings/${key}`, {
    headers: { 'X-CSRF-Token': await getCsrfToken(context), 'Content-Type': 'application/json' },
    data: { value }
  });
  expect(r.ok(), await r.text()).toBeTruthy();
}

test.afterEach(async ({ page, context }) => {
  while (made.length) {
    const id = made.pop()!;
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
    expect(typeof rev).toBe('number');
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, { headers: { 'X-CSRF-Token': await getCsrfToken(context) } });
    expect(r.ok()).toBeTruthy();
  }
});

test.describe('dead-link report', () => {
  test('lists a dead tile with its path, and Show it lands on it', async ({ page, context }) => {
    const f = await setup(page, context);
    const since = new Date(Date.now() - 9 * 24 * 3600_000 - 3600_000).toISOString();
    await page.route('**/api/dead-links', (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        checksEnabled: true, thresholdHours: 168, historyStartedAt: '2026-09-01T00:00:00Z', checkedTiles: 3,
        links: [{
          id: f.id('nas'), name: 'Deadnas', url: 'https://deadnas.example.lan/',
          dashboardId: f.id('dash'), dashboardPath: f.path, dashboardName: f.name,
          tabId: f.id('t2'), folderIds: [f.id('srv')], path: [f.name, 'Media', 'Servers'],
          failingSince: since, lastChecked: new Date().toISOString(), lastError: 'HTTP 502'
        }]
      })
    }));
    await page.goto('/settings/dashboards');
    const row = page.locator(`[data-dead-link="${f.id('nas')}"]`);
    await expect(row).toContainText('Deadnas');
    await expect(row).toContainText(`${f.name} › Media › Servers`);
    await expect(row).toContainText('for 9 days');
    await expect(row).toContainText('HTTP 502');
    await expect(page.getByTestId('dead-links')).toContainText('more than 7 days');
    await expect(page.getByTestId('dead-links')).toContainText('Failure history started on');

    await row.getByRole('button', { name: 'Show it' }).click();
    await expect(page).toHaveURL(new RegExp(`${f.path}$`));
    const tile = page.locator(`.tab-canvas [data-node-id="${f.id('nas')}"]`);
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAttribute('data-search-hit', /pulse|still/);
  });

  test('says so when status checks are off globally', async ({ page, context }) => {
    await setSetting(page, context, 'status.checks_enabled', 'false');
    try {
      await page.goto('/settings/dashboards');
      const state = page.locator('[data-state="checks-off"]');
      await expect(state).toContainText('Status checks are turned off');
      await expect(state.getByRole('link', { name: /Global settings/ })).toHaveAttribute('href', '/settings/global#status-checks');
    } finally {
      await setSetting(page, context, 'status.checks_enabled', 'true');
    }
  });

  test('the threshold is set in days and stored in hours', async ({ page, context }) => {
    try {
      await page.goto('/settings/global#status-checks');
      const input = page.locator('#setting-status\\.dead_after_hours');
      await expect(input).toHaveValue('7');
      await expect(page.locator('[data-unit-for="status.dead_after_hours"]')).toHaveValue('days');
      await input.fill('36');
      await page.locator('[data-unit-for="status.dead_after_hours"]').selectOption('hours');
      const row = page.locator('.row', { has: input });
      await row.getByRole('button', { name: 'Save' }).click();
      await expect(row.getByRole('button', { name: 'Save' })).toBeDisabled();
      const list = await (await page.request.get('/api/settings')).json();
      expect(list.settings.find((s: { key: string }) => s.key === 'status.dead_after_hours').value).toBe('36');
    } finally {
      await setSetting(page, context, 'status.dead_after_hours', '168');
    }
  });
});
