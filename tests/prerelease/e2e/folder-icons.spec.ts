import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken, flourishesDone } from '../helpers';

// A folder opened inside another shows its own icon in its header (tab and rounded looks); a very long
// name still ellipsises inside the tab with the icon in view. Synthetic data; needs real layout.

let seq = 0;
const made: string[] = [];
type Child = Record<string, unknown>;
type AnyNode = { id: string; content?: { children: AnyNode[] } };

const kid = (id: string, name: string, extra: Child = {}): Child => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, ...extra
});
const tile = (id: string, name: string, x: number, y: number): Child => kid(id, name, { placement: { x, y, w: 2, h: 2 } });
const folder = (id: string, name: string, box: { x: number; y: number; w: number; h: number } | null, children: Child[], extra: Child = {}): Child => ({
  id, kind: 'folder', name, display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
  ...(box ? { placement: box } : {}), content: { children }, ...extra
});
const kids = (id: (s: string) => string, n: number, prefix = 'K') =>
  Array.from({ length: n }, (_, i) => kid(id(`${prefix.toLowerCase()}${i + 1}`), `${prefix}${i + 1}`));

/** Import one dashboard (stored form, layoutVersion 2, one Main tab). */
async function importDash(page: Page, context: BrowserContext, children: (id: (s: string) => string) => Child[]) {
  const p = `m5n${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `nested ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{ id: id('tab'), name: 'Main', order: 0, root: { columns: 24, children: children(id) } }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm5n.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
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

const ICON = '/api/icons/dashboard/1337x.svg';
const node = (page: Page, id: string) => page.locator(`.tab-canvas [data-node-id="${id}"]`).first();

test.describe('a nested folder header shows its icon', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  const LONG = 'A very long folder name that keeps going well past any tab width ok';

  test('folder-paper: icon inside the tab; a 60+ char name ellipsises within the tab', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('top'), 'Top', { x: 0, y: 0, w: 18, h: 9 }, [
        kid(id('a'), 'A'),
        folder(id('sub'), LONG, null, [kid(id('b'), 'B')], { shape: 'folder-paper', iconUrl: ICON })
      ], { shape: 'folder-paper' })
    ]);
    await page.goto(f.path);
    await page.getByRole('button', { name: /^A very long folder name.*folder with 1 item/ }).click();
    const tab = page.locator(`[data-folder-tab="${f.id('sub')}"]`);
    await expect(tab).toBeVisible();
    await flourishesDone(page);
    const icon = tab.locator('img.tab-icon');
    await expect(icon).toBeVisible();
    const t = (await tab.boundingBox())!;
    const i = (await icon.boundingBox())!;
    expect(i.x, 'icon left inside tab').toBeGreaterThanOrEqual(t.x - 0.5);
    expect(i.x + i.width, 'icon right inside tab').toBeLessThanOrEqual(t.x + t.width + 0.5);
    const name = tab.locator('.tab-name');
    expect(await name.evaluate((e) => getComputedStyle(e).textOverflow)).toBe('ellipsis');
    const n = (await name.boundingBox())!;
    expect(n.x + n.width, 'name right edge within tab').toBeLessThanOrEqual(t.x + t.width + 0.5);
    expect(await name.evaluate((e) => e.scrollWidth > e.clientWidth), 'name is actually truncated').toBe(true);
  });

  test('rounded: the icon shows beside the name in the nested bar', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('top'), 'Top', { x: 0, y: 0, w: 18, h: 9 }, [
        kid(id('a'), 'A'),
        folder(id('sub'), 'Sub', null, [kid(id('b'), 'B')], { iconUrl: ICON, iconBgColor: '#334455' })
      ])
    ]);
    await page.goto(f.path);
    await page.getByRole('button', { name: /^Sub, folder with 1 item/ }).click();
    const bar = node(page, f.id('top')).locator(`.nested-box[data-nested-folder="${f.id('sub')}"] > .nested-header`);
    await expect(bar.locator('img.folder-icon-img')).toBeVisible();
    await flourishesDone(page);
    const backing = (await bar.locator('.folder-icon-backing.has-bg').boundingBox())!;
    const b = (await bar.boundingBox())!;
    expect(backing.y, 'backing top inside bar').toBeGreaterThanOrEqual(b.y - 0.5);
    expect(backing.y + backing.height, 'backing bottom inside bar').toBeLessThanOrEqual(b.y + b.height + 0.5);
  });
});

