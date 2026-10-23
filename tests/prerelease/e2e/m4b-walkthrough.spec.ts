import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCsrfToken, login, longPress, signInDialog, setSetting } from '../helpers';
import { ADMIN_USERNAME, ADMIN_TEST_PASSWORD } from '../constants';

// M4 walkthrough changes (design/specs/2026-10-21-hops-v3-m4-walkthrough-changes-design.md §1–3, §6),
// in a REAL browser: selection rendering, compositing (pixels) and layout need Chromium.

let seq = 0;
const made: string[] = [];

const placement = (x: number, y: number, w = 2, h = 2) => ({ x, y, w, h });
type Child = Record<string, unknown>;

// The M5 stored form (layoutVersion 1): 24-column grid tabs; a tab tile is exactly its Size's span;
// folder contents are an ordered list with no placements; folders carry size and contentSize.
const SPAN: Record<string, number> = { small: 1, medium: 2, large: 4 };
/** A tile as it sits inside a folder: no placement. */
const kid = (id: string, name: string, extra: Child = {}): Child => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, ...extra
});
/** A tile on a tab at cell (x, y) of the 24-column grid, its Size's span each way. */
const tile = (id: string, name: string, x = 0, y = 0, extra: Child = {}): Child => {
  const t = kid(id, name, extra);
  const s = SPAN[String(t.size)] ?? 2;
  return { placement: placement(x, y, s, s), ...t };
};
/** A folder on a tab (`box` in cells) or inside a folder (`box` null). */
const folder = (id: string, name: string, box: ReturnType<typeof placement> | null, children: Child[], extra: Child = {}): Child => ({
  id, kind: 'folder', name, display: 'expanded', shape: 'rounded', showTitle: true, size: 'medium', contentSize: 'medium',
  ...(box ? { placement: box } : {}), content: { children }, ...extra
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
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: tabs.map((t, i) => ({
      id: id(`tab${i}`), name: t.name, order: i, root: { columns: 24, children: t.children(id) }
    }))
  };
  if (opts.background) dash.background = opts.background;
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 1, dashboards: [dash] }
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
        tile(id('anchor'), 'Anchor', 22, 0),
        folder(id('fold'), 'Folder', placement(0, 2, 8, 6), [kid(id('in'), 'Inner')])
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
        tile(id('faint'), 'Faint', 0, 0, { size: 'large', color: '#0000ff', opacity: 0.2 }),
        tile(id('solid'), 'Solid', 8, 0, { size: 'large', color: '#0000ff', opacity: 1 })
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

  // (Was the Showcase's Free tab, the short tab with a picture. Free tabs are gone (M5) and the M5 Showcase's
  // tabs are all long, so the short tab with a picture is its own dashboard here.)
  test('the panel reaches the bottom of the screen on a short tab with a background picture, in view and edit mode', async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const f = await importDash(page, context, [
      { name: 'Long', children: (id) => [tile(id('first'), 'First', 0, 0), tile(id('far'), 'Far', 0, 40)] },
      { name: 'Short', children: (id) => [tile(id('a'), 'Alpha', 2, 2), tile(id('big'), 'Big', 8, 2, { size: 'large' })] }
    ], { background: { type: 'image', value: '/presets/galaxy.jpg', fit: 'cover', overlayOpacity: 0, overlayBlur: 0, opacity: 0.6 } });
    await page.goto(f.path);
    await page.getByRole('tab', { name: 'Switch to Short tab' }).click();
    await expect(page.getByRole('tab', { name: 'Switch to Short tab' })).toHaveAttribute('aria-selected', 'true');
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
      children: (id) => [tile(id('first'), 'First', 0, 0), tile(id('last'), 'Last', 0, 80)]
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
          folder(id('grp'), 'Group', placement(4, 0, 8, 6), [kid(id('in'), 'Inner')]),
          folder(id('box'), 'Box', placement(16, 0, 8, 6), [kid(id('bx'), 'Boxed')], { display: 'collapsed' })
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

  test('collapsed folder: the handle, a double-click and the menu edit it; "Open" in its menu opens it in place', async ({ page, context }) => {
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
    await expect(item).toHaveClass(/collapsed/);
    await item.click({ button: 'right', position: { x: 30, y: 60 } });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Open', exact: true }).click();
    // M5 §3a.8: in place (edit mode: its saved default), never a pop-over.
    await expect(item).toHaveAttribute('role', 'group');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  test('collapsed folder outside edit mode: a click opens it in place and there is no handle', async ({ page, context }) => {
    const f = await itemsDash(page, context);
    await page.goto(f.path);
    await expect(page.locator(`[data-node-id="${f.id('box')}"]`)).toBeVisible();
    await expect(page.locator('[data-edit-handle]')).toHaveCount(0);
    await page.locator(`[data-node-id="${f.id('box')}"]`).click({ position: { x: 30, y: 60 } });
    await expect(page.getByRole('group', { name: 'Box folder' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
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
      folder(id('nf'), 'Plain', placement(4, 2, 8, 6), [kid(id('corner'), 'Corner')], { showTitle: false })
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
      { name: 'Main', children: (id) => [tile(id('a'), 'Alpha', 0, 0), tile(id('b'), 'Bravo', 2, 0)] },
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

  test('with zero dashboards "/" says "No dashboards yet" and its button opens Settings (logged in and logged out)', async ({ page, context, browser }) => {
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

      // Logged out: the same empty state; its button opens Settings, which signs in in place.
      const { page: anon, ctx } = await anonPage(browser);
      try {
        await anon.goto('/');
        await expect(anon.getByRole('heading', { name: 'No dashboards yet' })).toBeVisible();
        await expect(anon).toHaveURL(/\/$/);
        await anon.getByRole('button', { name: 'Open Settings' }).click();
        await expect(anon).toHaveURL(/\/settings$/);
        await expect(anon.getByRole('heading', { name: 'Global settings', level: 2 })).toHaveCount(0);
        await signInDialog(anon);
        await expect(anon).toHaveURL(/\/settings$/);
        await expect(anon.getByRole('heading', { name: 'Global settings', level: 2 })).toBeVisible();
        await expect(anon.getByRole('button', { name: 'New Dashboard' })).toBeVisible();
      } finally {
        await ctx.close();
      }
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

  test('with 8 dashboards at 1280px the navbar keeps the pencil, gear and Log out clickable; the page is no wider than the screen; More holds the rest', async ({ page, context }) => {
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
    // Nothing in the bar overlaps: logo/version, the dashboard links (and More), the title, the controls.
    const checkBar = async () => {
      const boxes = await page.evaluate(() =>
        ['.logo', '.nav-dash', '.center-title', '.nav-right'].map((sel) => {
          const r = document.querySelector(sel)!.getBoundingClientRect();
          return { sel, left: r.left, right: r.right, width: r.width };
        })
      );
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].left, `${boxes[i].sel} starts after ${boxes[i - 1].sel} ends`).toBeGreaterThanOrEqual(boxes[i - 1].right - 0.5);
      }
    };
    await checkBar();
    // Ruling 12 (M5 walkthrough 1): no scrolling strip — the links that fit, then "More" for the rest.
    const strip = page.locator('.nav-links');
    if (await strip.count()) expect(await strip.evaluate((el) => getComputedStyle(el).overflowX)).not.toMatch(/auto|scroll/);
    const more = page.getByRole('button', { name: 'More dashboards' });
    await expect(more).toBeVisible();
    // Every dashboard link is still reachable (shown, or in More), and the pencil really works.
    const shown = await page.locator('.nav-links > .nav-link').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    await more.click();
    const inMore = await page.getByRole('menu', { name: 'More dashboards' }).getByRole('menuitem').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    await page.keyboard.press('Escape');
    for (const d of dashes) {
      expect([...shown, ...inMore].filter((h) => h === d.path), `${d.path} is one click away`).toHaveLength(1);
    }
    await pencil.click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    const editWidths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
    expect(editWidths.doc).toBeLessThanOrEqual(editWidths.view);
    await checkBar();
    await page.getByRole('link', { name: 'Settings' }).click({ trial: true, timeout: 3000 });
    await page.getByRole('button', { name: 'Log out' }).click({ trial: true, timeout: 3000 });
    // A link in the More menu still opens its dashboard: one of these 8 that IS in the menu (which
    // ones are depends on how many links fit, so none is assumed).
    await page.getByRole('button', { name: 'Exit Edit Mode' }).click();
    await more.click();
    const inMenu = await page.getByRole('menu', { name: 'More dashboards' }).getByRole('menuitem').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    const pick = dashes.find((d) => inMenu.includes(d.path) && d !== f);
    expect(pick, 'one of the 8 (not the current one) is in the More menu').toBeTruthy();
    await page.getByRole('menu', { name: 'More dashboards' }).locator(`[href="${pick!.path}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${pick!.path}$`));
    await expect(page.locator(`[data-node-id="${pick!.id('a')}"]`)).toBeVisible();
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


test.describe('one sign-in dialog at a time: navigating closes the pencil\'s', () => {
  async function anonPage(browser: Browser): Promise<{ page: Page; ctx: BrowserContext }> {
    const ctx = await browser.newContext({
      baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }
    });
    return { page: await ctx.newPage(), ctx };
  }

  test('pencil dialog open, then Back to /settings: only Settings\' dialog, and its Sign in button signs in', async ({ page, context, browser }) => {
    const f = await importDash(page, context, [{ name: 'Main', children: (id) => [tile(id('a'), 'Alpha')] }]);
    const { page: anon, ctx } = await anonPage(browser);
    try {
      await anon.goto(f.path);
      await expect(anon.locator(`[data-node-id="${f.id('a')}"]`)).toBeVisible();
      // Client-side history: dashboard → /settings → (Cancel) dashboard.
      await anon.getByRole('link', { name: 'Settings' }).click();
      await expect(anon).toHaveURL(/\/settings$/);
      await anon.getByRole('dialog', { name: 'Sign in' }).getByRole('button', { name: 'Cancel' }).click();
      await expect(anon).toHaveURL(new RegExp(`${f.path}$`));
      await expect(anon.getByRole('dialog', { name: 'Sign in' })).toHaveCount(0);

      await anon.getByRole('button', { name: 'Enter Edit Mode' }).click();
      const dlg = anon.getByRole('dialog', { name: 'Sign in' });
      await expect(dlg).toHaveCount(1);
      await expect(dlg).toContainText('Sign in to edit this dashboard.');

      await anon.goBack();
      await expect(anon).toHaveURL(/\/settings$/);
      await expect(dlg).toHaveCount(1);
      await expect(dlg).toContainText('Sign in to open Settings.');
      expect(await anon.locator('form').count(), 'one sign-in form in the page').toBe(1);

      // The footer's Sign in button (not Enter) submits this dialog's own form.
      await dlg.getByLabel('Username').fill(ADMIN_USERNAME);
      await dlg.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
      await dlg.getByRole('button', { name: 'Sign in' }).click();
      await expect(dlg).toHaveCount(0);
      await expect(anon.getByRole('heading', { name: 'Global settings', level: 2 })).toBeVisible();
      await expect(anon).toHaveURL(/\/settings$/);
      await expect(anon.getByText("There's no dashboard here to edit")).toHaveCount(0);
      await expect(anon.getByRole('toolbar', { name: 'Editing' })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('pencil dialog open, then Back to another dashboard: no dialog; the pencil there edits that one', async ({ page, context, browser }) => {
    const a = await importDash(page, context, [{ name: 'Main', children: (id) => [tile(id('a'), 'Alpha')] }]);
    const b = await importDash(page, context, [{ name: 'Main', children: (id) => [tile(id('b'), 'Bravo')] }]);
    const { page: anon, ctx } = await anonPage(browser);
    try {
      await anon.goto(a.path);
      await expect(anon.locator(`[data-node-id="${a.id('a')}"]`)).toBeVisible();
      // A client-side navigation to B (logged out the navbar has no dashboard links): an ordinary
      // same-origin link, which SvelteKit routes in place.
      await anon.evaluate((href) => {
        const link = document.createElement('a');
        link.href = href;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }, b.path);
      await expect(anon).toHaveURL(new RegExp(`${b.path}$`));
      await expect(anon.locator(`[data-node-id="${b.id('b')}"]`)).toBeVisible();

      await anon.getByRole('button', { name: 'Enter Edit Mode' }).click();
      await expect(anon.getByRole('dialog', { name: 'Sign in' })).toHaveCount(1);
      await anon.goBack();
      await expect(anon).toHaveURL(new RegExp(`${a.path}$`));
      await expect(anon.locator(`[data-node-id="${a.id('a')}"]`)).toBeVisible();
      await expect(anon.getByRole('dialog', { name: 'Sign in' })).toHaveCount(0);

      // Signing in from A's pencil edits A.
      await anon.getByRole('button', { name: 'Enter Edit Mode' }).click();
      const dlg = anon.getByRole('dialog', { name: 'Sign in' });
      await expect(dlg).toHaveCount(1);
      await dlg.getByLabel('Username').fill(ADMIN_USERNAME);
      await dlg.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
      await dlg.getByRole('button', { name: 'Sign in' }).click();
      await expect(dlg).toHaveCount(0);
      await expect(anon.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
      expect(new URL(anon.url()).pathname).toBe(a.path);
      await anon.locator(`[data-node-id="${a.id('a')}"]`).click({ button: 'right' });
      await anon.getByRole('menuitem', { name: 'Edit' }).click();
      await expect(anon.getByRole('dialog').locator('input#name')).toHaveValue('Alpha');
    } finally {
      await ctx.close();
    }
  });
});

test.describe('phones: the page is never wider than the screen', () => {
  const WIDTHS = [360, 375, 390];

  async function anonPage(browser: Browser): Promise<{ page: Page; ctx: BrowserContext }> {
    const ctx = await browser.newContext({
      baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }
    });
    return { page: await ctx.newPage(), ctx };
  }

  async function fits(p: Page, what: string) {
    const w = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
    expect(w.doc, `${what}: page ${w.doc}px wide on a ${w.view}px screen`).toBeLessThanOrEqual(w.view);
  }

  /** The element is shown and lies entirely inside the screen's width. */
  async function inside(p: Page, loc: ReturnType<Page['locator']>, what: string) {
    await expect(loc, what).toBeVisible();
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    const view = await p.evaluate(() => window.innerWidth);
    expect(box, what).not.toBeNull();
    expect(box!.x, `${what}: left edge`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${what}: right edge`).toBeLessThanOrEqual(view + 0.5);
  }

  test('logged in: a dashboard and /settings fit at 360, 375 and 390px; the gear and Log out stay reachable', async ({ page, context }) => {
    const f = await importDash(page, context, [{ name: 'Main', children: (id) => [tile(id('a'), 'Alpha')] }]);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(f.path);
      await expect(page.locator(`[data-node-id="${f.id('a')}"]`)).toBeVisible();
      await expect(page.locator('.admin-badge')).toHaveCount(1); // the logged-in navbar has rendered
      await fits(page, `${width}px, logged in, dashboard`);
      await inside(page, page.getByRole('link', { name: 'Settings' }), `${width}px dashboard: the gear`);
      const navLogout = page.locator('nav').getByRole('button', { name: 'Log out' });
      if (await navLogout.isVisible()) await inside(page, navLogout, `${width}px dashboard: navbar Log out`);

      await page.getByRole('link', { name: 'Settings' }).click();
      await expect(page.getByRole('heading', { name: 'Global settings', level: 2 })).toBeVisible();
      await fits(page, `${width}px, logged in, /settings`);
      // Log out is always reachable on a phone: in Settings (the navbar's may be hidden there).
      await inside(page, page.locator('#logout').getByRole('button', { name: 'Log out' }), `${width}px /settings: Log out`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await fits(page, `${width}px, logged in, /settings (after scrolling)`);
    }
  });

  test('logged out: a dashboard and /settings (with its sign-in dialog) fit at 360, 375 and 390px', async ({ page, context, browser }) => {
    const f = await importDash(page, context, [{ name: 'Main', children: (id) => [tile(id('a'), 'Alpha')] }]);
    const { page: anon, ctx } = await anonPage(browser);
    try {
      for (const width of WIDTHS) {
        await anon.setViewportSize({ width, height: 812 });
        await anon.goto(f.path);
        await expect(anon.locator(`[data-node-id="${f.id('a')}"]`)).toBeVisible();
        await fits(anon, `${width}px, logged out, dashboard`);
        await inside(anon, anon.getByRole('link', { name: 'Settings' }), `${width}px logged out: the gear`);
        await anon.goto('/settings');
        const dlg = anon.getByRole('dialog', { name: 'Sign in' });
        await expect(dlg).toBeVisible();
        await fits(anon, `${width}px, logged out, /settings`);
        await inside(anon, dlg.getByRole('button', { name: 'Sign in' }), `${width}px: the dialog's Sign in button`);
      }
    } finally {
      await ctx.close();
    }
  });
});

// ---- §7.1: plain words for the background on/off control at every level

test.describe('§7.1 background on/off wording', () => {
  test('the folder dialog says "Same as <tab name>"; the tab and dashboard dialogs use their own words', async ({ page, context }) => {
    const f = await importDash(page, context, [{
      name: 'Main',
      children: (id) => [
        tile(id('anchor'), 'Anchor', 22, 0),
        folder(id('fold'), 'Folder', placement(0, 2, 8, 6), [kid(id('in'), 'Inner')])
      ]
    }]);
    const sel = `[data-node-id="${f.id('fold')}"]`;
    await page.goto(f.path);
    await expect(page.locator(sel)).toBeVisible();
    await enterEdit(page);

    // Folder: a radio group naming the tab it sits in.
    await page.locator(sel).dblclick({ position: { x: 20, y: 20 } });
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await dlg.getByRole('button', { name: /^Background/ }).click();
    const picker = page.getByRole('dialog', { name: 'Folder background' });
    await expect(picker.getByRole('radiogroup', { name: 'Folder background' })).toBeVisible();
    await expect(picker.getByRole('radio', { name: 'Same as Main' })).toBeVisible();
    await picker.getByRole('radio', { name: 'Same as Main' }).check();
    await expect(picker.getByText("This folder's own picture is kept for when you switch back.")).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);

    // Tab.
    await page.getByRole('tab', { name: 'Switch to Main tab' }).dblclick();
    const tabDlg = page.getByRole('dialog', { name: 'Edit Tab' });
    await tabDlg.getByRole('button', { name: /Configure Tab Background/ }).click();
    const tabPicker = page.getByRole('dialog', { name: 'Tab background' });
    await expect(tabPicker.getByRole('radio', { name: 'Same as the dashboard' })).toBeVisible();
    await expect(tabPicker.getByRole('radio', { name: 'Its own background' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(tabDlg).toHaveCount(0);

    // Dashboard.
    await page.getByRole('button', { name: 'Edit Dashboard' }).click();
    const dashDlg = page.getByRole('dialog', { name: 'Edit Dashboard' });
    await dashDlg.getByRole('tab', { name: 'Background' }).click();
    // The switch is a visually hidden checkbox behind a drawn track; its label text is what shows.
    await expect(dashDlg.getByRole('switch', { name: 'Show background picture' })).toBeChecked();
    await expect(dashDlg.getByText('Show background picture')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});

// ---- §7.2: edit mode looks like the real thing (WYSIWYG)

/** Import a copy of a bundled/stored dashboard under a fresh id, path and name; returns its stored entry. */
/** `dash` is in the M5 stored form already (the bundled M5 Showcase, or this server's own export). */
async function importCopy(page: Page, context: BrowserContext, dash: Record<string, unknown>, label: string) {
  const p = `m4bw72${Date.now().toString(36)}${(seq++).toString(36)}`;
  const copy = JSON.parse(JSON.stringify(dash));
  copy.id = `${p}-dash`;
  copy.path = `/${p}`;
  copy.name = `${label} ${p}`;
  const config = { layoutVersion: 1, dashboards: [copy] };
  const bundle = { format: 'hops-export', schemaVersion: 3, exportType: 'full', config };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'copy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  const cfg = await (await page.request.get('/api/config')).json();
  const stored = cfg.dashboards.find((d: { name: string }) => d.name === copy.name);
  expect(stored, `imported ${label} copy is stored`).toBeTruthy();
  made.push(stored.id);
  return stored as { id: string; path: string; tabs: { name: string }[] };
}

async function showcaseCopy(page: Page, context: BrowserContext) {
  const fixture = JSON.parse(fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend/internal/configdoc/testdata/v3_showcase_export.json'), 'utf8'));
  return importCopy(page, context, fixture.config.dashboards[0], 'Showcase');
}

/** The Sample dashboard every fresh install starts with (the test server's), copied. */
async function sampleCopy(page: Page, context: BrowserContext) {
  const exp = await page.request.get('/api/config/export');
  expect(exp.status()).toBe(200);
  const cfg = (await exp.json()).config;
  const sample = cfg.dashboards.find((d: { id: string }) => d.id === 'sample');
  expect(sample, 'the test server has the default Sample dashboard').toBeTruthy();
  expect(cfg.layoutVersion, 'the export carries the layout version').toBe(1);
  return importCopy(page, context, sample, 'Sample');
}

type Boxes = Record<string, { x: number; y: number; w: number; h: number }>;

/** Page-coordinate boxes of every item on the canvas and every tab (overlays closed). */
async function layoutBoxes(page: Page): Promise<Boxes> {
  return page.evaluate(() => {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const add = (key: string, el: Element) => {
      const r = el.getBoundingClientRect();
      let k = key;
      for (let i = 2; k in out; i++) k = `${key}#${i}`;
      out[k] = { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
    };
    document.querySelectorAll('.tab-canvas [data-node-id]').forEach((el) => add(`node ${el.getAttribute('data-node-id')}`, el));
    document.querySelectorAll('[data-dashboard-tabs] [role="tab"]').forEach((el) => add(`tab ${el.getAttribute('aria-label')}`, el));
    const panel = document.querySelector('.canvas-panel');
    if (panel) add('panel', panel);
    return out;
  });
}

/** The boxes once they have stopped moving (tabs animate their border on a switch: 0.2s transition). */
async function settledBoxes(page: Page): Promise<Boxes> {
  let prev = await layoutBoxes(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    const next = await layoutBoxes(page);
    if (JSON.stringify(prev) === JSON.stringify(next)) return next;
    prev = next;
  }
  throw new Error('the layout never settled');
}

/** Every key of `want` is in `got` at the same box, within 1px. Returns the differences. */
function boxDiffs(want: Boxes, got: Boxes): string[] {
  const diffs: string[] = [];
  for (const [k, a] of Object.entries(want)) {
    const b = got[k];
    if (!b) { diffs.push(`${k}: missing in edit mode`); continue; }
    // The panel's height may grow (it fills the screen / its content); its top-left and width may not.
    const keys = k === 'panel' ? (['x', 'y', 'w'] as const) : (['x', 'y', 'w', 'h'] as const);
    for (const c of keys) if (Math.abs(a[c] - b[c]) > 1) diffs.push(`${k}: ${c} ${a[c].toFixed(1)} -> ${b[c].toFixed(1)}`);
  }
  for (const k of Object.keys(got)) if (!(k in want)) diffs.push(`${k}: only in edit mode`);
  return diffs;
}

async function noSideScroll(page: Page, what: string) {
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(w.doc, `${what}: page ${w.doc}px wide on a ${w.view}px screen`).toBeLessThanOrEqual(w.view);
}

/**
 * Enter edit mode at this viewport. Phones (<= 480px) hide the navbar pencil, so there the pencil
 * is pressed at desktop width and the window is narrowed back (edit mode stays on).
 */
async function enterEditAt(page: Page, width: number, height: number) {
  if (width <= 480) await page.setViewportSize({ width: 1280, height });
  await enterEdit(page);
  if (width <= 480) await page.setViewportSize({ width, height });
}

/** A tile, a titled folder and an untitled folder (with a tile in its top-right corner) on Main; a second tab. */
async function folderDash(page: Page, context: BrowserContext) {
  return importDash(page, context, [
    {
      name: 'Main',
      children: (id) => [
        tile(id('a'), 'Alpha', 0, 0),
        folder(id('grp'), 'Group', placement(4, 0, 8, 6), [kid(id('in'), 'Inner')]),
        folder(id('plain'), 'Plain', placement(14, 2, 8, 6), [kid(id('pin'), 'Pinned')], { showTitle: false })
      ]
    },
    { name: 'Two', children: (id) => [tile(id('t2a'), 'Tango')] }
  ]);
}

test.describe('§7.2 edit mode keeps the view layout', () => {
  for (const which of ['Showcase', 'Sample'] as const) {
    for (const width of [1280, 375]) {
      test(`edit mode keeps every item where it is: ${which} at ${width}x800`, async ({ page, context }) => {
        await page.setViewportSize({ width, height: 800 });
        const d = which === 'Showcase' ? await showcaseCopy(page, context) : await sampleCopy(page, context);
        await page.goto(d.path);
        const tabNames = d.tabs.map((t) => t.name);
        expect(tabNames.length).toBeGreaterThan(0);
        const tabOf = (n: string) => page.getByRole('tab', { name: `Switch to ${n} tab`, exact: true });
        const view: Record<string, Boxes> = {};
        for (const n of tabNames) {
          await tabOf(n).click();
          await expect(tabOf(n)).toHaveAttribute('aria-selected', 'true');
          await expect(page.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
          await page.evaluate(() => window.scrollTo(0, 0));
          view[n] = await settledBoxes(page);
          await noSideScroll(page, `${which} ${width}px view, ${n}`);
        }
        await enterEditAt(page, width, 800);
        await expect(page.locator('.canvas-panel.editing')).toBeVisible();
        for (const n of tabNames) {
          await tabOf(n).click();
          await expect(tabOf(n)).toHaveAttribute('aria-selected', 'true');
          await page.evaluate(() => window.scrollTo(0, 0));
          await expect
            .poll(async () => boxDiffs(view[n], await layoutBoxes(page)), { message: `${which} ${width}px, tab ${n}: same boxes in edit mode` })
            .toEqual([]);
          await noSideScroll(page, `${which} ${width}px edit, ${n}`);
        }
        // The toolbar floats over the page: it is fixed to the bottom and inside the screen.
        const bar = page.getByRole('toolbar', { name: 'Editing' });
        expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
        const bb = (await bar.boundingBox())!;
        expect(bb.x).toBeGreaterThanOrEqual(0);
        expect(bb.x + bb.width).toBeLessThanOrEqual(width + 0.5);
        expect(bb.y + bb.height).toBeLessThanOrEqual(800 + 0.5);
      });
    }
  }



  test('the toolbar holds every editing control; the old Dashboard row, Add Tab button and failed-background row are gone', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const f = await folderDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    const bar = page.getByRole('toolbar', { name: 'Editing' });
    for (const n of ['Save', 'Discard', 'Undo', 'Redo', 'Add tile', 'Add folder', 'Add tab', 'Edit Dashboard'])
      await expect(bar.getByRole('button', { name: n, exact: true }), n).toBeVisible();
    await expect(page.locator('[data-dashboard-tabs]').getByRole('button', { name: /add/i })).toHaveCount(0);
    await expect(page.locator('.header-actions, .bg-failed-row, .add-tab-btn, .editor-shell')).toHaveCount(0);
    // Add tab from the toolbar.
    await bar.getByRole('button', { name: 'Add tab', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'New Tab' })).toBeVisible();
  });

  test('its buttons are reachable by keyboard, in order, and Enter works', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const f = await folderDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    const bar = page.getByRole('toolbar', { name: 'Editing' });
    await page.getByRole('tab', { name: 'Switch to Two tab' }).focus();
    const reached: string[] = [];
    for (let i = 0; i < 60 && !reached.includes('Edit Dashboard'); i++) {
      await page.keyboard.press('Tab');
      const name = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return a?.closest('[role="toolbar"]') ? a.getAttribute('aria-label') || a.textContent?.trim() || '' : null;
      });
      if (name !== null) reached.push(name);
    }
    expect(reached).toEqual(expect.arrayContaining(['Add tile', 'Add folder', 'Add tab', 'Edit Dashboard']));
    await expect(bar.getByRole('button', { name: 'Edit Dashboard' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Edit Dashboard' })).toBeVisible();
  });

  for (const width of [1280, 375]) {
    test(`the toolbar never covers an open dialog (${width}px)`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 800 });
      const f = await folderDash(page, context);
      await page.goto(f.path);
      await enterEditAt(page, width, 800);
      const bar = page.getByRole('toolbar', { name: 'Editing' });
      const opens: [string, string][] = [['Edit Dashboard', 'Edit Dashboard'], ['Add tile', 'New Tile'], ['Add tab', 'New Tab']];
      for (const [button, dialog] of opens) {
        await bar.getByRole('button', { name: button, exact: true }).click();
        const dlg = page.getByRole('dialog', { name: dialog });
        await expect(dlg).toBeVisible();
        // Wherever the toolbar is, what is on top there is the dialog (or its backdrop), never the toolbar.
        const covered = await bar.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const pts = [[r.left + 4, r.top + 4], [r.left + r.width / 2, r.top + r.height / 2], [r.right - 4, r.bottom - 4]];
          return pts.some(([x, y]) => {
            const top = document.elementFromPoint(x, y);
            return !!top && el.contains(top);
          });
        });
        expect(covered, `${button}: the toolbar is drawn over the ${dialog} dialog`).toBe(false);
        await page.keyboard.press('Escape');
        await expect(dlg).toHaveCount(0);
      }
    });
  }

  test('folder Minimise shows in edit mode (no Maximise, M5); Minimise changes the saved default (undoable); none hit a handle', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const f = await folderDash(page, context);
    await page.goto(f.path);
    const grp = page.locator(`[data-node-id="${f.id('grp')}"]`);
    const plain = page.locator(`[data-node-id="${f.id('plain')}"]`);
    await expect(grp.getByRole('button', { name: 'Minimise folder' })).toBeVisible();
    await enterEdit(page);
    await expect(grp.getByRole('button', { name: 'Minimise folder' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Maximise folder' })).toHaveCount(0);
    await plain.hover({ position: { x: 4, y: 60 } });
    await expect(plain.getByRole('button', { name: 'Minimise folder' })).toBeVisible();
    // Neither folder's controls overlap its edit handle (focus shows the handle without a hover).
    for (const [loc, name] of [[grp, 'Edit Group'], [plain, 'Edit Plain']] as const) {
      const handle = page.getByRole('button', { name, exact: true });
      await handle.focus();
      await expect(handle).toHaveCSS('opacity', '1');
      const hb = (await handle.boundingBox())!;
      const cb = (await loc.getByRole('button', { name: 'Minimise folder' }).boundingBox())!;
      expect(overlaps(hb, cb), `${name} vs Minimise folder`).toBe(false);
    }
    // Minimise in edit mode sets the draft's saved default: undoable, and the folder is not also selected.
    await page.mouse.move(2, 2);
    await grp.getByRole('button', { name: 'Minimise folder' }).click();
    await expect(page.locator(`[data-node-id="${f.id('grp')}"].folder-slot.collapsed`)).toBeVisible();
    await expect(page.locator(`[data-node-id="${f.id('grp')}"].selected`)).toHaveCount(0);
    const bar = page.getByRole('toolbar', { name: 'Editing' });
    await bar.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(grp.getByRole('button', { name: 'Minimise folder' })).toBeVisible();
  });
});

test.describe('§7.2 fix round 1', () => {
  const broken = (p: string) => ({ type: 'image', value: `/backgrounds/${p}-missing.jpg` });

  /** A long Main tab (a tile at row 0 and a last row far below) and a second tab; a broken dashboard background. */
  async function longDash(page: Page, context: BrowserContext) {
    return importDash(page, context, [
      {
        name: 'Main',
        children: (id) => [
          tile(id('a'), 'Alpha', 0, 0),
          ...Array.from({ length: 12 }, (_, i) => tile(id(`last${i}`), `Last${i}`, 2 * i, 28))
        ]
      },
      { name: 'Two', children: (id) => [tile(id('t2a'), 'Tango')] }
    ], { background: broken(`m4bw-room${Date.now().toString(36)}`) });
  }

  test('1024px, the toolbar wrapped with a failed-background warning: the last row scrolls fully clear of it; "Unsaved changes" moves no button', async ({ page, context }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    const f = await longDash(page, context);
    await page.goto(f.path);
    // Large text (the navbar's text size, per browser): the toolbar no longer fits one row at 1024px.
    await page.getByRole('button', { name: 'Increase text size' }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.fontSize)).toBe('18px');
    await enterEdit(page);
    const bar = page.getByRole('toolbar', { name: 'Editing' });
    await expect(bar.locator('[data-bg-failed="dashboard"]')).toBeVisible();
    const addTile = bar.getByRole('button', { name: 'Add tile', exact: true });
    const before = (await addTile.boundingBox())!;
    // Make the draft dirty (Alt+Right moves the Main tab): "Unsaved changes" appears.
    await page.getByRole('tab', { name: 'Switch to Main tab' }).focus();
    await page.keyboard.press('Alt+ArrowRight');
    await expect(bar.getByText('Unsaved changes')).toBeVisible();
    const after = (await addTile.boundingBox())!;
    expect(Math.abs(after.x - before.x), 'Add tile x moved when "Unsaved changes" appeared').toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y), 'Add tile y moved when "Unsaved changes" appeared').toBeLessThanOrEqual(1);
    await page.getByRole('tab', { name: 'Switch to Main tab' }).click();
    const tb = (await bar.boundingBox())!;
    expect(tb.height, 'the scenario: a tall (wrapped, with a warning) toolbar').toBeGreaterThan(100);
    await expect
      .poll(async () => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        return page.evaluate((ids) => {
          const bar = document.querySelector('[role="toolbar"][aria-label="Editing"]')!.getBoundingClientRect();
          const bottoms = ids.map((id) => document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)!.getBoundingClientRect().bottom);
          const last = Math.max(...bottoms);
          return last <= bar.top ? 'clear' : `last row ends at ${last.toFixed(0)}, toolbar starts at ${bar.top.toFixed(0)}`;
        }, Array.from({ length: 12 }, (_, i) => f.id(`last${i}`)));
      }, { message: 'scrolled to the bottom, the last row is clear of the toolbar' })
      .toBe('clear');
  });

  test('during a drag the toolbar lets the drop through: a tile dropped on a cell under it lands there', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const f = await longDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    const bar = page.getByRole('toolbar', { name: 'Editing' });
    await expect(bar.locator('[data-bg-failed="dashboard"]')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    const alpha = page.locator(`[data-node-id="${f.id('a')}"]`);
    const a0 = (await alpha.boundingBox())!;
    const tb = (await bar.boundingBox())!;
    // A point inside the toolbar's left end (the drag breadcrumb shows at the bottom centre), above
    // the auto-scroll edge zone (48px), over the grid.
    const x = tb.x + 16;
    const y = tb.y + 8;
    expect(y, 'the point is above the auto-scroll zone').toBeLessThan(800 - 50);
    await page.mouse.move(a0.x + a0.width / 2, a0.y + a0.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 25; i++) {
      await page.mouse.move(a0.x + a0.width / 2 + ((x - a0.x - a0.width / 2) * i) / 25, a0.y + a0.height / 2 + ((y - a0.y - a0.height / 2) * i) / 25);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(100);
    // Nothing but the toolbar was over that point: what is there now (pointer-events none) is the canvas.
    expect(await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('.tab-canvas'), [x, y])).toBe(true);
    await page.mouse.up();
    await expect
      .poll(async () => {
        const b = (await alpha.boundingBox())!;
        return b.y - a0.y;
      }, { message: 'Alpha moved down to the cell under the toolbar' })
      .toBeGreaterThan(400);
  });

  // M5 Task 4: the same through-the-toolbar drop onto an open folder's page (its drop area): it goes in
  // at the pointer's place in the folder's order — before the item under the pointer — as saved.
  test('during a drag the toolbar lets the drop through onto an open folder\'s page: at the item under it', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const f = await importDash(page, context, [{
      name: 'Main',
      children: (id) => [
        tile(id('a'), 'Alpha', 0, 0),
        folder(id('f'), 'Big', placement(0, 2, 24, 20), Array.from({ length: 120 }, (_, i) => kid(id(`k${i}`), `K${i}`)))
      ]
    }]);
    await page.goto(f.path);
    await enterEdit(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const bar = page.getByRole('toolbar', { name: 'Editing' });
    const alpha = page.locator(`[data-node-id="${f.id('a')}"]`);
    const a0 = (await alpha.boundingBox())!;
    const tb = (await bar.boundingBox())!;
    const x = tb.x + 16;
    const y = tb.y + 8;
    expect(y, 'the point is above the auto-scroll zone').toBeLessThan(800 - 50);
    await page.mouse.move(a0.x + a0.width / 2, a0.y + a0.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 25; i++) {
      await page.mouse.move(a0.x + a0.width / 2 + ((x - a0.x - a0.width / 2) * i) / 25, a0.y + a0.height / 2 + ((y - a0.y - a0.height / 2) * i) / 25);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(100);
    // The toolbar lets the pointer through (pointer-events none): under it is an item on the folder's page.
    const hitItem = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py)?.closest('[data-folder-page] [data-node-id]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute('data-node-id') ?? '', right: px >= r.left + r.width / 2 };
    }, [x, y]);
    expect(hitItem, 'an item of the open folder is under the toolbar').not.toBeNull();
    const under = hitItem!.id;
    await expect(page.locator('.drag-layer .marker')).toBeVisible();
    await page.mouse.up();
    const save = bar.getByRole('button', { name: /Save/ });
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
    await save.click();
    expect((await saved).status()).toBe(200);
    const cfg = await (await page.request.get('/api/config')).json();
    const d = cfg.dashboards.find((x: { id: string }) => x.id === f.id('dash'));
    const big = d.tabs[0].root.children.find((n: { id: string }) => n.id === f.id('f'));
    const order: string[] = big.content.children.map((n: { id: string }) => n.id);
    const want = Array.from({ length: 120 }, (_, i) => f.id(`k${i}`));
    // Its left half: before it; its right half: after it (fix round 1).
    want.splice(want.indexOf(under) + (hitItem!.right ? 1 : 0), 0, f.id('a'));
    expect(order).toEqual(want);
  });

  test('a titled folder\'s edit handle never covers its failed-background warning or its controls', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const f = await importDash(page, context, [{
      name: 'Main',
      children: (id) => [
        folder(id('grp'), 'Group', placement(0, 0, 8, 6), [kid(id('in'), 'Inner')], { background: broken(`m4bw-fold${Date.now().toString(36)}`) })
      ]
    }]);
    await page.goto(f.path);
    await enterEdit(page);
    const grp = page.locator(`[data-node-id="${f.id('grp')}"]`);
    const badge = grp.locator('[data-bg-failed="folder"]');
    await expect(badge).toBeVisible();
    const handle = page.getByRole('button', { name: 'Edit Group', exact: true });
    await grp.hover({ position: { x: 10, y: 10 } });
    await expect(handle).toHaveCSS('opacity', '1');
    const hb = (await handle.boundingBox())!;
    expect(overlaps(hb, (await badge.boundingBox())!), 'the handle covers the warning').toBe(false);
    expect(overlaps(hb, (await grp.getByRole('button', { name: 'Minimise folder' }).boundingBox())!), 'the handle covers Minimise').toBe(false);
  });
});

test.describe('§7.2 on a touch device (hover: none)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1280, height: 900 } });

  test('every handle, folder control and tab handle is shown and none overlap', async ({ page, context }) => {
    const f = await folderDash(page, context);
    await page.goto(f.path);
    await page.getByRole('button', { name: 'Enter Edit Mode' }).tap();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    const named = ['Edit Alpha', 'Edit Group', 'Edit Inner', 'Edit Plain', 'Edit Pinned', 'Edit Main tab', 'Edit Two tab'];
    const boxes: [string, Box][] = [];
    for (const n of named) {
      const h = page.getByRole('button', { name: n, exact: true });
      await expect(h).toHaveCSS('opacity', '1');
      boxes.push([n, (await h.boundingBox())!]);
    }
    // M5: one control per open folder (Minimise), in its bar; no Maximise.
    const ctl = page.locator('.tab-canvas').getByRole('button', { name: /^(Minimise|Maximise) folder$/ });
    await expect(ctl).toHaveCount(2);
    for (let i = 0; i < 2; i++) boxes.push([`folder control ${i}`, (await ctl.nth(i).boundingBox())!]);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlaps(boxes[i][1], boxes[j][1]), `${boxes[i][0]} vs ${boxes[j][0]}`).toBe(false);
  });
});

test.describe('§7.2 nested untitled folders on a touch device', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1280, height: 900 } });

  // M5: an untitled folder inside an untitled folder is an item on its page (its minimised tile, its
  // handle in its own corner); opening it drills in — an inset box inside the parent (M5 §7) with its
  // own ‹ and handle. Neither level's handles, controls or ‹ overlap.
  test('an untitled folder inside an untitled folder: no handle, control or ‹ overlaps another, before and after drilling in', async ({ page, context }) => {
    const f = await importDash(page, context, [{
      name: 'Main',
      children: (id) => [
        folder(id('outer'), 'Outer', placement(2, 2, 16, 10), [
          folder(id('inner'), 'InnerF', null, [kid(id('deep'), 'Deep')], { showTitle: false })
        ], { showTitle: false })
      ]
    }]);
    await page.goto(f.path);
    await page.getByRole('button', { name: 'Enter Edit Mode' }).tap();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    const outer = page.locator(`[data-node-id="${f.id('outer')}"]`);
    const noOverlaps = async (names: string[], extra: [string, Box][]) => {
      const boxes: [string, Box][] = [...extra];
      for (const n of names) {
        const h = page.getByRole('button', { name: n, exact: true });
        await expect(h).toHaveCSS('opacity', '1');
        boxes.push([n, (await h.boundingBox())!]);
      }
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++)
          expect(overlaps(boxes[i][1], boxes[j][1]), `${boxes[i][0]} vs ${boxes[j][0]}`).toBe(false);
    };
    const minimise = async (): Promise<[string, Box]> =>
      ['Outer Minimise folder', (await outer.locator('.folder-header').getByRole('button', { name: 'Minimise folder' }).boundingBox())!];
    // The inner folder is an item: its minimised tile, its handle in its own corner; Outer's in its bar.
    await expect(page.locator(`[data-node-id="${f.id('inner')}"]`)).toHaveClass(/collapsed/);
    await noOverlaps(['Edit Outer', 'Edit InnerF'], [await minimise()]);
    // Drill in through the item menu a REAL touch long-press opens (its Open): an inset box in Outer's.
    await longPress(page, page.locator(`[data-node-id="${f.id('inner')}"] .folder-collapsed-tile`));
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Open', exact: true }).tap();
    const inset = outer.locator(`.nested-box[data-nested-folder="${f.id('inner')}"]`);
    await expect(inset).toBeVisible();
    const back = inset.getByRole('button', { name: 'Back to Outer' });
    await noOverlaps(['Edit Outer', 'Edit InnerF', 'Edit Deep'], [await minimise(), ['Back to Outer', (await back.boundingBox())!]]);
  });
});

