import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken } from '../helpers';
// THE page model (the app's own pure geometry): a page's rows are asserted, not guessed.
import { folderPaging, openFolderContentBox } from '../../../frontend/src/lib/layout/geometry';

// M5 Task 4 (design/specs/2026-10-22-hops-v3-m5-folders-design.md §3.4, §3.5, §3a.3, §3a.4, §3a.9):
// drag, drop and resize in the ordered, paged folder model. Every test is a REAL mouse drag in
// Chromium, and every result is checked in the SAVED document (not only on screen).

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
const orderOf = (ns: AnyNode[], folderId: string) => (find(ns, folderId)?.content?.children ?? []).map((n) => n.id);

/** A point just inside an item's left edge, half way down: "before it", outside its centre (merge) zone. */
const leftEdge = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + 8, y: b.y + b.height / 2 });

test.describe('M5 drag and drop in ordered, paged folders', () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  test('a tile from the tab goes into an open folder at the pointer (before the item under it)', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      tile(id('t'), 'Tee', 0, 0),
      folder(id('f'), 'Box', { x: 0, y: 3, w: 14, h: 6 }, kids(id, 4))
    ]);
    const errors = await openEditing(page, f.path, f.id('t'));
    const to = leftEdge(await box(node(page, f.id('k3'))));
    await dragCentre(page, node(page, f.id('t')), to.x, to.y);
    await expect(page.locator('.drag-layer .marker')).toBeVisible(); // where it will go
    await allowedThenDrop(page);
    await expect(node(page, f.id('f')).locator('[data-container-id] > [data-node-id]')).toHaveCount(5);
    await saveDraft(page);
    const root = await savedRoot(page, f.id('dash'));
    expect(orderOf(root, f.id('f'))).toEqual(['k1', 'k2', 't', 'k3', 'k4'].map(f.id));
    expect(find(root, f.id('t'))?.placement, 'no placement inside a folder').toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('reordering within a folder: an item dragged before another takes its place in the order', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [folder(id('f'), 'Box', { x: 0, y: 0, w: 14, h: 6 }, kids(id, 4))]);
    const errors = await openEditing(page, f.path, f.id('f'));
    const to = leftEdge(await box(node(page, f.id('k4'))));
    await dragCentre(page, node(page, f.id('k1')), to.x, to.y);
    await allowedThenDrop(page);
    await saveDraft(page);
    expect(orderOf(await savedRoot(page, f.id('dash')), f.id('f'))).toEqual(['k2', 'k3', 'k1', 'k4'].map(f.id));
    expect(errors).toEqual([]);
  });

  test('out to the tab: a tile lands at the pointer; a sub-folder this browser had open lands MINIMISED (§3a.3)', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('f'), 'Box', { x: 0, y: 0, w: 14, h: 6 }, [...kids(id, 2), folder(id('s'), 'Sub', null, kids(id, 2, 'Z'))])
    ]);
    // This browser remembers the sub-folder as open, on its page 2 and drilled (from an earlier life).
    await page.goto(f.path);
    await page.evaluate((d) => {
      localStorage.setItem(`hops.folderView.${d.dash}`, JSON.stringify({ [d.s]: 'expanded' }));
      localStorage.setItem(`hops.folderNav.${d.dash}`, JSON.stringify({ page: { [d.s]: 1 }, drill: {} }));
    }, { dash: f.id('dash'), s: f.id('s') });
    const errors = await openEditing(page, f.path, f.id('f'));
    const fb = await box(node(page, f.id('f')));
    await dragCentre(page, node(page, f.id('k2')), fb.x + 60, fb.y + fb.height + 80);
    await allowedThenDrop(page);
    await dragCentre(page, node(page, f.id('s')), fb.x + fb.width + 250, fb.y + 60);
    await allowedThenDrop(page);
    await saveDraft(page);
    const root = await savedRoot(page, f.id('dash'));
    expect(root.map((n) => n.id).sort()).toEqual([f.id('f'), f.id('k2'), f.id('s')].sort());
    expect(find(root, f.id('k2'))?.placement).toMatchObject({ w: 2, h: 2 });
    // Its default open box: Medium x 3 by x 2 (6 x 4), raised to the Medium minimum (6 high in M6, Ruling 7a).
    expect(find(root, f.id('s'))).toMatchObject({ display: 'collapsed', placement: { w: 6, h: 6 } });
    expect(orderOf(root, f.id('f'))).toEqual([f.id('k1')]);
    // View mode applies this browser's memory: the moved-out sub-folder is still minimised.
    await page.locator('[aria-label="Exit Edit Mode"]').click();
    await expect(node(page, f.id('s'))).toHaveClass(/collapsed/);
    await page.reload();
    await expect(node(page, f.id('s'))).toHaveClass(/collapsed/);
    expect(errors).toEqual([]);
  });

  test('folder to folder: an open folder dropped on another folder\'s title bar goes in at its end', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('one'), 'One', { x: 0, y: 0, w: 8, h: 6 }, kids(id, 1, 'A')),
      folder(id('two'), 'Two', { x: 12, y: 0, w: 12, h: 6 }, kids(id, 2, 'B'))
    ]);
    const errors = await openEditing(page, f.path, f.id('one'));
    const onebar = await box(node(page, f.id('one')).locator('.folder-header'));
    const twobar = await box(node(page, f.id('two')).locator('.folder-header'));
    await dragTo(page, onebar.x + 60, onebar.y + onebar.height / 2, twobar.x + 80, twobar.y + twobar.height / 2);
    await page.waitForTimeout(120);
    await expect(page.locator('.drag-layer .cue')).toContainText('Into "Two"');
    await allowedThenDrop(page);
    await saveDraft(page);
    const root = await savedRoot(page, f.id('dash'));
    expect(orderOf(root, f.id('two'))).toEqual(['b1', 'b2', 'one'].map(f.id));
    expect(find(root, f.id('one'))?.placement).toBeUndefined();
    expect(orderOf(root, f.id('one'))).toEqual([f.id('a1')]);
    expect(errors).toEqual([]);
  });

  test('onto a sub-folder tile: its centre puts the item inside (at its end); its edge puts it before the sub-folder', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      tile(id('t'), 'Tee', 0, 0),
      tile(id('u'), 'You', 2, 0),
      folder(id('f'), 'Box', { x: 0, y: 3, w: 14, h: 6 }, [kid(id('k1'), 'K1'), folder(id('s'), 'Sub', null, [kid(id('z'), 'Z')])])
    ]);
    const errors = await openEditing(page, f.path, f.id('t'));
    const sb = await box(node(page, f.id('s')));
    await dragCentre(page, node(page, f.id('t')), sb.x + sb.width / 2, sb.y + sb.height / 2);
    await expect(page.locator('.drag-layer .cue')).toContainText('Into "Sub"');
    await allowedThenDrop(page);
    const to = leftEdge(await box(node(page, f.id('s'))));
    await dragCentre(page, node(page, f.id('u')), to.x, to.y);
    await allowedThenDrop(page);
    await saveDraft(page);
    const root = await savedRoot(page, f.id('dash'));
    expect(orderOf(root, f.id('s'))).toEqual(['z', 't'].map(f.id));
    expect(orderOf(root, f.id('f'))).toEqual(['k1', 'u', 's'].map(f.id));
    expect(errors).toEqual([]);
  });

  test('holding over the page bar\'s › turns to page 2; the drop lands there, in place', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      tile(id('t'), 'Tee', 0, 0),
      folder(id('f'), 'Box', { x: 0, y: 3, w: 8, h: 6 }, kids(id, 9))
    ]);
    const errors = await openEditing(page, f.path, f.id('t'));
    const body = node(page, f.id('f')).locator('[data-folder-page]');
    const per = Number(await body.getAttribute('data-folder-per-page'));
    expect(per, 'the box is overfull: two pages').toBeLessThan(9);
    expect(Math.ceil(9 / per)).toBe(2);
    const next = node(page, f.id('f')).locator('[data-page-bar="next"]');
    const nb = await box(next);
    await dragCentre(page, node(page, f.id('t')), nb.x + nb.width / 2, nb.y + nb.height / 2);
    await expect(next).toHaveClass(/holding/); // the hold shows
    await expect(body).toHaveAttribute('data-folder-page', '1', { timeout: 2000 });
    const first = node(page, f.id(`k${per + 1}`));
    await expect(first).toBeVisible();
    const to = leftEdge(await box(first));
    await glide(page, { x: nb.x + nb.width / 2, y: nb.y + nb.height / 2 }, to.x, to.y);
    await page.waitForTimeout(120);
    await allowedThenDrop(page);
    await saveDraft(page);
    const want = kids(f.id, 9).map((k) => k.id as string);
    want.splice(per, 0, f.id('t'));
    expect(orderOf(await savedRoot(page, f.id('dash')), f.id('f'))).toEqual(want);
    expect(errors).toEqual([]);
  });

  // M6: a tab shape's go-up target is its tab (the name lives there); Rounded's is its title bar.
  for (const shape of ['rounded', 'folder-flat'] as const) {
    test(`${shape}: holding over the outer folder's ${shape === 'rounded' ? 'title bar' : 'tab'} goes back up to it; the drop lands on that level`, async ({ page, context }) => {
      const f = await importDash(page, context, (id) => [
        tile(id('t'), 'Tee', 0, 0),
        folder(id('f'), 'Box', { x: 0, y: 3, w: 14, h: 6 }, [kid(id('k1'), 'K1'), folder(id('s'), 'Sub', null, kids(id, 2, 'Z'), { shape })], { shape })
      ]);
      // This browser is drilled into Sub.
      await page.goto(f.path);
      await page.evaluate((d) => {
        localStorage.setItem(`hops.folderNav.${d.dash}`, JSON.stringify({ page: {}, drill: { [d.f]: [d.s] } }));
      }, { dash: f.id('dash'), f: f.id('f'), s: f.id('s') });
      const errors = await openEditing(page, f.path, f.id('t'));
      // Drilled in, the top folder's title bar (a tab shape: its tab) is the go-up target (M5 §7: no breadcrumb).
      const head = node(page, f.id('f')).locator(':scope > .folder-header');
      const crumb = shape === 'rounded' ? head : head.locator(':scope > [data-folder-tab]');
      await expect(crumb).toHaveAttribute('data-crumb', f.id('f'));
      await expect(crumb).toContainText('Box');
      // Exactly one go-up target for the top folder: a tab shape's bar row is not one as well.
      await expect(node(page, f.id('f')).locator(`[data-crumb="${f.id('f')}"]`)).toHaveCount(1);
      const cb = await box(crumb);
      await dragCentre(page, node(page, f.id('t')), cb.x + cb.width / 2, cb.y + cb.height / 2);
      await expect(node(page, f.id('f')).locator('.nested-box')).toHaveCount(0, { timeout: 2000 }); // back at the top
      const to = leftEdge(await box(node(page, f.id('k1'))));
      await glide(page, { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 }, to.x, to.y);
      await page.waitForTimeout(120);
      await allowedThenDrop(page);
      await saveDraft(page);
      const root = await savedRoot(page, f.id('dash'));
      expect(orderOf(root, f.id('f'))).toEqual(['t', 'k1', 's'].map(f.id));
      expect(orderOf(root, f.id('s'))).toEqual(['z1', 'z2'].map(f.id));
      expect(errors).toEqual([]);
    });
  }

  test('merge is unchanged inside a folder: first a "before" marker, then held on the centre a new folder in its place', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [folder(id('f'), 'Box', { x: 0, y: 0, w: 14, h: 6 }, kids(id, 3))]);
    const errors = await openEditing(page, f.path, f.id('f'));
    const k3 = await box(node(page, f.id('k3')));
    await dragCentre(page, node(page, f.id('k1')), k3.x + k3.width / 2, k3.y + k3.height / 2);
    await expect(page.locator('.drag-layer .marker')).toBeVisible(); // before the hold ripens: a place in the order
    await expect(page.locator('.drag-layer .cue')).toContainText(/hold to make a folder/i);
    await page.waitForTimeout(700);
    await expect(page.locator('.drag-layer .cue')).toHaveText(/^\s*Make a folder\s*$/i);
    await page.mouse.up();
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await expect(dlg).toBeHidden();
    await saveDraft(page);
    const root = await savedRoot(page, f.id('dash'));
    const order = orderOf(root, f.id('f'));
    expect(order).toHaveLength(2);
    expect(order[0]).toBe(f.id('k2'));
    const made = find(root, order[1])!;
    expect(made.kind).toBe('folder');
    expect(made.content!.children.map((n) => n.id)).toEqual(['k3', 'k1'].map(f.id));
    expect(errors).toEqual([]);
  });

  for (const shape of ['rounded', 'folder-flat'] as const) {
    test(`${shape}: resize — a corner drag snaps to cells and stops at the one minimum; its page is folderPaging's rows (§3.5, M6 §3a.4)`, async ({ page, context }) => {
      const f = await importDash(page, context, (id) => [folder(id('f'), 'Box', { x: 0, y: 0, w: 12, h: 8 }, kids(id, 3), { shape })]);
      const errors = await openEditing(page, f.path, f.id('f'));
      const fbox = node(page, f.id('f'));
      const corner = fbox.locator('[data-resize="corner"]');
      await fbox.hover();
      const cb = await box(corner);
      const start = await box(fbox);
      await dragTo(page, cb.x + cb.width / 2, cb.y + cb.height / 2, start.x + 20, start.y + 20); // far below the minimum
      await page.waitForTimeout(120);
      await expect(page.locator('.drag-layer .target')).toBeVisible();
      await page.mouse.up();
      await saveDraft(page);
      const saved = find(await savedRoot(page, f.id('dash')), f.id('f'))!;
      // geometry.minOpenFolderCells('medium'): one minimum for every shape (M6 §3a.4).
      expect(saved.placement).toMatchObject({ x: 0, y: 0, w: 3, h: 6 });
      const fb = await box(fbox);
      const cell = fb.width / 3;
      expect(Math.abs(fb.height - 6 * cell), 'the box is 3 x 6 cells').toBeLessThanOrEqual(1);
      // The page at the minimum, from THE page model: Rounded does not draw the tab allowance the minimum
      // counts, so it holds two rows (one item each); a tab shape draws it, so one row. Both page: 3 items.
      const want = folderPaging(openFolderContentBox({ widthPx: fb.width, heightPx: fb.height }, shape), 'medium', cell, 3, 0);
      expect(want.pageBar, 'still paged: the 3 items need a second page').toBe(true);
      expect(want.perRow).toBe(1);
      expect(want.rowsPerPage, 'rows at the minimum (1280 px)').toBe(shape === 'rounded' ? 2 : 1);
      // Drawn: exactly that page — whole items above the page bar, the bar inside the box (nothing clipped).
      const items = fbox.locator('[data-container-id] > [data-node-id]');
      await expect(items).toHaveCount(want.perPage);
      const bar = await box(fbox.locator('nav.page-bar'));
      const rows = new Set<number>();
      for (let i = 0; i < want.perPage; i++) {
        const item = await box(items.nth(i));
        rows.add(Math.round(item.y));
        expect(item.x + item.width).toBeLessThanOrEqual(fb.x + fb.width);
        expect(item.y + item.height).toBeLessThanOrEqual(bar.y + 1);
      }
      expect(rows.size, 'drawn rows').toBe(want.rowsPerPage);
      expect(bar.y + bar.height).toBeLessThanOrEqual(fb.y + fb.height);
      expect(errors).toEqual([]);
    });
  }

  // ---- Fix round 1

  test('an empty open folder shows the "Into" cue while dragged over, and the drop lands inside', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      tile(id('t'), 'Tee', 0, 0),
      folder(id('e'), 'Empty', { x: 0, y: 3, w: 10, h: 6 }, [])
    ]);
    const errors = await openEditing(page, f.path, f.id('t'));
    const body = await box(node(page, f.id('e')).locator('.folder-body'));
    await dragCentre(page, node(page, f.id('t')), body.x + body.width / 2, body.y + body.height / 2);
    const cue = page.locator('.drag-layer .cue');
    await expect(cue).toContainText('Into "Empty"');
    const cb = await box(cue); // drawn on the folder's body
    expect(Math.abs(cb.x - body.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(cb.width - body.width)).toBeLessThanOrEqual(1);
    await allowedThenDrop(page);
    await saveDraft(page);
    expect(orderOf(await savedRoot(page, f.id('dash')), f.id('e'))).toEqual([f.id('t')]);
    expect(errors).toEqual([]);
  });

  test('the right half of the last item on a full page puts the drop after it', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      tile(id('t'), 'Tee', 0, 0),
      folder(id('f'), 'Box', { x: 0, y: 3, w: 8, h: 6 }, kids(id, 9))
    ]);
    const errors = await openEditing(page, f.path, f.id('t'));
    const per = Number(await node(page, f.id('f')).locator('[data-folder-page]').getAttribute('data-folder-per-page'));
    expect(per).toBeLessThan(9); // page 1 is full
    const last = await box(node(page, f.id(`k${per}`)));
    // Right half, outside the centre zone (no merge hold).
    await dragCentre(page, node(page, f.id('t')), last.x + last.width - 8, last.y + last.height / 2);
    await expect(page.locator('.drag-layer .marker')).toBeVisible();
    await allowedThenDrop(page);
    await saveDraft(page);
    const want = kids(f.id, 9).map((k) => k.id as string);
    want.splice(per, 0, f.id('t'));
    expect(orderOf(await savedRoot(page, f.id('dash')), f.id('f'))).toEqual(want);
    expect(errors).toEqual([]);
  });

  test('resize stops at the LARGEST contents size inside: a Large-contents sub-folder keeps a Small folder at 5 x 8', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('f'), 'Box', { x: 0, y: 0, w: 12, h: 9 }, [kid(id('k1'), 'K1'), folder(id('s'), 'Sub', null, kids(id, 2, 'Z'), { contentSize: 'large' })], { contentSize: 'small' })
    ]);
    const errors = await openEditing(page, f.path, f.id('f'));
    const fbox = node(page, f.id('f'));
    await fbox.hover();
    const cb = await box(fbox.locator('[data-resize="corner"]'));
    const start = await box(fbox);
    await dragTo(page, cb.x + cb.width / 2, cb.y + cb.height / 2, start.x + 20, start.y + 20);
    await page.waitForTimeout(120);
    await page.mouse.up();
    await saveDraft(page);
    expect(find(await savedRoot(page, f.id('dash')), f.id('f'))!.placement).toMatchObject({ x: 0, y: 0, w: 5, h: 8 });
    // Drilled into the Large sub-folder, one whole Large item still fits in the box.
    await node(page, f.id('s')).locator('.folder-collapsed-tile').focus();
    await page.keyboard.press('Enter');
    await expect(fbox.locator(`[data-folder-page][data-folder-id="${f.id('s')}"]`)).toBeVisible();
    const fb = await box(fbox);
    const item = await box(fbox.locator('[data-container-id] > [data-node-id]').first());
    expect(item.x + item.width).toBeLessThanOrEqual(fb.x + fb.width);
    expect(item.y + item.height).toBeLessThanOrEqual(fb.y + fb.height);
    expect(errors).toEqual([]);
  });

  test('raising Contents size in the dialog grows a box too small for one item, pushing neighbours; one Undo restores both', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('f'), 'Box', { x: 0, y: 0, w: 3, h: 6 }, kids(id, 2)),
      tile(id('n'), 'Next', 0, 6)
    ]);
    const errors = await openEditing(page, f.path, f.id('f'));
    const f0 = await box(node(page, f.id('f')));
    const n0 = await box(node(page, f.id('n')));
    await node(page, f.id('f')).locator('.folder-header h3').hover();
    await page.getByRole('button', { name: 'Edit Box', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    await dlg.getByLabel('Contents size').selectOption('large');
    await expect(dlg.getByRole('alert')).toHaveCount(0);
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await expect(dlg).toBeHidden();
    // Drawn grown; the neighbour moved clear of it.
    const fb = await box(node(page, f.id('f')));
    const nb = await box(node(page, f.id('n')));
    const clear = nb.x >= fb.x + fb.width - 1 || nb.y >= fb.y + fb.height - 1;
    expect(clear, 'the neighbour is clear of the grown folder').toBe(true);
    // One undo step: Undo once restores both.
    const toolbar = page.getByRole('toolbar', { name: 'Editing' });
    await toolbar.getByRole('button', { name: /Undo/ }).click();
    await expect(toolbar.getByRole('button', { name: /Undo/ })).toBeDisabled();
    const f1 = await box(node(page, f.id('f')));
    const n1 = await box(node(page, f.id('n')));
    for (const [a, b] of [[f1, f0], [n1, n0]] as const) {
      for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(1);
    }
    // Again, then save: the saved document has the grown box and the pushed neighbour.
    await node(page, f.id('f')).locator('.folder-header h3').hover();
    await page.getByRole('button', { name: 'Edit Box', exact: true }).click();
    await dlg.getByLabel('Contents size').selectOption('large');
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await expect(dlg).toBeHidden();
    await saveDraft(page);
    const root = await savedRoot(page, f.id('dash'));
    const saved = find(root, f.id('f'))!;
    expect(saved).toMatchObject({ placement: { x: 0, y: 0, w: 5, h: 8 } });
    const n = find(root, f.id('n'))!.placement!;
    expect(n.x >= 5 || n.y >= 8).toBe(true);
    expect(errors).toEqual([]);
  });
});


