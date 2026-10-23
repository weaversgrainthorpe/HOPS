import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCsrfToken } from '../helpers';

// M5 Task 5 — consistency acceptance (design/specs/2026-10-22-hops-v3-m5-folders-design.md §2, §5).
// "One view, one code base, one approach per thing": in a REAL browser, at 1280 and 1920 px, within
// 1 px:
//   - a Medium tile's box is identical on the tab, in a Medium-contents folder, in view and in edit
//     mode, and after dragging it tab → folder → tab;
//   - a Large tile dragged into a Small-contents folder is the Small box; back on the tab it is Large
//     again (its own size is never changed by being in a folder);
//   - the name sits above the icon everywhere (tab, folders of every contents size, minimised folder),
//     in view and edit mode;
//   - a minimised folder's tile is identical in view and edit mode.
// These replace the removed v3→v3 before/after box comparison (finer-grid.spec.ts, §2a).

let seq = 0;
const made: string[] = [];
type Child = Record<string, unknown>;
type Box = { x: number; y: number; width: number; height: number };
type AnyNode = { id: string; size?: string; placement?: unknown; content?: { children: AnyNode[] } };

const kid = (id: string, name: string, extra: Child = {}): Child => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, ...extra
});
const SPAN: Record<string, number> = { small: 1, medium: 2, large: 4 };
const tile = (id: string, name: string, x: number, y: number, size: 'small' | 'medium' | 'large' = 'medium'): Child =>
  kid(id, name, { size, placement: { x, y, w: SPAN[size], h: SPAN[size] } });
const folder = (id: string, name: string, box: { x: number; y: number; w: number; h: number }, children: Child[], extra: Child = {}): Child => ({
  id, kind: 'folder', name, display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
  placement: box, content: { children }, ...extra
});

