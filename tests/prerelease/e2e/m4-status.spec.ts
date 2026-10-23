import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M4 Task 7 in a REAL browser: layered status checks show their source and effect, the badge
// follows the resolved setting, and the one-time notice lists a dashboard whose tiles are
// switched on under an off dashboard; its Dismiss is stored on the server (survives a reload).

let made: { id: string } | null = null;

const placement = (x: number, y: number, w = 2, h = 2) => ({ x, y, w, h });

async function importDash(page: Page, context: BrowserContext) {
  const p = `m4s${Date.now().toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const tile = (key: string, name: string, x: number, extra: Record<string, unknown> = {}) => ({
    id: id(key), kind: 'tile', type: 'link', name, url: `https://${key}.example.lan/`, icon: 'mdi:lan',
    openMode: 'newtab', size: 'medium', order: 0, placement: placement(x, 0), ...extra
  });
  const dash = {
    id: id('dash'), name: `Status off ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      // The dashboard's checks are OFF ...
      statusChecksEnabled: false, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{
      id: id('tab'), name: 'Main', order: 0,
      root: {
        columns: 24, // the M5 stored form: a 24-column grid, a Medium tile 2 x 2 cells
        children: [
          // ... but this tile is explicitly switched on (so it is checked: the most specific wins).
          tile('on', 'Checked', 0, { statusCheck: { type: 'http', enabled: true, interval: 60 } }),
          // An unset tile: off, never checked.
          tile('unset', 'Plain', 2),
          // Inherits: follows the off dashboard.
          tile('inh', 'Follower', 4, { statusCheck: { type: 'http', enabled: null, interval: 60 } })
        ]
      }
    }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 1, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm4s.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made = { id: id('dash') };
  return { path: `/${p}`, id, name: dash.name };
}

test.afterEach(async ({ page, context }) => {
  if (!made) return;
  const id = made.id;
  made = null;
  const cfg = await (await page.request.get('/api/config')).json();
  const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
  expect(typeof rev, `cleanup: dashboard ${id} has a revision`).toBe('number');
  const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) }
  });
  expect(r.ok(), `cleanup: delete dashboard ${id}: ${r.status()} ${await r.text()}`).toBeTruthy();
});

test.describe('M4 layered status checks in a real browser', () => {
  test('a tile switched on under an off dashboard: badge, dialog text, notice, stored Dismiss', async ({ page, context }) => {
    const f = await importDash(page, context);
    const node = (k: string) => page.locator(`[data-node-id="${f.id(k)}"]`);

    // View mode: the switched-on tile has its badge; the unset and the inheriting (off) ones don't.
    const inhStatus = page.waitForResponse((r) => r.url().endsWith(`/api/status/${f.id('inh')}`));
    await page.goto(f.path);
    await expect(node('on')).toBeVisible();
    await expect(node('on').locator('.status-badge .status-indicator')).toBeVisible();
    await expect(node('unset').locator('.status-badge')).toHaveCount(0);
    await expect(node('inh')).toBeVisible();
    // The inheriting tile asks the server, which says "disabled" (dashboard off): no badge.
    expect((await (await inhStatus).json()).status).toBe('disabled');
    await expect(node('inh').locator('.status-badge')).toHaveCount(0);

    // Edit mode: the inheriting tile's off state shows, naming the dashboard.
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    await expect(node('inh').locator('.status-badge .status-indicator')).toHaveAttribute(
      'title', `Status checks are off for this tile (set on ${f.name})`
    );

    // The tile's dialog shows the source and the effect.
    await node('on').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const dlg = page.getByRole('dialog');
    const group = dlg.getByRole('group', { name: 'Status checks' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('radio', { name: 'On' })).toBeChecked();
    await expect(group).toContainText('Overridden here: on (the dashboard is off)');
    // Inherit: says where from (draft-only; Cancel discards).
    await group.getByRole('radio', { name: 'Inherit' }).check();
    await expect(group).toContainText(`Inherited from ${f.name}: off`);
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toHaveCount(0);

    // Settings (the admin home) shows the one-time notice listing this dashboard.
    await page.goto('/settings');
    const notice = page.locator('.server-notice').filter({ hasText: f.name });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Status checks now follow the most specific setting');
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('.server-notice')).toHaveCount(0);

    // Dismissed on the server: still gone after a reload.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Dashboards', level: 2 })).toBeVisible();
    await expect(page.locator('.server-notice')).toHaveCount(0);
    const cfg = await (await page.request.get('/api/config')).json();
    expect(cfg.notices ?? []).toEqual([]);
  });
});
