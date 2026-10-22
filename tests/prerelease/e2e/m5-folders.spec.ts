import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M5 Task 3 (design/specs/2026-10-22-hops-v3-m5-folders-design.md §2, §3, §3a): ONE Folder component
// draws every folder — minimised (a tile with its name and up to four icons), open in place (one page
// of items at its contents size, a page bar only when there is more than one page) and drilled into a
// sub-folder (it fills the box; the title bar is a breadcrumb). No pop-over, no maximise. In a REAL
// browser: layout, paging and focus need Chromium.

let seq = 0;
const made: string[] = [];
type Child = Record<string, unknown>;

const kid = (id: string, name: string, extra: Child = {}): Child => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, ...extra
});
const tile = (id: string, name: string, x: number, y: number, extra: Child = {}): Child =>
  kid(id, name, { placement: { x, y, w: 2, h: 2 }, ...extra });
const folder = (id: string, name: string, box: { x: number; y: number; w: number; h: number } | null, children: Child[], extra: Child = {}): Child => ({
  id, kind: 'folder', name, display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
  ...(box ? { placement: box } : {}), content: { children }, ...extra
});
const kids = (id: (s: string) => string, n: number, prefix = 'K') =>
  Array.from({ length: n }, (_, i) => kid(id(`${prefix.toLowerCase()}${i + 1}`), `${prefix}${i + 1}`));

/** Import one dashboard (M5 stored form, layoutVersion 1, one Main tab). */
async function importDash(page: Page, context: BrowserContext, children: (id: (s: string) => string) => Child[]) {
  const p = `m5f${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `M5 folders ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{ id: id('tab'), name: 'Main', order: 0, root: { columns: 24, children: children(id) } }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 1, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm5f.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
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

const node = (page: Page, id: string) => page.locator(`.tab-canvas [data-node-id="${id}"]`);
const box = async (l: Locator) => (await l.boundingBox())!;
const near = (a: number, b: number, what: string) => expect(Math.abs(a - b), `${what}: ${a} vs ${b}`).toBeLessThanOrEqual(1);
/** The ids drawn on the folder's current page (only that page is in the DOM). */
async function shown(page: Page, folderId: string): Promise<string[]> {
  return node(page, folderId)
    .locator('[data-folder-page] [data-container-id] > [data-node-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id') ?? ''));
}

