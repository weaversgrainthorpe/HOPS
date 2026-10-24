import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCsrfToken } from '../helpers';

// M6 Task 3 (spec design/specs/2026-10-23-hops-v3-m6-folder-shapes-design.md §2, §3a): ONE FolderShape
// draws every folder state in each of the seven looks. In a REAL browser (layout needs Chromium):
//  - every shape at minimised, open and nested, in view and edit mode, at 1280 and 390 px;
//  - the content inset (geometry.shapeInset) holds every tile and the page bar; tiles are M5's size;
//  - tab shapes: the name on the tab, the minimise control at the top-right of the body (§3a.2);
//  - a nested box never shows an empty band above it (Ruling 1) — Rounded and a tab shape;
//  - the tab position; the dialog's picker previews; a taller look re-pages inside the minimum;
//  - the contrast warning.

const SHAPES = ['rounded', 'simple-tab', 'folder-flat', 'folder-paper', 'folder-outline', 'folder-cartoon', 'folder-open'] as const;
type Shape = (typeof SHAPES)[number];
const LABEL: Record<Shape, string> = {
  rounded: 'Rounded box', 'simple-tab': 'Simple tab', 'folder-flat': 'Folder (flat)', 'folder-paper': 'Folder with paper',
  'folder-outline': 'Folder (outlined)', 'folder-cartoon': 'Folder (cartoon)', 'folder-open': 'Folder (open flap)'
};
/** geometry.shapeInset: Rounded 9 / 49 / 9 / 9; a tab shape 9 / 73 / 9 / 9 (tab 24 + edge 1 + bar 40 + pad 8). */
const insetOf = (s: Shape) => ({ left: 9, top: s === 'rounded' ? 49 : 73, right: 9, bottom: 9 });

let seq = 0;
const made: string[] = [];
type Child = Record<string, unknown>;

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

