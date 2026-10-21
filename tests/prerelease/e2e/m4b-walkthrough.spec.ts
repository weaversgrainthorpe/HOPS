import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCsrfToken } from '../helpers';
import { ADMIN_USERNAME, ADMIN_TEST_PASSWORD } from '../constants';

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

  // ---- §4A: log in from the pencil, in place

  /** A fresh browser context with no session (logged out), same server. */
  async function loggedOutPage(browser: Browser): Promise<{ page: Page; ctx: BrowserContext }> {
    // Explicitly empty: in Playwright Test a new context would otherwise inherit the project's auth.json.
    const ctx = await browser.newContext({
      baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }
    });
    return { page: await ctx.newPage(), ctx };
  }

  /** Logged out on a dashboard: the pencil opens the sign-in dialog; sign in with the test admin. */
  async function signInFromPencil(page: Page) {
    const pencil = page.getByRole('button', { name: 'Enter Edit Mode' });
    await expect(pencil).toBeVisible();
    await pencil.click();
    const dlg = page.getByRole('dialog', { name: 'Sign in' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel('Username')).toBeFocused();
    await dlg.getByLabel('Username').fill(ADMIN_USERNAME);
    await dlg.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
    await dlg.getByLabel('Password').press('Enter');
    await expect(dlg).toHaveCount(0);
  }

  test('logged out on a dashboard: pencil, sign in, and edit mode is on, on the same dashboard', async ({ page, context, browser }) => {
    const f = await importDash(page, context, [{ name: 'Main', children: (id) => [tile(id('a'), 'Alpha')] }]);
    const { page: anon, ctx } = await loggedOutPage(browser);
    try {
      await anon.goto(f.path);
      await expect(anon.locator(`[data-node-id="${f.id('a')}"]`)).toBeVisible();
      await expect(anon.getByRole('toolbar', { name: 'Editing' })).toHaveCount(0);

      // A wrong password: the error is in the dialog, which stays open; nothing else changes.
      await anon.getByRole('button', { name: 'Enter Edit Mode' }).click();
      const dlg = anon.getByRole('dialog', { name: 'Sign in' });
      await dlg.getByLabel('Username').fill(ADMIN_USERNAME);
      await dlg.getByLabel('Password').fill('definitely-wrong');
      await dlg.getByRole('button', { name: 'Sign in' }).click();
      await expect(dlg.getByRole('alert')).toContainText('check your username and password');
      await expect(dlg).toBeVisible();
      await dlg.getByRole('button', { name: 'Cancel' }).click();
      await expect(dlg).toHaveCount(0);
      await expect(anon.getByRole('toolbar', { name: 'Editing' })).toHaveCount(0);

      await signInFromPencil(anon);
      await expect(anon.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
      await expect(anon.getByRole('button', { name: 'Exit Edit Mode' })).toBeVisible();
      expect(new URL(anon.url()).pathname).toBe(f.path);
      // The edit session is on this dashboard: its tile opens the editor.
      await anon.locator(`[data-node-id="${f.id('a')}"]`).click({ button: 'right' });
      await anon.getByRole('menuitem', { name: 'Edit' }).click();
      await expect(anon.getByRole('dialog').locator('input#name')).toHaveValue('Alpha');
    } finally {
      await ctx.close();
    }
  });

  test('a parked draft is restored after signing back in through the pencil dialog', async ({ page, context, browser }) => {
    const f = await importDash(page, context, [{ name: 'Main', children: (id) => [tile(id('a'), 'Alpha')] }]);
    const { page: anon, ctx } = await loggedOutPage(browser);
    try {
      await anon.goto(f.path);
      await signInFromPencil(anon);
      await expect(anon.getByRole('toolbar', { name: 'Editing' })).toBeVisible();

      // A dirty draft: rename the tile (not saved).
      await anon.locator(`[data-node-id="${f.id('a')}"]`).click({ button: 'right' });
      await anon.getByRole('menuitem', { name: 'Edit' }).click();
      const tileDlg = anon.getByRole('dialog');
      await tileDlg.locator('input#name').fill('Alpha draft');
      await tileDlg.getByRole('button', { name: /^Save$/ }).click();
      await expect(anon.locator(`[data-node-id="${f.id('a')}"]`)).toContainText('Alpha draft');

      // The session ends on the server; the next save finds out (401) and parks the draft.
      const csrf = (await ctx.cookies()).find((c) => c.name === 'hops_csrf')!.value;
      const out = await anon.request.post('/api/auth/logout', { headers: { 'X-CSRF-Token': csrf } });
      expect(out.ok(), `logout: ${out.status()}`).toBeTruthy();
      await anon.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ }).click();
      await expect(anon.locator('.parked-banner')).toContainText('sign in to save your changes');
      await expect(anon.getByRole('toolbar', { name: 'Editing' })).toHaveCount(0);

      // Back in through the pencil dialog: edit mode is on with the draft restored.
      await signInFromPencil(anon);
      await expect(anon.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
      await expect(anon.locator('.parked-banner')).toHaveCount(0);
      await expect(anon.locator(`[data-node-id="${f.id('a')}"]`)).toContainText('Alpha draft');
      await expect(anon.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(1);
      // Nothing reached the server while signed out.
      const cfg = await (await page.request.get('/api/config')).json();
      const stored = cfg.dashboards.find((d: { id: string }) => d.id === f.id('dash'));
      expect(JSON.stringify(stored)).toContain('"Alpha"');
      expect(JSON.stringify(stored)).not.toContain('Alpha draft');
    } finally {
      await ctx.close();
    }
  });

  // ---- §4B: every item edits the same way (handle, double-click, menu)

  /** One dashboard with a tile, an expanded folder and a collapsed folder on Main, and a second tab. */
  async function itemsDash(page: Page, context: BrowserContext) {
    return importDash(page, context, [
      {
        name: 'Main',
        children: (id) => [
          tile(id('a'), 'Alpha', 0, 0),
          {
            id: id('grp'), kind: 'folder', name: 'Group', layout: 'inherit', display: 'expanded', shape: 'rounded',
            showTitle: true, placement: placement(2, 0, 4, 3),
            content: { columns: 4, children: [tile(id('in'), 'Inner')] }
          },
          {
            id: id('box'), kind: 'folder', name: 'Box', layout: 'inherit', display: 'collapsed', shape: 'rounded',
            showTitle: true, placement: placement(8, 0, 4, 3),
            content: { columns: 4, children: [tile(id('bx'), 'Boxed')] }
          }
        ]
      },
      { name: 'Two', children: (id) => [tile(id('t2a'), 'Tango')] }
    ]);
  }

  /** The three ways in, for one item: its handle, a double-click, and its menu's Edit. */
  async function editsThreeWays(
    page: Page,
    o: {
      item: ReturnType<Page['locator']>;
      handle: string;
      dialog: string;
      field: ReturnType<Page['locator']>;
      value: string;
      dblAt?: { x: number; y: number };
    }
  ) {
    const dlg = page.getByRole('dialog', { name: o.dialog });
    const handle = page.getByRole('button', { name: o.handle, exact: true });
    // Hidden (and click-through) until the item is hovered; then shown.
    await page.mouse.move(2, 2);
    await expect(handle).toHaveCSS('opacity', '0');
    await o.item.hover({ position: o.dblAt });
    await expect(handle).toHaveCSS('opacity', '1');
    // 1. The handle.
    await handle.click();
    await expect(dlg).toBeVisible();
    await expect(o.field).toHaveValue(o.value);
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dlg).toHaveCount(0);
    // 2. Double-click.
    await o.item.dblclick({ position: o.dblAt });
    await expect(dlg).toBeVisible();
    await expect(o.field).toHaveValue(o.value);
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dlg).toHaveCount(0);
    // 3. Right-click: the shared menu; its Edit opens the same dialog.
    await o.item.click({ button: 'right', position: o.dblAt });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await expect(dlg).toBeVisible();
    await expect(o.field).toHaveValue(o.value);
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dlg).toHaveCount(0);
    // 4. Keyboard: the handle is a real button; focusing it shows it and Enter edits.
    await page.mouse.move(2, 2);
    await handle.focus();
    await expect(handle).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dlg).toHaveCount(0);
  }

  test('tile: the handle, a double-click and the menu all edit it', async ({ page, context }) => {
    const f = await itemsDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    await editsThreeWays(page, {
      item: page.locator(`[data-node-id="${f.id('a')}"]`),
      handle: 'Edit Alpha',
      dialog: 'Edit Tile',
      field: page.getByRole('dialog').locator('input#name'),
      value: 'Alpha',
      dblAt: { x: 20, y: 40 }
    });
  });

  test('expanded folder: the handle, a double-click and the menu all edit it', async ({ page, context }) => {
    const f = await itemsDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    await editsThreeWays(page, {
      item: page.locator(`[data-node-id="${f.id('grp')}"]`),
      handle: 'Edit Group',
      dialog: 'Edit Folder',
      field: page.locator('#folder-name'),
      value: 'Group',
      dblAt: { x: 60, y: 20 }
    });
  });

  test('collapsed folder: the handle, a double-click and the menu edit it; "Open" in its menu opens it', async ({ page, context }) => {
    const f = await itemsDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    const item = page.locator(`[data-node-id="${f.id('box')}"]`);
    await editsThreeWays(page, {
      item,
      handle: 'Edit Box',
      dialog: 'Edit Folder',
      field: page.locator('#folder-name'),
      value: 'Box',
      dblAt: { x: 30, y: 60 }
    });
    // A double-click edited it: it never opened.
    await expect(page.locator(`[data-drag-panel="${f.id('box')}"]`)).toHaveCount(0);
    await item.click({ button: 'right', position: { x: 30, y: 60 } });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Open', exact: true }).click();
    await expect(page.locator(`[data-drag-panel="${f.id('box')}"]`)).toBeVisible();
  });

  test('collapsed folder outside edit mode: a click still opens it and there is no handle', async ({ page, context }) => {
    const f = await itemsDash(page, context);
    await page.goto(f.path);
    await expect(page.locator(`[data-node-id="${f.id('box')}"]`)).toBeVisible();
    await expect(page.locator('[data-edit-handle]')).toHaveCount(0);
    await page.locator(`[data-node-id="${f.id('box')}"]`).click({ position: { x: 30, y: 60 } });
    await expect(page.getByRole('dialog', { name: 'Box' })).toBeVisible();
  });

  test('tab: the handle, a double-click and the menu all edit it; the menu also duplicates and deletes', async ({ page, context }) => {
    const f = await itemsDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    // The old per-tab pencil, duplicate and delete buttons are gone.
    await expect(page.locator('.tab-control-btn')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Duplicate Two tab' })).toHaveCount(0);
    const tab = page.getByRole('tab', { name: 'Switch to Two tab' });
    await editsThreeWays(page, {
      item: tab,
      handle: 'Edit Two tab',
      dialog: 'Edit Tab',
      field: page.getByRole('dialog').getByLabel(/Tab Name/),
      value: 'Two'
    });
    // The double-click's clicks switched to the tab — harmless, and still the tab edited.
    await expect(tab).toHaveAttribute('aria-selected', 'true');

    // Duplicate from the menu: the copy is shown.
    await tab.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Tab actions: Two' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Edit', 'Duplicate', 'Delete']);
    await menu.getByRole('menuitem', { name: 'Duplicate' }).click();
    const copy = page.getByRole('tab', { name: 'Switch to Two (Copy) tab' });
    await expect(copy).toHaveAttribute('aria-selected', 'true');
    // Delete from the menu (asks first).
    await copy.click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await expect(copy).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(2);
  });
});

