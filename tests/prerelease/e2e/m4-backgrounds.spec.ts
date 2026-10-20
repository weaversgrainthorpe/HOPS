import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M4 Task 4 fix round 1 (Ruling 10), in a REAL browser: jsdom has no layout, so
// "the failure badge never covers content" and "the maximised backdrop is
// translucent" are checked here. (Task 9 adds the full background suite.)

let seq = 0;
let made: { id: string } | null = null;

const placement = (x: number, y: number, w = 1, h = 1) => ({ x, y, w, h });
const tile = (id: string, name: string) => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, placement: placement(0, 0)
});

async function importFixture(page: Page, context: BrowserContext) {
  const p = `m4b${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  // A same-origin asset path that does not exist: the image fails to load.
  const broken = { type: 'image', value: `/backgrounds/${p}-missing.jpg` };
  const folder = (key: string, name: string, x: number, extra: Record<string, unknown> = {}) => ({
    id: id(key), kind: 'folder', name, layout: 'inherit', display: 'expanded', shape: 'rounded', showTitle: true,
    placement: placement(x, 1, 4, 3), background: broken,
    content: { columns: 4, children: [tile(id(`${key}-t`), `${name}Tile`)] }, ...extra
  });
  const dash = {
    id: id('dash'), name: `M4 backgrounds ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null, defaultLayout: null
    },
    defaultLayout: 'grid',
    tabs: [{
      id: id('tab'), name: 'Main', order: 0, layout: 'inherit',
      root: {
        columns: 12,
        children: [
          tile(id('anchor'), 'Anchor'),
          folder('ft', 'Titled', 0),
          folder('fu', 'Untitled', 4, { showTitle: false }),
          folder('fc', 'Collapsed', 8, { display: 'collapsed', placement: placement(8, 1, 2, 2) })
        ]
      }
    }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm4.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made = { id: id('dash') };
  return { path: `/${p}`, id };
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

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  return b;
}

test.describe('M4 backgrounds in a real browser', () => {
  test('the failed-image badge never covers a folder\'s content (edit mode)', async ({ page, context }) => {
    const f = await importFixture(page, context);
    await page.goto(f.path);
    await expect(page.locator(`[data-node-id="${f.id('anchor')}"]`)).toBeVisible();
    // View mode: no badge.
    await expect(page.locator('[data-bg-failed]')).toHaveCount(0);
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();

    const node = (k: string) => `[data-node-id="${f.id(k)}"]`;
    const cases: [string, string][] = [
      ['ft', `${node('ft')} > .folder-body`],
      ['fu', `${node('fu')} > .folder-body`],
      ['fc', `${node('fc')} .folder-collapsed-tile`]
    ];
    for (const [k, content] of cases) {
      const badge = page.locator(`${node(k)} [data-bg-failed="folder"]`);
      await expect(badge, `badge on ${k}`).toBeVisible();
      await expect(badge).toContainText("Background image couldn't be loaded");
      const bb = await badge.boundingBox();
      expect(bb, `badge box for ${k}`).toBeTruthy();
      expect(intersects(bb!, await boxOf(page, content)), `badge on ${k} overlaps its content`).toBe(false);
    }
  });

  test('a maximised folder sits over a translucent, dimmed backdrop', async ({ page, context }) => {
    const f = await importFixture(page, context);
    await page.goto(f.path);
    const titled = page.locator(`[data-node-id="${f.id('ft')}"]`);
    await expect(titled).toBeVisible();
    await titled.getByRole('button', { name: 'Maximise folder' }).click();
    const host = page.locator('.max-host');
    await expect(host).toBeVisible();
    const bg = await host.evaluate((el) => getComputedStyle(el).backgroundColor);
    const m = bg.match(/rgba?\(([^)]+)\)/);
    expect(m, `max-host background ${bg}`).toBeTruthy();
    const parts = m![1].split(',').map((s) => parseFloat(s));
    expect(parts.length, `max-host background ${bg} has an alpha`).toBe(4);
    expect(parts[3]).toBeGreaterThan(0);
    expect(parts[3]).toBeLessThan(1);
    // Leave the viewer's remembered view as it was.
    await host.getByRole('button', { name: 'Restore folder' }).click();
    await expect(host).toHaveCount(0);
  });
});
