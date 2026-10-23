import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M5 final review, Important 1 (Ruling 9): a v2 group converts to an open folder box that is never
// below its minimum, so at every grid width — 1280 and the low-end tablet 1024 — its items and,
// when it needs one, its page bar are drawn inside the box: every item is reachable, nothing is
// clipped silently. Also (Minor 6) an open folder's box is its placement x the tab cell.

let seq = 0;
const made: string[] = [];
type Box = { x: number; y: number; width: number; height: number };

test.afterEach(async ({ page, context }) => {
  while (made.length) {
    const id = made.pop()!;
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
    expect(typeof rev, `cleanup: dashboard ${id} has a revision`).toBe('number');
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) }
    });
    expect(r.ok(), `cleanup: delete dashboard ${id}: ${r.status()} ${await r.text()}`).toBeTruthy();
  }
});

const N = 12; // a full v2 row (12 Medium tiles)

/** Import a v2 HOPS dashboard with one full-width group of a full row of entries; it is converted. */
async function importV2(page: Page, context: BrowserContext) {
  const p = `m5m${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const entries = Array.from({ length: N }, (_, i) => ({
    id: id(`e${i}`), name: `Item ${i}`, url: `https://item${i}.example.lan/`, icon: 'mdi:lan', order: i
  }));
  const v2 = {
    dashboards: [{
      id: id('dash'), name: `M5 migration ${p}`, path: `/${p}`, order: 0,
      tabs: [{ id: id('tab'), name: 'Main', order: 0, groups: [{ id: id('row'), name: 'Row', order: 0, width: 'full', entries }] }]
    }]
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'v2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v2)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  const cfg = await (await page.request.get('/api/config')).json();
  const dash = cfg.dashboards.find((d: { path: string }) => d.path === `/${p}`);
  expect(dash, 'the converted dashboard is stored').toBeTruthy();
  made.push(dash.id);
  return { path: `/${p}`, dash, folderId: id('row'), itemIds: entries.map((e) => e.id) };
}

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}
const inside = (a: Box, b: Box) =>
  a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1;

/** Every item of the folder, page by page through its page bar; each fully inside the folder's box. */
async function reachable(page: Page, folderId: string): Promise<string[]> {
  const f = page.locator(`.tab-canvas [data-node-id="${folderId}"]`).first();
  const fb = await box(f);
  const seen: string[] = [];
  for (let guard = 0; guard < 20; guard++) {
    const items = f.locator('[data-folder-page] [data-node-id]');
    for (let i = 0; i < (await items.count()); i++) {
      const it = items.nth(i);
      const ib = await box(it);
      const iid = (await it.getAttribute('data-node-id'))!;
      expect(inside(ib, fb), `${iid} is drawn inside the folder's box (not clipped)`).toBe(true);
      seen.push(iid);
    }
    const next = f.locator('[data-page-bar="next"]');
    if ((await next.count()) === 0 || (await next.isDisabled())) break;
    await expect(next).toBeVisible();
    expect(inside(await box(next), fb), 'the page bar is inside the folder box').toBe(true);
    await next.click();
  }
  return seen;
}

async function putFolderBox(page: Page, context: BrowserContext, dashId: string, folderId: string, w: number, h: number) {
  const cfg = await (await page.request.get('/api/config')).json();
  const dash = cfg.dashboards.find((d: { id: string }) => d.id === dashId);
  const folder = dash.tabs[0].root.children.find((n: { id: string }) => n.id === folderId);
  folder.placement = { ...folder.placement, w, h };
  const r = await page.request.put(`/api/dashboards/${encodeURIComponent(dashId)}`, {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    data: { schema: 3, dashboard: dash, revision: dash.revision, layoutVersion: 2 }
  });
  expect(r.status(), await r.text()).toBe(200);
}

for (const width of [1280, 1024]) {
  test(`a converted full-row group at ${width}px: its box is its placement, every item is reachable, nothing clipped`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await importV2(page, context);
    const folder = f.dash.tabs[0].root.children.find((n: { id: string }) => n.id === f.folderId);
    expect(folder.placement.w * folder.placement.h, 'converted box').toBeGreaterThan(0);
    await page.goto(f.path);
    const node = page.locator(`.tab-canvas [data-node-id="${f.folderId}"]`).first();
    await expect(node).toBeVisible();
    // Minor 6: the open box is placement x cell (one geometry source).
    const cell = (await box(page.locator('.tab-canvas'))).width / 24;
    const nb = await box(node);
    expect(Math.abs(nb.width - folder.placement.w * cell), 'open box width = w x cell').toBeLessThanOrEqual(1);
    expect(Math.abs(nb.height - folder.placement.h * cell), 'open box height = h x cell').toBeLessThanOrEqual(1);
    await expect(node.locator('[data-folder-too-small]')).toHaveCount(0);
    expect((await reachable(page, f.folderId)).sort()).toEqual([...f.itemIds].sort());
  });

  test(`a converted full-row group at its minimum height at ${width}px shows its page bar; every item is reachable`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await importV2(page, context);
    // 24 x 6: the M6 minimum height (one row, the chrome and the tab allowance). A converted group is
    // Rounded, which does not draw the tab, so that allowance is spare room: it may hold a second row.
    // Whatever fits, a page bar shows exactly when the items need more than one page.
    await putFolderBox(page, context, f.dash.id, f.folderId, 24, 6);
    await page.goto(f.path);
    const node = page.locator(`.tab-canvas [data-node-id="${f.folderId}"]`).first();
    const per = Number(await node.locator('[data-folder-page]').first().getAttribute('data-folder-per-page'));
    expect(per, 'a page holds at least one row').toBeGreaterThan(0);
    if (per < f.itemIds.length) await expect(node.locator('[data-page-bar="next"]')).toBeVisible();
    else await expect(node.locator('[data-page-bar="next"]')).toHaveCount(0);
    await expect(node.locator('[data-folder-too-small]')).toHaveCount(0);
    expect((await reachable(page, f.folderId)).sort()).toEqual([...f.itemIds].sort());
  });
}

test('a box below its minimum is refused on save, naming the folder and both sizes', async ({ page, context }) => {
  const f = await importV2(page, context);
  const cfg = await (await page.request.get('/api/config')).json();
  const dash = cfg.dashboards.find((d: { id: string }) => d.id === f.dash.id);
  const folder = dash.tabs[0].root.children.find((n: { id: string }) => n.id === f.folderId);
  folder.placement = { ...folder.placement, w: 24, h: 5 };
  const r = await page.request.put(`/api/dashboards/${encodeURIComponent(f.dash.id)}`, {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    data: { schema: 3, dashboard: dash, revision: dash.revision, layoutVersion: 2 }
  });
  expect(r.status()).toBe(400);
  const msg = (await r.json()).error as string;
  expect(msg).toContain('Row');
  expect(msg).toContain('24×5');
  expect(msg).toContain('3×6');
});