// ---- §4B fix round 1: nested handles never overlap; touch shows them without hover

/** An untitled folder (showTitle false) with a tile in its top-right corner, and a tile beside it. */
async function nestedDash(page: Page, context: BrowserContext) {
  return importDash(page, context, [{
    name: 'Main',
    children: (id) => [
      tile(id('out'), 'Outside', 0, 0),
      {
        id: id('nf'), kind: 'folder', name: 'Plain', layout: 'inherit', display: 'expanded', shape: 'rounded',
        showTitle: false, placement: placement(2, 1, 4, 3),
        content: { columns: 4, children: [tile(id('corner'), 'Corner', 3, 0)] }
      }
    ]
  }]);
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe('§4B handles: innermost only, never overlapping', () => {
  test('an untitled folder with a tile in its top-right corner: the tile\'s handle edits the tile', async ({ page, context }) => {
    const f = await nestedDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    const corner = page.locator(`[data-node-id="${f.id('corner')}"]`);
    const tileHandle = page.getByRole('button', { name: 'Edit Corner', exact: true });
    const folderHandle = page.getByRole('button', { name: 'Edit Plain', exact: true });
    await corner.hover({ position: { x: 20, y: 40 } });
    // Only the innermost hovered item shows its handle.
    await expect(tileHandle).toHaveCSS('opacity', '1');
    await expect(folderHandle).toHaveCSS('opacity', '0');
    const tb = (await tileHandle.boundingBox())!;
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('input#name')).toHaveValue('Corner');
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
    // The folder's own handle (on its frame, outside its content) still edits the folder.
    // (Closing the dialog returns focus to the tile's handle, which keeps it shown: drop that focus.)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const nf = page.locator(`[data-node-id="${f.id('nf')}"]`);
    await nf.hover({ position: { x: 4, y: 60 } });
    await expect(folderHandle).toHaveCSS('opacity', '1');
    await expect(tileHandle).toHaveCSS('opacity', '0');
    await folderHandle.click();
    const fdlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(fdlg.locator('#folder-name')).toHaveValue('Plain');
    await fdlg.getByRole('button', { name: 'Cancel', exact: true }).click();
    // Never overlapping, whatever is shown.
    expect(overlaps((await folderHandle.boundingBox())!, (await tileHandle.boundingBox())!)).toBe(false);
  });
});

test.describe('§4B handles on a touch device (hover: none)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1280, height: 900 } });

  test('every handle is shown without hovering, none overlap, and a tap on the tile\'s edits the tile', async ({ page, context }) => {
    const f = await nestedDash(page, context);
    await page.goto(f.path);
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
    await page.getByRole('button', { name: 'Enter Edit Mode' }).tap();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    const names = ['Edit Outside', 'Edit Corner', 'Edit Plain', 'Edit Main tab'];
    const boxes: Box[] = [];
    for (const n of names) {
      const h = page.getByRole('button', { name: n, exact: true });
      await expect(h).toHaveCSS('opacity', '1');
      boxes.push((await h.boundingBox())!);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlaps(boxes[i], boxes[j]), `${names[i]} vs ${names[j]}`).toBe(false);
    await page.getByRole('button', { name: 'Edit Corner', exact: true }).tap();
    const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('input#name')).toHaveValue('Corner');
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await page.getByRole('button', { name: 'Edit Plain', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: 'Edit Folder' }).locator('#folder-name')).toHaveValue('Plain');
  });
});
