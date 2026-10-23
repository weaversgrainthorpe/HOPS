import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M5 §7 (Jonathan's walkthrough 2, design/feedback/2026-10-22-m5-walkthrough2/image-3.png): a drilled-in
// sub-folder is a folder inside a folder. The top folder keeps its own title; every opened sub-folder
// level is an inset box inside the last, with its own bar — identical to a top folder's (Ruling 15):
// its name on the left, the same minimise (–) on the right — holding, the innermost, one page of its
// contents. Minimise on a box, or an outer box's title, goes back up. In a REAL browser: layout, drag
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

/** Import one dashboard (M6 stored form, layoutVersion 2, one Main tab). */
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
    config: { layoutVersion: 2, dashboards: [dash] }
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

  test("Services › New folder: Services' own title, plus an inset New folder box with its name and minimise holding the items", async ({ page, context }) => {
    const f = await importDash(page, context, services);
    await page.goto(f.path);
    const svc = node(page, f.id('svc'));
    await page.getByRole('button', { name: /^New folder, folder with 3 items/ }).click();
    // The top folder keeps its title; there is no breadcrumb.
    await expect(svc.locator('.folder-header h3')).toHaveText('Services');
    await expect(svc.getByRole('navigation', { name: 'Folder path' })).toHaveCount(0);
    // The inset box: inside Services' body, with its name and minimise in its own bar (no ‹, Ruling 15).
    const nf = nested(svc, f.id('nf'));
    await expect(nf).toBeVisible();
    await expect(header(nf).getByRole('button', { name: 'Minimise New folder' })).toBeVisible();
    await expect(header(nf).getByRole('button', { name: /^Back to/ })).toHaveCount(0);
    await expect(header(nf)).not.toContainText('‹');
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

  test('minimise on an inset box goes up one level; an outer box\'s title goes back to that level', async ({ page, context }) => {
    const f = await importDash(page, context, services);
    await page.goto(f.path);
    await drilled(page, f.id('dash'), f.id('svc'), [f.id('nf'), f.id('deeper')]);
    await page.reload();
    const svc = node(page, f.id('svc'));
    // Minimise on Deeper → New folder.
    await header(nested(svc, f.id('deeper'))).getByRole('button', { name: 'Minimise Deeper' }).click();
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
      folder(id('f'), 'Tiny', { x: 0, y: 0, w: 4, h: 6 }, [
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
    expect(saved.placement).toEqual({ x: 0, y: 0, w: 4, h: 6 });
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

  // Ruling 15 (Jonathan, walkthrough 3): every box's title bar is the top folder's — its name on the
  // left, the same minimise (–) on the right at the same place, the edit handle placed the same way.
  // Minimise on an inner box returns it to its tile in the parent: up one level.
  test('Ruling 15: every box has the same minimise at the same place; on an inner box it goes up one level', async ({ page, context }) => {
    const f = await importDash(page, context, services);
    await page.goto(f.path);
    await drilled(page, f.id('dash'), f.id('svc'), [f.id('nf'), f.id('deeper')]);
    await page.reload();
    const svc = node(page, f.id('svc'));
    const bars: [string, Locator, Locator, string][] = [
      ['Services', svc.locator(':scope > .folder-header'), svc.locator(':scope > .folder-header h3'), 'Minimise Services'],
      ['New folder', header(nested(svc, f.id('nf'))), header(nested(svc, f.id('nf'))).locator('.nested-name'), 'Minimise New folder'],
      ['Deeper', header(nested(svc, f.id('deeper'))), header(nested(svc, f.id('deeper'))).locator('.nested-name'), 'Minimise Deeper']
    ];
    /** Where the minimise sits in its bar, and where the name starts: the same for every box. */
    const placeOf = async (bar: Locator, name: Locator, label: string) => {
      const b = await box(bar);
      const m = await box(bar.getByRole('button', { name: label, exact: true }));
      const n = await box(name);
      // No other control of the bar lies right of minimise (it is the bar's last control).
      const right = await bar.locator('button:visible').evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().right)));
      return { fromRight: b.x + b.width - (m.x + m.width), midY: m.y + m.height / 2 - (b.y + b.height / 2), w: m.width, h: m.height, nameLeft: n.x - b.x, last: right - (m.x + m.width) };
    };
    const check = async (mode: string) => {
      const places = [];
      for (const [what, bar, name, label] of bars) places.push([what, await placeOf(bar, name, label)] as const);
      const [, top] = places[0];
      for (const [what, p] of places) {
        near(p.fromRight, top.fromRight, `${mode} ${what}: minimise's distance from the bar's right edge`);
        near(p.midY, 0, `${mode} ${what}: minimise centred in its bar`);
        near(p.w, top.w, `${mode} ${what}: minimise width`);
        near(p.h, top.h, `${mode} ${what}: minimise height`);
        near(p.nameLeft, top.nameLeft, `${mode} ${what}: name on the left, as the top folder's`);
        expect(p.last, `${mode} ${what}: minimise is the bar's rightmost control`).toBeLessThanOrEqual(0.5);
      }
      // No separate ‹ anywhere.
      await expect(svc.getByRole('button', { name: /^Back to/ })).toHaveCount(0);
      // Every box's minimise names its box (I2): no two controls on the page share a name (WCAG 2.4.6).
      const dupes = await page.evaluate(() => {
        const seen = new Map<string, number>();
        for (const e of document.querySelectorAll<HTMLElement>('button, a[href], [role="button"], [role="tab"], [role="menuitem"]')) {
          const b = e.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          const name = (e.getAttribute('aria-label') ?? e.textContent ?? '').replace(/\s+/g, ' ').trim();
          seen.set(name, (seen.get(name) ?? 0) + 1);
        }
        return [...seen].filter(([, n]) => n > 1).map(([name, n]) => `${name} ×${n}`);
      });
      expect(dupes, `${mode}: controls sharing a name`).toEqual([]);
    };
    await check('view');
    await enterEdit(page);
    await check('edit');
    // The edit handle is placed the same way: just left of the minimise, the same gap in every bar.
    const handleGap = async (bar: Locator, name: string, label: string) => {
      const h = await box(bar.getByRole('button', { name: `Edit ${name}`, exact: true }));
      const m = await box(bar.getByRole('button', { name: label, exact: true }));
      return m.x - (h.x + h.width);
    };
    const topGap = await handleGap(bars[0][1], 'Services', bars[0][3]);
    expect(topGap).toBeGreaterThanOrEqual(0);
    for (const [what, bar, , label] of bars.slice(1)) near(await handleGap(bar, what, label), topGap, `${what}: handle beside minimise as on the top bar`);
    // In edit mode minimise on an inner box goes up (this browser's memory, never the draft).
    await header(nested(svc, f.id('deeper'))).getByRole('button', { name: 'Minimise Deeper' }).click();
    await expect(nested(svc, f.id('deeper'))).toHaveCount(0);
    expect(await shown(page, f.id('svc'))).toEqual(['yt', 'gh', 'deeper'].map(f.id));
    await expect(page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: 'Undo' })).toBeDisabled();
    await page.getByRole('button', { name: 'Exit Edit Mode' }).click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toHaveCount(0);
    // View mode, by keyboard: a labelled button; Enter on it goes up one level, focus to its tile.
    await page.reload();
    await expect(nested(svc, f.id('nf'))).toBeVisible();
    const nfMin = header(nested(svc, f.id('nf'))).getByRole('button', { name: 'Minimise New folder' });
    await nfMin.focus();
    await page.keyboard.press('Enter');
    await expect(svc.locator('.nested-box')).toHaveCount(0);
    expect(await shown(page, f.id('svc'))).toEqual(['plex', 'nf'].map(f.id));
    await expect(node(page, f.id('nf')).locator('.folder-collapsed-tile')).toBeFocused();
    // Remembered per browser, exactly as going up.
    const nav = await page.evaluate((d) => JSON.parse(localStorage.getItem(`hops.folderNav.${d}`) ?? '{}'), f.id('dash'));
    expect(nav.drill?.[f.id('svc')] ?? []).toEqual([]);
    // The top folder's minimise still minimises the whole folder.
    await svc.locator(':scope > .folder-header').getByRole('button', { name: 'Minimise Services' }).click();
    await expect(node(page, f.id('svc'))).toHaveClass(/collapsed/);
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
    await header(dp).getByRole('button', { name: 'Minimise Deeper' }).click();
    await expect(dp).toHaveCount(0);
    expect(await shown(page, f.id('svc'))).toEqual(['yt', 'gh', 'deeper'].map(f.id));
  });
});