test.describe('a minimised folder shows its own icon', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  const mini = (id: string, name: string, x: number, extra: Child = {}) =>
    folder(id, name, { x, y: 0, w: 4, h: 4 }, [kid(`${id}-k`, 'K')], { display: 'collapsed', size: 'large', ...extra });

  test('own icon replaces the previews; an unloadable image still shows the name and a glyph; reload keeps it', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      mini(id('ok'), 'Okay', 0, { minimisedIcon: 'own', iconUrl: ICON }),
      mini(id('bad'), 'Broken', 4, { minimisedIcon: 'own', iconUrl: '/api/icons/dashboard/does-not-exist-404.svg' }),
      mini(id('plain'), 'Plain', 8, { iconUrl: ICON })
    ]);
    await page.goto(f.path);
    const tileOf = (k: string) => node(page, f.id(k)).locator('.folder-collapsed-tile');

    const ok = tileOf('ok');
    await expect(ok.locator('[data-own-icon] img')).toBeVisible();
    await expect(ok.locator('.preview-grid')).toHaveCount(0);
    await expect(tileOf('plain').locator('.preview-grid')).toBeVisible();
    await expect(tileOf('plain').locator('[data-own-icon]')).toHaveCount(0);

    // A 404 icon: the name stays, and a visible glyph stands in (never an empty face).
    const bad = tileOf('bad');
    await expect(bad.locator('.collapsed-name')).toHaveText('Broken');
    await expect(bad.locator('[data-own-icon][data-own-icon-fallback] svg')).toBeVisible();
    const box = (await bad.locator('[data-own-icon]').boundingBox())!;
    expect(box.width).toBeGreaterThan(16);
    expect(box.height).toBeGreaterThan(16);

    await page.reload();
    await expect(tileOf('ok').locator('[data-own-icon] img')).toBeVisible();
    await expect(tileOf('bad').locator('.collapsed-name')).toHaveText('Broken');
  });
});

test.describe('at the Small size', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('names take two lines and a Rounded folder keeps everything inside its tile', async ({ page, context }) => {
    const small = (x: number, y: number) => ({ x, y, w: 1, h: 1 });
    const mini = (id: string, name: string, x: number, extra: Child = {}) =>
      folder(id, name, small(x, 2), [kid(`${id}a`, 'A'), kid(`${id}b`, 'B'), kid(`${id}c`, 'C')], { size: 'small', display: 'collapsed', ...extra });
    const d = await importDash(page, context, (id) => [
      kid(id('t'), 'Home Assistant', { url: 'https://ha.example.lan/', size: 'small', placement: small(0, 0) }),
      mini(id('none'), 'Own none', 0, { minimisedIcon: 'own' }),
      mini(id('has'), 'Own has', 6, { minimisedIcon: 'own', icon: 'mdi:home' }),
      folder(id('empty'), 'Empty one', small(12, 2), [], { size: 'small', display: 'collapsed' })
    ]);
    await page.goto(d.path);
    const cell = (s: string) => page.locator(`.tab-canvas [data-node-id="${d.id(s)}"]`);
    const title = await cell('t').locator('.title').evaluate((t) => t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight));
    expect(Math.round(title), 'the name wraps to two lines').toBe(2);
    // One rule with the tiles: its name (on two lines too) above the preview of all its icons (up to 4).
    await expect(cell('none').locator('.preview-cell')).toHaveCount(3);
    await expect(cell('none').locator('.collapsed-name')).toBeVisible();
    for (const s of ['t', 'none', 'has', 'empty']) {
      const inside = await cell(s).evaluate((c) => {
        const box = c.getBoundingClientRect();
        return [...c.querySelectorAll('.title, .icon svg, .collapsed-name, .preview-cell, [data-own-icon], .empty-note')].every((e) => {
          const r = e.getBoundingClientRect();
          return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5 && r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
        });
      });
      expect(inside, `${s}: everything inside the tile`).toBe(true);
    }
  });
});
