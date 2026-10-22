// M5 walkthrough 1, part C (review-round leftovers, 2026-10-22):
//  (1) on a Small item (the Showcase's "Minimised Small" folder) the edit pencil covered the tile's
//      centre, so a click in the middle opened the Edit dialog instead of the folder. The handle is in
//      the top-right corner, sized to the item, never over its centre; at least 24×24; on an item too
//      small for that it hangs just outside the corner.
//  (2) at 1280 in edit mode the navbar's right-hand controls took the room and only "More" showed.
//      With room short the controls go compact (icons only, no "Editing" text), so the 4 dashboard
//      links show; "More" only beyond that.
//  (3) dragging an item out of a folder onto the tab, the ghost stayed at the folder's item size. Over
//      the tab it is the item's OWN size; over a folder's page that folder's item size (Ruling 11).
import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCsrfToken } from '../helpers';

let seq = 0;
const made: string[] = [];

test.afterEach(async ({ page, context }) => {
  while (made.length) {
    const id = made.pop()!;
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
    expect(typeof rev, `cleanup: dashboard ${id} has a revision`).toBe('number');
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) }
    });
    expect(r.status(), await r.text()).toBe(200);
  }
});

async function importDoc(page: Page, context: BrowserContext, dash: Record<string, unknown>) {
  const doc = { format: 'hops-export', schemaVersion: 3, exportType: 'single-dashboard', config: { layoutVersion: 1, dashboards: [dash] } };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'w1c.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(dash.id as string);
}

/** The bundled M5 Showcase, every id prefixed so this copy never collides with another. */
async function showcase(page: Page, context: BrowserContext, name: string) {
  const fixture = JSON.parse(fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend/internal/configdoc/testdata/v3_showcase_export.json'), 'utf8'));
  const p = `w1c${Date.now().toString(36)}${(seq++).toString(36)}`;
  const dash = fixture.config.dashboards[0];
  const prefix = (n: { id: string; content?: { children: unknown[] }; root?: { children: unknown[] } }) => {
    n.id = `${p}-${n.id}`;
    for (const c of (n.content ?? n.root)?.children ?? []) prefix(c as typeof n);
  };
  prefix(dash);
  for (const t of dash.tabs) prefix(t);
  dash.path = `/${p}`;
  dash.name = name;
  await importDoc(page, context, dash);
  return { path: dash.path as string, id: (s: string) => `${p}-${s}` };
}

/** A small one-tab dashboard called `name`. */
async function plainDash(page: Page, context: BrowserContext, name: string) {
  const p = `w1c${Date.now().toString(36)}${(seq++).toString(36)}`;
  await importDoc(page, context, {
    id: `${p}-dash`, name, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{ id: `${p}-tab`, name: 'Main', order: 0, root: { columns: 24, children: [
      { kind: 'tile', id: `${p}-a`, name: 'A tile', url: 'http://a.test', icon: 'mdi:home', openMode: 'newtab', size: 'medium', order: 0, placement: { x: 0, y: 0, w: 2, h: 2 } }
    ] } }]
  });
}

const node = (page: Page, id: string) => page.locator(`.tab-canvas [data-node-id="${id}"]`).first();