/** Import one dashboard (M6 stored form, layoutVersion 2, one Main tab). */
async function importDash(page: Page, context: BrowserContext, children: (id: (s: string) => string) => Child[]) {
  const p = `m5c${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `M5 consistency ${p}`, order: 0, path: `/${p}`, revision: 1,
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
    multipart: { file: { name: 'm5c.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
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
async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}
const TOL = 1;
function sameSize(a: Box, b: Box, what: string) {
  expect(Math.abs(a.width - b.width), `${what}: width ${a.width} vs ${b.width}`).toBeLessThanOrEqual(TOL);
  expect(Math.abs(a.height - b.height), `${what}: height ${a.height} vs ${b.height}`).toBeLessThanOrEqual(TOL);
}
function sameBox(a: Box, b: Box, what: string) {
  sameSize(a, b, what);
  expect(Math.abs(a.x - b.x), `${what}: x ${a.x} vs ${b.x}`).toBeLessThanOrEqual(TOL);
  expect(Math.abs(a.y - b.y), `${what}: y ${a.y} vs ${b.y}`).toBeLessThanOrEqual(TOL);
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
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
  await page.locator('[aria-label="Exit Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toHaveCount(0);
}

/** A real mouse drag: press on `l`'s centre, travel in small steps to (x, y), release (the drop must be allowed). */
async function drag(page: Page, l: Locator, x: number, y: number) {
  const s = await box(l);
  const x0 = s.x + s.width / 2;
  const y0 = s.y + s.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(x0 + ((x - x0) * i) / 20, y0 + ((y - y0) * i) / 20);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(120);
  await expect(page.locator('.drag-layer .reason')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('.drag-layer')).toHaveCount(0);
}
/** Just inside an item's right edge, half way down: "after it", outside its centre (merge) zone. */
const rightEdge = (b: Box) => ({ x: b.x + b.width - 8, y: b.y + b.height / 2 });

async function savedRoot(page: Page, dashId: string): Promise<AnyNode[]> {
  const r = await page.request.get('/api/config');
  expect(r.status()).toBe(200);
  return (await r.json()).dashboards.find((x: { id: string }) => x.id === dashId).tabs[0].root.children;
}
function find(ns: AnyNode[], id: string): AnyNode | undefined {
  for (const n of ns) {
    if (n.id === id) return n;
    const r = n.content ? find(n.content.children, id) : undefined;
    if (r) return r;
  }
  return undefined;
}

/** Where the name and the icon are drawn in a tile (or a minimised folder's tile). */
async function nameAndIcon(l: Locator): Promise<{ name: Box; icon: Box }> {
  return l.evaluate((cell) => {
    const r = (el: Element | null) => {
      if (!el) throw new Error('missing name or icon in ' + cell.getAttribute('data-node-id'));
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, width: b.width, height: b.height };
    };
    const minimised = cell.querySelector('.folder-collapsed-tile');
    if (minimised) return { name: r(minimised.querySelector('.collapsed-name')), icon: r(minimised.querySelector('.preview-grid')) };
    const btn = cell.querySelector('button.entry');
    return { name: r(btn?.querySelector('.title') ?? null), icon: r(btn?.querySelector('.icon svg, .icon img') ?? null) };
  });
}
async function nameAboveIcon(page: Page, ids: string[], where: string) {
  for (const id of ids) {
    const { name, icon } = await nameAndIcon(node(page, id));
    expect(name.height, `${where} ${id}: the name is drawn`).toBeGreaterThan(0);
    expect(name.y + name.height, `${where} ${id}: the name is above the icon`).toBeLessThanOrEqual(icon.y + 0.5);
  }
}

for (const [width, height] of [[1280, 1000], [1920, 1080]] as const) {
  test.describe(`M5 consistency at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test('a Medium tile is the same box on the tab, in a Medium folder, in view and edit mode, and after tab → folder → tab', async ({ page, context }) => {
      const f = await importDash(page, context, (id) => [
        tile(id('m'), 'Mover', 0, 0),
        tile(id('ref'), 'Stays', 2, 0),
        folder(id('fm'), 'Medium box', { x: 6, y: 0, w: 14, h: 6 }, [kid(id('k1'), 'Inside', { size: 'large' }), kid(id('k2'), 'Second')]),
        tile(id('anchor'), 'Anchor', 22, 12)
      ]);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(f.path);
      await expect(node(page, f.id('m'))).toBeVisible();
      const tab = await box(node(page, f.id('m')));
      const view = { m: tab, ref: await box(node(page, f.id('ref'))), k1: await box(node(page, f.id('k1'))), k2: await box(node(page, f.id('k2'))) };
      // In a Medium-contents folder every item is the Medium box (k1's own size is Large).
      sameSize(view.k1, tab, 'view: in a Medium folder (own size Large)');
      sameSize(view.k2, tab, 'view: in a Medium folder');
      sameSize(view.ref, tab, 'view: another Medium tile on the tab');

      await enterEdit(page);
      for (const k of ['m', 'ref', 'k1', 'k2'] as const) sameBox(await box(node(page, f.id(k))), view[k], `edit vs view: ${k}`);

      // Tab → folder: dropped after the last item, it is the Medium box there.
      const to = rightEdge(await box(node(page, f.id('k2'))));
      await drag(page, node(page, f.id('m')), to.x, to.y);
      await expect(node(page, f.id('fm')).locator(`[data-node-id="${f.id('m')}"]`)).toHaveCount(1);
      sameSize(await box(node(page, f.id('m'))), tab, 'edit: dragged into the folder');
      sameSize(await box(node(page, f.id('k1'))), tab, 'edit: the folder item beside it');

      // Folder → tab: back where it started (the cell it left is free), the same box as before.
      await drag(page, node(page, f.id('m')), tab.x + tab.width / 2, tab.y + tab.height / 2);
      await expect(node(page, f.id('fm')).locator(`[data-node-id="${f.id('m')}"]`)).toHaveCount(0);
      sameBox(await box(node(page, f.id('m'))), tab, 'edit: dragged back onto the tab');

      // And once more into the folder, saved, in view mode.
      const again = rightEdge(await box(node(page, f.id('k2'))));
      await drag(page, node(page, f.id('m')), again.x, again.y);
      await saveAndExit(page);
      sameSize(await box(node(page, f.id('m'))), tab, 'view after save: in the folder');
      sameBox(await box(node(page, f.id('ref'))), view.ref, 'view after save: the tab tile');
      const root = await savedRoot(page, f.id('dash'));
      expect(find(root, f.id('m'))).toMatchObject({ size: 'medium' });
      expect(find(root, f.id('m'))?.placement).toBeUndefined();
      expect(errors).toEqual([]);
    });

    test('a Large tile dragged into a Small-contents folder is the Small box; back on the tab it is Large again', async ({ page, context }) => {
      const f = await importDash(page, context, (id) => [
        tile(id('big'), 'Big', 0, 0, 'large'),
        tile(id('sm'), 'Small ref', 4, 0, 'small'),
        folder(id('fs'), 'Small box', { x: 6, y: 0, w: 14, h: 6 }, [kid(id('s1'), 'Ess')], { contentSize: 'small' }),
        tile(id('anchor'), 'Anchor', 22, 12)
      ]);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(f.path);
      await expect(node(page, f.id('big'))).toBeVisible();
      const large = await box(node(page, f.id('big')));
      const small = await box(node(page, f.id('sm')));
      expect(large.width, 'Large is bigger than Small').toBeGreaterThan(small.width * 3);
      sameSize(await box(node(page, f.id('s1'))), small, 'view: a Medium tile in a Small folder');

      await enterEdit(page);
      const to = rightEdge(await box(node(page, f.id('s1'))));
      // The right edge of a Small item is close to its centre: aim just past it instead.
      const s1 = await box(node(page, f.id('s1')));
      await drag(page, node(page, f.id('big')), Math.max(to.x, s1.x + s1.width + 6), to.y);
      await expect(node(page, f.id('fs')).locator(`[data-node-id="${f.id('big')}"]`)).toHaveCount(1);
      sameSize(await box(node(page, f.id('big'))), small, 'edit: Large in a Small folder');

      await drag(page, node(page, f.id('big')), large.x + small.width / 2 + 2, large.y + small.height / 2 + 2);
      await expect(node(page, f.id('fs')).locator(`[data-node-id="${f.id('big')}"]`)).toHaveCount(0);
      sameSize(await box(node(page, f.id('big'))), large, 'edit: back on the tab');

      await saveAndExit(page);
      sameBox(await box(node(page, f.id('big'))), large, 'view after save: back on the tab');
      const root = await savedRoot(page, f.id('dash'));
      expect(find(root, f.id('big'))).toMatchObject({ size: 'large', placement: { w: 4, h: 4 } });
      expect(errors).toEqual([]);
    });

    test('the name is above the icon everywhere, and a minimised folder is the same tile in view and edit mode', async ({ page, context }) => {
      const f = await importDash(page, context, (id) => [
        tile(id('ts'), 'Small tab', 0, 0, 'small'),
        tile(id('tm'), 'Medium tab', 1, 0),
        tile(id('tl'), 'Large tab', 3, 0, 'large'),
        folder(id('mini'), 'Mini', { x: 8, y: 0, w: 6, h: 6 }, [kid(id('n1'), 'N1'), kid(id('n2'), 'N2')], { display: 'collapsed' }),
        folder(id('fs'), 'Small contents', { x: 0, y: 6, w: 7, h: 6 }, [kid(id('fs1'), 'Fs1')], { contentSize: 'small' }),
        folder(id('fm'), 'Medium contents', { x: 8, y: 6, w: 7, h: 6 }, [kid(id('fm1'), 'Fm1')]),
        folder(id('fl'), 'Large contents', { x: 16, y: 0, w: 8, h: 10 }, [kid(id('fl1'), 'Fl1', { size: 'small' })], { contentSize: 'large' })
      ]);
      const ids = ['ts', 'tm', 'tl', 'mini', 'fs1', 'fm1', 'fl1'].map(f.id);
      await page.goto(f.path);
      await expect(node(page, f.id('tm'))).toBeVisible();
      await nameAboveIcon(page, ids, 'view');
      const face = () => node(page, f.id('mini')).locator('.folder-collapsed-tile');
      const mini = await box(node(page, f.id('mini')));
      const miniFace = await box(face());
      sameSize(mini, await box(node(page, f.id('tm'))), 'view: a Medium minimised folder is the Medium tile box');
      sameSize(miniFace, await box(node(page, f.id('tm'))), 'view: the minimised folder tile is the Medium tile box');
      await enterEdit(page);
      await nameAboveIcon(page, ids, 'edit');
      sameBox(await box(node(page, f.id('mini'))), mini, 'edit vs view: the minimised folder');
      sameBox(await box(face()), miniFace, 'edit vs view: the minimised folder tile');
    });

    test('the M5 Showcase: overfull folders page; minimised folders are the tile of their own size', async ({ page, context }) => {
      // The bundled Showcase fixture (M5 form), every id prefixed so this copy never collides with another.
      const fixture = JSON.parse(fs.readFileSync(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend/internal/configdoc/testdata/v3_showcase_export.json'), 'utf8'));
      const p = `m5csc${Date.now().toString(36)}${(seq++).toString(36)}`;
      const id = (s: string) => `${p}-${s}`;
      const dash = fixture.config.dashboards[0];
      const prefix = (n: { id: string; content?: { children: unknown[] }; root?: { children: unknown[] } }) => {
        n.id = id(n.id);
        for (const c of (n.content ?? n.root)?.children ?? []) prefix(c as typeof n);
      };
      prefix(dash);
      for (const t of dash.tabs) prefix(t);
      dash.path = `/${p}`;
      dash.name = `Showcase ${p}`;
      const r = await page.request.post('/api/config/import', {
        headers: { 'X-CSRF-Token': await getCsrfToken(context) },
        multipart: { file: { name: 'sc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) } }
      });
      expect(r.status(), await r.text()).toBe(200);
      made.push(dash.id);
      await page.goto(dash.path);
      const tabOf = (n: string) => page.getByRole('tab', { name: `Switch to ${n} tab`, exact: true });

      await tabOf('Sizes').click();
      await expect(node(page, id('sc-fa'))).toBeVisible();
      // A minimised folder is the tile of its own size: Small, Medium and Large.
      for (const [folderId, tileId] of [['sc-f-min-s', 'sc-sz-s'], ['sc-f-min-m', 'sc-fa'], ['sc-f-min-l', 'sc-big']]) {
        await expect(node(page, id(folderId)).locator('.folder-collapsed-tile')).toBeVisible();
        sameSize(await box(node(page, id(folderId)).locator('.folder-collapsed-tile')), await box(node(page, id(tileId))), `${folderId} vs ${tileId}`);
      }
      // Small contents, overfull: a page bar; page 2 shows the rest.
      const small = node(page, id('sc-f-small'));
      await expect(small.locator('[data-page-bar="next"]')).toBeEnabled();
      sameSize(await box(small.locator('[data-folder-page] [data-node-id]').first()), await box(node(page, id('sc-sz-s'))), 'a Small-contents item');
      await small.locator('[data-page-bar="next"]').click();
      await expect(small.locator('[data-page-bar="prev"]')).toBeEnabled();
      await expect(small.locator('[data-folder-page] [data-node-id]').first()).toBeVisible();
      // Large contents: a Small tile inside shows Large.
      sameSize(await box(node(page, id('sc-lg-2'))), await box(node(page, id('sc-big'))), 'a Large-contents item');

      await tabOf('Folders').click();
      const many = node(page, id('sc-f-many'));
      await expect(many.locator('[data-page-bar="next"]')).toBeEnabled();
      await many.locator('[data-page-bar="next"]').click();
      await many.locator('[data-page-bar="next"]').click();
      await expect(many.locator('[data-folder-page] [data-node-id]').first()).toBeVisible();
    });
  });
}
