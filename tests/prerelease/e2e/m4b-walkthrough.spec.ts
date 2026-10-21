import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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

type RGB = [number, number, number];
type Box = { x: number; y: number; width: number; height: number };
const dist = (a: RGB, b: RGB) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

/**
 * From one real screenshot (decoded by the browser): the colour at each point, and for each
 * box the pixel closest to white (on a white-text title, a pixel fully inside a glyph).
 */
async function sample(page: Page, points: [number, number][], boxes: Box[]): Promise<{ at: RGB[]; whitest: RGB[] }> {
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  return page.evaluate(
    async ({ b64, pts, bxs }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const scale = img.naturalWidth / window.innerWidth;
      const at = pts.map(([x, y]) => {
        const d = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
        return [d[0], d[1], d[2]] as [number, number, number];
      });
      const whitest = bxs.map((b) => {
        const x0 = Math.round(b.x * scale), y0 = Math.round(b.y * scale);
        const w = Math.max(1, Math.round(b.width * scale)), h = Math.max(1, Math.round(b.height * scale));
        const d = ctx.getImageData(x0, y0, w, h).data;
        let best: [number, number, number] = [0, 0, 0];
        let bestD = Infinity;
        for (let i = 0; i < d.length; i += 4) {
          const dd = Math.max(255 - d[i], 255 - d[i + 1], 255 - d[i + 2]);
          if (dd < bestD) { bestD = dd; best = [d[i], d[i + 1], d[i + 2]]; }
        }
        return best;
      });
      return { at, whitest };
    },
    { b64: png.toString('base64'), pts: points, bxs: boxes }
  );
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

  // ---- §2: tile opacity fades the background only

  test('a tile at background opacity 0.2: its text is as solid as a tile at 1.0; its background shows the wallpaper', async ({ page, context }) => {
    // A bright flat wallpaper (no overlay) and blue tiles with white text (custom colour).
    const WALL: RGB = [255, 255, 0];
    const BLUE: RGB = [0, 0, 255];
    const f = await importDash(page, context, [{
      name: 'Main',
      children: (id) => [
        tile(id('faint'), 'Faint', 0, 0, { size: 'large', color: '#0000ff', opacity: 0.2, placement: placement(0, 0, 3, 2) }),
        tile(id('solid'), 'Solid', 4, 0, { size: 'large', color: '#0000ff', opacity: 1, placement: placement(4, 0, 3, 2) })
      ]
    }], { background: { type: 'color', value: '#ffff00', overlayOpacity: 0, overlayBlur: 0 } });
    await page.goto(f.path);
    const faint = page.locator(`[data-node-id="${f.id('faint')}"] .entry`);
    const solid = page.locator(`[data-node-id="${f.id('solid')}"] .entry`);
    await expect(faint).toBeVisible();
    await expect(solid).toBeVisible();
    await page.mouse.move(1, 1);

    // Nothing on the title's path is faded, in either tile (the old bug faded the whole tile).
    const chain = (loc: typeof faint) => loc.locator('.title').evaluate((el) => {
      let o = 1;
      for (let n: Element | null = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
      return o;
    });
    expect(await chain(faint)).toBe(1);
    expect(await chain(solid)).toBe(1);

    const fb = (await faint.boundingBox())!;
    const sb = (await solid.boundingBox())!;
    const ft = (await faint.locator('.title').boundingBox())!;
    const st = (await solid.locator('.title').boundingBox())!;
    // On the tile face near its left edge, mid-height: clear of the title, icon and border.
    const faceF: [number, number] = [fb.x + 8, fb.y + fb.height / 2];
    const faceS: [number, number] = [sb.x + 8, sb.y + sb.height / 2];
    const expectedFace: RGB = [0, 1, 2].map((i) => Math.round(0.2 * BLUE[i] + 0.8 * WALL[i])) as RGB;

    // Poll until the tiles have painted (fonts, transitions) and the colours match.
    await expect
      .poll(async () => {
        const { at, whitest } = await sample(page, [faceF, faceS], [ft, st]);
        return dist(at[0], expectedFace) <= 8 && dist(at[1], BLUE) <= 6 && dist(whitest[0], whitest[1]) <= 12;
      }, { message: 'faint tile: face blended with the wallpaper, text as white as the solid tile' })
      .toBe(true);

    const { at, whitest } = await sample(page, [faceF, faceS], [ft, st]);
    // The backgrounds differ: the faint one shows the wallpaper through it ...
    expect(dist(at[0], at[1]), `faces ${at[0]} vs ${at[1]}`).toBeGreaterThan(100);
    expect(dist(at[0], expectedFace), `faint face ${at[0]} vs ${expectedFace}`).toBeLessThanOrEqual(8);
    // ... while the text matches the solid tile's (white; a faded title would be ~(255,255,204)).
    expect(dist(whitest[0], whitest[1]), `text ${whitest[0]} vs ${whitest[1]}`).toBeLessThanOrEqual(12);
    expect(dist(whitest[0], [255, 255, 255]), `faint text ${whitest[0]}`).toBeLessThanOrEqual(12);
  });

  // ---- §3: the tab panel fills the screen (no edge)

  /** The canvas panel's bottom and the viewport height, in page coordinates. */
  const panelGeometry = (page: Page) => page.evaluate(() => {
    const el = document.querySelector('.canvas-panel');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { bottom: r.bottom + window.scrollY, vh: window.innerHeight, docH: document.documentElement.scrollHeight };
  });

  test('the panel reaches the bottom of the screen on the Showcase Free tab, in view and edit mode', async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // The bundled showcase fixture, under a fresh id and path.
    const fixture = JSON.parse(fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend/internal/configdoc/testdata/v3_showcase_export.json'), 'utf8'));
    const p = `m4bwsc${Date.now().toString(36)}${(seq++).toString(36)}`;
    const dash = fixture.config.dashboards[0];
    dash.id = `${p}-dash`;
    dash.path = `/${p}`;
    dash.name = `Showcase ${p}`;
    fixture.config.dashboards = [dash];
    const r = await page.request.post('/api/config/import', {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) },
      multipart: { file: { name: 'sc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) } }
    });
    expect(r.status(), await r.text()).toBe(200);
    const cfg = await (await page.request.get('/api/config')).json();
    const stored = cfg.dashboards.find((d: { name: string }) => d.name === dash.name);
    expect(stored, 'imported showcase is stored').toBeTruthy();
    made.push(stored.id);

    await page.goto(stored.path);
    await page.getByRole('tab', { name: 'Switch to Free tab' }).click();
    await expect(page.getByRole('tab', { name: 'Switch to Free tab' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.canvas-panel')).toBeVisible();

    for (const mode of ['view', 'edit'] as const) {
      if (mode === 'edit') {
        await enterEdit(page);
        await expect(page.locator('.canvas-panel.editing')).toBeVisible();
      }
      await expect
        .poll(async () => {
          const g = await panelGeometry(page);
          return g ? g.bottom >= g.vh - 1 : false;
        }, { message: `${mode} mode: the panel reaches the bottom of the viewport` })
        .toBe(true);
      const g = (await panelGeometry(page))!;
      // A short tab is the content case this checks: the page does not need to scroll.
      expect(g.docH, `${mode}: short content, page height ${g.docH} vs viewport ${g.vh}`).toBeLessThanOrEqual(g.vh + 1);
      expect(g.bottom, `${mode}: panel bottom ${g.bottom} vs viewport ${g.vh}`).toBeLessThanOrEqual(g.vh + 1);
    }
  });

  test('on a long tab the panel grows with its content and contains its last tile', async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const f = await importDash(page, context, [{
      name: 'Long',
      children: (id) => [tile(id('first'), 'First', 0, 0), tile(id('last'), 'Last', 0, 40)]
    }]);
    await page.goto(f.path);
    const last = page.locator(`[data-node-id="${f.id('last')}"]`);
    await expect(last).toBeAttached();
    for (const mode of ['view', 'edit'] as const) {
      if (mode === 'edit') await enterEdit(page);
      await expect
        .poll(async () => page.evaluate((id) => {
          const panel = document.querySelector('.canvas-panel')?.getBoundingClientRect();
          const t = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
          if (!panel || !t) return 'missing';
          if (t.bottom <= window.innerHeight) return `tile ends at ${t.bottom}, not below the fold`;
          return panel.top <= t.top && panel.bottom >= t.bottom ? 'contained' : `panel ${panel.top}-${panel.bottom} vs tile ${t.top}-${t.bottom}`;
        }, f.id('last')), { message: `${mode} mode: the last tile is inside the panel` })
        .toBe('contained');
    }
  });
});