async function importDash(page: Page, context: BrowserContext, children: (id: (s: string) => string) => Child[]) {
  const p = `m6s${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `M6 shapes ${p}`, order: 0, path: `/${p}`, revision: 1,
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
    multipart: { file: { name: 'm6s.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
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

type Box = { x: number; y: number; width: number; height: number };
const node = (page: Page, id: string) => page.locator(`.tab-canvas [data-node-id="${id}"]`).first();
const box = async (l: Locator): Promise<Box> => {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
};
const near = (a: number, b: number, what: string, tol = 1) => expect(Math.abs(a - b), `${what}: ${a} vs ${b}`).toBeLessThanOrEqual(tol);
function within(inner: Box, outer: { left: number; top: number; right: number; bottom: number }, what: string) {
  expect(inner.x, `${what}: left`).toBeGreaterThanOrEqual(outer.left - 0.5);
  expect(inner.y, `${what}: top`).toBeGreaterThanOrEqual(outer.top - 0.5);
  expect(inner.x + inner.width, `${what}: right`).toBeLessThanOrEqual(outer.right + 0.5);
  expect(inner.y + inner.height, `${what}: bottom`).toBeLessThanOrEqual(outer.bottom + 0.5);
}
async function enterEdit(page: Page) {
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
}
async function saveAndExit(page: Page) {
  const save = page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ });
  await expect(save).toBeEnabled();
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await save.click();
  const r = await saved;
  expect(r.status(), await r.text()).toBe(200);
  await page.locator('[aria-label="Exit Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toHaveCount(0);
}
async function drilled(page: Page, dash: string, folderId: string, path: string[]) {
  await page.evaluate((d) => {
    localStorage.setItem(`hops.folderNav.${d.dash}`, JSON.stringify({ page: {}, drill: { [d.f]: d.path } }));
  }, { dash, f: folderId, path });
}

/** One dashboard per shape: an open folder (12 items, a sub-folder first) that pages, a minimised one, a tab tile. */
const fixture = (shape: Shape) => (id: (s: string) => string) => [
  folder(id('o'), 'Services', { x: 0, y: 0, w: 12, h: 7 }, [
    folder(id('sub'), 'Media', null, kids(id, 3, 'S'), { shape, color: '#0891b2' }),
    ...kids(id, 12)
  ], { shape, color: '#d97706' }),
  folder(id('m'), 'Mini', { x: 13, y: 0, w: 6, h: 7 }, kids(id, 3, 'M'), { shape, display: 'collapsed', color: '#7c3aed' }),
  tile(id('tt'), 'TabTile', 20, 0)
];

/** The open folder's content inset in the page, and every item on its page (and its page bar) inside it. */
async function checkInset(page: Page, shape: Shape, oid: string, tt: Box, what: string) {
  const o = node(page, oid);
  const b = await box(o);
  const ins = insetOf(shape);
  const area = { left: b.x + ins.left, top: b.y + ins.top, right: b.x + b.width - ins.right, bottom: b.y + b.height - ins.bottom };
  const items = o.locator('[data-folder-page] [data-container-id] > [data-node-id]');
  const n = await items.count();
  expect(n, `${what}: items drawn`).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const ib = await box(items.nth(i));
    within(ib, area, `${what}: item ${i}`);
    // Tiles inside every shape are M5's (the tab tile's) size.
    near(ib.width, tt.width, `${what}: item ${i} width = tab tile`);
    near(ib.height, tt.height, `${what}: item ${i} height = tab tile`);
  }
  const bar = o.locator('.page-bar');
  if ((await bar.count()) > 0) within(await box(bar.first()), area, `${what}: page bar`);
  return { b, n };
}

/** A tab shape: the name on its tab (in the tab allowance), the minimise control at the body's top-right. */
async function checkTabAndControls(page: Page, shape: Shape, oid: string, name: string, what: string) {
  const o = node(page, oid);
  const b = await box(o);
  const minimise = o.locator(':scope > .folder-header [data-folder-minimise]');
  const mb = await box(minimise);
  if (shape === 'rounded') {
    await expect(o.locator(':scope > .folder-header h3')).toHaveText(name);
    await expect(o.locator('[data-folder-tab]')).toHaveCount(0);
    return;
  }
  const tab = o.locator(':scope > .folder-header > [data-folder-tab]');
  await expect(tab).toContainText(name);
  const tb = await box(tab);
  near(tb.y, b.y, `${what}: tab at the top`);
  near(tb.height, 24, `${what}: tab height`);
  expect(mb.y, `${what}: minimise below the tab (on the body)`).toBeGreaterThanOrEqual(b.y + 24);
  expect(mb.x + mb.width, `${what}: minimise at the right`).toBeGreaterThan(b.x + b.width * 0.8);
  // The drawn shape is there, in its state, and is decoration.
  const s = o.locator(':scope > [data-folder-shape]');
  await expect(s).toHaveAttribute('data-folder-shape', shape);
  await expect(s).toHaveAttribute('data-shape-state', 'open');
  await expect(s).toHaveAttribute('aria-hidden', 'true');
  // The SVG is drawn at the box's real size (measured), not a nominal one.
  const vb = await s.locator('svg.shape-svg').getAttribute('viewBox');
  const [, , vw, vh] = (vb ?? '').split(' ').map(Number);
  near(vw, b.width, `${what}: svg width`, 1.5);
  near(vh, b.height, `${what}: svg height`, 1.5);
}

/** The nested box: drawn in its own shape; its first row (tab or bar) at its very top — no empty band. */
async function checkNested(page: Page, shape: Shape, oid: string, sid: string, tt: Box, what: string) {
  const o = node(page, oid);
  const ob = await box(o);
  const nest = o.locator(`.nested-box[data-nested-folder="${sid}"]`);
  const nb = await box(nest);
  // It fills the open folder's body content area from its top (the body's 8px padding).
  near(nb.y, ob.y + insetOf(shape).top, `${what}: nested box at the body's content top`);
  if (shape === 'rounded') {
    await expect(nest.locator('[data-folder-tab]')).toHaveCount(0);
    const hb = await box(nest.locator(':scope > .nested-header'));
    near(hb.y, nb.y + 1, `${what}: Rounded nested bar right under its 1px border (no band)`);
  } else {
    await expect(nest.locator(':scope > [data-folder-shape]')).toHaveAttribute('data-shape-state', 'nested');
    const tab = nest.locator(':scope > .nested-header > [data-folder-tab]');
    await expect(tab).toContainText('Media');
    const tb = await box(tab);
    near(tb.y, nb.y, `${what}: nested tab at the box top (the tab fills the allowance, no band)`);
    const hb = await box(nest.locator(':scope > .nested-header'));
    near(hb.y, nb.y + 25, `${what}: nested bar right under the tab`);
  }
  // Ruling 1, pixel-level: the row just inside the top of the nested box is drawn (tab or bar), not
  // the parent's body showing through a gap. elementFromPoint at the tab/bar's top-left + 4px.
  const first = shape === 'rounded' ? nest.locator(':scope > .nested-header') : nest.locator(':scope > .nested-header > [data-folder-tab]');
  const fb = await box(first);
  const hit = await page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return e ? !!e.closest('.nested-box') : false;
  }, [fb.x + 6, nb.y + 3]);
  expect(hit, `${what}: the top 3px of the nested box are the nested box`).toBe(true);
  const items = nest.locator('[data-folder-page] [data-container-id] > [data-node-id]');
  const n = await items.count();
  expect(n, `${what}: nested items`).toBe(3);
  const inner = { left: nb.x + 1, top: nb.y + 24, right: nb.x + nb.width - 1, bottom: nb.y + nb.height - 1 };
  for (let i = 0; i < n; i++) {
    const ib = await box(items.nth(i));
    within(ib, inner, `${what}: nested item ${i}`);
    near(ib.width, tt.width, `${what}: nested item ${i} width = tab tile`);
  }
}

