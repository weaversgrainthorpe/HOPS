import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M4 walkthrough changes (design/specs/2026-10-21-hops-v3-m4-walkthrough-changes-design.md §1–3, §6),
// in a REAL browser: selection rendering, compositing (pixels) and layout need Chromium.

let seq = 0;
const made: string[] = [];

const placement = (x: number, y: number, w = 1, h = 1) => ({ x, y, w, h });
type Child = Record<string, unknown>;

const tile = (id: string, name: string, x = 0, y = 0, extra: Child = {}) => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, placement: placement(x, y), ...extra
});

type TabSpec = { name: string; children: (id: (s: string) => string) => Child[] };

/** Import one dashboard with the given tabs (default: one Main tab); returns its path and id maker. */
async function importDash(
  page: Page,
  context: BrowserContext,
  tabs: TabSpec[],
  opts: { background?: Record<string, unknown> } = {}
) {
  const p = `m4bw${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash: Record<string, unknown> = {
    id: id('dash'), name: `M4 walkthrough ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null, defaultLayout: null
    },
    defaultLayout: 'grid',
    tabs: tabs.map((t, i) => ({
      id: id(`tab${i}`), name: t.name, order: i, layout: 'inherit', root: { columns: 12, children: t.children(id) }
    }))
  };
  if (opts.background) dash.background = opts.background;
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm4bw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(id('dash'));
  return { path: `/${p}`, id };
}

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

async function enterEdit(page: Page) {
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
}

test.describe('M4 walkthrough changes in a real browser', () => {
  // ---- §1: the gallery shows each picture once

  test('gallery: picking a picture listed under several names selects exactly one card', async ({ page, context }) => {
    const f = await importDash(page, context, [{
      name: 'Main',
      children: (id) => [
        tile(id('anchor'), 'Anchor', 11, 0),
        {
          id: id('fold'), kind: 'folder', name: 'Folder', layout: 'inherit', display: 'expanded', shape: 'rounded',
          showTitle: true, placement: placement(0, 1, 4, 3),
          content: { columns: 4, children: [tile(id('in'), 'Inner')] }
        }
      ]
    }]);
    const sel = `[data-node-id="${f.id('fold')}"]`;
    await page.goto(f.path);
    await expect(page.locator(sel)).toBeVisible();
    await enterEdit(page);
    await page.locator(sel).dblclick({ position: { x: 20, y: 20 } });
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: /^Background/ }).click();
    const picker = page.getByRole('dialog', { name: 'Folder background' });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: /^Image$/ }).click();

    // /presets/network-grid.jpg is in the catalogue three times (Network Grid, Server Room, ...).
    const cards = picker.locator('.image-card:has(img[src="/presets/network-grid.jpg"])');
    await expect(cards).toHaveCount(1);
    await cards.click();
    await expect(picker.locator('.image-card.selected')).toHaveCount(1);
    await expect(picker.locator('.image-card.selected img')).toHaveAttribute('src', '/presets/network-grid.jpg');
    // Every card in the "All" view is a different picture.
    const srcs = await picker.locator('.image-card img').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
    expect(srcs.length).toBeGreaterThan(0);
    expect(new Set(srcs).size).toBe(srcs.length);
  });
});