// Ruling 7: an open folder box is never below its minimum. (a) A folder that comes out of a folder
// gets its default box raised to its minimum (at its largest contents size). (b) Moving a folder whose
// subtree has a larger contents size into a folder grows the receiving open box to the new minimum,
// pushing neighbours by the M3 rules, in the same undo step. (No room on a 24-column tab cannot happen
// at a 5-column minimum; the refusal is covered by the treeOps unit tests.)
test.describe('Ruling 7: an open folder box is never below its minimum', () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  test('a sub-folder with Large contents dragged out to the tab lands with its default box raised to 6 x 8', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('f'), 'Box', { x: 0, y: 0, w: 14, h: 8 }, [kid(id('k1'), 'K1'), folder(id('s'), 'Sub', null, kids(id, 2, 'Z'), { contentSize: 'large' })])
    ]);
    const errors = await openEditing(page, f.path, f.id('f'));
    const fb = await box(node(page, f.id('f')));
    await dragCentre(page, node(page, f.id('s')), fb.x + fb.width + 200, fb.y + 60);
    await allowedThenDrop(page);
    await saveDraft(page);
    const root = await savedRoot(page, f.id('dash'));
    expect(find(root, f.id('s'))).toMatchObject({ display: 'collapsed', placement: { w: 6, h: 8 } });
    expect(errors).toEqual([]);
  });

  test('a Large-contents folder dropped into a Medium folder at its minimum grows it to 5 x 8, pushing the neighbour; one Undo restores both', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('f'), 'Box', { x: 0, y: 0, w: 3, h: 6 }, kids(id, 1)),
      tile(id('n'), 'Next', 0, 6),
      folder(id('g'), 'Large', { x: 12, y: 0, w: 8, h: 8 }, kids(id, 1, 'G'), { contentSize: 'large' })
    ]);
    const errors = await openEditing(page, f.path, f.id('f'));
    const f0 = await box(node(page, f.id('f')));
    const n0 = await box(node(page, f.id('n')));
    const gbar = await box(node(page, f.id('g')).locator('.folder-header'));
    const fbar = await box(node(page, f.id('f')).locator('.folder-header'));
    await dragTo(page, gbar.x + 40, gbar.y + gbar.height / 2, fbar.x + fbar.width / 2, fbar.y + fbar.height / 2);
    await page.waitForTimeout(120);
    await expect(page.locator('.drag-layer .cue')).toContainText('Into "Box"');
    await allowedThenDrop(page);
    // Drawn grown at once; the neighbour moved clear of it.
    const fb = await box(node(page, f.id('f')));
    expect(fb.width).toBeGreaterThan(f0.width + 1);
    expect(fb.height).toBeGreaterThan(f0.height + 1);
    const nb = await box(node(page, f.id('n')));
    expect(nb.x >= fb.x + fb.width - 1 || nb.y >= fb.y + fb.height - 1, 'the neighbour is clear of the grown folder').toBe(true);
    // One undo step: the move and the growth come back together.
    const toolbar = page.getByRole('toolbar', { name: 'Editing' });
    await toolbar.getByRole('button', { name: /Undo/ }).click();
    await expect(toolbar.getByRole('button', { name: /Undo/ })).toBeDisabled();
    await expect(node(page, f.id('g'))).toHaveAttribute('role', 'group'); // back on the tab
    for (const [a, b] of [[await box(node(page, f.id('f'))), f0], [await box(node(page, f.id('n'))), n0]] as const) {
      for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(1);
    }
    await toolbar.getByRole('button', { name: /Redo/ }).click();
    await saveDraft(page);
    const root = await savedRoot(page, f.id('dash'));
    expect(orderOf(root, f.id('f'))).toEqual([f.id('k1'), f.id('g')]);
    expect(find(root, f.id('f'))).toMatchObject({ placement: { x: 0, y: 0, w: 5, h: 8 } });
    const n = find(root, f.id('n'))!.placement!;
    expect(n.x >= 5 || n.y >= 8).toBe(true);
    expect(errors).toEqual([]);
  });
});