// ---- §8/§9: a tile's Size sets the space it takes. These dashboards are imported as OLD-form (12-column)
// exports, which the import doubles (finer grid, spec §9): a Medium is 2 x 2 cells, Large 4 x 4, Small 1 x 1.

test.describe('§8 tile size sets the space it takes', () => {
  const box = async (page: Page, id: string) => (await page.locator(`.tab-canvas [data-node-id="${id}"]`).boundingBox())!;
  const near = (a: number, b: number, what: string) => expect(Math.abs(a - b), `${what}: ${a} vs ${b}`).toBeLessThanOrEqual(1.5);

  async function sizeDash(page: Page, context: BrowserContext) {
    return importDash(page, context, [{
      name: 'Main',
      children: (id) => [
        tile(id('a'), 'Alpha', 0, 0), tile(id('b'), 'Bravo', 2, 0), tile(id('d'), 'Delta', 0, 2),
        tile(id('e'), 'Edge', 22, 0), tile(id('f'), 'Foxtrot', 20, 2)
      ]
    }]);
  }

  async function pickSize(page: Page, item: ReturnType<Page['locator']>, size: string) {
    await item.dblclick();
    const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
    await expect(dlg).toBeVisible();
    await dlg.getByLabel('Size', { exact: true }).selectOption(size);
    await dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dlg).toHaveCount(0);
  }

  async function allApart(page: Page, ids: string[]) {
    const bs = await Promise.all(ids.map((i) => box(page, i)));
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++)
        expect(overlaps(bs[i], bs[j]), `${ids[i]} vs ${ids[j]}`).toBe(false);
  }

  test('Large makes a 4 x 4 box (two Medium pitches plus the gap) and pushes its neighbours; Undo restores it', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const f = await sizeDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    const [a0, b0, d0] = [await box(page, f.id('a')), await box(page, f.id('b')), await box(page, f.id('d'))];
    const pitchX = b0.x - a0.x;
    const pitchY = d0.y - a0.y;
    const tileBox = async () => (await page.locator(`[data-node-id="${f.id('a')}"] button.entry`).boundingBox())!;
    const t0 = await tileBox();

    await pickSize(page, page.locator(`[data-node-id="${f.id('a')}"]`), 'large');
    const a1 = await box(page, f.id('a'));
    near(a1.x, a0.x, 'x');
    near(a1.y, a0.y, 'y');
    near(a1.width, 2 * pitchX, 'cell width = 2 cells');
    near(a1.height, 2 * pitchY, 'cell height = 2 rows');
    // The drawn tile: two cell widths plus the gap between them (likewise in height).
    const t1 = await tileBox();
    near(t1.width, pitchX + t0.width, 'tile width = 2 cells + the gap');
    near(t1.height, pitchY + t0.height, 'tile height = 2 rows + the gap');
    const b1 = await box(page, f.id('b'));
    const d1 = await box(page, f.id('d'));
    expect(b1.x !== b0.x || b1.y !== b0.y, 'Bravo was pushed aside').toBe(true);
    expect(d1.x !== d0.x || d1.y !== d0.y, 'Delta was pushed aside').toBe(true);
    await allApart(page, ['a', 'b', 'd', 'e', 'f'].map(f.id));
    // Opening it again shows Large.
    await page.locator(`[data-node-id="${f.id('a')}"]`).dblclick();
    const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
    await expect(dlg.getByLabel('Size', { exact: true })).toHaveValue('large');
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();

    // One undo step restores the tile and its neighbours.
    const bar = page.getByRole('toolbar', { name: 'Editing' });
    await bar.getByRole('button', { name: 'Undo' }).click();
    for (const [id, was] of [['a', a0], ['b', b0], ['d', d0]] as const) {
      const now = await box(page, f.id(id));
      near(now.x, was.x, `${id} x after undo`);
      near(now.y, was.y, `${id} y after undo`);
      near(now.width, was.width, `${id} width after undo`);
    }
    await expect(bar.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('at the right edge Large shifts the tile left; nothing overlaps', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const f = await sizeDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    const [e0, f0] = [await box(page, f.id('e')), await box(page, f.id('f'))];
    await pickSize(page, page.locator(`[data-node-id="${f.id('e')}"]`), 'large');
    const e1 = await box(page, f.id('e'));
    near(e1.x, f0.x, 'shifted one cell left');
    near(e1.x + e1.width, e0.x + e0.width, 'still ends at the right edge');
    await allApart(page, ['a', 'b', 'd', 'e', 'f'].map(f.id));
  });

  // Spec §9: Small is one 1 x 1 cell (a quarter of a Medium's 2 x 2), always compact, with a smaller icon.
  for (const width of [1280, 1920]) test(`Small takes one cell (half a Medium each way), is compact and draws a smaller icon (${width}px)`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await sizeDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    const item = page.locator(`[data-node-id="${f.id('a')}"]`);
    const icon = item.locator('.icon svg');
    const a0 = await box(page, f.id('a'));
    const i0 = (await icon.boundingBox())!;
    await pickSize(page, item, 'small');
    await expect(item.locator('button.entry')).toHaveClass(/\bsmall\b/);
    await expect(item.locator('button.entry')).toHaveClass(/\bcompact\b/);
    const i1 = (await icon.boundingBox())!;
    expect(i1.width, 'icon is smaller').toBeLessThan(i0.width - 4);
    const a1 = await box(page, f.id('a'));
    near(a1.width, a0.width / 2, 'one cell wide: half a Medium');
    near(a1.height, a0.height / 2, 'one cell high: half a Medium');
    near(a1.x, a0.x, 'keeps its top-left (x)');
    near(a1.y, a0.y, 'keeps its top-left (y)');
  });

  /** The root grid's column track and row height, in px, read from the rendered grid. */
  async function rootCell(page: Page) {
    return page.locator('.tab-canvas').evaluate((canvas) => {
      const grids = [canvas as HTMLElement, ...canvas.querySelectorAll<HTMLElement>('*')].filter((el) => getComputedStyle(el).display === 'grid');
      const g = grids.find((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length === 24);
      if (!g) throw new Error('no 24-column grid: ' + grids.map((el) => el.className + ' ' + getComputedStyle(el).gridTemplateColumns).join(' | '));
      const cs = getComputedStyle(g);
      return { col: parseFloat(cs.gridTemplateColumns.split(' ')[0]), row: parseFloat(cs.gridAutoRows) };
    });
  }

  // Spec §9: Small 1 x 1, Medium 2 x 2, Large 4 x 4 cells of the 24-column grid, so the drawn boxes'
  // areas run Small < Medium < Large (1 : 4 : 16).
  for (const width of [1280, 1920]) test(`box sizes: Small 1 x 1, Medium 2 x 2, Large 4 x 4 cells; Small < Medium < Large (${width}px)`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await sizeDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    await pickSize(page, page.locator(`[data-node-id="${f.id('a')}"]`), 'large');
    await pickSize(page, page.locator(`[data-node-id="${f.id('f')}"]`), 'small');
    const cell = await rootCell(page);
    expect(cell.col, 'a 24-column cell is 1/24 of the canvas').toBeGreaterThan(20);
    const [sm, md, lg] = [await box(page, f.id('f')), await box(page, f.id('b')), await box(page, f.id('a'))];
    for (const [what, b, n] of [['Small', sm, 1], ['Medium', md, 2], ['Large', lg, 4]] as const) {
      near(b.width, n * cell.col, `${what} is ${n} cells wide`);
      near(b.height, n * cell.row, `${what} is ${n} cells high`);
    }
    const area = (b: { width: number; height: number }) => b.width * b.height;
    expect(area(sm), 'Small < Medium').toBeLessThan(area(md));
    expect(area(md), 'Medium < Large').toBeLessThan(area(lg));
    expect(area(md) / area(sm)).toBeCloseTo(4, 0);
    expect(area(lg) / area(md)).toBeCloseTo(4, 0);
    await allApart(page, ['a', 'b', 'd', 'e', 'f'].map(f.id));
  });

  test("a stored large tile inside a folder (Sample's Netflix) shows the folder's contents size; its own size stays Large", async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const s = await sampleCopy(page, context);
    await page.goto(s.path);
    await page.getByRole('tab', { name: 'Switch to Media tab' }).click();
    const netflix = page.locator('.tab-canvas [data-node-id]', { has: page.getByRole('button', { name: 'Open Netflix' }) }).last();
    const spotify = page.locator('.tab-canvas [data-node-id]', { has: page.getByRole('button', { name: 'Open Spotify' }) }).last();
    await expect(netflix).toBeVisible();
    const [n, sp] = [(await netflix.boundingBox())!, (await spotify.boundingBox())!];
    // M5 §2: inside a folder every item shows the folder's contents size (Medium), whatever its own.
    near(n.width, sp.width, 'Netflix is drawn at the contents size, like Spotify');
    near(n.height, sp.height, 'Netflix is drawn at the contents size, like Spotify');
    await expect(netflix.locator('button.entry')).toHaveClass(/\bmedium\b/);
    // Stored: its own size, Large, and no placement inside the folder (nothing silently resized).
    const cfg = await (await page.request.get('/api/config')).json();
    const dash = cfg.dashboards.find((d: { id: string }) => d.id === s.id);
    const found: { size?: string; placement?: unknown }[] = [];
    const walk = (c: { children?: unknown[] } | undefined, inFolder: boolean) => {
      for (const x of (c?.children ?? []) as { name?: string; kind?: string; content?: { children?: unknown[] } }[]) {
        if (x.kind === 'tile' && x.name === 'Netflix' && inFolder) found.push(x as never);
        if (x.kind === 'folder') walk(x.content, true);
      }
    };
    for (const t of dash.tabs) walk(t.root, false);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ size: 'large' });
    expect(found[0]).not.toHaveProperty('placement');

    // The dialog shows its own size (Large; no "Custom"). Picking Small changes the stored size only:
    // the drawn box stays the contents size. Undo restores Large.
    const nid = await netflix.getAttribute('data-node-id');
    const nf = page.locator(`.tab-canvas [data-node-id="${nid}"]`);
    await enterEdit(page);
    await nf.dblclick();
    const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
    await expect(dlg.getByLabel('Size', { exact: true })).toHaveValue('large');
    await expect(dlg.getByLabel('Size', { exact: true }).locator('option')).toHaveText(['Small', 'Medium', 'Large']);
    await dlg.getByLabel('Size', { exact: true }).selectOption('small');
    await dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dlg).toHaveCount(0);
    const after = (await nf.boundingBox())!;
    near(after.width, n.width, 'still the contents size');
    near(after.height, n.height, 'still the contents size');
    const bar = page.getByRole('toolbar', { name: 'Editing' });
    await bar.getByRole('button', { name: 'Undo' }).click();
    await expect(bar.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await nf.dblclick();
    await expect(dlg.getByLabel('Size', { exact: true })).toHaveValue('large');
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  // Jonathan's walkthrough (Sample's Services folder: Google, GitHub, YouTube). Each tile's size is
  // its own: checked after every step in the dialog, on the drawn tile and in the saved config.
  async function servicesDash(page: Page, context: BrowserContext) {
    return importDash(page, context, [{
      name: 'Main',
      children: (id) => [
        folder(id('services'), 'Services', placement(0, 0, 24, 5), [
          kid(id('google'), 'Google', { description: 'Search Engine', icon: 'mdi:google' }),
          kid(id('github'), 'GitHub', { description: 'Code Repository', icon: 'mdi:github', order: 1 }),
          kid(id('youtube'), 'YouTube', { description: 'Video Platform', icon: 'mdi:youtube', order: 2 })
        ], { color: '#8b5cf6', opacity: 0.95 })
      ]
    }]);
  }

  test('Services walkthrough: Google Large, YouTube Medium, GitHub Small; each tile keeps its own size', async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const f = await servicesDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    const ids = { Google: f.id('google'), GitHub: f.id('github'), YouTube: f.id('youtube') } as const;
    type Name = keyof typeof ids;
    const cell = (n: Name) => page.locator(`.tab-canvas [data-node-id="${ids[n]}"]`);
    const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
    const sizeIn = async (n: Name) => {
      await cell(n).dblclick();
      await expect(dlg.locator('input#name')).toHaveValue(n);
      const v = await dlg.getByLabel('Size', { exact: true }).inputValue();
      await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dlg).toHaveCount(0);
      return v;
    };
    // M5 §2: in the folder every tile is DRAWN at its contents size (Medium); the dialog shows its own size.
    const expectSizes = async (want: Record<Name, string>, step: string) => {
      for (const n of Object.keys(want) as Name[]) {
        await expect(cell(n).locator('button.entry'), `${step}: ${n} is drawn at the contents size`).toHaveClass(/\bmedium\b/);
        expect(await sizeIn(n), `${step}: ${n}'s dialog shows ${want[n]}`).toBe(want[n]);
      }
    };
    const sizes = async () => ({ Google: await box(page, ids.Google), GitHub: await box(page, ids.GitHub), YouTube: await box(page, ids.YouTube) });
    const sameBoxes = async (was: Awaited<ReturnType<typeof sizes>>, step: string) => {
      const now = await sizes();
      for (const n of ['Google', 'GitHub', 'YouTube'] as const) {
        near(now[n].width, was[n].width, `${step}: ${n} keeps its drawn width`);
        near(now[n].height, was[n].height, `${step}: ${n} keeps its drawn height`);
      }
    };

    await expectSizes({ Google: 'medium', GitHub: 'medium', YouTube: 'medium' }, 'start');
    const folderBox = () => page.locator(`.tab-canvas [data-node-id="${f.id('services')}"]`).boundingBox();
    const [svc0, s0] = [(await folderBox())!, await sizes()];
    near(s0.Google.width, s0.YouTube.width, 'all three are drawn Medium');
    await pickSize(page, cell('Google'), 'large');
    await expectSizes({ Google: 'large', GitHub: 'medium', YouTube: 'medium' }, 'Google Large');
    await sameBoxes(s0, 'Google Large');
    // The folder never grows to fit its contents (M5: it pages them instead).
    const svc1 = (await folderBox())!;
    near(svc1.height, svc0.height, 'Services keeps its height');
    near(svc1.width, svc0.width, 'Services keeps its width');
    await pickSize(page, cell('YouTube'), 'medium');
    await expectSizes({ Google: 'large', GitHub: 'medium', YouTube: 'medium' }, 'YouTube Medium');
    await pickSize(page, cell('GitHub'), 'small');
    await expectSizes({ Google: 'large', GitHub: 'small', YouTube: 'medium' }, 'GitHub Small');
    await sameBoxes(s0, 'GitHub Small');
    // The menu's Edit on YouTube (GitHub was edited last) opens YouTube's own dialog.
    await cell('YouTube').click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await expect(dlg.locator('input#name')).toHaveValue('YouTube');
    await expect(dlg.getByLabel('Size', { exact: true })).toHaveValue('medium');
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Saved: each tile's own size, and no placements inside the folder.
    const bar = page.getByRole('toolbar', { name: 'Editing' });
    await bar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(bar.getByText('Unsaved changes')).toHaveCount(0);
    const cfg = await (await page.request.get('/api/config')).json();
    const dash = cfg.dashboards.find((d: { id: string }) => d.id === f.id('dash'));
    const kids = dash.tabs[0].root.children[0].content.children as { id: string; size: string; placement?: unknown }[];
    const by = (n: Name) => kids.find((k) => k.id === ids[n])!;
    expect(by('Google')).toMatchObject({ size: 'large' });
    expect(by('YouTube')).toMatchObject({ size: 'medium' });
    expect(by('GitHub')).toMatchObject({ size: 'small' });
    for (const k of kids) expect(k, 'no placement inside a folder').not.toHaveProperty('placement');
  });

  /** A tile's drawn icon and title size. */
  async function looks(page: Page, id: string) {
    return page.locator(`.tab-canvas [data-node-id="${id}"]`).evaluate((el) => {
      const icon = el.querySelector('.icon svg, .icon img')!.getBoundingClientRect();
      return { icon: Math.max(icon.width, icon.height), font: parseFloat(getComputedStyle(el.querySelector('.title')!).fontSize) };
    });
  }
  function clearlySmaller(small: { icon: number; font: number }, medium: { icon: number; font: number }, where: string) {
    expect(small.icon, `${where}: Small's icon (${small.icon}px) is at most 0.6 x Medium's (${medium.icon}px)`).toBeLessThanOrEqual(0.6 * medium.icon);
    // Spec §10 fix round 1: a name is never under 12px, so where Medium's is at that floor Small's is too.
    expect(small.font, `${where}: Small's title (${small.font}px) is at most 0.8 x Medium's (${medium.font}px) or the 12px floor`).toBeLessThanOrEqual(Math.max(12, 0.8 * medium.font));
  }

  test('Small is clearly smaller than Medium in the same container: compact cells (1280px) and full cells (1920px)', async ({ page, context }, info) => {
    for (const [width, fit] of [[1280, 'compact'], [1920, 'fill']] as const) {
      await page.setViewportSize({ width, height: 900 });
      const g = await sizeDash(page, context);
      await page.goto(g.path);
      await enterEdit(page);
      await pickSize(page, page.locator(`.tab-canvas [data-node-id="${g.id('a')}"]`), 'small');
      const b = page.locator(`.tab-canvas [data-node-id="${g.id('b')}"] button.entry`);
      if (fit === 'compact') await expect(b).toHaveClass(/\bcompact\b/);
      else await expect(b).not.toHaveClass(/\bcompact\b/);
      await info.attach(`tiles-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
      // Spec §10: Medium's icon scales with its tile (about a third of its shorter side) at either
      // fit; Small is clearly smaller beside it.
      const med = await looks(page, g.id('b'));
      const tb = (await b.boundingBox())!;
      const side = Math.min(tb.width, tb.height);
      expect(med.icon, `${width}px Medium icon ${med.icon}px on a ${side}px tile`).toBeGreaterThanOrEqual(0.28 * side);
      expect(med.icon, `${width}px Medium icon ${med.icon}px on a ${side}px tile`).toBeLessThanOrEqual(0.4 * side);
      clearlySmaller(await looks(page, g.id('a')), med, `${fit} (${width}px)`);
    }
  });
});

// Spec §10: one arrangement at every size and fit (name, icon, description, kept together and centred,
// never space-between), and the content scales with the tile (container query units).
test.describe('§10 tile content layout', () => {
  type R = { top: number; bottom: number; left: number; right: number; width: number; height: number };
  type Look = { tile: R; title: R; icon: R; sub: R | null; font: number; subFont: number | null; subLines: number | null; fit: string };

  /** Services-shaped tiles in the finer grid's own units: Large 4 x 4, Medium 2 x 2, Small 1 x 1. */
  async function layoutDash(page: Page, context: BrowserContext) {
    return importDash(page, context, [{
      name: 'Main',
      children: (id) => [
        tile(id('lg'), 'Google', 0, 0, { description: 'Search Engine', icon: 'mdi:google', size: 'large', placement: placement(0, 0, 4, 4) }),
        tile(id('md'), 'YouTube', 4, 0, { description: 'Video Platform', icon: 'mdi:youtube', placement: placement(4, 0, 2, 2) }),
        tile(id('sm'), 'GitHub', 6, 0, { description: 'Code Repository', icon: 'mdi:github', size: 'small', placement: placement(6, 0, 1, 1) })
      ]
    }]);
  }

  /** The drawn boxes of a tile and its name, icon graphic and description (null when not shown). */
  async function look(page: Page, id: string): Promise<Look> {
    return page.locator(`.tab-canvas [data-node-id="${id}"]`).evaluate((cell) => {
      const r = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
      };
      const btn = cell.querySelector('button.entry')!;
      const sub = btn.querySelector('.subtitle');
      const shown = sub && getComputedStyle(sub).display !== 'none' && sub.getBoundingClientRect().height > 0;
      return {
        tile: r(btn), title: r(btn.querySelector('.title')!), icon: r(btn.querySelector('.icon svg, .icon img')!),
        sub: shown ? r(sub) : null, font: parseFloat(getComputedStyle(btn.querySelector('.title')!).fontSize),
        subFont: shown ? parseFloat(getComputedStyle(sub).fontSize) : null,
        subLines: shown ? sub.getBoundingClientRect().height / parseFloat(getComputedStyle(sub).lineHeight) : null,
        fit: btn.classList.contains('compact') ? 'compact' : btn.classList.contains('fill') ? 'fill' : 'none'
      };
    });
  }

  const f1 = (n: number) => n.toFixed(1);
  const describeLook = (l: Look) =>
    `tile ${f1(l.tile.width)}x${f1(l.tile.height)} (${l.fit}); title y ${f1(l.title.top - l.tile.top)}; ` +
    `icon y ${f1(l.icon.top - l.tile.top)} size ${f1(l.icon.width)}; ` +
    `description ${l.sub ? 'y ' + f1(l.sub.top - l.tile.top) + ' font ' + l.subFont + 'px' : 'hidden'}; name font ${l.font}px`;

  /** Name above icon above description; small gaps; centred together; nothing spills out of the tile. */
  function arranged(l: Look, what: string) {
    const h = l.tile.height;
    expect(l.title.bottom, `${what}: the name is above the icon`).toBeLessThanOrEqual(l.icon.top + 0.5);
    const gapTop = l.icon.top - l.title.bottom;
    expect(gapTop, `${what}: name-icon gap ${f1(gapTop)}px <= 12% of ${f1(h)}px`).toBeLessThanOrEqual(0.12 * h);
    let last = l.icon.bottom;
    if (l.sub) {
      expect(l.icon.bottom, `${what}: the icon is above the description`).toBeLessThanOrEqual(l.sub.top + 0.5);
      const gapBot = l.sub.top - l.icon.bottom;
      expect(gapBot, `${what}: icon-description gap ${f1(gapBot)}px <= 12% of ${f1(h)}px`).toBeLessThanOrEqual(0.12 * h);
      last = l.sub.bottom;
    }
    // Kept together and centred: the space above the name and below the last line match (within 6%).
    const above = l.title.top - l.tile.top;
    const below = l.tile.bottom - last;
    expect(Math.abs(above - below), `${what}: centred (above ${f1(above)}, below ${f1(below)})`).toBeLessThanOrEqual(0.06 * h + 2);
    expect(above, `${what}: the name is inside the tile`).toBeGreaterThanOrEqual(0);
    expect(below, `${what}: the content is inside the tile`).toBeGreaterThanOrEqual(0);
    for (const [k, b] of [['name', l.title], ['icon', l.icon]] as const) {
      expect(b.left, `${what}: ${k} inside on the left`).toBeGreaterThanOrEqual(l.tile.left - 0.5);
      expect(b.right, `${what}: ${k} inside on the right`).toBeLessThanOrEqual(l.tile.right + 0.5);
    }
  }

  for (const width of [1280, 1600, 1920]) test(`name above icon above description, close together, and the icon grows Small < Medium < Large (${width}px)`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await layoutDash(page, context);
    await page.goto(f.path);
    await expect(page.locator(`.tab-canvas [data-node-id="${f.id('sm')}"] .icon svg`)).toBeVisible();
    const [sm, md, lg] = [await look(page, f.id('sm')), await look(page, f.id('md')), await look(page, f.id('lg'))];
    const report = `${width}px\n  Small:  ${describeLook(sm)}\n  Medium: ${describeLook(md)}\n  Large:  ${describeLook(lg)}`;
    console.log(report);
    await info.attach(`layout-${width}`, { body: report, contentType: 'text/plain' });
    await info.attach(`layout-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    for (const [what, l] of [['Small', sm], ['Medium', md], ['Large', lg]] as const) arranged(l, `${what} at ${width}px`);
    expect(sm.icon.width, `${width}px: Small's icon < Medium's`).toBeLessThan(md.icon.width);
    expect(md.icon.width, `${width}px: Medium's icon < Large's`).toBeLessThan(lg.icon.width);
    // The name and description are shown on Medium and Large at every width.
    expect(md.sub, `${width}px: Medium shows its description`).not.toBeNull();
    expect(lg.sub, `${width}px: Large shows its description`).not.toBeNull();
    // Still clearly smaller than Medium beside it (spec §8): at most 0.6x the icon, 0.8x the name.
    expect(sm.icon.width, `${width}px: Small's icon is at most 0.6 x Medium's`).toBeLessThanOrEqual(0.6 * md.icon.width);
    // ... and its name at most 0.8x Medium's, unless both sit at the 12px floor (fix round 1).
    expect(sm.font, `${width}px: Small's name is at most 0.8 x Medium's (or the 12px floor)`).toBeLessThanOrEqual(Math.max(12, 0.8 * md.font));
  });

  // Fix round 1 (binding): readable text. A name is never under 12px and a description never under
  // 11px; a description that cannot fit at that floor (2 lines plus gaps) is hidden, not shrunk.
  for (const width of [1280, 1600, 1920]) test(`readable text: wherever shown, the name is >= 12px and the description >= 11px (${width}px)`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await layoutDash(page, context);
    await page.goto(f.path);
    await expect(page.locator(`.tab-canvas [data-node-id="${f.id('sm')}"] .icon svg`)).toBeVisible();
    for (const k of ['sm', 'md', 'lg']) {
      const l = await look(page, f.id(k));
      const what = `${k} at ${width}px: ${describeLook(l)}`;
      expect(l.title.height, `${what}: the name is shown`).toBeGreaterThan(0);
      expect(l.font, `${what}: name >= 12px`).toBeGreaterThanOrEqual(12);
      if (l.sub) {
        expect(l.subFont!, `${what}: description >= 11px`).toBeGreaterThanOrEqual(11);
        expect(l.subLines!, `${what}: description at most 2 lines`).toBeLessThanOrEqual(2.05);
        expect(l.sub.bottom, `${what}: the description fits in the tile`).toBeLessThanOrEqual(l.tile.bottom + 0.5);
      }
      arranged(l, what);
    }
    // Medium keeps its description at every width, at the readable size.
    expect((await look(page, f.id('md'))).sub, `${width}px: Medium shows its description`).not.toBeNull();
  });

  test('a Medium at a typical width (1600px) looks like the old Medium: a ~48px icon and a ~14px name', async ({ page, context }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const f = await layoutDash(page, context);
    await page.goto(f.path);
    const md = await look(page, f.id('md'));
    expect(md.icon.width, describeLook(md)).toBeGreaterThanOrEqual(40);
    expect(md.icon.width, describeLook(md)).toBeLessThanOrEqual(56);
    expect(md.font, describeLook(md)).toBeGreaterThanOrEqual(12.5);
    expect(md.font, describeLook(md)).toBeLessThanOrEqual(15.5);
  });

  test('a long name stays on one line and a long description on at most two', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const long = 'A very long description that goes on and on and certainly needs more than two lines to show it all';
    const f = await importDash(page, context, [{
      name: 'Main',
      children: (id) => [tile(id('md'), 'An extremely long tile name', 0, 0, { description: long, placement: placement(0, 0, 2, 2) })]
    }]);
    await page.goto(f.path);
    const m = await page.locator(`.tab-canvas [data-node-id="${f.id('md')}"] button.entry`).evaluate((btn) => {
      const lh = (el: Element) => parseFloat(getComputedStyle(el).lineHeight);
      const t = btn.querySelector('.title')!, s = btn.querySelector('.subtitle')!;
      return { th: t.getBoundingClientRect().height, tl: lh(t), sh: s.getBoundingClientRect().height, sl: lh(s) };
    });
    expect(m.th, 'the name is one line').toBeLessThanOrEqual(m.tl * 1.5);
    expect(m.sh, 'the description is at most two lines').toBeLessThanOrEqual(m.sl * 2.5);
    expect(m.sh, 'the description shows (it is not dropped)').toBeGreaterThan(m.sl * 0.5);
    arranged(await look(page, f.id('md')), 'long text Medium');
  });

  test('in edit mode the arrangement is the same, and on a phone (stacked) too', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const f = await layoutDash(page, context);
    await page.goto(f.path);
    await enterEdit(page);
    for (const k of ['sm', 'md', 'lg']) arranged(await look(page, f.id(k)), `edit mode ${k}`);
    await page.goto(f.path);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator(`.tab-canvas [data-node-id="${f.id('md')}"] .icon svg`)).toBeVisible();
    for (const k of ['sm', 'md', 'lg']) {
      const l = await look(page, f.id(k));
      expect(l.fit, `phone ${k}: stacked tiles have no fit`).toBe('none');
      arranged(l, `phone ${k}`);
      expect(l.sub, `phone ${k}: shows its description`).not.toBeNull();
    }
  });
});