// ---- Task 7 fix round 1 (review Important 1, Ruling 14).

/** Press at `from` and travel in small steps to `to` (still pressed). */
async function travel(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 20) {
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(16);
  }
}
const mid = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
/** The name part of an inset box's bar: a press there is a press on the sub-folder (not on minimise or the handle). */
const barGrip = async (l: Locator) => {
  const h = await box(header(l));
  return { x: h.x + h.width * 0.6, y: h.y + h.height / 2 };
};
async function enterEdit(page: Page) {
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
}
async function saveDraft(page: Page) {
  const save = page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ });
  await expect(save).toBeEnabled();
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await save.click();
  expect((await saved).status()).toBe(200);
}
async function savedRoot(page: Page, dashId: string): Promise<AnyNode[]> {
  const cfg = await (await page.request.get('/api/config')).json();
  return cfg.dashboards.find((d: { id: string }) => d.id === dashId).tabs[0].root.children;
}
function findNode(ns: AnyNode[], id: string): AnyNode | undefined {
  for (const n of ns) {
    if (n.id === id) return n;
    const r = n.content ? findNode(n.content.children, id) : undefined;
    if (r) return r;
  }
  return undefined;
}
const childIds = (ns: AnyNode[], id: string) => (findNode(ns, id)?.content?.children ?? []).map((n) => n.id);
async function navOf(page: Page, dash: string) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(`hops.folderNav.${k}`) ?? '{"page":{},"drill":{}}'), dash);
}