async function enterEdit(page: Page) {
  await page.getByRole('button', { name: 'Enter Edit Mode' }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Editing' });
  await expect(toolbar).toBeVisible();
  return toolbar;
}

// ---------------------------------------------------------------- (1) handles clear of the centre

/**
 * Every drawn item on the canvas, innermost first: hover its centre and report what is under it, and
 * the item's corner handle (once shown).
 */
async function centreReport(page: Page) {
  const ids = await page.locator('.tab-canvas [data-node-id]').evaluateAll((els) =>
    els.filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && !e.closest('[aria-hidden="true"]');
    }).map((e) => e.getAttribute('data-node-id')!));
  const out: { id: string; w: number; h: number; underIsHandle: boolean; handle: { w: number; h: number; coversCentre: boolean } | null }[] = [];
  for (const id of [...new Set(ids)]) {
    const el = page.locator(`.tab-canvas [data-node-id="${id}"]`).first();
    // A minimised folder's face is its tile; an open folder's centre is its body (its own items).
    const target = (await el.locator(':scope > .folder-collapsed-tile').count()) ? el.locator(':scope > .folder-collapsed-tile') : el;
    const role = await el.getAttribute('role');
    if (role === 'group') continue; // an open folder: its centre is its items, each checked itself
    const b = (await target.boundingBox())!;
    if (!b || b.y < 0 || b.y + b.height > (page.viewportSize()!.height)) continue;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    // Arrive from just off the item, so the hover is fresh; then wait out the handle's fade-in.
    await page.mouse.move(cx - 3, cy - 3);
    await page.mouse.move(cx, cy);
    const look = () => page.evaluate(([x, y, nid]) => {
      const under = document.elementFromPoint(x, y);
      const host = document.querySelector(`.tab-canvas [data-node-id="${nid}"]`)!;
      const h = Array.from(host.querySelectorAll(':scope > [data-edit-handle]'))[0] as HTMLElement | undefined;
      const hb = h && getComputedStyle(h).opacity === '1' ? h.getBoundingClientRect() : null;
      return {
        underIsHandle: !!under?.closest('[data-edit-handle]'),
        handle: hb ? { w: hb.width, h: hb.height, coversCentre: hb.left <= x && x <= hb.right && hb.top <= y && y <= hb.bottom } : null
      };
    }, [cx, cy, id] as const);
    let r = await look();
    for (let i = 0; i < 20 && !r.handle; i++) {
      await page.waitForTimeout(50);
      r = await look();
    }
    out.push({ id, w: b.width, h: b.height, ...r });
  }
  return out;
}

