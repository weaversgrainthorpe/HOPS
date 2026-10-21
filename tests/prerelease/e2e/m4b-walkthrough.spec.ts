import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCsrfToken, login, signInDialog, setSetting } from '../helpers';
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

// These tests sign in through the UI (some with a wrong password on purpose). The failed-login
// limit is per IP per minute and api/boundaries.spec exhausts it on purpose just before, so each
// test raises it for itself and puts the stored value back afterwards.
const RATE_LIMIT_KEY = 'auth.login_rate_limit_per_min';
let rateLimitBefore: string | null = null;
test.beforeEach(async ({ page }) => {
  rateLimitBefore = await setSetting(page, RATE_LIMIT_KEY, '1000');
});
test.afterEach(async ({ page }) => {
  if (rateLimitBefore === null) return;
  const v = rateLimitBefore;
  rateLimitBefore = null;
  await setSetting(page, RATE_LIMIT_KEY, v);
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

// ---- Escape closes edit dialogs (pre-existing bug: Modal stopped every keydown, so its
// window-level Escape never ran in a real browser). Innermost first; no other key leaks.

test.describe('Escape in edit dialogs (real browser)', () => {
  async function escDash(page: Page, context: BrowserContext) {
    return importDash(page, context, [
      { name: 'Main', children: (id) => [tile(id('a'), 'Alpha', 0, 0), tile(id('b'), 'Bravo', 1, 0)] },
      { name: 'Two', children: (id) => [tile(id('t2'), 'Tango')] }
    ]);
  }

  test('Escape closes the tile dialog without saving; arrow keys and Delete stay inside it', async ({ page, context }) => {
    const f = await escDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    const a = page.locator(`[data-node-id="${f.id('a')}"]`);
    await a.click(); // selected: a Delete reaching the page would delete it
    await a.dblclick();
    const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
    await expect(dlg).toBeVisible();
    await dlg.locator('input#name').fill('Alpha changed');
    // Arrow keys and Delete on a button inside the dialog stay inside it.
    const cancel = dlg.getByRole('button', { name: 'Cancel', exact: true });
    await cancel.focus();
    for (const k of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Delete']) await page.keyboard.press(k);
    await expect(dlg).toBeVisible();
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await expect(a).toBeVisible();
    // Escape (focus in a text field): closes it, nothing applied.
    await dlg.locator('input#name').focus();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(a).toContainText('Alpha');
    await expect(a).not.toContainText('Alpha changed');
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
  });

  test('nested: Escape closes only the innermost (icon picker, then icon editor, then the tile dialog)', async ({ page, context }) => {
    const f = await escDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    await page.locator(`[data-node-id="${f.id('a')}"]`).dblclick();
    const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
    await dlg.getByRole('button', { name: /Edit icon/ }).click();
    const iconDlg = page.getByRole('dialog', { name: 'Edit icon' });
    await expect(iconDlg).toBeVisible();
    await iconDlg.getByRole('button', { name: /Browse/ }).click();
    const picker = page.getByRole('dialog', { name: 'Choose an Icon' });
    await expect(picker).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[aria-labelledby="icon-picker-title"]'))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(iconDlg).toBeVisible();
    await expect(dlg).toBeVisible();
    await iconDlg.locator('#icon-edit-input').focus();
    await page.keyboard.press('Escape');
    await expect(iconDlg).toHaveCount(0);
    await expect(dlg).toBeVisible();
    await dlg.locator('input#name').focus();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
  });

  test('nested: Escape in the tab background picker closes the picker, then the tab dialog', async ({ page, context }) => {
    const f = await escDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    await page.getByRole('tab', { name: 'Switch to Two tab' }).dblclick();
    const dlg = page.getByRole('dialog', { name: 'Edit Tab' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: /Configure Tab Background/ }).click();
    const picker = page.getByRole('dialog', { name: 'Tab background' });
    await expect(picker).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[aria-labelledby="background-config-title"]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(dlg).toBeVisible();
    await dlg.getByLabel(/Tab Name/).focus();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible(); // edit mode stays on
  });

  test('Escape closes the dashboard dialog and discards its edits', async ({ page, context }) => {
    const f = await escDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    await page.getByRole('button', { name: 'Edit Dashboard' }).click();
    const dlg = page.getByRole('dialog', { name: 'Edit Dashboard' });
    await expect(dlg).toBeVisible();
    await dlg.getByLabel(/Custom Title/).fill('Never applied');
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
    await expect(page.getByText('Never applied')).toHaveCount(0);
  });
});

// ---- §4C: one dashboard dialog (Header, Background, Settings), one Save, one undo step

test.describe('§4C one dashboard dialog', () => {
  async function dash(page: Page, context: BrowserContext) {
    return importDash(page, context, [{ name: 'Main', children: (id) => [tile(id('a'), 'Alpha')] }]);
  }

  test('the three old buttons are gone; one labelled "Dashboard" pencil opens one dialog with three sections', async ({ page, context }) => {
    const f = await dash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    for (const t of ['Configure Background', 'Configure Header', 'Dashboard settings']) {
      await expect(page.getByTitle(t, { exact: true })).toHaveCount(0);
    }
    const handle = page.getByRole('button', { name: 'Edit Dashboard' });
    await expect(handle).toBeVisible();
    await expect(handle).toHaveText('Dashboard');
    await expect(handle).toHaveCSS('opacity', '1');
    await handle.click();
    const dlg = page.getByRole('dialog', { name: 'Edit Dashboard' });
    await expect(dlg.getByRole('tab')).toHaveText(['Header', 'Background', 'Settings']);
  });

  test('a header title and a background preset in one Save: one undo step; both persist after the toolbar Save and a reload', async ({ page, context }) => {
    const f = await dash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    await page.getByRole('button', { name: 'Edit Dashboard' }).click();
    const dlg = page.getByRole('dialog', { name: 'Edit Dashboard' });
    await dlg.getByLabel(/Custom Title/).fill('Walkthrough Title');
    await dlg.getByRole('tab', { name: 'Background' }).click();
    await dlg.getByRole('button', { name: /^Image$/ }).click();
    const card = dlg.locator('.image-card:has(img[src="/presets/network-grid.jpg"])');
    await card.click();
    await expect(dlg.locator('.image-card.selected img')).toHaveAttribute('src', '/presets/network-grid.jpg');
    await dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('nav').getByText('Walkthrough Title')).toBeVisible();

    // One undo step for both.
    const bar = page.getByRole('toolbar', { name: 'Editing' });
    await bar.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('nav').getByText('Walkthrough Title')).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await bar.getByRole('button', { name: 'Redo' }).click();
    await expect(page.locator('nav').getByText('Walkthrough Title')).toBeVisible();

    await bar.getByRole('button', { name: /Save/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('nav').getByText('Walkthrough Title')).toBeVisible();
    const cfg = await (await page.request.get('/api/config')).json();
    const stored = cfg.dashboards.find((d: { id: string }) => d.id === f.id('dash'));
    expect(stored.header?.centerTitle).toBe('Walkthrough Title');
    expect(stored.background?.type).toBe('image');
    expect(stored.background?.value).toBe('/presets/network-grid.jpg');
  });

  test('a failed settings save: the error shows in the dialog, it stays open, and the draft is untouched', async ({ page, context }) => {
    const f = await dash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    await page.route(`**/api/dashboards/*/settings`, (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'disk full' }) })
        : route.continue()
    );
    await page.getByRole('button', { name: 'Edit Dashboard' }).click();
    const dlg = page.getByRole('dialog', { name: 'Edit Dashboard' });
    await dlg.getByLabel(/Custom Title/).fill('Not Yet');
    await dlg.getByRole('tab', { name: 'Settings' }).click();
    await dlg.getByLabel('Override for this dashboard: Edit mode idle timeout (minutes)').check();
    await dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dlg.getByRole('alert').filter({ hasText: /disk full|settings/i }).first()).toBeVisible();
    await expect(dlg).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
    await expect(page.locator('nav').getByText('Not Yet')).toHaveCount(0);
    // Cancel discards everything.
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
  });
});

