import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M5 §2a (one layout version), in a REAL browser against a real server. A page loaded before a
// layout-format update runs the old code: it holds another form's placements and sends no (or
// another) layoutVersion. The server must refuse every placement-carrying write from it with a
// visible 409 ("HOPS was updated… Reload") and leave the stored document exactly as it was; the
// current page sends layoutVersion: 1 on each such write, and when a write is refused the user
// sees why and keeps the draft.

let seq = 0;
const made: string[] = [];

function tile(id: string, name: string, x: number) {
  return {
    id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
    openMode: 'newtab', size: 'medium', order: x / 2, placement: { x, y: 0, w: 2, h: 2 }
  };
}

/** Import one small dashboard (in the M5 stored form, layoutVersion 1); returns its ids. */
async function importDash(page: Page, context: BrowserContext) {
  const p = `stale${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `Stale ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{ id: id('tab'), name: 'Main', order: 0,
      root: { columns: 24, children: [tile(id('a'), 'Alpha', 0), tile(id('b'), 'Bravo', 2)] } }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 1, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'stale.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(id('dash'));
  return { path: `/${p}`, id };
}

async function storedConfig(page: Page) {
  const r = await page.request.get('/api/config');
  expect(r.status()).toBe(200);
  return r.json();
}
const dashIn = (cfg: { dashboards: { id: string }[] }, id: string) =>
  cfg.dashboards.find((d) => d.id === id) as Record<string, unknown> & { revision: number; tabs: { root: { children: { id: string; name: string }[] } }[] };

test.afterEach(async ({ page, context }) => {
  while (made.length) {
    const id = made.pop()!;
    const rev = dashIn(await storedConfig(page), id)?.revision;
    expect(typeof rev, `cleanup: dashboard ${id} has a revision`).toBe('number');
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) }
    });
    expect(r.ok(), `cleanup: delete dashboard ${id}: ${r.status()} ${await r.text()}`).toBeTruthy();
  }
});

test.describe('a stale (pre-update) client cannot write an old layout form', () => {
  test('save, rename and move/copy without layoutVersion: 1 are refused with a 409; the stored document is unchanged', async ({ page, context }) => {
    const a = await importDash(page, context);
    const b = await importDash(page, context);
    const csrf = await getCsrfToken(context);
    const headers = { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' };
    const before = await storedConfig(page);
    expect(before.layoutVersion).toBe(1);
    const d = dashIn(before, a.id('dash'));

    // An old page's save: 12-column placements (half the stored ones), no layoutVersion.
    const old = structuredClone(d);
    for (const n of old.tabs[0].root.children as unknown as { placement: { x: number; w: number; h: number } }[]) {
      n.placement.x /= 2; n.placement.w /= 2; n.placement.h /= 2;
    }
    const writes: { what: string; method: 'put' | 'post'; url: string; body: unknown }[] = [
      { what: 'save', method: 'put', url: `/api/dashboards/${a.id('dash')}`, body: { schema: 3, dashboard: old, revision: d.revision } },
      { what: 'rename', method: 'put', url: `/api/dashboards/${a.id('dash')}`,
        body: { schema: 3, dashboard: { ...d, name: 'Renamed by a stale page' }, revision: d.revision } },
      { what: 'save, the retired gridUnit 2', method: 'put', url: `/api/dashboards/${a.id('dash')}`, body: { schema: 3, dashboard: d, revision: d.revision, gridUnit: 2 } },
      { what: 'save, layoutVersion 2', method: 'put', url: `/api/dashboards/${a.id('dash')}`, body: { schema: 3, dashboard: d, revision: d.revision, layoutVersion: 2 } },
      ...(['move', 'copy'] as const).map((mode) => ({
        what: mode, method: 'post' as const, url: '/api/dashboards/transfer',
        body: { mode, sourceId: a.id('dash'), sourceRevision: d.revision, nodeIds: [a.id('a')],
          targetId: b.id('dash'), targetRevision: dashIn(before, b.id('dash')).revision, target: { tabId: b.id('tab') } }
      }))
    ];
    for (const w of writes) {
      const r = await page.request[w.method](w.url, { headers, data: JSON.stringify(w.body) });
      expect(r.status(), `${w.what}: ${await r.text()}`).toBe(409);
      const body = await r.json();
      expect(body.error, w.what).toBe('layout_version_mismatch');
      expect(body.detail, w.what).toMatch(/HOPS was updated.*Reload/);
      expect(await storedConfig(page), `${w.what} left the stored document unchanged`).toEqual(before);
    }
  });

  test('the editor sends layoutVersion: 1; a refused save shows the reload message and keeps the draft', async ({ page, context }) => {
    const f = await importDash(page, context);
    const before = await storedConfig(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(f.path);
    const alpha = page.locator(`[data-node-id="${f.id('a')}"]`).first();
    await expect(alpha).toBeVisible();
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    const toolbar = page.getByRole('toolbar', { name: 'Editing' });
    await expect(toolbar).toBeVisible();

    await alpha.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('input#name').fill('Alpha edited');
    await dlg.getByRole('button', { name: /^Save$/ }).click();
    await expect(alpha).toContainText('Alpha edited');

    // Simulate the stale page: strip layoutVersion from the outgoing save.
    const sent: unknown[] = [];
    await page.route(/\/api\/dashboards\/[^/]+$/, async (route) => {
      const body = route.request().postDataJSON();
      sent.push({ ...body });
      delete body.layoutVersion;
      await route.continue({ postData: JSON.stringify(body) });
    });
    const save = toolbar.getByRole('button', { name: /Save/ });
    const refused = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
    await save.click();
    expect((await refused).status()).toBe(409);
    expect((sent[0] as { layoutVersion?: number }).layoutVersion, 'the editor sent layoutVersion: 1').toBe(1);
    expect(sent[0], 'and no retired gridUnit').not.toHaveProperty('gridUnit');
    await expect(page.locator('.toast-error').filter({ hasText: /HOPS was updated.*Reload/ })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(1);
    await expect(alpha).toContainText('Alpha edited');
    expect(await storedConfig(page), 'the refused save changed nothing').toEqual(before);

    // The same draft, sent as this page sends it, saves: nothing was lost.
    await page.unroute(/\/api\/dashboards\/[^/]+$/);
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
    await save.click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
    const stored = dashIn(await storedConfig(page), f.id('dash'));
    expect(stored.tabs[0].root.children.find((n) => n.id === f.id('a'))?.name).toBe('Alpha edited');
    expect(errors).toEqual([]);
  });
});
