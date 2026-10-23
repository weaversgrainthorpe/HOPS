// M5 walkthrough 1, part A (Jonathan, 2026-10-22):
//  (1) the navbar's dashboard links were a scrolling strip with a visible scrollbar, and the page could
//      be wider than the screen (it scrolled sideways). Ruling 12 (links that fit + "More ▾") is
//      superseded by Ruling 16 (M5 §8): no link row at all — signed in, the title is the dashboard
//      switcher. Still: nothing in the bar overlaps; the pencil, gear and Log out stay visible; the
//      page never scrolls sideways; every dashboard is one click away (in the switcher).
//      m5-switcher.spec.ts holds the switcher's own tests (keys, mouse, order, edit mode, centring).
//  (2) in edit mode a minimised folder could not be opened by clicking it. M5 §3a.8: click, Enter and
//      the menu's "Open" all open it in place — in edit mode as the draft's saved default (undoable);
//      a double-click still edits it (§4B).
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
    multipart: { file: { name: 'w1a.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(dash.id as string);
}

/** The bundled M5 Showcase, every id prefixed so this copy never collides with another. */
async function showcase(page: Page, context: BrowserContext, name: string) {
  const fixture = JSON.parse(fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend/internal/configdoc/testdata/v3_showcase_export.json'), 'utf8'));
  const p = `w1a${Date.now().toString(36)}${(seq++).toString(36)}`;
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
  const p = `w1a${Date.now().toString(36)}${(seq++).toString(36)}`;
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

/**
 * Jonathan's dev set (Sample + Weavers, Sample (Imported), v3 Showcase), plus more to make `total`.
 * Returns the Showcase.
 */
async function dashboards(page: Page, context: BrowserContext, total: number) {
  const names = ['Weavers', 'Sample (Imported)', 'Kitchen display', 'Garage', 'Home office', 'Media room', 'Network'];
  const have = ((await (await page.request.get('/api/config')).json()).dashboards as unknown[]).length;
  for (let i = 0; i < total - have - 1; i++) await plainDash(page, context, names[i]);
  return showcase(page, context, 'v3 Showcase');
}

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

/** The navbar's visible pieces, in page order. */
async function barPieces(page: Page) {
  return page.evaluate(() => {
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const pieces: { name: string; box: Box }[] = [];
    const add = (name: string, el: Element | null) => {
      if (!el || !shown(el)) return;
      const r = el.getBoundingClientRect();
      pieces.push({ name, box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } });
    };
    add('logo', document.querySelector('.navbar .logo'));
    const title = document.querySelector('.navbar .center-title');
    if (title && title.getBoundingClientRect().width > 1) add('title', title);
    document.querySelectorAll('.navbar .nav-right > *').forEach((el) => add(`control ${el.getAttribute('aria-label') ?? el.className}`, el));
    return pieces;
  });
}

/** The header's promises at this width (Rulings 12 and 16). */
async function headerHolds(page: Page, all: string[]) {
  // After a resize the bar is measured again on the next frame (ResizeObservers): let it settle.
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await expect.poll(sideways, { message: 'the page never scrolls sideways', timeout: 2000 }).toBeLessThanOrEqual(0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
  expect(w.doc, 'the page never scrolls sideways').toBeLessThanOrEqual(w.view);
  const pieces = await barPieces(page);
  expect(pieces.some((p) => p.name === 'title'), 'the title shows').toBe(true);
  for (const p of pieces) {
    expect(p.box.left, `${p.name} is on screen`).toBeGreaterThanOrEqual(-0.5);
    expect(p.box.right, `${p.name} is on screen`).toBeLessThanOrEqual(w.view + 0.5);
  }
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      expect(overlaps(pieces[i].box, pieces[j].box), `${pieces[i].name} and ${pieces[j].name} overlap`).toBe(false);
    }
  }
  // Ruling 16: no link row and no More, at any width.
  await expect(page.locator('.navbar .nav-link, .navbar .nav-links, .navbar .nav-more-btn')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More dashboards' })).toHaveCount(0);
  // Every dashboard is one click away: in the switcher, in order, once each.
  const btn = page.locator('.navbar').getByRole('button', { name: /switch dashboard$/ });
  await expect(btn).toBeVisible();
  await btn.click();
  const menu = page.getByRole('menu', { name: 'Dashboards' });
  await expect(menu).toBeVisible();
  const listed = await menu.getByRole('menuitem').allInnerTexts();
  // The open menu is on screen too.
  const mb = (await menu.boundingBox())!;
  expect(mb.x).toBeGreaterThanOrEqual(0);
  expect(mb.x + mb.width).toBeLessThanOrEqual(w.view + 0.5);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(listed.map((t) => t.trim())).toEqual(all);
}

async function allNames(page: Page) {
  return ((await (await page.request.get('/api/config')).json()).dashboards as { name: string; order: number }[])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((d) => d.name);
}

async function desktopControls(page: Page, editing: boolean) {
  await page.getByRole('button', { name: editing ? 'Exit Edit Mode' : 'Enter Edit Mode' }).click({ trial: true, timeout: 3000 });
  await page.getByRole('link', { name: 'Settings' }).click({ trial: true, timeout: 3000 });
  await page.getByRole('button', { name: 'Log out' }).click({ trial: true, timeout: 3000 });
}

test.describe('walkthrough 1 (1): the header (Rulings 12 and 16)', () => {
  for (const total of [4, 8]) {
    test(`${total} dashboards at 1280, 1416 and 1920: no link row, every dashboard in the switcher, nothing overlaps, no sideways scroll (view and edit)`, async ({ page, context }) => {
      const sc = await dashboards(page, context, total);
      const all = await allNames(page);
      expect(all).toHaveLength(total);
      await page.goto(sc.path);
      await expect(page.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
      for (const editing of [false, true]) {
        if (editing) {
          await page.getByRole('button', { name: 'Enter Edit Mode' }).click();
          await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
        }
        for (const width of [1280, 1416, 1920]) {
          await page.setViewportSize({ width, height: 900 });
          await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBeLessThanOrEqual(width);
          await headerHolds(page, all);
          await desktopControls(page, editing);
        }
      }
    });
  }

  test('phones (375) keep the existing hiding rules; tablets (481–1100) never scroll sideways either', async ({ page, context }) => {
    const sc = await dashboards(page, context, 8);
    const all = await allNames(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(sc.path);
    await expect(page.locator('.navbar .logo')).toBeVisible();
    await headerHolds(page, all); // phones too: the switcher (§8), no link row
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter Edit Mode' })).toBeHidden(); // phones: no editing (existing rule)
    // Every text size (the A buttons scale the whole page), view and edit mode.
    for (const size of ['default', 'largest']) {
      if (size === 'largest') {
        await page.setViewportSize({ width: 1920, height: 800 });
        const up = page.getByRole('button', { name: 'Increase text size' });
        while (await up.isEnabled()) await up.click();
      }
      for (const editing of [false, true]) {
        await page.setViewportSize({ width: 1100, height: 800 });
        if (editing) {
          await page.getByRole('button', { name: 'Enter Edit Mode' }).click();
          await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
        }
        for (let width = 1100; width >= 481; width -= 41) {
          await page.setViewportSize({ width, height: 800 });
          await headerHolds(page, all);
          await expect(page.getByRole('link', { name: 'Settings' }), `gear at ${width}`).toBeVisible();
          await expect(page.getByRole('button', { name: editing ? 'Exit Edit Mode' : 'Enter Edit Mode' }), `pencil at ${width}`).toBeVisible();
          await expect(page.getByRole('button', { name: 'Log out' }), `Log out at ${width}`).toBeVisible();
        }
        if (editing) {
          await page.getByRole('button', { name: 'Exit Edit Mode' }).click();
          await expect(page.getByRole('toolbar', { name: 'Editing' })).toHaveCount(0);
        }
      }
    }
    // Back to the default size for the next test (this browser remembers it).
    await page.setViewportSize({ width: 1920, height: 800 });
    const down = page.getByRole('button', { name: 'Decrease text size' });
    const reset = page.getByRole('button', { name: 'Increase text size' });
    while (await down.isEnabled()) await down.click();
    await reset.click(); // Small → Medium (the default)
  });
});

// ---- (2) opening a folder in edit mode

const node = (page: Page, id: string) => page.locator(`.tab-canvas [data-node-id="${id}"]`).first();
const face = (page: Page, id: string) => node(page, id).locator('.folder-collapsed-tile');

/** Press at the centre of `from` and travel in small steps to (x, y); then let go. */
async function dragTo(page: Page, from: Locator, x: number, y: number) {
  const b = (await from.boundingBox())!;
  const x0 = b.x + b.width / 2, y0 = b.y + b.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(x0 + ((x - x0) * i) / 20, y0 + ((y - y0) * i) / 20);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(120);
  await page.mouse.up();
}

test.describe('walkthrough 1 (2): opening a folder in edit mode', () => {
  test('after dragging Big tile into Medium contents: click, Enter and the menu\'s Open all open each minimised folder (undoable); a double-click edits', async ({ page, context }) => {
    const sc = await showcase(page, context, 'v3 Showcase');
    const id = sc.id;
    await page.setViewportSize({ width: 1416, height: 900 });
    await page.goto(sc.path);
    await page.getByRole('tab', { name: 'Switch to Sizes tab', exact: true }).click();
    await page.getByRole('button', { name: 'Enter Edit Mode' }).click();
    const toolbar = page.getByRole('toolbar', { name: 'Editing' });
    await expect(toolbar).toBeVisible();
    // Jonathan's step: Big tile into the Medium contents folder (its empty lower right).
    const body = (await node(page, id('sc-ff')).locator('.folder-body').boundingBox())!;
    await dragTo(page, node(page, id('sc-big')), body.x + body.width - 30, body.y + body.height - 30);
    await expect(node(page, id('sc-ff')).locator(`[data-node-id="${id('sc-big')}"]`)).toBeVisible();
    const undo = toolbar.getByRole('button', { name: /Undo/ });

    const isOpen = (fid: string) => expect(node(page, id(fid))).toHaveAttribute('role', 'group');
    const isMinimised = (fid: string) => expect(face(page, id(fid))).toBeVisible();

    for (const fid of ['sc-f-min-s', 'sc-f-min-m', 'sc-f-min-l']) {
      // 1. A click (on the tile, clear of its edit handle in the top-right corner).
      await face(page, id(fid)).scrollIntoViewIfNeeded();
      const b = (await face(page, id(fid)).boundingBox())!;
      await page.mouse.click(b.x + 8, b.y + b.height - 8);
      await isOpen(fid);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await undo.click();
      await isMinimised(fid);
      // 2. Enter.
      await face(page, id(fid)).focus();
      await page.keyboard.press('Enter');
      await isOpen(fid);
      await undo.click();
      await isMinimised(fid);
      // 3. The menu's Open.
      await face(page, id(fid)).click({ button: 'right', position: { x: 8, y: b.height - 8 } });
      await page.getByRole('menu').getByRole('menuitem', { name: 'Open', exact: true }).click();
      await isOpen(fid);
      // 4. The open box's Minimise toggle puts it back (the same draft value, undoable).
      await node(page, id(fid)).getByRole('button', { name: /^Minimise / }).click();
      await isMinimised(fid);
      // 5. A double-click edits it, and never also opens it.
      await face(page, id(fid)).dblclick({ position: { x: 8, y: b.height - 8 } });
      const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
      await expect(dlg).toBeVisible();
      await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dlg).toHaveCount(0);
      await page.waitForTimeout(500); // longer than the double-click wait
      await isMinimised(fid);
    }

    // A sub-folder on a page: a click drills in (this browser's memory) — a folder inside a folder
    // (M5 §7) — and the outer folder's title goes back up.
    const sub = face(page, id('sc-f-large-sub'));
    await sub.scrollIntoViewIfNeeded();
    const sb = (await sub.boundingBox())!;
    await page.mouse.click(sb.x + 8, sb.y + sb.height - 8);
    const inset = node(page, id('sc-f-large')).locator(`.nested-box[data-nested-folder="${id('sc-f-large-sub')}"]`);
    await expect(inset.locator('.nested-header')).toContainText('Small-contents sub-folder');
    await node(page, id('sc-f-large')).locator('.folder-header').getByRole('button', { name: 'Large contents', exact: true }).click();
    await expect(sub).toBeVisible();

    // Opening goes into the draft: open one by a click and save — it is stored open.
    await face(page, id('sc-f-min-m')).scrollIntoViewIfNeeded();
    const mb = (await face(page, id('sc-f-min-m')).boundingBox())!;
    await page.mouse.click(mb.x + 8, mb.y + mb.height - 8);
    await isOpen('sc-f-min-m');
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
    await toolbar.getByRole('button', { name: /Save/ }).click();
    expect((await saved).status()).toBe(200);
    const cfg = await (await page.request.get('/api/config')).json();
    const dash = cfg.dashboards.find((d: { path: string }) => d.path === sc.path);
    const sizes = dash.tabs.find((t: { name: string }) => t.name === 'Sizes');
    const disp = (fid: string) => sizes.root.children.find((n: { id: string }) => n.id === id(fid)).display;
    expect(disp('sc-f-min-m')).toBe('expanded');
    expect(disp('sc-f-min-s')).toBe('collapsed');
    expect(disp('sc-f-min-l')).toBe('collapsed');
  });
});