test.describe('walkthrough 1 C (1): the edit handle never covers an item\'s centre', () => {
  for (const width of [1280, 1920]) {
    test(`at ${width}: on every tab of the Showcase, every item's centre is the item (the handle is in its corner, ≥ 24 px)`, async ({ page, context }) => {
      const sc = await showcase(page, context, 'v3 Showcase');
      await page.setViewportSize({ width, height: 2400 });
      await page.goto(sc.path);
      await enterEdit(page);
      for (const tab of ['Grid', 'Sizes', 'Folders']) {
        await page.getByRole('tab', { name: `Switch to ${tab} tab`, exact: true }).click();
        await expect(page.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
        const rep = await centreReport(page);
        expect(rep.length, `${tab}: items checked`).toBeGreaterThan(3);
        for (const r of rep) {
          expect(r.underIsHandle, `${tab} ${r.id} (${Math.round(r.w)}×${Math.round(r.h)}): its centre is the item, not the edit handle`).toBe(false);
          expect(r.handle, `${tab} ${r.id}: its handle shows on hover`).not.toBeNull();
          expect(r.handle!.coversCentre, `${tab} ${r.id}: the handle is clear of the centre`).toBe(false);
          expect(r.handle!.w, `${tab} ${r.id}: handle ≥ 24 wide`).toBeGreaterThanOrEqual(24);
          expect(r.handle!.h, `${tab} ${r.id}: handle ≥ 24 tall`).toBeGreaterThanOrEqual(24);
        }
      }
    });
  }

  test('a click on the centre of every Small item opens the folder or selects the tile, never the Edit dialog', async ({ page, context }) => {
    test.setTimeout(150_000); // three widths, every Small item clicked one by one
    const sc = await showcase(page, context, 'v3 Showcase');
    const id = sc.id;
    for (const width of [1280, 1416, 1920]) {
      await page.setViewportSize({ width, height: 2400 });
      await page.goto(sc.path);
      await page.getByRole('tab', { name: 'Switch to Sizes tab', exact: true }).click();
      const toolbar = await enterEdit(page);
      const undo = toolbar.getByRole('button', { name: /Undo/ });

      // The Minimised Small folder: a centre click opens it (one undo step back).
      const face = node(page, id('sc-f-min-s')).locator('.folder-collapsed-tile');
      const fb = (await face.boundingBox())!;
      expect(Math.min(fb.width, fb.height), 'Minimised Small is a small tile').toBeLessThan(80);
      await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
      await page.waitForTimeout(170);
      await page.mouse.click(fb.x + fb.width / 2, fb.y + fb.height / 2);
      await expect(node(page, id('sc-f-min-s'))).toHaveAttribute('role', 'group');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await undo.click();
      await expect(face).toBeVisible();

      // Small tiles: the Small tile on the tab, and the Small-contents folder's items on its page.
      const smalls = [id('sc-sz-s'), ...(await node(page, id('sc-f-small')).locator('.folder-body [data-node-id]').evaluateAll(
        (els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getAttribute('data-node-id')!)))];
      expect(smalls.length).toBeGreaterThan(3);
      for (const sid of smalls) {
        const t = page.locator(`.tab-canvas [data-node-id="${sid}"]`).first();
        const b = (await t.boundingBox())!;
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(170);
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        await expect(t, `${sid} at ${width}: selected`).toHaveClass(/selected/);
        await expect(page.getByRole('dialog'), `${sid} at ${width}: no Edit dialog`).toHaveCount(0);
        await page.waitForTimeout(350); // past the double-click window before the next item
      }
      // Nothing was changed (the open was undone; selecting changes nothing): editing just ends.
      await page.getByRole('button', { name: 'Exit Edit Mode' }).click();
      await expect(toolbar).toHaveCount(0);
    }
  });
});

// ---------------------------------------------------------------- (2) the navbar at 1280 / 1416

/** Jonathan's dev set: Sample (the fresh server's), Weavers, Sample (Imported), v3 Showcase. */
async function fourDashboards(page: Page, context: BrowserContext) {
  const have = ((await (await page.request.get('/api/config')).json()).dashboards as { name: string }[]).map((d) => d.name);
  expect(have, 'the fresh test server has its Sample dashboard').toEqual(['Sample']);
  await plainDash(page, context, 'Weavers');
  await plainDash(page, context, 'Sample (Imported)');
  return showcase(page, context, 'v3 Showcase');
}

const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** The bar holds: no sideways scroll, nothing overlaps or leaves the screen, every control is there. */
async function barHolds(page: Page, width: number, editing: boolean, label: string) {
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways, `${label}: no sideways scroll`).toBeLessThanOrEqual(0);
  const pieces = await page.evaluate(() => {
    const els = [
      ...document.querySelectorAll('.navbar .logo, .navbar .nav-links > .nav-link, .navbar .nav-more-btn:not([data-measure-more]), .navbar .center-title, .navbar .nav-right > *')
    ].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    return els.map((e) => { const r = e.getBoundingClientRect(); return { n: e.className + ' ' + (e.textContent ?? '').trim(), l: r.left, r: r.right, t: r.top, b: r.bottom }; });
  });
  for (let i = 0; i < pieces.length; i++) {
    expect(pieces[i].l, `${label}: ${pieces[i].n} on screen`).toBeGreaterThanOrEqual(-0.5);
    expect(pieces[i].r, `${label}: ${pieces[i].n} on screen`).toBeLessThanOrEqual(width + 0.5);
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i], b = pieces[j];
      const ov = Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
      expect(ov, `${label}: ${a.n} / ${b.n} overlap`).toBe(false);
    }
  }
  // Every control is still in the bar (compact, never moved into another menu), at a tappable size.
  const names = ['Search', 'Decrease text size', 'Increase text size', 'Theme Settings', editing ? 'Exit Edit Mode' : 'Enter Edit Mode', 'Help', 'About HOPS', 'Log out'];
  if (editing) names.push('Export Dashboard');
  for (const name of names) {
    const b = page.locator('.navbar .nav-right').getByRole('button', { name, exact: true });
    await b.click({ trial: true, timeout: 3000 });
    const bb = (await b.boundingBox())!;
    expect(Math.min(bb.width, bb.height), `${label}: ${name} stays tappable`).toBeGreaterThanOrEqual(24);
  }
  await page.locator('.navbar .nav-right').getByRole('link', { name: 'Settings' }).click({ trial: true, timeout: 3000 });
  // The title is still there, whole.
  const t = await page.locator('.navbar .center-title').evaluate((e) => ({ w: e.clientWidth, sw: e.scrollWidth }));
  expect(t.sw, `${label}: the title is not cut off`).toBeLessThanOrEqual(t.w + 0.5);
}