// ---- §4D: Settings is the admin home; "/" shows a dashboard
test.describe('§4D Settings is the admin home; / shows a dashboard', () => {
  /** A fresh browser context with no session (logged out), same server. */
  async function anonPage(browser: Browser): Promise<{ page: Page; ctx: BrowserContext }> {
    const ctx = await browser.newContext({
      baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }
    });
    return { page: await ctx.newPage(), ctx };
  }

  /** The first dashboard in display order, as the server stores it. */
  async function firstDashboard(page: Page): Promise<{ id: string; path: string; name: string }> {
    const cfg = await (await page.request.get('/api/config')).json();
    const all = cfg.dashboards.map((d: { order?: number }, i: number) => ({ d, i, k: typeof d.order === 'number' ? d.order : Infinity }));
    all.sort((a: { k: number; i: number }, b: { k: number; i: number }) => (a.k === b.k ? a.i - b.i : a.k - b.k));
    expect(all.length, 'the server has at least one dashboard').toBeGreaterThan(0);
    return all[0].d;
  }

  test('logged out, the gear opens Settings with the sign-in dialog in place; a wrong password stays in the dialog', async ({ page, context, browser }) => {
    const f = await importDash(page, context, [{ name: 'Main', children: (id) => [tile(id('a'), 'Alpha')] }]);
    const { page: anon, ctx } = await anonPage(browser);
    try {
      await anon.goto(f.path);
      await expect(anon.locator(`[data-node-id="${f.id('a')}"]`)).toBeVisible();
      await expect(anon.getByRole('button', { name: 'Log out' })).toHaveCount(0);
      await anon.getByRole('link', { name: 'Settings' }).click();
      await expect(anon).toHaveURL(/\/settings$/);
      const dlg = anon.getByRole('dialog', { name: 'Sign in' });
      await expect(dlg).toBeVisible();
      await expect(dlg).toContainText('Sign in to open Settings.');
      await expect(dlg.getByLabel('Username')).toBeFocused();
      // Nothing admin shows behind the dialog.
      await expect(anon.getByRole('heading', { name: 'Global settings' })).toHaveCount(0);

      // A wrong password: the reason shows once, in the dialog (no second copy in a toast), and
      // the cursor is back in the password field.
      await dlg.getByLabel('Username').fill(ADMIN_USERNAME);
      await dlg.getByLabel('Password').fill('definitely-wrong');
      await dlg.getByLabel('Password').press('Enter');
      await expect(dlg.getByRole('alert')).toContainText('check your username and password');
      await expect(anon.locator('.toast-error')).toHaveCount(0);
      await expect(dlg.getByLabel('Password')).toBeFocused();
      await expect(dlg).toBeVisible();

      // The right one: Settings, in place.
      await dlg.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
      await dlg.getByLabel('Password').press('Enter');
      await expect(dlg).toHaveCount(0);
      await expect(anon).toHaveURL(/\/settings$/);
      for (const h of ['Dashboards', 'Global settings', 'Discovery', 'Backups', 'Password', 'Factory reset', 'Log out']) {
        await expect(anon.getByRole('heading', { name: h, level: 2, exact: true })).toBeVisible();
      }
      await expect(anon.getByRole('heading', { name: `M4 walkthrough ${f.path.slice(1)}`, level: 3 })).toBeVisible();
      await expect(anon.getByRole('button', { name: 'Log out' }).first()).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('Cancel on the Settings sign-in goes back to the dashboard you came from', async ({ page, context, browser }) => {
    const f = await importDash(page, context, [{ name: 'Main', children: (id) => [tile(id('a'), 'Alpha')] }]);
    const { page: anon, ctx } = await anonPage(browser);
    try {
      await anon.goto(f.path);
      await expect(anon.locator(`[data-node-id="${f.id('a')}"]`)).toBeVisible();
      await anon.getByRole('link', { name: 'Settings' }).click();
      const dlg = anon.getByRole('dialog', { name: 'Sign in' });
      await expect(dlg).toBeVisible();
      await dlg.getByRole('button', { name: 'Cancel' }).click();
      await expect(dlg).toHaveCount(0);
      await expect(anon).toHaveURL(new RegExp(`${f.path}$`));
      await expect(anon.locator(`[data-node-id="${f.id('a')}"]`)).toBeVisible();
      const check = await (await anon.request.get('/api/auth/check')).json();
      expect(check.authenticated).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  test('"/" lands on the first dashboard (logged in and logged out), replacing itself in history', async ({ page, browser }) => {
    const first = await firstDashboard(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Global settings', level: 2 })).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`${first.path}$`));
    await expect(page.locator('.center-title')).toHaveText(first.name);
    // "/" replaced itself: Back goes to the page before it, not to "/" (which would forward again).
    await page.goBack();
    await expect(page).toHaveURL(/\/settings$/);

    const { page: anon, ctx } = await anonPage(browser);
    try {
      await anon.goto('/');
      await expect(anon).toHaveURL(new RegExp(`${first.path}$`));
      await expect(anon.locator('.center-title')).toHaveText(first.name);
    } finally {
      await ctx.close();
    }
  });

  test('with zero dashboards "/" says "No dashboards yet" and its button opens Settings', async ({ page, context }) => {
    // Keep every dashboard (the export), delete them all, and put them back afterwards.
    const exp = await page.request.get('/api/config/export');
    expect(exp.status()).toBe(200);
    const bundle = await exp.json();
    const ids: string[] = bundle.config.dashboards.map((d: { id: string }) => d.id);
    expect(ids.length).toBeGreaterThan(0);
    try {
      for (const id of ids) {
        const cfg = await (await page.request.get('/api/config')).json();
        const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
        const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
          headers: { 'X-CSRF-Token': await getCsrfToken(context) }
        });
        expect(r.ok(), `delete ${id}: ${r.status()} ${await r.text()}`).toBeTruthy();
      }
      expect((await (await page.request.get('/api/config')).json()).dashboards).toEqual([]);

      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'No dashboards yet' })).toBeVisible();
      await expect(page).toHaveURL(/\/$/);
      await page.getByRole('button', { name: 'Open Settings' }).click();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole('heading', { name: 'Global settings', level: 2 })).toBeVisible();
      await expect(page.getByRole('button', { name: 'New Dashboard' })).toBeVisible();
    } finally {
      const r = await page.request.post('/api/config/import', {
        headers: { 'X-CSRF-Token': await getCsrfToken(context) },
        multipart: { file: { name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) } }
      });
      expect(r.status(), `restore: ${await r.text()}`).toBe(200);
      const after = (await (await page.request.get('/api/config')).json()).dashboards.map((d: { id: string }) => d.id);
      expect(after.sort()).toEqual([...ids].sort());
    }
  });

  test('Log out: from the navbar it stays on the dashboard, signed out; from Settings it leaves Settings', async ({ page, context, browser }) => {
    const f = await importDash(page, context, [{ name: 'Main', children: (id) => [tile(id('a'), 'Alpha')] }]);
    // Its own session: logging out must not end the shared one the other tests use.
    const { page: own, ctx } = await anonPage(browser);
    try {
      await login(own);
      await own.goto(f.path);
      await expect(own.locator(`[data-node-id="${f.id('a')}"]`)).toBeVisible();
      await own.getByRole('button', { name: 'Log out' }).click();
      await expect(own.getByRole('button', { name: 'Log out' })).toHaveCount(0);
      await expect(own).toHaveURL(new RegExp(`${f.path}$`));
      await expect(own.locator(`[data-node-id="${f.id('a')}"]`)).toBeVisible();
      await expect(own.getByRole('button', { name: 'Enter Edit Mode' })).toHaveAttribute('title', 'Sign in to edit this dashboard');
      expect((await (await own.request.get('/api/auth/check')).json()).authenticated).toBe(false);

      // Again, from the Settings section: Settings is left (no sign-in dialog pops up).
      await own.goto('/settings');
      await signInDialog(own);
      await expect(own.getByRole('heading', { name: 'Log out', level: 2 })).toBeVisible();
      await own.locator('#logout').getByRole('button', { name: 'Log out' }).click();
      await expect(own).not.toHaveURL(/\/settings$/);
      await expect(own.getByRole('dialog', { name: 'Sign in' })).toHaveCount(0);
      await expect(own.getByRole('button', { name: 'Log out' })).toHaveCount(0);
      expect((await (await own.request.get('/api/auth/check')).json()).authenticated).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  test('logged out from an admin page: Cancel on the Settings sign-in leaves for a dashboard, and Back does not loop', async ({ page, browser }) => {
    const first = await firstDashboard(page);
    const { page: anon, ctx } = await anonPage(browser);
    try {
      await anon.goto(first.path);
      await expect(anon.locator('.center-title')).toHaveText(first.name);
      await anon.goto('/admin/discovery');
      await expect(anon).toHaveURL(/\/settings$/);
      const dlg = anon.getByRole('dialog', { name: 'Sign in' });
      await expect(dlg).toBeVisible();
      await dlg.getByRole('button', { name: 'Cancel' }).click();
      await expect(anon).toHaveURL(new RegExp(`${first.path}$`));
      await expect(anon.getByRole('dialog', { name: 'Sign in' })).toHaveCount(0);
      // Back: the redirect replaced /admin/discovery, so it never sends you into it again.
      await anon.goBack();
      await expect(anon).not.toHaveURL(/\/admin\/discovery$/);
      if (/\/settings$/.test(anon.url())) {
        await anon.getByRole('dialog', { name: 'Sign in' }).getByRole('button', { name: 'Cancel' }).click();
        await expect(anon).not.toHaveURL(/\/(settings|admin\/discovery)$/);
      }
    } finally {
      await ctx.close();
    }
  });

  test('an expired session on Settings asks for the password again in place (no redirect)', async ({ browser }) => {
    const { page: own, ctx } = await anonPage(browser);
    try {
      await login(own);
      const csrf = (await ctx.cookies()).find((c) => c.name === 'hops_csrf')!.value;
      const out = await own.request.post('/api/auth/logout', { headers: { 'X-CSRF-Token': csrf } });
      expect(out.ok()).toBeTruthy();
      // The next request finds out (401): a setting save, which must not be stored.
      const input = own.locator('[id="setting-auth.login_rate_limit_per_min"]');
      const before = await input.inputValue();
      await input.fill(String(Number(before) - 1));
      await own.locator('.row', { has: input }).getByRole('button', { name: 'Save', exact: true }).click();
      const dlg = own.getByRole('dialog', { name: 'Sign in' });
      await expect(dlg).toBeVisible();
      await own.waitForTimeout(1000); // the old handler left after 300 ms
      await expect(own).toHaveURL(/\/settings$/);
      await expect(dlg).toBeVisible();
      await signInDialog(own);
      await expect(own.getByRole('heading', { name: 'Global settings', level: 2 })).toBeVisible();
      await expect(own.locator('[id="setting-auth.login_rate_limit_per_min"]')).toHaveValue(before);
    } finally {
      await ctx.close();
    }
  });

  test('with 8 dashboards at 1280px the navbar keeps the pencil, gear and Log out clickable; the page is no wider than the screen', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dashes = [];
    for (let i = 0; i < 8; i++) {
      dashes.push(await importDash(page, context, [{ name: 'Main', children: (id) => [tile(id('a'), `Tile ${i}`)] }]));
    }
    const f = dashes[7];
    await page.goto(f.path);
    await expect(page.locator(`[data-node-id="${f.id('a')}"]`)).toBeVisible();
    const pencil = page.getByRole('button', { name: 'Enter Edit Mode' });
    // trial: every actionability check, including that nothing else receives the click.
    await pencil.click({ trial: true, timeout: 3000 });
    await page.getByRole('link', { name: 'Settings' }).click({ trial: true, timeout: 3000 });
    await page.getByRole('button', { name: 'Log out' }).click({ trial: true, timeout: 3000 });
    const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
    expect(widths.doc).toBeLessThanOrEqual(widths.view);
    // Nothing in the bar overlaps: logo/version, the links strip, the title, the controls.
    const checkBar = async () => {
      const boxes = await page.evaluate(() =>
        ['.logo', '.nav-links', '.center-title', '.nav-right'].map((sel) => {
          const r = document.querySelector(sel)!.getBoundingClientRect();
          return { sel, left: r.left, right: r.right, width: r.width };
        })
      );
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].left, `${boxes[i].sel} starts after ${boxes[i - 1].sel} ends`).toBeGreaterThanOrEqual(boxes[i - 1].right - 0.5);
      }
      expect(boxes[1].width, 'the dashboard links keep a visible strip').toBeGreaterThan(100);
    };
    await checkBar();
    // The strip scrolls, with a plain (vertical) mouse wheel too.
    const strip = page.locator('.nav-links');
    await strip.hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    // Every dashboard link is still reachable (the links scroll), and the pencil really works.
    for (const d of dashes) {
      await expect(page.locator(`.nav-link[href="${d.path}"]`)).toHaveCount(1);
    }
    await pencil.click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    const editWidths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
    expect(editWidths.doc).toBeLessThanOrEqual(editWidths.view);
    await checkBar();
    await page.getByRole('link', { name: 'Settings' }).click({ trial: true, timeout: 3000 });
    await page.getByRole('button', { name: 'Log out' }).click({ trial: true, timeout: 3000 });
    // A link scrolled into its strip still opens its dashboard.
    await page.getByRole('button', { name: 'Exit Edit Mode' }).click();
    await page.locator(`.nav-link[href="${dashes[0].path}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${dashes[0].path}$`));
    await expect(page.locator(`[data-node-id="${dashes[0].id('a')}"]`)).toBeVisible();
  });

  test('logged out, /admin/discovery sends you to Settings to sign in', async ({ browser }) => {
    const { page: anon, ctx } = await anonPage(browser);
    try {
      await anon.goto('/admin/discovery');
      await expect(anon).toHaveURL(/\/settings$/);
      await expect(anon.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});

