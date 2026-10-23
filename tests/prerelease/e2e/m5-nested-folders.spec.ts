import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M5 §7 (Jonathan's walkthrough 2, design/feedback/2026-10-22-m5-walkthrough2/image-3.png): a drilled-in
// sub-folder is a folder inside a folder. The top folder keeps its own title; every opened sub-folder
// level is an inset box inside the last, with its own bar (‹ and its name), holding — the innermost —
// one page of its contents. ‹ or an outer box's title goes back up. In a REAL browser: layout, drag
// and search need Chromium.

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

/** Import one dashboard (M5 stored form, layoutVersion 1, one Main tab). */
async function importDash(page: Page, context: BrowserContext, children: (id: (s: string) => string) => Child[]) {
  const p = `m5n${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `M5 nested ${p}`, order: 0, path: `/${p}`, revision: 1,
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

const node = (page: Page, id: string) => page.locator(`.tab-canvas [data-node-id="${id}"]`).first();
const nested = (scope: Page | Locator, id: string) => scope.locator(`.nested-box[data-nested-folder="${id}"]`).first();
const header = (l: Locator) => l.locator(':scope > .nested-header');
const box = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
};
type Box = { x: number; y: number; width: number; height: number };
const near = (a: number, b: number, what: string) => expect(Math.abs(a - b), `${what}: ${a} vs ${b}`).toBeLessThanOrEqual(1);
/** `inner` lies inside `outer`, inset by at least `by` px on every side. */
function inside(inner: Box, outer: Box, by: number, what: string) {
  expect(inner.x - outer.x, `${what}: left inset`).toBeGreaterThanOrEqual(by - 0.5);
  expect(inner.y - outer.y, `${what}: top inset`).toBeGreaterThanOrEqual(by - 0.5);
  expect(outer.x + outer.width - (inner.x + inner.width), `${what}: right inset`).toBeGreaterThanOrEqual(by - 0.5);
  expect(outer.y + outer.height - (inner.y + inner.height), `${what}: bottom inset`).toBeGreaterThanOrEqual(by - 0.5);
}
/** This browser is drilled into `path` inside open folder `folderId` (set before the page loads its memory). */
async function drilled(page: Page, dash: string, folderId: string, path: string[], pages: Record<string, number> = {}) {
  await page.evaluate((d) => {
    localStorage.setItem(`hops.folderNav.${d.dash}`, JSON.stringify({ page: d.pages, drill: { [d.f]: d.path } }));
  }, { dash, f: folderId, path, pages });
}
/** The ids drawn on the page shown (only the innermost box has one). */
async function shown(page: Page, folderId: string): Promise<string[]> {
  return node(page, folderId)
    .locator('[data-folder-page] [data-container-id] > [data-node-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id') ?? ''));
}

/** Services › New folder › Deeper, beside a Medium tab tile (Jonathan's screenshot, one level more). */
const services = (id: (s: string) => string) => [
  tile(id('tabmed'), 'TabMed', 20, 0),
  folder(id('svc'), 'Services', { x: 0, y: 0, w: 18, h: 9 }, [
    kid(id('plex'), 'Plex'),
    folder(id('nf'), 'New folder', null, [
      kid(id('yt'), 'YouTube'), kid(id('gh'), 'GitHub'),
      folder(id('deeper'), 'Deeper', null, [kid(id('wiki'), 'Wiki')])
    ])
  ], { color: '#7c3aed' })
];

test.describe('M5 §7: a sub-folder opens as a folder inside a folder', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Services › New folder: Services' own title, plus an inset New folder box with ‹ and its name holding the items", async ({ page, context }) => {
    const f = await importDash(page, context, services);
    await page.goto(f.path);
    const svc = node(page, f.id('svc'));
    await page.getByRole('button', { name: /^New folder, folder with 3 items/ }).click();
    // The top folder keeps its title; there is no breadcrumb.
    await expect(svc.locator('.folder-header h3')).toHaveText('Services');
    await expect(svc.getByRole('navigation', { name: 'Folder path' })).toHaveCount(0);
    // The inset box: inside Services' body, with ‹ and its name in its own bar.
    const nf = nested(svc, f.id('nf'));
    await expect(nf).toBeVisible();
    await expect(header(nf).getByRole('button', { name: 'Back to Services' })).toHaveText('‹');
    await expect(header(nf)).toContainText('New folder');
    const body = await box(svc.locator(':scope > .folder-body'));
    const nb = await box(nf);
    inside(nb, body, 8, 'the inset box in Services\' body');
    const hb = await box(header(nf));
    near(hb.height, 28, 'compact bar');
    expect(hb.y + hb.height).toBeLessThanOrEqual(nb.y + 30);
    // The items sit inside the inset box, under its bar — the same box as a Medium tab tile.
    expect(await shown(page, f.id('svc'))).toEqual(['yt', 'gh', 'deeper'].map(f.id));
    const med = await box(node(page, f.id('tabmed')));
    for (const k of ['yt', 'gh', 'deeper']) {
      const kb = await box(node(page, f.id(k)));
      inside(kb, nb, 8, `${k} inside the inset box`);
      expect(kb.y).toBeGreaterThanOrEqual(hb.y + hb.height);
      near(kb.width, med.width, `${k} width = a Medium tab tile`);
      near(kb.height, med.height, `${k} height = a Medium tab tile`);
    }
    // The name sits above the icon, as everywhere.
    const yt = node(page, f.id('yt'));
    const nameB = await box(yt.locator('.title').first());
    const iconB = await box(yt.locator('svg, img').first());
    expect(nameB.y + nameB.height).toBeLessThanOrEqual(iconB.y + 1);
  });

  test('2 deep: three titled boxes, each inside the last; the page is in the innermost', async ({ page, context }) => {
    const f = await importDash(page, context, services);
    await page.goto(f.path);
    await drilled(page, f.id('dash'), f.id('svc'), [f.id('nf'), f.id('deeper')]);
    await page.reload();
    const svc = node(page, f.id('svc'));
    const nf = nested(svc, f.id('nf'));
    const dp = nested(nf, f.id('deeper'));
    await expect(svc.locator('.folder-header h3')).toHaveText('Services');
    await expect(header(nf)).toContainText('New folder');
    await expect(header(dp)).toContainText('Deeper');
    for (const h of [svc.locator(':scope > .folder-header'), header(nf), header(dp)]) await expect(h).toBeVisible();
    inside(await box(nf), await box(svc.locator(':scope > .folder-body')), 8, 'New folder in Services');
    inside(await box(dp), await box(nf.locator(':scope > .nested-body')), 8, 'Deeper in New folder');
    expect(await shown(page, f.id('svc'))).toEqual([f.id('wiki')]);
    inside(await box(node(page, f.id('wiki'))), await box(dp), 8, 'Wiki inside Deeper');
    await expect(svc.locator('[data-folder-page]')).toHaveCount(1);
  });

  test('‹ goes up one level; an outer box\'s title goes back to that level', async ({ page, context }) => {
    const f = await importDash(page, context, services);
    await page.goto(f.path);
    await drilled(page, f.id('dash'), f.id('svc'), [f.id('nf'), f.id('deeper')]);
    await page.reload();
    const svc = node(page, f.id('svc'));
    // ‹ on Deeper → New folder.
    await header(nested(svc, f.id('deeper'))).getByRole('button', { name: 'Back to New folder' }).click();
    await expect(nested(svc, f.id('deeper'))).toHaveCount(0);
    expect(await shown(page, f.id('svc'))).toEqual(['yt', 'gh', 'deeper'].map(f.id));
    // In again, then New folder's title (an outer box) → New folder.
    await page.getByRole('button', { name: /^Deeper, folder with 1 item/ }).click();
    await expect(nested(svc, f.id('deeper'))).toBeVisible();
    await header(nested(svc, f.id('nf'))).getByRole('button', { name: 'New folder', exact: true }).click();
    await expect(nested(svc, f.id('deeper'))).toHaveCount(0);
    expect(await shown(page, f.id('svc'))).toEqual(['yt', 'gh', 'deeper'].map(f.id));
    // In again, then Services' title → the top.
    await page.getByRole('button', { name: /^Deeper, folder with 1 item/ }).click();
    await svc.locator('.folder-header').getByRole('button', { name: 'Services', exact: true }).click();
    await expect(svc.locator('.nested-box')).toHaveCount(0);
    expect(await shown(page, f.id('svc'))).toEqual(['plex', 'nf'].map(f.id));
    // This browser remembers: nothing drilled after a reload.
    await page.reload();
    await expect(svc.locator('.nested-box')).toHaveCount(0);
  });

  test('a small folder with deep nesting says "Not enough room", never clips', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('f'), 'Tiny', { x: 0, y: 0, w: 4, h: 5 }, [
        folder(id('a'), 'A', null, [folder(id('b'), 'B', null, [folder(id('c'), 'C', null, [kid(id('z'), 'Zed')])])])
      ])
    ]);
    await page.goto(f.path);
    await drilled(page, f.id('dash'), f.id('f'), [f.id('a'), f.id('b'), f.id('c')]);
    await page.reload();
    const tiny = node(page, f.id('f'));
    const note = tiny.locator('[data-folder-no-room]');
    await expect(note).toBeVisible();
    await expect(note).toHaveText(/Not enough room — make the folder bigger/);
    inside(await box(note), await box(tiny), 0, 'the note is on the folder');
    await expect(page.locator(`[data-node-id="${f.id('z')}"]`)).toHaveCount(0); // nothing clipped is drawn
    // The saved box is never changed by opening a sub-folder.
    const cfg = await (await page.request.get('/api/config')).json();
    const saved = cfg.dashboards.find((d: { id: string }) => d.id === f.id('dash')).tabs[0].root.children[0];
    expect(saved.placement).toEqual({ x: 0, y: 0, w: 4, h: 5 });
    // The same in edit mode.
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    await expect(tiny.locator('[data-folder-no-room]')).toBeVisible();
  });

  test('search reveal opens the chain as nested boxes and flips the innermost to the tile\'s page', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('f'), 'Outer', { x: 0, y: 0, w: 12, h: 9 }, [
        kid(id('a'), 'First'),
        folder(id('s'), 'Middle', null, [folder(id('s2'), 'Inner', null, [...kids(id, 15), kid(id('needle'), 'Needlefind')])])
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
    await expect(outer).toHaveAttribute('role', 'group');
    await expect(outer.locator('.folder-header h3')).toHaveText('Outer');
    const mid = nested(outer, f.id('s'));
    const inner = nested(mid, f.id('s2'));
    await expect(inner).toBeVisible();
    await expect(header(inner)).toContainText('Inner');
    await expect(inner.locator('[data-folder-page]')).not.toHaveAttribute('data-folder-page', '0');
    await expect(inner.locator(`[data-node-id="${f.id('needle')}"]`)).toBeVisible();
    await expect.poll(() => page.evaluate((id) => !!document.activeElement?.closest(`[data-node-id="${id}"]`), f.id('needle'))).toBe(true);
  });

  test('view and edit mode draw the nested boxes identically, apart from the handles', async ({ page, context }) => {
    const f = await importDash(page, context, services);
    await page.goto(f.path);
    await drilled(page, f.id('dash'), f.id('svc'), [f.id('nf'), f.id('deeper')]);
    await page.reload();
    const svc = node(page, f.id('svc'));
    const parts = () => [
      svc, svc.locator(':scope > .folder-header'), nested(svc, f.id('nf')), header(nested(svc, f.id('nf'))),
      nested(svc, f.id('deeper')), header(nested(svc, f.id('deeper'))), node(page, f.id('wiki'))
    ];
    const view: Box[] = [];
    for (const p of parts()) view.push(await box(p));
    await expect(page.getByRole('button', { name: 'Edit New folder' })).toHaveCount(0);
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    const edit: Box[] = [];
    for (const p of parts()) edit.push(await box(p));
    view.forEach((v, i) => {
      near(edit[i].x, v.x, `part ${i} x`);
      near(edit[i].y, v.y, `part ${i} y`);
      near(edit[i].width, v.width, `part ${i} w`);
      near(edit[i].height, v.height, `part ${i} h`);
    });
    // Each inset box has its own edit handle, which edits that sub-folder.
    const nfHead = header(nested(svc, f.id('nf')));
    await nfHead.hover();
    await nfHead.getByRole('button', { name: 'Edit New folder' }).click();
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('textbox', { name: /^Folder name/ })).toHaveValue('New folder');
  });

  test('holding over an outer box\'s title while dragging goes up to it; the drop inserts into the innermost box', async ({ page, context }) => {
    const f = await importDash(page, context, services);
    await page.goto(f.path);
    await drilled(page, f.id('dash'), f.id('svc'), [f.id('nf'), f.id('deeper')]);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(f.path);
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    const svc = node(page, f.id('svc'));
    const nfHead = header(nested(svc, f.id('nf')));
    await expect(nfHead).toHaveAttribute('data-crumb', f.id('nf'));
    // Drag the tab tile and hold over New folder's title bar (an outer box): it goes up to New folder.
    const s = await box(node(page, f.id('tabmed')));
    const hb = await box(nfHead.getByRole('button', { name: 'New folder', exact: true }));
    const from = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
    const at = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(from.x + ((at.x - from.x) * i) / 20, from.y + ((at.y - from.y) * i) / 20);
      await page.waitForTimeout(16);
    }
    await expect(nested(svc, f.id('deeper'))).toHaveCount(0, { timeout: 2000 });
    await expect(nested(svc, f.id('nf'))).toBeVisible();
    // Then drop on the left half of GitHub in New folder (the innermost box now): it goes before GitHub.
    const gh = await box(node(page, f.id('gh')));
    const to = { x: gh.x + 8, y: gh.y + gh.height / 2 };
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(at.x + ((to.x - at.x) * i) / 10, at.y + ((to.y - at.y) * i) / 10);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(120);
    await expect(page.locator('.drag-layer .reason')).toHaveCount(0);
    await page.mouse.up();
    const save = page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ });
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
    await save.click();
    expect((await saved).status()).toBe(200);
    const cfg = await (await page.request.get('/api/config')).json();
    const root: AnyNode[] = cfg.dashboards.find((d: { id: string }) => d.id === f.id('dash')).tabs[0].root.children;
    const find = (ns: AnyNode[], id: string): AnyNode | undefined => {
      for (const n of ns) {
        if (n.id === id) return n;
        const r = n.content ? find(n.content.children, id) : undefined;
        if (r) return r;
      }
      return undefined;
    };
    expect(find(root, f.id('nf'))!.content!.children.map((n) => n.id)).toEqual(['yt', 'tabmed', 'gh', 'deeper'].map(f.id));
    expect(find(root, f.id('svc'))!.content!.children.map((n) => n.id)).toEqual(['plex', 'nf'].map(f.id));
    expect(errors).toEqual([]);
  });
});

test.describe('M5 §7 on a 390 x 844 phone: the same nesting at full width', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('nested boxes inside the full-width folder, no sideways scroll, the items inside the innermost', async ({ page, context }) => {
    const f = await importDash(page, context, services);
    await page.goto(f.path);
    await drilled(page, f.id('dash'), f.id('svc'), [f.id('nf'), f.id('deeper')]);
    await page.reload();
    const svc = node(page, f.id('svc'));
    const nf = nested(svc, f.id('nf'));
    const dp = nested(nf, f.id('deeper'));
    await expect(svc.locator('.folder-header h3')).toHaveText('Services');
    await expect(header(nf)).toContainText('New folder');
    await expect(header(dp)).toContainText('Deeper');
    inside(await box(nf), await box(svc.locator(':scope > .folder-body')), 8, 'New folder in Services');
    inside(await box(dp), await box(nf.locator(':scope > .nested-body')), 8, 'Deeper in New folder');
    inside(await box(node(page, f.id('wiki'))), await box(dp), 8, 'Wiki inside Deeper');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await header(dp).getByRole('button', { name: 'Back to New folder' }).click();
    await expect(dp).toHaveCount(0);
    expect(await shown(page, f.id('svc'))).toEqual(['yt', 'gh', 'deeper'].map(f.id));
  });
});