async function checkMinimised(page: Page, shape: Shape, mid: string, tt: Box, what: string) {
  const m = node(page, mid);
  const face = m.locator('.folder-collapsed-tile');
  const s = face.locator(':scope > [data-folder-shape]');
  await expect(s).toHaveAttribute('data-folder-shape', shape);
  await expect(s).toHaveAttribute('data-shape-state', 'minimised');
  const fb = await box(face);
  near(fb.width, tt.width, `${what}: minimised width = tab tile`);
  near(fb.height, tt.height, `${what}: minimised height = tab tile`);
  // Its icons are on the front, inside the tile.
  const cells = face.locator('.preview-cell');
  expect(await cells.count()).toBeGreaterThan(0);
  for (let i = 0; i < (await cells.count()); i++) {
    within(await box(cells.nth(i)), { left: fb.x, top: fb.y, right: fb.x + fb.width, bottom: fb.y + fb.height }, `${what}: icon ${i}`);
  }
}

for (const width of [1280, 390]) {
  test.describe(`M6 shapes at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const shape of SHAPES) {
      test(`${shape}: minimised, open and nested, in view and edit mode`, async ({ page, context }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const f = await importDash(page, context, fixture(shape));
        await page.goto(f.path);
        for (const mode of ['view', 'edit'] as const) {
          if (mode === 'edit') {
            // A phone has no edit button: edit mode is entered wide, then the window narrows (as a
            // tablet rotating) — the same folders must draw the same in it.
            if (width < 768) await page.setViewportSize({ width: 1280, height: 900 });
            await enterEdit(page);
            if (width < 768) await page.setViewportSize({ width, height: 900 });
          }
          const tt = await box(node(page, f.id('tt')));
          const what = `${shape} ${width} ${mode}`;
          await checkMinimised(page, shape, f.id('m'), tt, what);
          await checkInset(page, shape, f.id('o'), tt, `${what} open`);
          await checkTabAndControls(page, shape, f.id('o'), 'Services', `${what} open`);
          // Drill into the sub-folder (a click on its tile; in edit mode the open waits out a double-click).
          await node(page, f.id('o')).getByRole('button', { name: /^Media, folder with 3 items/ }).click();
          await expect(node(page, f.id('o')).locator(`.nested-box[data-nested-folder="${f.id('sub')}"]`)).toBeVisible();
          await checkNested(page, shape, f.id('o'), f.id('sub'), tt, `${what} nested`);
          // Back up: Rounded's title bar, a tab shape's tab.
          const up = shape === 'rounded'
            ? node(page, f.id('o')).locator(':scope > .folder-header h3 button')
            : node(page, f.id('o')).locator(':scope > .folder-header > [data-folder-tab][data-crumb] button');
          await up.click();
          await expect(node(page, f.id('o')).locator('.nested-box')).toHaveCount(0);
        }
        expect(errors).toEqual([]);
      });
    }
  });
}

test.describe('M6 keyboard focus ring (WCAG 2.4.7)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a tab-shape tile at opacity 0 and 0.3 shows a fully opaque, high-contrast focus ring on Tab', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('z'), 'Zero', { x: 0, y: 0, w: 6, h: 7 }, kids(id, 2, 'Z'), { shape: 'folder-flat', display: 'collapsed', color: '#d97706', opacity: 0 }),
      folder(id('t'), 'Third', { x: 8, y: 0, w: 6, h: 7 }, kids(id, 2, 'T'), { shape: 'folder-cartoon', display: 'collapsed', color: '#1e3a8a', opacity: 0.3 })
    ]);
    await page.goto(f.path);
    for (const k of ['z', 't']) {
      const face = node(page, f.id(k)).locator('.folder-collapsed-tile');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await expect(face).not.toBeFocused();
      const before = await face.screenshot();
      // Keyboard focus: Tab until the tile has it (so :focus-visible applies, as for a real keyboard user).
      let got = false;
      for (let i = 0; i < 80 && !got; i++) {
        await page.keyboard.press('Tab');
        got = await face.evaluate((e) => document.activeElement === e && e.matches(':focus-visible'));
      }
      expect(got, `${k}: reached by Tab`).toBe(true);
      // The ring: drawn, and its effective opacity (its own and every ancestor's up to the tile) is 1.
      const ring = await face.evaluate((tile) => {
        const rings = Array.from(tile.querySelectorAll<SVGElement>('[data-focus-ring] path'));
        let eff = 1;
        const strokes: string[] = [];
        let visible = rings.length > 0;
        for (const r of rings) {
          strokes.push(getComputedStyle(r).stroke);
          for (let e: Element | null = r; e && e !== tile; e = e.parentElement) {
            const cs = getComputedStyle(e);
            eff = Math.min(eff, Number(cs.opacity));
            if (cs.visibility === 'hidden' || cs.display === 'none') visible = false;
          }
        }
        return { n: rings.length, eff, visible, strokes };
      });
      expect(ring.n, `${k}: a two-tone ring`).toBe(2);
      expect(ring.visible).toBe(true);
      expect(ring.eff, `${k}: ring effective opacity`).toBe(1);
      // Two tones, black and white (21:1 to each other), so one of them is >= 3:1 against any surrounding colour.
      expect(ring.strokes.sort()).toEqual(['rgb(0, 0, 0)', 'rgb(255, 255, 255)']);
      // And it really paints: the tile's pixels change when it is focused.
      const after = await face.screenshot();
      expect(Buffer.compare(before, after), `${k}: focused pixels differ`).not.toBe(0);
    }
  });
});

test.describe('M6 tab position and the dialog', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the tab position puts the tab (label and drawn tab) left, centre or right', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('l'), 'Left', { x: 0, y: 0, w: 8, h: 7 }, kids(id, 2, 'L'), { shape: 'folder-flat', tabPosition: 'left' }),
      folder(id('c'), 'Centre', { x: 8, y: 0, w: 8, h: 7 }, kids(id, 2, 'C'), { shape: 'folder-paper', tabPosition: 'centre' }),
      folder(id('r'), 'Right', { x: 16, y: 0, w: 8, h: 7 }, kids(id, 2, 'R'), { shape: 'simple-tab', tabPosition: 'right' })
    ]);
    await page.goto(f.path);
    for (const [k, pos] of [['l', 'left'], ['c', 'centre'], ['r', 'right']] as const) {
      const o = node(page, f.id(k));
      const b = await box(o);
      const tab = o.locator('[data-folder-tab]');
      await expect(tab).toHaveAttribute('data-tab-position', pos);
      await expect(o.locator(':scope > [data-folder-shape]')).toHaveAttribute('data-tab-position', pos);
      const tb = await box(tab);
      const mid = tb.x + tb.width / 2 - b.x;
      if (pos === 'left') expect(mid).toBeLessThan(b.width / 3);
      if (pos === 'centre') near(mid, b.width / 2, 'centre tab', 1.5);
      if (pos === 'right') expect(mid).toBeGreaterThan((2 * b.width) / 3);
      // The drawn tab is under the label: the pixel above the label's middle is the shape (not the page).
      const painted = await page.evaluate(([x, y]) => {
        const e = document.elementFromPoint(x, y);
        return e?.closest('[data-folder-tab]') !== null;
      }, [tb.x + tb.width / 2, tb.y + 4]);
      expect(painted).toBe(true);
    }
  });

  test('the picker previews every look in the folder colour; a taller look re-pages inside the one minimum and is saved', async ({ page, context }) => {
    // Rounded at the Medium minimum (3 x 6) is two rows of one (Rounded draws no tab, so it has room);
    // a tab shape at the same box is one row and a page bar. The minimum has no shape parameter (§3a.4),
    // so the box (at or above it) never needs to grow for a look: it only re-pages.
    const f = await importDash(page, context, (id) => [
      folder(id('o'), 'Box', { x: 0, y: 0, w: 3, h: 6 }, kids(id, 3), { shape: 'rounded', color: '#2563eb' }),
      tile(id('tt'), 'TabTile', 10, 0)
    ]);
    await page.goto(f.path);
    await enterEdit(page);
    const before = await box(node(page, f.id('o')));
    await node(page, f.id('o')).dblclick({ position: { x: 10, y: 20 } });
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    const looks = dlg.getByRole('radiogroup', { name: 'Look' });
    await expect(looks.getByRole('radio')).toHaveCount(7);
    for (const s of SHAPES) {
      const choice = looks.locator('label').filter({ has: page.getByRole('radio', { name: LABEL[s], exact: true }) });
      await expect(choice.locator('[data-folder-shape]')).toHaveAttribute('data-folder-shape', s);
      const pb = await box(choice.locator('.look-shape'));
      expect(pb.width).toBeGreaterThan(40);
    }
    // The previews are in the folder's colour (its back panel: the colour darkened).
    const flatBack = looks.locator('label').filter({ hasText: 'Folder (flat)' }).locator('path.back');
    expect(await flatBack.getAttribute('fill')).toMatch(/^#[0-9a-f]{6}$/);
    await expect(dlg.getByRole('radiogroup', { name: 'Tab position' })).toHaveCount(0); // Rounded: no tab
    // A pointer picks a look by its preview card (the radio inside it is the keyboard control).
    await looks.locator('label').filter({ hasText: 'Folder (open flap)' }).click();
    await expect(looks.getByRole('radio', { name: 'Folder (open flap)' })).toBeChecked();
    const pos = dlg.getByRole('radiogroup', { name: 'Tab position' });
    await expect(pos).toBeVisible();
    await pos.getByRole('radio', { name: 'Right' }).check();
    await expect(looks.locator('[data-folder-shape="simple-tab"]')).toHaveAttribute('data-tab-position', 'right');
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await expect(dlg).toBeHidden();
    const o = node(page, f.id('o'));
    await expect(o.locator(':scope > [data-folder-shape]')).toHaveAttribute('data-folder-shape', 'folder-open');
    const after = await box(o);
    expect(after.height, 'the box never shrinks; it is at or above the one minimum').toBeGreaterThanOrEqual(before.height - 0.5);
    const tt = await box(node(page, f.id('tt')));
    const { n } = await checkInset(page, 'folder-open', f.id('o'), tt, 'after the look change');
    expect(n).toBe(1);
    await expect(o.locator('.page-bar')).toBeVisible();
    await saveAndExit(page);
    const cfg = await (await page.request.get('/api/config')).json();
    const saved = cfg.dashboards.find((d: { id: string }) => d.id === f.id('dash')).tabs[0].root.children.find((n: { id: string }) => n.id === f.id('o'));
    expect(saved.shape).toBe('folder-open');
    expect(saved.tabPosition).toBe('right');
    expect(saved.placement.h).toBeGreaterThanOrEqual(6);
  });

  test('the contrast warning: an explicit text colour that fails on the panels is shown; Auto clears it', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('o'), 'Pale', { x: 0, y: 0, w: 8, h: 7 }, kids(id, 2), { shape: 'folder-flat', color: '#fde68a', textColor: 'auto' })
    ]);
    await page.goto(f.path);
    // Auto on a pale colour draws dark text on the tab.
    const tabColour = await node(page, f.id('o')).evaluate((e) => getComputedStyle(e).color);
    expect(tabColour).toBe('rgb(0, 0, 0)');
    await enterEdit(page);
    await node(page, f.id('o')).dblclick({ position: { x: 10, y: 40 } });
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg.locator('[data-contrast-warning]')).toHaveCount(0);
    await dlg.getByRole('radio', { name: 'Light' }).check();
    await expect(dlg.locator('[data-contrast-warning]')).toContainText(/hard to read/i);
    await dlg.getByRole('radio', { name: 'Auto' }).check();
    await expect(dlg.locator('[data-contrast-warning]')).toHaveCount(0);
  });

  test('a dark colour gets light text on every tab shape (contrast-safe Auto)', async ({ page, context }) => {
    const f = await importDash(page, context, (id) =>
      SHAPES.filter((s) => s !== 'rounded' && s !== 'folder-outline').map((s, i) =>
        folder(id(`f${i}`), `F${i}`, { x: (i % 3) * 8, y: Math.floor(i / 3) * 7, w: 8, h: 7 }, kids(id, 1, `K${i}`), { shape: s, color: '#1e3a8a' })
      )
    );
    await page.goto(f.path);
    for (let i = 0; i < 5; i++) {
      const c = await node(page, f.id(`f${i}`)).locator('[data-folder-tab]').evaluate((e) => getComputedStyle(e).color);
      expect(c).toBe('rgb(255, 255, 255)');
    }
  });
});

// ---- M6 Task 4, Review Focus 1: consistency acceptance. "One view, one code base": in a REAL browser,
// at 1280 and 1920 px, a Medium tile's box is identical (within 1 px) on the tab and inside every one
// of the seven shapes — at the folder's own level and one level in (a nested box of the same shape) —
// in view mode and in edit mode. Edit mode moves nothing: every box is where view mode drew it.

const sameSize = (a: Box, b: Box, what: string) => {
  near(a.width, b.width, `${what}: width`);
  near(a.height, b.height, `${what}: height`);
};
const sameBox = (a: Box, b: Box, what: string) => {
  sameSize(a, b, what);
  near(a.x, b.x, `${what}: x`);
  near(a.y, b.y, `${what}: y`);
};

/** Every shape on one tab: an open Medium-contents folder of 2 Medium tiles and a sub-folder (same shape, 2 Medium tiles). */
const everyShape = (id: (s: string) => string) => [
  ...SHAPES.map((shape, i) =>
    folder(id(`f${i}`), `Look ${i}`, { x: (i % 3) * 8, y: Math.floor(i / 3) * 7, w: 8, h: 7 }, [
      kid(id(`f${i}a`), `A${i}`),
      kid(id(`f${i}b`), `B${i}`),
      folder(id(`f${i}s`), `Sub ${i}`, null, [kid(id(`f${i}sa`), `SA${i}`), kid(id(`f${i}sb`), `SB${i}`)], { shape, tabPosition: 'centre' })
    ], { shape, color: '#0d9488' })
  ),
  tile(id('tt'), 'TabTile', 8, 14)
];

for (const [width, height] of [[1280, 1000], [1920, 1080]] as const) {
  test.describe(`M6 consistency at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test('a Medium tile is the same box on the tab and inside each of the 7 shapes (open and nested), in view and edit mode', async ({ page, context }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const f = await importDash(page, context, everyShape);
      const top = SHAPES.flatMap((_, i) => [f.id(`f${i}a`), f.id(`f${i}b`)]);
      const inner = SHAPES.flatMap((_, i) => [f.id(`f${i}sa`), f.id(`f${i}sb`)]);
      const measure = async (ids: string[]) => {
        const out: Record<string, Box> = {};
        for (const k of [f.id('tt'), ...ids]) out[k] = await box(node(page, k));
        return out;
      };
      const asTabTile = (got: Record<string, Box>, tab: Box, mode: string) => {
        for (const [k, b] of Object.entries(got)) {
          const i = SHAPES.findIndex((_, j) => k.startsWith(f.id(`f${j}`)));
          sameSize(b, tab, `${mode}: ${k} (${i >= 0 ? SHAPES[i] : 'tab'}) = the tab tile`);
        }
      };

      // The folder's own level.
      await page.goto(f.path);
      await expect(node(page, f.id('tt'))).toBeVisible();
      for (let i = 0; i < SHAPES.length; i++) {
        await expect(node(page, f.id(`f${i}`)).locator(':scope > [data-folder-shape]')).toHaveAttribute('data-folder-shape', SHAPES[i]);
      }
      const tab = await box(node(page, f.id('tt')));
      const viewTop = await measure(top);
      asTabTile(viewTop, tab, 'view, open');
      await enterEdit(page);
      const editTop = await measure(top);
      for (const k of Object.keys(viewTop)) sameBox(editTop[k], viewTop[k], `edit vs view, open: ${k}`);
      asTabTile(editTop, tab, 'edit, open');
      await page.locator('[aria-label="Exit Edit Mode"]').click();
      await expect(page.getByRole('toolbar', { name: 'Editing' })).toHaveCount(0);

      // One level in: this browser is drilled into every sub-folder (each drawn as its parent's shape).
      await page.evaluate((d) => {
        localStorage.setItem(`hops.folderNav.${d.dash}`, JSON.stringify({ page: {}, drill: d.drill }));
      }, { dash: f.id('dash'), drill: Object.fromEntries(SHAPES.map((_, i) => [f.id(`f${i}`), [f.id(`f${i}s`)]])) });
      await page.reload();
      for (let i = 0; i < SHAPES.length; i++) {
        const nest = node(page, f.id(`f${i}`)).locator(`.nested-box[data-nested-folder="${f.id(`f${i}s`)}"]`);
        await expect(nest).toBeVisible();
        if (SHAPES[i] !== 'rounded') await expect(nest.locator(':scope > [data-folder-shape]')).toHaveAttribute('data-folder-shape', SHAPES[i]);
      }
      sameBox(await box(node(page, f.id('tt'))), tab, 'view, drilled: the tab tile');
      const viewIn = await measure(inner);
      asTabTile(viewIn, tab, 'view, nested');
      await enterEdit(page);
      const editIn = await measure(inner);
      for (const k of Object.keys(viewIn)) sameBox(editIn[k], viewIn[k], `edit vs view, nested: ${k}`);
      asTabTile(editIn, tab, 'edit, nested');
      expect(errors).toEqual([]);
    });
  });
}