test.describe('M5 §7 fix round 1', () => {
  test.use({ viewport: { width: 1024, height: 900 } });

  test('an inset box with room for one item but not the page bar its items need says "Not enough room" (no silent clip)', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      tile(id('m'), 'Med', 20, 0),
      // M6: a 4 x 7 box two levels in: each level takes 70 px (tab allowance 24 + bar 28 + border
      // and padding 18), so the inner content is 7c - 58 - 140.
      folder(id('f'), 'Small', { x: 0, y: 0, w: 4, h: 7 }, [folder(id('o'), 'Outer', null, [folder(id('s'), 'Three', null, kids(id, 3))])])
    ]);
    await page.goto(f.path);
    const c = (await box(node(page, f.id('m')))).width / 2; // the tab cell
    // Precondition (the arithmetic of this case): the inset content holds one Medium item, but not
    // one plus the 32 px page bar three items need.
    expect(7 * c - 198, 'one item fits').toBeGreaterThanOrEqual(2 * c);
    expect(7 * c - 198 - 32, 'item + page bar do not').toBeLessThan(2 * c);
    await drilled(page, f.id('dash'), f.id('f'), [f.id('o'), f.id('s')]);
    await page.reload();
    const small = node(page, f.id('f'));
    await expect(nested(small, f.id('s'))).toBeVisible();
    await expect(small.locator('[data-folder-no-room]')).toBeVisible();
    await expect(small.locator('[data-folder-no-room]')).toHaveText(/Not enough room — make the folder bigger/);
    // Nothing is drawn clipped: no item, no page bar.
    await expect(small.locator(`[data-node-id="${f.id('k1')}"]`)).toHaveCount(0);
    await expect(small.locator('[data-page-bar]')).toHaveCount(0);
  });

  test('right-click on an inset box\'s title: that sub-folder\'s own menu (Close goes back up; Edit edits it)', async ({ page, context }) => {
    const f = await importDash(page, context, services);
    await page.goto(f.path);
    await drilled(page, f.id('dash'), f.id('svc'), [f.id('nf'), f.id('deeper')]);
    await page.goto(f.path);
    await enterEdit(page);
    const svc = node(page, f.id('svc'));
    await page.mouse.click((await barGrip(nested(svc, f.id('nf')))).x, (await barGrip(nested(svc, f.id('nf')))).y, { button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Open', exact: true })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg.getByRole('textbox', { name: /^Folder name/ })).toHaveValue('New folder');
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dlg).toHaveCount(0);
    // Close: back up to Services' own level (this browser's memory; the draft is unchanged).
    const g = await barGrip(nested(svc, f.id('nf')));
    await page.mouse.click(g.x, g.y, { button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Close', exact: true }).click();
    await expect(svc.locator('.nested-box')).toHaveCount(0);
    expect(await shown(page, f.id('svc'))).toEqual(['plex', 'nf'].map(f.id));
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
  });

  test('dragging an inset box\'s title out to the tab moves THAT sub-folder; nothing is left drilled into it', async ({ page, context }) => {
    const f = await importDash(page, context, services);
    await page.goto(f.path);
    await drilled(page, f.id('dash'), f.id('svc'), [f.id('nf'), f.id('deeper')], { [f.id('nf')]: 0 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(f.path);
    await enterEdit(page);
    const svc = node(page, f.id('svc'));
    const from = await barGrip(nested(svc, f.id('nf')));
    const med = await box(node(page, f.id('tabmed')));
    const to = { x: med.x + med.width / 2, y: med.y + med.height * 3.5 }; // empty cells below TabMed
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await travel(page, from, to);
    await page.waitForTimeout(120);
    await expect(page.locator('.drag-layer .reason')).toHaveCount(0);
    await page.mouse.up();
    // Services is back at its own level; the moved folder is a minimised folder on the tab.
    await expect(svc.locator('.nested-box')).toHaveCount(0);
    await expect(node(page, f.id('nf'))).toHaveClass(/collapsed/);
    await saveDraft(page);
    const root = await savedRoot(page, f.id('dash'));
    expect(root.map((n) => n.id)).toContain(f.id('nf'));
    expect(childIds(root, f.id('svc'))).toEqual([f.id('plex')]);
    expect(childIds(root, f.id('nf'))).toEqual(['yt', 'gh', 'deeper'].map(f.id));
    const nav = await navOf(page, f.id('dash'));
    expect(nav.drill).toEqual({});
    // Never mistaken for "changed elsewhere".
    await expect(page.getByText(/A folder you had open/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('dragging an inset title onto another folder puts that sub-folder inside it', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      ...services(id),
      folder(id('other'), 'Other', { x: 20, y: 4, w: 3, h: 6 }, [kid(id('o1'), 'O1')], { display: 'collapsed' })
    ]);
    await page.goto(f.path);
    await drilled(page, f.id('dash'), f.id('svc'), [f.id('nf'), f.id('deeper')]);
    await page.goto(f.path);
    await enterEdit(page);
    const svc = node(page, f.id('svc'));
    const from = await barGrip(nested(svc, f.id('deeper')));
    const to = mid(await box(node(page, f.id('other')).locator('.folder-collapsed-tile')));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await travel(page, from, to);
    await page.waitForTimeout(120);
    await expect(page.locator('.drag-layer .reason')).toHaveCount(0);
    await page.mouse.up();
    await expect(nested(svc, f.id('deeper'))).toHaveCount(0);
    await expect(nested(svc, f.id('nf'))).toBeVisible(); // back up one level: New folder still open
    await saveDraft(page);
    const root = await savedRoot(page, f.id('dash'));
    expect(childIds(root, f.id('other'))).toEqual(['o1', 'deeper'].map(f.id));
    expect(childIds(root, f.id('nf'))).toEqual(['yt', 'gh'].map(f.id));
    expect((await navOf(page, f.id('dash'))).drill).toEqual({ [f.id('svc')]: [f.id('nf')] });
  });

  test('dragging an inset title, holding over the outer title to go up, then dropping reorders it there', async ({ page, context }) => {
    const f = await importDash(page, context, services);
    await page.goto(f.path);
    await drilled(page, f.id('dash'), f.id('svc'), [f.id('nf'), f.id('deeper')]);
    await page.goto(f.path);
    await enterEdit(page);
    const svc = node(page, f.id('svc'));
    const from = await barGrip(nested(svc, f.id('deeper')));
    const nfTitle = mid(await box(header(nested(svc, f.id('nf'))).getByRole('button', { name: 'New folder', exact: true })));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await travel(page, from, nfTitle);
    await expect(nested(svc, f.id('deeper'))).toHaveCount(0, { timeout: 2000 }); // held: up to New folder
    const yt = await box(node(page, f.id('yt')));
    const to = { x: yt.x + 8, y: yt.y + yt.height / 2 };
    await travel(page, nfTitle, to, 10);
    await page.waitForTimeout(120);
    await expect(page.locator('.drag-layer .reason')).toHaveCount(0);
    await page.mouse.up();
    await saveDraft(page);
    expect(childIds(await savedRoot(page, f.id('dash')), f.id('nf'))).toEqual(['deeper', 'yt', 'gh'].map(f.id));
  });
});