test.describe('M5 one Folder component', () => {
  test('a minimised folder is a tile with its name and four icons, the size of a Medium tile', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      tile(id('m'), 'Med', 0, 0),
      folder(id('f'), 'Media', { x: 4, y: 0, w: 12, h: 6 }, kids(id, 6), { display: 'collapsed' })
    ]);
    await page.goto(f.path);
    const tileFace = node(page, f.id('f')).locator('.folder-collapsed-tile');
    await expect(tileFace).toBeVisible();
    await expect(tileFace.locator('.collapsed-name')).toHaveText('Media');
    await expect(tileFace.locator('.preview-cell')).toHaveCount(4);
    for (const cell of await tileFace.locator('.preview-cell svg, .preview-cell img').all()) await expect(cell).toBeVisible();
    // Name above the icons, as on every tile.
    const nb = await box(tileFace.locator('.collapsed-name'));
    const gb = await box(tileFace.locator('.preview-grid'));
    expect(nb.y + nb.height).toBeLessThanOrEqual(gb.y + 1);
    // Its own size (Medium): the same box as a Medium tile on the tab.
    const mb = await box(node(page, f.id('m')));
    const fb = await box(node(page, f.id('f')));
    near(fb.width, mb.width, 'width');
    near(fb.height, mb.height, 'height');
  });

  test('a click opens it in place into the space it kept; the neighbours never move; no pop-over', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('f'), 'Media', { x: 0, y: 0, w: 12, h: 6 }, kids(id, 3), { display: 'collapsed' }),
      tile(id('right'), 'Right', 14, 0),
      tile(id('below'), 'Below', 0, 6)
    ]);
    await page.goto(f.path);
    const before = { right: await box(node(page, f.id('right'))), below: await box(node(page, f.id('below'))), f: await box(node(page, f.id('f'))) };
    await page.getByRole('button', { name: /^Media, folder with 3 items/ }).click();
    await expect(node(page, f.id('f'))).toHaveAttribute('role', 'group');
    const open = await box(node(page, f.id('f')));
    near(open.x, before.f.x, 'left');
    near(open.y, before.f.y, 'top');
    expect(open.width).toBeGreaterThan(before.f.width * 5);
    for (const k of ['right', 'below'] as const) {
      const now = await box(node(page, f.id(k)));
      near(now.x, before[k].x, `${k} x`);
      near(now.y, before[k].y, `${k} y`);
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Maximise folder' })).toHaveCount(0);
    expect(await shown(page, f.id('f'))).toEqual([f.id('k1'), f.id('k2'), f.id('k3')]);
    // Remembered by this browser: a reload shows it open.
    await page.reload();
    await expect(node(page, f.id('f'))).toHaveAttribute('role', 'group');
  });

  test('overfull: a page bar appears, only the current page is drawn, and page 2 shows the rest', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('f'), 'Lots', { x: 0, y: 0, w: 8, h: 6 }, kids(id, 20)),
      folder(id('few'), 'Few', { x: 10, y: 0, w: 8, h: 6 }, kids(id, 2, 'F'))
    ]);
    await page.goto(f.path);
    const lots = node(page, f.id('f'));
    await expect(node(page, f.id('few')).locator('[data-page-bar]')).toHaveCount(0); // everything fits: no bar
    const next = lots.locator('[data-page-bar="next"]');
    await expect(next).toBeVisible();
    await expect(lots.locator('[data-page-bar="prev"]')).toBeDisabled();
    const per = Number(await lots.locator('[data-folder-page]').getAttribute('data-folder-per-page'));
    expect(per).toBeGreaterThan(1);
    expect(per).toBeLessThan(20);
    const page1 = await shown(page, f.id('f'));
    expect(page1).toEqual(Array.from({ length: per }, (_, i) => f.id(`k${i + 1}`)));
    await expect(lots.locator('[data-node-id]')).toHaveCount(per); // nothing past the page is in the DOM
    // Every item on the page is inside the folder's box (nothing drawn over the page bar or outside).
    const fb = await box(lots);
    const bar = await box(lots.locator('nav.page-bar'));
    for (const i of page1) {
      const b = await box(node(page, i));
      expect(b.y + b.height).toBeLessThanOrEqual(bar.y + 1);
      expect(b.x + b.width).toBeLessThanOrEqual(fb.x + fb.width + 1);
    }
    await next.click();
    await expect(lots.locator('[data-folder-page]')).toHaveAttribute('data-folder-page', '1');
    const page2 = await shown(page, f.id('f'));
    expect(page2[0]).toBe(f.id(`k${per + 1}`));
    // To the last page: together the pages hold all twenty, in order.
    const all = [...page1, ...page2];
    while (await next.isEnabled()) {
      await next.click();
      all.push(...(await shown(page, f.id('f'))));
    }
    expect(all).toEqual(Array.from({ length: 20 }, (_, i) => f.id(`k${i + 1}`)));
    // This browser remembers the page.
    await page.reload();
    await expect(lots.locator('[data-folder-page]')).not.toHaveAttribute('data-folder-page', '0');
  });

  test('drilling into a sub-folder fills the parent; the breadcrumb goes back up', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('f'), 'Services', { x: 0, y: 0, w: 12, h: 6 }, [
        kid(id('a'), 'Alpha'),
        folder(id('s'), 'Storage', null, [kid(id('nas'), 'NAS'), folder(id('s2'), 'Backups', null, [kid(id('deep'), 'Deep')])])
      ]),
      tile(id('n'), 'Neighbour', 14, 0)
    ]);
    await page.goto(f.path);
    const svc = node(page, f.id('f'));
    const before = { box: await box(svc), body: await box(svc.locator('.folder-body')), n: await box(node(page, f.id('n'))) };
    await page.getByRole('button', { name: /^Storage, folder with 2 items/ }).click();
    const crumbs = svc.getByRole('navigation', { name: 'Folder path' });
    await expect(crumbs).toBeVisible();
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Storage');
    expect(await shown(page, f.id('f'))).toEqual([f.id('nas'), f.id('s2')]);
    // It fills the parent's box: the same box and body; nothing else moves.
    const after = { box: await box(svc), body: await box(svc.locator('.folder-body')), n: await box(node(page, f.id('n'))) };
    for (const k of ['box', 'body', 'n'] as const) {
      near(after[k].x, before[k].x, `${k} x`);
      near(after[k].y, before[k].y, `${k} y`);
      near(after[k].width, before[k].width, `${k} w`);
      near(after[k].height, before[k].height, `${k} h`);
    }
    // Deeper, then back up one crumb at a time.
    await page.getByRole('button', { name: /^Backups, folder with 1 item/ }).click();
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Backups');
    expect(await shown(page, f.id('f'))).toEqual([f.id('deep')]);
    await crumbs.locator(`[data-crumb="${f.id('s')}"]`).click();
    expect(await shown(page, f.id('f'))).toEqual([f.id('nas'), f.id('s2')]);
    await crumbs.locator(`[data-crumb="${f.id('f')}"]`).click();
    await expect(svc.getByRole('navigation', { name: 'Folder path' })).toHaveCount(0);
    await expect(svc.locator('.folder-header h3')).toHaveText('Services');
    expect(await shown(page, f.id('f'))).toEqual([f.id('a'), f.id('s')]);
    // Enter drills in too (keyboard).
    await page.getByRole('button', { name: /^Storage, folder with/ }).focus();
    await page.keyboard.press('Enter');
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Storage');
  });

  test('a Medium item in a folder is exactly a Medium tile on the tab (one size everywhere)', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      tile(id('m'), 'TabMed', 0, 0),
      folder(id('f'), 'Box', { x: 4, y: 0, w: 12, h: 6 }, [kid(id('in'), 'InMed', { size: 'large' })])
    ]);
    await page.goto(f.path);
    const tb = await box(node(page, f.id('m')));
    const ib = await box(node(page, f.id('in')));
    near(ib.width, tb.width, 'width');
    near(ib.height, tb.height, 'height');
  });

  test('resizing the open folder shows more per page', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [folder(id('f'), 'Grow', { x: 0, y: 0, w: 6, h: 6 }, kids(id, 12))]);
    await page.goto(f.path);
    const g = node(page, f.id('f'));
    const perBefore = Number(await g.locator('[data-folder-page]').getAttribute('data-folder-per-page'));
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    // Select it (its bar) and grow it with Shift+Arrow (the keyboard resize of the selection).
    await g.locator('.folder-header').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => Number(await g.locator('[data-folder-page]').getAttribute('data-folder-per-page'))).toBeGreaterThan(perBefore);
    // The same paging in edit mode as in view mode (WYSIWYG): the page bar is still drawn while overfull.
    const per = Number(await g.locator('[data-folder-page]').getAttribute('data-folder-per-page'));
    await expect(g.locator('[data-node-id]')).toHaveCount(Math.min(12, per));
  });

  test('search reveals a tile on page 2 of a sub-folder: opened in place, drilled, flipped, focused', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('f'), 'Outer', { x: 0, y: 0, w: 8, h: 6 }, [
        kid(id('a'), 'First'),
        folder(id('s'), 'Inner', null, [...kids(id, 15), kid(id('needle'), 'Needlefind')])
      ], { display: 'collapsed' })
    ]);
    await page.goto(f.path);
    await expect(node(page, f.id('f'))).toHaveClass(/collapsed/);
    await page.keyboard.press('/');
    const input = page.getByRole('textbox', { name: /search tiles/i });
    await expect(input).toBeVisible();
    await input.fill('needlefind');
    await page.getByRole('button', { name: /Needlefind/ }).click();
    const outer = node(page, f.id('f'));
    await expect(outer).toHaveAttribute('role', 'group'); // opened in place
    await expect(outer.getByRole('navigation', { name: 'Folder path' }).locator('[aria-current="page"]')).toHaveText('Inner');
    await expect(outer.locator('[data-folder-page]')).not.toHaveAttribute('data-folder-page', '0');
    await expect(node(page, f.id('needle'))).toBeVisible();
    await expect.poll(() => page.evaluate((id) => !!document.activeElement?.closest(`[data-node-id="${id}"]`), f.id('needle'))).toBe(true);
    await expect(page.locator('.overlay-panel, [role="dialog"][aria-modal="true"]')).toHaveCount(0);
  });

  test('untitled: the open folder still has its bar (controls only), with the breadcrumb when drilled', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('f'), 'Hidden', { x: 0, y: 0, w: 12, h: 6 }, [folder(id('s'), 'Sub', null, [kid(id('z'), 'Zed')])], { showTitle: false })
    ]);
    await page.goto(f.path);
    const bar = node(page, f.id('f')).locator('.folder-header');
    await expect(bar).toBeVisible();
    await expect(bar).not.toContainText('Hidden');
    await expect(bar.getByRole('button', { name: 'Minimise folder' })).toBeVisible();
    await page.getByRole('button', { name: /^Sub, folder with 1 item/ }).click();
    await expect(bar.locator(`[data-crumb="${f.id('f')}"]`)).toHaveText('Hidden');
    await bar.getByRole('button', { name: 'Minimise folder' }).click();
    await expect(node(page, f.id('f'))).toHaveClass(/collapsed/);
  });
});

test.describe('M5 folders on a phone (stacked)', () => {
  test.use({ viewport: { width: 420, height: 900 } });
  test('the same component at full width, with the same pages', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('f'), 'Phone', { x: 0, y: 0, w: 8, h: 6 }, kids(id, 20)),
      folder(id('m'), 'Mini', { x: 10, y: 0, w: 6, h: 4 }, kids(id, 2, 'M'), { display: 'collapsed' })
    ]);
    await page.goto(f.path);
    const ph = node(page, f.id('f'));
    const canvas = await box(page.locator('.tab-canvas'));
    const pb = await box(ph);
    near(pb.width, canvas.width, 'full width');
    await expect(ph.locator('[data-page-bar="next"]')).toBeVisible();
    const per = Number(await ph.locator('[data-folder-page]').getAttribute('data-folder-per-page'));
    await expect(ph.locator('[data-node-id]')).toHaveCount(per);
    await ph.locator('[data-page-bar="next"]').click();
    expect((await shown(page, f.id('f')))[0]).toBe(f.id(`k${per + 1}`));
    await expect(node(page, f.id('m'))).toHaveClass(/collapsed/);
  });
});