// ---- M6 Task 4: the bundled Showcase's Shapes tab (backend/internal/configdoc/testdata/v3_showcase_export.json)
// draws what it stores: an open folder in every look, all three tab positions, looks nested 2 deep, and a
// Small minimised folder as the Small silhouette — every item the tab tile's size, in view and edit mode.
test.describe('M6 the Showcase Shapes tab', () => {
  test.use({ viewport: { width: 1280, height: 1400 } });

  test('every look, every tab position, nested looks and a Small minimised folder draw as stored', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const fixture = JSON.parse(fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend/internal/configdoc/testdata/v3_showcase_export.json'), 'utf8'));
    const p = `m6sc${Date.now().toString(36)}${(seq++).toString(36)}`;
    const dash = fixture.config.dashboards[0];
    const prefix = (n: { id: string; content?: { children: unknown[] }; root?: { children: unknown[] } }) => {
      n.id = `${p}-${n.id}`;
      for (const c of (n.content ?? n.root)?.children ?? []) prefix(c as typeof n);
    };
    prefix(dash);
    for (const t of dash.tabs) prefix(t);
    dash.path = `/${p}`;
    dash.name = `M6 Showcase ${p}`;
    const r = await page.request.post('/api/config/import', {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) },
      multipart: { file: { name: 'sc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...fixture, config: { ...fixture.config, dashboards: [dash] } })) } }
    });
    expect(r.status(), await r.text()).toBe(200);
    made.push(dash.id);
    const id = (s: string) => `${p}-${s}`;
    const tabKids: Child[] = dash.tabs.find((t: { name: string }) => t.name === 'Shapes').root.children;

    await page.goto(dash.path);
    await page.getByRole('tab', { name: 'Switch to Shapes tab', exact: true }).click();
    const ref = node(page, id('sc-sh-tile'));
    await expect(ref).toBeVisible();
    for (const mode of ['view', 'edit'] as const) {
      if (mode === 'edit') await enterEdit(page);
      const tt = await box(ref);
      const positions = new Set<string>();
      for (const shape of SHAPES) {
        const f = tabKids.find((n) => n.id === id(`sc-sh-${shape}`))!;
        const o = node(page, f.id as string);
        await expect(o.locator(':scope > [data-folder-shape]')).toHaveAttribute('data-folder-shape', shape);
        if (shape !== 'rounded') {
          await expect(o.locator(':scope > .folder-header > [data-folder-tab]')).toHaveAttribute('data-tab-position', f.tabPosition as string);
          positions.add(f.tabPosition as string);
        }
        await checkInset(page, shape, f.id as string, tt, `Showcase ${shape} ${mode}`);
      }
      expect([...positions].sort(), `${mode}: all three tab positions`).toEqual(['centre', 'left', 'right']);
      // The Small minimised folder: the Small silhouette (no name drawn; it stays the accessible name).
      const mini = node(page, id('sc-sh-min-s')).locator('.folder-collapsed-tile');
      await expect(mini.locator(':scope > [data-folder-shape]')).toHaveAttribute('data-shape-state', 'minimised');
      await expect(mini.locator(':scope > [data-folder-shape]')).toHaveAttribute('data-folder-shape', 'folder-cartoon');
      const mb = await box(mini);
      expect(Math.max(mb.width, mb.height), `${mode}: Small is a small tile`).toBeLessThan(84);
      await expect(mini.locator('.collapsed-name')).toHaveCount(0);
      await expect(mini).toHaveAccessibleName(/Minimised Small cartoon/);
    }
    // Nested looks 2 deep: Flat > Paper > Open flap, each drawn in its own look with its tab.
    await page.locator('[aria-label="Exit Edit Mode"]').click();
    await page.evaluate((d) => {
      localStorage.setItem(`hops.folderNav.${d.dash}`, JSON.stringify({ page: {}, drill: { [d.f]: d.path } }));
    }, { dash: dash.id, f: id('sc-sh-nest'), path: [id('sc-sh-nest-a'), id('sc-sh-nest-b')] });
    await page.reload();
    await page.getByRole('tab', { name: 'Switch to Shapes tab', exact: true }).click();
    const outer = node(page, id('sc-sh-nest'));
    await expect(outer.locator(':scope > [data-folder-shape]')).toHaveAttribute('data-folder-shape', 'folder-flat');
    const tt = await box(ref);
    for (const [sub, shape, pos] of [['sc-sh-nest-a', 'folder-paper', 'centre'], ['sc-sh-nest-b', 'folder-open', 'right']] as const) {
      const nest = outer.locator(`.nested-box[data-nested-folder="${id(sub)}"]`);
      await expect(nest).toBeVisible();
      await expect(nest.locator(':scope > [data-folder-shape]')).toHaveAttribute('data-folder-shape', shape);
      await expect(nest.locator(':scope > .nested-header > [data-folder-tab]')).toHaveAttribute('data-tab-position', pos);
    }
    const deep = outer.locator(`.nested-box[data-nested-folder="${id('sc-sh-nest-b')}"] [data-folder-page] [data-container-id] > [data-node-id]`);
    await expect(deep).toHaveCount(2);
    for (let i = 0; i < 2; i++) sameSize(await box(deep.nth(i)), tt, `nested 2 deep: item ${i} = the tab tile`);
    expect(errors).toEqual([]);
  });
});
