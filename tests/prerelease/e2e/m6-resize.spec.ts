import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken, flourishesDone } from '../helpers';
// THE page model (the app's own pure geometry): a page's rows are asserted, not guessed.

// Folder resizing (Jonathan's report: "can drag left/right but not up/down … the height adjuster is
// well hidden"): height resizes from the bottom edge and the corner — past the bottom of the window
// too (the page scrolls on) — the limit is told, and the grips are visible in edit mode without
// hovering. REAL mouse drags in Chromium; every size is checked in the SAVED document.

let seq = 0;
const made: string[] = [];
type Child = Record<string, unknown>;
type AnyNode = { id: string; kind: string; display?: string; placement?: { x: number; y: number; w: number; h: number }; content?: { children: AnyNode[] } };

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

/** Import one dashboard (M6 stored form, layoutVersion 2, one Main tab). */
async function importDash(page: Page, context: BrowserContext, children: (id: (s: string) => string) => Child[]) {
  const p = `m5d${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `M5 drag ${p}`, order: 0, path: `/${p}`, revision: 1,
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
    multipart: { file: { name: 'm5d.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
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

const node = (page: Page, id: string) => page.locator(`.tab-canvas [data-node-id="${id}"]`).first();
const box = async (l: Locator) => {
  await flourishesDone(l.page()); // §9: boxes at rest
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
};

/** Open the dashboard and enter edit mode; any page error fails the test. */
async function openEditing(page: Page, path: string, first: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(path);
  await expect(node(page, first)).toBeVisible();
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  return errors;
}

/** Press at (x0, y0) and travel in small steps to (x1, y1), as a person does (no release). */
async function dragTo(page: Page, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(16);
  }
}

/** Move (still pressed) in small steps to (x, y). */
async function glide(page: Page, from: { x: number; y: number }, x: number, y: number) {
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + ((x - from.x) * i) / 10, from.y + ((y - from.y) * i) / 10);
    await page.waitForTimeout(16);
  }
}

/** Grab `l` at its centre and drag to (x, y); the highlight must be an allowed target. */
async function dragCentre(page: Page, l: Locator, x: number, y: number) {
  const s = await box(l);
  await dragTo(page, s.x + s.width / 2, s.y + s.height / 2, x, y);
  await page.waitForTimeout(120);
}

async function allowedThenDrop(page: Page) {
  await expect(page.locator('.drag-layer .reason')).toHaveCount(0);
  await page.mouse.up();
}

async function saveDraft(page: Page) {
  const save = page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ });
  await expect(save).toBeEnabled();
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await save.click();
  const r = await saved;
  expect(r.status(), await r.text()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
}

/** The saved tab root (GET /api/config). */
async function savedRoot(page: Page, dashId: string): Promise<AnyNode[]> {
  const r = await page.request.get('/api/config');
  expect(r.status()).toBe(200);
  const d = (await r.json()).dashboards.find((x: { id: string }) => x.id === dashId);
  expect(d, 'the dashboard is saved').toBeTruthy();
  return d.tabs[0].root.children;
}
function find(ns: AnyNode[], id: string): AnyNode | undefined {
  for (const n of ns) {
    if (n.id === id) return n;
    const r = n.content ? find(n.content.children, id) : undefined;
    if (r) return r;
  }
  return undefined;
}


/** The colour (r, g, b, a) of a CSS colour string as the browser resolves it. */
type RGBA = [number, number, number, number];
function lum([r, g, b]: RGBA): number {
  const c = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
const contrast = (a: RGBA, b: RGBA) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

/** The grip's drawn colour, and what is behind it on the item and on the page. */
async function gripColours(page: Page, handle: Locator): Promise<{ grip: RGBA; item: RGBA; page: RGBA; opacity: number }> {
  return handle.evaluate((el) => {
    const parse = (c: string): [number, number, number, number] => {
      const cv = document.createElement('canvas').getContext('2d')!;
      cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1);
      const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3]];
    };
    const before = getComputedStyle(el, '::before');
    const gripC = before.backgroundColor !== 'rgba(0, 0, 0, 0)' ? before.backgroundColor : before.borderRightColor;
    // Behind the grip on the item: the first painted layer under a point just inside the box.
    const r = el.getBoundingClientRect();
    const item = el.closest('[data-node-id]')!;
    const ib = item.getBoundingClientRect();
    const x = Math.min(r.left + r.width / 2, ib.right - 6), y = Math.min(r.top + r.height / 2, ib.bottom - 6);
    let itemC = '';
    for (const e of document.elementsFromPoint(x, y)) {
      if (e === el || !item.contains(e)) continue;
      const cs = getComputedStyle(e);
      const fill = e instanceof SVGElement ? cs.fill : '';
      if (fill && fill !== 'none' && !fill.startsWith('url')) { itemC = fill; break; }
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') { itemC = cs.backgroundColor; break; }
    }
    const pageC = getComputedStyle(document.body).backgroundColor;
    return { grip: parse(gripC), item: parse(itemC || pageC), page: parse(pageC), opacity: Number(before.opacity) };
  });
}

test('the bottom edge resizes a folder in height; the saved layout has the new height', async ({ page, context }) => {
  const f = await importDash(page, context, (id) => [folder(id('f'), 'Box', { x: 0, y: 0, w: 12, h: 6 }, kids(id, 3))]);
  const errors = await openEditing(page, f.path, f.id('f'));
  const fbox = node(page, f.id('f'));
  const f0 = await box(fbox);
  const cell = f0.width / 12;
  const bb = await box(fbox.locator('[data-resize="bottom"]'));
  await dragTo(page, bb.x + bb.width / 3, bb.y + bb.height / 2, bb.x + bb.width / 3, bb.y + bb.height / 2 + 3 * cell);
  await page.waitForTimeout(120);
  await expect(page.locator('.drag-layer .target')).toBeVisible();
  await expect(page.locator('[data-resize-limit]')).toHaveCount(0);
  await page.mouse.up();
  await saveDraft(page);
  expect(find(await savedRoot(page, f.id('dash')), f.id('f'))!.placement).toMatchObject({ x: 0, y: 0, w: 12, h: 9 });
  const f1 = await box(fbox);
  expect(Math.abs(f1.height - 9 * cell)).toBeLessThanOrEqual(1);
  expect(Math.abs(f1.width - f0.width)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('the corner changes both width and height', async ({ page, context }) => {
  const f = await importDash(page, context, (id) => [folder(id('f'), 'Box', { x: 0, y: 0, w: 8, h: 6 }, kids(id, 3))]);
  const errors = await openEditing(page, f.path, f.id('f'));
  const fbox = node(page, f.id('f'));
  const cell = (await box(fbox)).width / 8;
  const cb = await box(fbox.locator('[data-resize="corner"]'));
  const [x, y] = [cb.x + cb.width / 2, cb.y + cb.height / 2];
  await dragTo(page, x, y, x + 2 * cell, y + 2 * cell);
  await page.waitForTimeout(120);
  await page.mouse.up();
  await saveDraft(page);
  expect(find(await savedRoot(page, f.id('dash')), f.id('f'))!.placement).toMatchObject({ w: 10, h: 8 });
  expect(errors).toEqual([]);
});

test('a folder at the bottom of the page grows past the bottom of the window: the page scrolls on', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const f = await importDash(page, context, (id) => [tile(id('t'), 'Tee', 0, 0), folder(id('f'), 'Box', { x: 0, y: 8, w: 12, h: 6 }, kids(id, 3))]);
  const errors = await openEditing(page, f.path, f.id('t'));
  await expect(node(page, f.id('f'))).toBeVisible();
  // Scrolled to the very bottom (re-scrolled until the page has settled at its full height).
  await page.waitForFunction(() => {
    window.scrollTo({ top: 1e6, behavior: 'instant' });
    return window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
  });
  await page.waitForTimeout(200);
  const fbox = node(page, f.id('f'));
  const cb = await box(fbox.locator('[data-resize="corner"]'));
  const [x, y] = [cb.x + cb.width / 2, cb.y + cb.height / 2];
  await dragTo(page, x, y, x, 715); // to the window's bottom edge, and held there
  await page.waitForTimeout(1200);
  await page.mouse.move(x, 716);
  await page.waitForTimeout(150);
  await page.mouse.up();
  await saveDraft(page);
  const h = find(await savedRoot(page, f.id('dash')), f.id('f'))!.placement!.h;
  expect(h, 'grew well past what fits on screen').toBeGreaterThanOrEqual(10);
  expect(errors).toEqual([]);
});

test('below the minimum height the resize stops there and says so', async ({ page, context }) => {
  const f = await importDash(page, context, (id) => [folder(id('f'), 'Box', { x: 0, y: 0, w: 12, h: 8 }, kids(id, 3))]);
  const errors = await openEditing(page, f.path, f.id('f'));
  const fbox = node(page, f.id('f'));
  const f0 = await box(fbox);
  const bb = await box(fbox.locator('[data-resize="bottom"]'));
  await dragTo(page, bb.x + bb.width / 3, bb.y + bb.height / 2, bb.x + bb.width / 3, f0.y + 10);
  await page.waitForTimeout(120);
  const limit = page.locator('[data-resize-limit]');
  await expect(limit).toBeVisible();
  await expect(limit).toContainText(/can't be any shorter/i);
  await page.mouse.up();
  await saveDraft(page);
  expect(find(await savedRoot(page, f.id('dash')), f.id('f'))!.placement).toMatchObject({ w: 12, h: 4 }); // minOpenFolderCells('medium') at the M6 §13 reference cell
  expect(errors).toEqual([]);
});

test('in edit mode the resize grips are visible without hovering, clear of the controls; tiles (sized by Size) have none', async ({ page, context }) => {
  const f = await importDash(page, context, (id) => [
    tile(id('t'), 'Tee', 14, 0),
    folder(id('f'), 'Box', { x: 0, y: 0, w: 12, h: 8 }, kids(id, 40)), // paged: it has a page bar
    folder(id('s'), 'Tabbed', { x: 0, y: 8, w: 8, h: 7 }, kids(id, 2, 'Z'), { shape: 'folder-flat' })
  ]);
  const errors = await openEditing(page, f.path, f.id('t'));
  await page.mouse.move(1, 1); // nothing hovered
  for (const fid of [f.id('f'), f.id('s')]) {
    const fbox = node(page, fid);
    for (const [edge, what] of [['right', 'width'], ['bottom', 'height'], ['corner', 'width and height']] as const) {
      const h = fbox.locator(`[data-resize="${edge}"]`);
      await expect(h).toBeVisible();
      await h.scrollIntoViewIfNeeded();
      await page.mouse.move(1, 1); // nothing hovered
      await expect(h).toHaveAttribute('aria-label', new RegExp(`^Drag to change ${what} of `));
      await expect(h).toHaveAttribute('title', new RegExp(`^Drag to change ${what}`));
      const b = await box(h);
      expect(Math.min(b.width, b.height), `${edge}: hit area`).toBeGreaterThanOrEqual(12);
      // The handle is what the pointer meets there (not the item's controls, page bar or a neighbour).
      const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.getAttribute('data-resize') ?? `${e?.tagName}.${e?.className}`; }, [b.x + b.width / 2, b.y + b.height / 2]);
      expect(hit, `${edge}: on top`).toBe(edge);
      const c = await gripColours(page, h);
      expect(c.opacity, `${edge}: shown without hover`).toBeGreaterThanOrEqual(0.85);
      expect(contrast(c.grip, c.page), `${edge}: grip vs page`).toBeGreaterThanOrEqual(3);
      expect(contrast(c.grip, c.item), `${edge}: grip vs item`).toBeGreaterThanOrEqual(3);
    }
  }
  // Never over the folder's own controls: its edit handle and page bar keep their own hit areas.
  const fbox = node(page, f.id('f'));
  const bar = await box(fbox.locator('nav.page-bar'));
  for (const edge of ['right', 'bottom', 'corner']) {
    const b = await box(fbox.locator(`[data-resize="${edge}"]`));
    const overlaps = b.x < bar.x + bar.width && bar.x < b.x + b.width && b.y < bar.y + bar.height && bar.y < b.y + b.height;
    expect(overlaps, `${edge} clear of the page bar`).toBe(false);
  }
  await expect(node(page, f.id('t')).locator('[data-resize]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Follow-up (Jonathan): the minimum is ONE value on every drag of a nested folder (tiles + a
// sub-folder); the refusal shows only at that minimum, and the release lands exactly on it.
const nestedFolder = (id: (s: string) => string) => [
  tile(id('t'), 'Tee', 0, 0),
  // As on Jonathan's dev: a Simple tab folder holding an Open flap sub-folder, nested 4 deep.
  folder(id('f'), 'Level 1', { x: 0, y: 2, w: 22, h: 10 }, [
    kid(id('a'), 'A'), kid(id('b'), 'B'), kid(id('c'), 'C'),
    folder(id('s'), 'Level 2', null, [
      kid(id('d'), 'D'), kid(id('e'), 'E'),
      folder(id('s3'), 'Level 3', null, [...kids(id, 3, 'Z'), folder(id('s4'), 'Level 4', null, [folder(id('s5'), 'New folder', null, [], { display: 'collapsed', shape: 'folder-flat' })], { display: 'collapsed' })], { display: 'collapsed', shape: 'folder-outline' })
    ], { shape: 'folder-open' })
  ], { shape: 'simple-tab' })
];

/** Drag `id`'s bottom edge up in 8 px steps; the height (cells) of the target where the refusal first shows, and the steps. */
async function dragUpUntilRefused(page: Page, fbox: Locator, cell: number, maxPx: number) {
  const bb = await box(fbox.locator('[data-resize="bottom"]'));
  const x = bb.x + bb.width / 3, y = bb.y + bb.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const seen: number[] = [];
  let refusedAt: number | null = null;
  for (let dy = 8; dy <= maxPx; dy += 8) {
    await page.mouse.move(x, y - dy);
    await page.waitForTimeout(25);
    const t = page.locator('.drag-layer .target');
    const h = (await t.count()) ? Math.round((await t.first().boundingBox())!.height / cell) : NaN;
    seen.push(h);
    if (await page.locator('[data-resize-limit]').count()) {
      refusedAt = h;
      break;
    }
  }
  return { refusedAt, seen };
}

test('a nested folder: the minimum is the same on every drag, the refusal shows only there, and the release lands on it', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  const f = await importDash(page, context, nestedFolder);
  const errors = await openEditing(page, f.path, f.id('t'));
  const fbox = node(page, f.id('f'));
  const cell = (await box(fbox)).width / 22;
  const MIN_H = 4; // geometry.folderMinCells: Medium contents everywhere inside (M6 §13 reference cell)

  // 1. Taller than the minimum: no refusal on the way down to it; refused only at it.
  const first = await dragUpUntilRefused(page, fbox, cell, 9 * cell);
  expect(first.refusedAt, 'refused at the minimum').toBe(MIN_H);
  expect(first.seen.slice(0, -1).every((h) => h >= MIN_H), `never below the minimum: ${first.seen}`).toBe(true);
  await page.mouse.up();
  // The release agrees with the cue: exactly the minimum, drawn and in the draft.
  await expect.poll(async () => Math.round((await box(fbox)).height / cell)).toBe(MIN_H);

  // 2. Again (and once more drilled into the sub-folder): refused straight away, never smaller.
  for (const drilled of [false, true]) {
    if (drilled) {
      await node(page, f.id('s')).locator('.folder-collapsed-tile').focus();
      await page.keyboard.press('Enter');
      await expect(fbox.locator(`[data-folder-page][data-folder-id="${f.id('s')}"]`)).toBeVisible();
    }
    const again = await dragUpUntilRefused(page, fbox, cell, 4 * cell);
    expect(again.refusedAt, `refused again${drilled ? ' (drilled in)' : ''}`).toBe(MIN_H);
    await page.mouse.up();
    await expect.poll(async () => Math.round((await box(fbox)).height / cell)).toBe(MIN_H);
  }
  await saveDraft(page);
  expect(find(await savedRoot(page, f.id('dash')), f.id('f'))!.placement).toMatchObject({ w: 22, h: MIN_H });
  expect(errors).toEqual([]);
});