async function linksAndMore(page: Page) {
  const shown = (await page.locator('.navbar .nav-links > .nav-link').allInnerTexts()).map((x) => x.trim());
  const more = page.getByRole('button', { name: 'More dashboards' });
  let rest: string[] = [];
  if (await more.count()) {
    await more.click();
    rest = (await page.getByRole('menu', { name: 'More dashboards' }).getByRole('menuitem').allInnerTexts()).map((x) => x.trim());
    await page.keyboard.press('Escape');
  }
  return { shown, rest };
}

test.describe('walkthrough 1 C (2): with room short, the navbar controls go compact so more dashboard links show', () => {
  // Measured (Chromium, default text size): the 4 links need 497 px (86 + 95 + 165 + 127 and three
  // 8 px gaps). The title stays centred, so the left side (logo 173 + 32 + links) gets at most half of
  // what the title leaves: 517 px at 1280, 577 px at 1416 and above (the bar is at most 1400 wide) —
  // room for 311 / 371 px of links. Compact controls (edit 484 px, view 432 px) already fit in their
  // half, so 2 links + More is the most a centred title allows at both widths (see walkthrough1-C.md).
  test('4 dashboards at 1280 and 1416, view and edit: the controls compact when that shows more links; at least 2 links + More; nothing overlaps; every control stays', async ({ page, context }) => {
    const sc = await fourDashboards(page, context);
    const all = ['Sample', 'Weavers', 'Sample (Imported)', 'v3 Showcase'];
    await page.goto(sc.path);
    await expect(page.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
    for (const editing of [false, true]) {
      if (editing) await enterEdit(page);
      for (const width of [1280, 1416]) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page);
        const label = `${editing ? 'edit' : 'view'} mode at ${width}`;
        await expect.poll(async () => (await page.locator('.navbar .nav-links > .nav-link').count()), { message: `${label}: at least 2 links`, timeout: 2000 })
          .toBeGreaterThanOrEqual(2);
        const { shown, rest } = await linksAndMore(page);
        expect([...shown, ...rest], `${label}: every dashboard once, in order`).toEqual(all);
        if (editing) {
          // Compact controls: the pencil is its icon (no "Editing" text), Log out its icon.
          await expect(page.locator('.navbar .edit-label'), `${label}: no "Editing" text`).toBeHidden();
          await expect(page.locator('.navbar .logout-label'), `${label}: Log out is its icon`).toBeHidden();
        }
        await barHolds(page, width, editing, label);
      }
    }
  });

  test('when every link fits, the controls keep their labels; compact only when that shows more links', async ({ page, context }) => {
    const sc = await showcase(page, context, 'v3 Showcase'); // Sample + v3 Showcase
    await page.goto(sc.path);
    await enterEdit(page);
    // 1416: both links fit beside the full controls — "Editing" and "Log out" keep their text.
    await page.setViewportSize({ width: 1416, height: 900 });
    await settle(page);
    await expect(page.locator('.navbar .nav-links > .nav-link')).toHaveText(['Sample', 'v3 Showcase']);
    await expect(page.locator('.navbar .edit-label')).toBeVisible();
    await expect(page.locator('.navbar .logout-label')).toBeVisible();
    await barHolds(page, 1416, true, 'edit at 1416, 2 dashboards');
    // 1280: only compact controls leave room for both — so they compact, and both links show.
    await page.setViewportSize({ width: 1280, height: 900 });
    await settle(page);
    await expect(page.locator('.navbar .nav-links > .nav-link')).toHaveText(['Sample', 'v3 Showcase']);
    await expect(page.getByRole('button', { name: 'More dashboards' })).toHaveCount(0);
    await expect(page.locator('.navbar .edit-label')).toBeHidden();
    await barHolds(page, 1280, true, 'edit at 1280, 2 dashboards');
    // And back: wide again, the labels return.
    await page.setViewportSize({ width: 1416, height: 900 });
    await settle(page);
    await expect(page.locator('.navbar .edit-label')).toBeVisible();
  });
});

// ---------------------------------------------------------------- (3) the ghost follows the target

test.describe('walkthrough 1 C (3): dragging out of a folder, the ghost is the item\'s own size over the tab', () => {
  test('"Large inside" (Large, shown Medium in its folder): over the tab it is Large at once; back over a folder, that folder\'s item size', async ({ page, context }) => {
    const sc = await showcase(page, context, 'v3 Showcase');
    const id = sc.id;
    await page.setViewportSize({ width: 1416, height: 1200 });
    await page.goto(sc.path);
    await page.getByRole('tab', { name: 'Switch to Sizes tab', exact: true }).click();
    await enterEdit(page);

    const big = (await node(page, id('sc-big')).boundingBox())!; // a Large tile on the tab: its own size
    const item = node(page, id('sc-ff-2'));
    const ib = (await item.boundingBox())!;
    expect(ib.width, 'shown at Medium in its folder').toBeLessThan(big.width * 0.75);
    const canvas = (await page.locator('.tab-canvas').first().boundingBox())!;
    const cell = canvas.width / 24;
    const ghost = page.locator('.drag-layer .ghost');

    // Press on it and travel (a real mouse) right, past its folder, onto the tab's empty cells (x 19–23, y 1–3).
    const x0 = ib.x + ib.width / 2, y0 = ib.y + ib.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    const tabX = canvas.x + cell * 20.5, tabY = canvas.y + cell * 2;
    const steps = 30;
    let switchedAt = -1;
    const folderBox = (await node(page, id('sc-ff')).boundingBox())!;
    for (let i = 1; i <= steps; i++) {
      const x = x0 + ((tabX - x0) * i) / steps, y = y0 + ((tabY - y0) * i) / steps;
      await page.mouse.move(x, y);
      await page.waitForTimeout(20);
      const outside = x > folderBox.x + folderBox.width + 1;
      if (outside && switchedAt < 0) {
        // The first move past the folder's edge, onto the tab: the ghost is the item's own (Large) size now.
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const g = (await ghost.boundingBox())!;
        expect(Math.abs(g.width - big.width), `just over the tab: ghost ${g.width}px vs its own Large ${big.width}px`).toBeLessThanOrEqual(1.5);
        switchedAt = i;
      }
    }
    expect(switchedAt, 'the drag crossed onto the tab').toBeGreaterThan(0);
    let g = (await ghost.boundingBox())!;
    expect(Math.abs(g.width - big.width), 'over the tab: its own size').toBeLessThanOrEqual(1.5);
    expect(Math.abs(g.height - big.height)).toBeLessThanOrEqual(1.5);

    // Back over a folder's page (Small contents): that folder's item size.
    const smallItem = (await node(page, id('sc-f-small')).locator('.folder-body [data-node-id]').first().boundingBox())!;
    const sb = (await node(page, id('sc-f-small')).locator('.folder-body').boundingBox())!;
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(tabX + ((sb.x + sb.width / 2 - tabX) * i) / 20, tabY + ((sb.y + sb.height / 2 - tabY) * i) / 20);
      await page.waitForTimeout(16);
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    g = (await ghost.boundingBox())!;
    expect(Math.abs(g.width - smallItem.width), `over Small contents: ghost ${g.width}px vs its item ${smallItem.width}px`).toBeLessThanOrEqual(1.5);
    // And over the tab again: its own size.
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(sb.x + sb.width / 2 + ((tabX - sb.x - sb.width / 2) * i) / 20, sb.y + sb.height / 2 + ((tabY - sb.y - sb.height / 2) * i) / 20);
      await page.waitForTimeout(16);
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    g = (await ghost.boundingBox())!;
    expect(Math.abs(g.width - big.width), 'back over the tab: its own size').toBeLessThanOrEqual(1.5);
    // Dropped there: it lands Large, under where the ghost was drawn.
    const drawn = g;
    await page.mouse.up();
    const landed = (await node(page, id('sc-ff-2')).boundingBox())!;
    expect(Math.abs(landed.width - big.width)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(landed.x - drawn.x), 'it lands where its ghost was').toBeLessThanOrEqual(cell / 2 + 1);
    expect(Math.abs(landed.y - drawn.y), 'it lands where its ghost was').toBeLessThanOrEqual(cell / 2 + 1);
  });
});
