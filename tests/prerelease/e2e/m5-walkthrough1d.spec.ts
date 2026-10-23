// M5 walkthrough 1, review round (D, 2026-10-22):
//  (1) Ruling 13 (the title off-centre, just right of the dashboard links) is superseded by Ruling 16
//      (M5 §8): no link row; the title — signed in, the dashboard switcher — is back in the CENTRE of
//      the bar, whole; the logo and version stay. Never an overlap, never a sideways scroll.
//  (2) the text-size buttons are the only text-size control: they never hide (769–1200 px at the
//      enlarged sizes, where the bar used to drop them first), and they work there.
//  (3) on touch (hover: none) every edit handle sits INSIDE its item's corner: it never overhangs a
//      neighbour, a tap on a neighbour's corner never opens the wrong item's dialog, and a tap on a
//      Small item's centre reaches that item.
//  (4) a touch long-press on a minimised folder in edit mode opens its menu only — never the folder
//      too (a tablet may send a click after the long-press release).
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCsrfToken, longPress } from '../helpers';

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
  const doc = { format: 'hops-export', schemaVersion: 3, exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'w1d.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(dash.id as string);
}

/** The bundled M5 Showcase, every id prefixed so this copy never collides with another. */
async function showcase(page: Page, context: BrowserContext, name: string) {
  const fixture = JSON.parse(fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend/internal/configdoc/testdata/v3_showcase_export.json'), 'utf8'));
  const p = `w1d${Date.now().toString(36)}${(seq++).toString(36)}`;
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

const SETTINGS = {
  statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
  editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
};

/** A one-tab dashboard called `name` holding `children` (default: one Medium tile). */
async function plainDash(page: Page, context: BrowserContext, name: string, children?: (p: string) => unknown[]) {
  const p = `w1d${Date.now().toString(36)}${(seq++).toString(36)}`;
  await importDoc(page, context, {
    id: `${p}-dash`, name, order: 0, path: `/${p}`, revision: 1, settings: SETTINGS,
    tabs: [{ id: `${p}-tab`, name: 'Main', order: 0, root: { columns: 24, children: children ? children(p) : [
      { kind: 'tile', id: `${p}-a`, name: 'A tile', url: 'http://a.test', icon: 'mdi:home', openMode: 'newtab', size: 'medium', order: 0, placement: { x: 0, y: 0, w: 2, h: 2 } }
    ] } }]
  });
  return { path: `/${p}`, id: (s: string) => `${p}-${s}` };
}

/** Jonathan's dev set (Sample, Weavers, Sample (Imported), v3 Showcase), plus more to make `total`. */
async function dashboards(page: Page, context: BrowserContext, total: number) {
  const names = ['Weavers', 'Sample (Imported)', 'Kitchen display', 'Garage', 'Home office', 'Media room', 'Network'];
  const have = ((await (await page.request.get('/api/config')).json()).dashboards as unknown[]).length;
  expect(have, 'the fresh test server has its Sample dashboard only').toBe(1);
  for (let i = 0; i < total - have - 1; i++) await plainDash(page, context, names[i]);
  return showcase(page, context, 'v3 Showcase');
}

async function allNames(page: Page) {
  return ((await (await page.request.get('/api/config')).json()).dashboards as { name: string; order: number }[])
    .slice().sort((a, b) => a.order - b.order).map((d) => d.name);
}

async function enterEdit(page: Page) {
  await page.getByRole('button', { name: 'Enter Edit Mode' }).click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
}
async function exitEdit(page: Page) {
  await page.getByRole('button', { name: 'Exit Edit Mode' }).click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toHaveCount(0);
}

const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
type Box = { left: number; right: number; top: number; bottom: number };
const overlaps = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

/** The bar after a resize or a change: settled, no sideways scroll, nothing overlapping or off screen. */
async function barHolds(page: Page, label: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    { message: `${label}: no sideways scroll`, timeout: 2000 }).toBeLessThanOrEqual(0);
  await settle(page);
  const r = await page.evaluate(() => {
    const view = document.documentElement.clientWidth;
    const shown = (e: Element) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const els = [...document.querySelectorAll(
      '.navbar .logo img, .navbar .wordmark, .navbar .version, .navbar .center-title, .navbar .nav-right > *'
    )].filter(shown);
    return {
      view, sideways: document.documentElement.scrollWidth - view,
      pieces: els.map((e) => { const b = e.getBoundingClientRect(); return { n: `${e.className} ${(e.textContent ?? '').trim()}`.slice(0, 60), left: b.left, right: b.right, top: b.top, bottom: b.bottom }; })
    };
  });
  expect(r.sideways, `${label}: no sideways scroll`).toBeLessThanOrEqual(0);
  for (let i = 0; i < r.pieces.length; i++) {
    const a = r.pieces[i];
    expect(a.left, `${label}: ${a.n} on screen`).toBeGreaterThanOrEqual(-0.5);
    expect(a.right, `${label}: ${a.n} on screen`).toBeLessThanOrEqual(r.view + 0.5);
    for (let j = i + 1; j < r.pieces.length; j++) {
      const b = r.pieces[j];
      if (a.n.startsWith('logo') || b.n.startsWith('logo')) continue;
      expect(overlaps(a, b), `${label}: ${a.n} / ${b.n} overlap`).toBe(false);
    }
  }
}

/** Ruling 16: no link row; the title centred in the bar and whole; every dashboard once, in order, in the switcher. */
async function ruling16(page: Page, all: string[], label: string) {
  const s = await page.evaluate(() => {
    const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
    const title = q('.navbar .center-title');
    const text = q('.navbar .center-title .title-text');
    const bar = q('.navbar .nav-content')!;
    const bs = getComputedStyle(bar), bb = bar.getBoundingClientRect();
    const tb = title?.getBoundingClientRect();
    return {
      links: document.querySelectorAll('.navbar .nav-link, .navbar .nav-links, .navbar .nav-more-btn').length,
      titleMid: tb ? (tb.left + tb.right) / 2 : null,
      barMid: (bb.left + parseFloat(bs.paddingLeft) + bb.right - parseFloat(bs.paddingRight)) / 2,
      titleCut: text ? text.scrollWidth > text.clientWidth + 0.5 : null
    };
  });
  expect(s.links, `${label}: no link row, no More`).toBe(0);
  expect(s.titleMid, `${label}: there is a title`).not.toBeNull();
  expect(Math.abs(s.titleMid! - s.barMid), `${label}: the title is centred`).toBeLessThanOrEqual(1);
  expect(s.titleCut, `${label}: the title is whole`).toBe(false);
  const btn = page.locator('.navbar').getByRole('button', { name: /switch dashboard$/ });
  await btn.click();
  const menu = page.getByRole('menu', { name: 'Dashboards' });
  const listed = (await menu.getByRole('menuitem').allInnerTexts()).map((x) => x.trim());
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(listed, `${label}: every dashboard once, in order`).toEqual(all);
}

// ---------------------------------------------------------------- (1) Ruling 16 (was Ruling 13)

test.describe('walkthrough 1 D (1): Ruling 16 — the title is back in the centre; no link row', () => {
  for (const total of [4, 8]) {
    test(`${total} dashboards at 1280, 1416 and 1920, view and edit: the title centred and whole; logo and version stay; no overlap, no sideways scroll`, async ({ page, context }) => {
      const sc = await dashboards(page, context, total);
      const all = await allNames(page);
      expect(all).toHaveLength(total);
      await page.goto(sc.path);
      await expect(page.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
      for (const editing of [false, true]) {
        if (editing) await enterEdit(page);
        for (const width of [1280, 1416, 1920]) {
          await page.setViewportSize({ width, height: 900 });
          const label = `${total} dashboards, ${editing ? 'edit' : 'view'} at ${width}`;
          await barHolds(page, label);
          await expect(page.locator('.navbar .logo img'), `${label}: logo`).toBeVisible();
          await expect(page.locator('.navbar .version'), `${label}: version`).toBeVisible();
          await ruling16(page, all, label);
          // Every control is still there and clickable.
          for (const name of ['Search', 'Decrease text size', 'Increase text size', 'Theme Settings', editing ? 'Exit Edit Mode' : 'Enter Edit Mode', 'Help', 'About HOPS', 'Log out']) {
            await page.locator('.navbar .nav-right').getByRole('button', { name, exact: true }).click({ trial: true, timeout: 3000 });
          }
        }
      }
    });
  }
});

// ---------------------------------------------------------------- (2) the text-size buttons never hide

test.describe('walkthrough 1 D (2): the text-size buttons are never hidden', () => {
  test('at the enlarged text sizes, 769–1200 px, view and edit, 8 dashboards: both buttons show, nothing overlaps, and they work', async ({ page, context }) => {
    test.setTimeout(240_000);
    const sc = await dashboards(page, context, 8);
    await page.setViewportSize({ width: 1920, height: 800 });
    await page.goto(sc.path);
    const down = page.getByRole('button', { name: 'Decrease text size' });
    const up = page.getByRole('button', { name: 'Increase text size' });
    const rootPx = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    try {
      for (const size of ['18px', '20px']) {
        while ((await rootPx()) !== size) await up.click();
        for (const editing of [false, true]) {
          await page.setViewportSize({ width: 1200, height: 800 });
          if (editing) await enterEdit(page);
          for (let width = 1200; width >= 769; width -= 31) {
            await page.setViewportSize({ width, height: 800 });
            const label = `text ${size}, ${editing ? 'edit' : 'view'} at ${width}`;
            await barHolds(page, label);
            for (const b of [down, up]) {
              await expect(b, `${label}: ${await b.getAttribute('aria-label')} shows`).toBeVisible();
              const bb = (await b.boundingBox())!;
              expect(Math.min(bb.width, bb.height), `${label}: tappable`).toBeGreaterThanOrEqual(24);
            }
            // They work: one step down and back up, from here.
            if (width % 3 === 0 || width === 769) {
              await down.click();
              await expect.poll(rootPx, { message: `${label}: smaller` }).not.toBe(size);
              await barHolds(page, `${label}, one size down`);
              await up.click();
              await expect.poll(rootPx, { message: `${label}: back` }).toBe(size);
              await barHolds(page, `${label}, back up`);
            }
          }
          await page.setViewportSize({ width: 1920, height: 800 });
          if (editing) await exitEdit(page);
        }
      }
    } finally {
      // Back to the default size for the next test (this browser remembers it).
      await page.evaluate(() => localStorage.setItem('hops_text_size', 'medium'));
    }
  });
});

// ---------------------------------------------------------------- (3) touch: handles inside the corner

/**
 * A tab built so neighbours touch a Small tile's top-right corner: S (Small, z unset) with U (Small, z 9)
 * right above it and R (Medium, z 7) to its right, plus a second Small T beside R; then a Medium M.
 */
async function cornerDash(page: Page, context: BrowserContext) {
  const t = (p: string, id: string, name: string, size: string, x: number, y: number, s: number, z?: number) => ({
    kind: 'tile', id: `${p}-${id}`, name, url: `http://${id}.test`, icon: 'mdi:home', openMode: 'newtab', size, order: 0,
    placement: { x, y, w: s, h: s, ...(z !== undefined ? { z } : {}) }
  });
  return plainDash(page, context, 'Corners', (p) => [
    t(p, 'u', 'Up', 'small', 1, 0, 1, 9),
    t(p, 's', 'Smally', 'small', 1, 1, 1),
    t(p, 'r', 'Righty', 'medium', 2, 0, 2, 7),
    t(p, 't', 'Tiny', 'small', 4, 1, 1, 3),
    t(p, 'm', 'Middle', 'medium', 0, 2, 2)
  ]);
}

/** Every drawn item's handle: inside its item, and topmost at its own centre. */
async function handlesInside(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const out: { id: string; inside: boolean; topmost: boolean; hb: number[]; ib: number[] }[] = [];
    for (const host of document.querySelectorAll('.tab-canvas [data-node-id]')) {
      const h = host.querySelector(':scope > [data-edit-handle]') as HTMLElement | null;
      if (!h || getComputedStyle(h).opacity !== '1') continue;
      const ib = host.getBoundingClientRect();
      const hb = h.getBoundingClientRect();
      if (ib.width === 0 || ib.bottom < 0 || ib.top > innerHeight) continue;
      const under = document.elementFromPoint(hb.left + hb.width / 2, hb.top + hb.height / 2);
      out.push({
        id: host.getAttribute('data-node-id')!,
        inside: hb.left >= ib.left - 0.5 && hb.right <= ib.right + 0.5 && hb.top >= ib.top - 0.5 && hb.bottom <= ib.bottom + 0.5,
        topmost: !!under && h.contains(under),
        hb: [hb.left, hb.top, hb.right, hb.bottom].map(Math.round),
        ib: [ib.left, ib.top, ib.right, ib.bottom].map(Math.round)
      });
    }
    return out;
  });
  expect(r.length, `${label}: handles checked`).toBeGreaterThan(2);
  for (const x of r) {
    expect(x.inside, `${label}: ${x.id}'s handle ${x.hb} inside its item ${x.ib}`).toBe(true);
    expect(x.topmost, `${label}: ${x.id}'s handle is on top at its centre`).toBe(true);
  }
}

test.describe('walkthrough 1 D (3): on touch, edit handles sit inside their item\'s corner', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1280, height: 1600 } });

  test('a tap on a neighbour\'s corner next to a Small tile never opens the Small tile\'s dialog; a tap on its centre selects it', async ({ page, context }) => {
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
    const f = await cornerDash(page, context);
    for (const width of [1280, 1416]) {
      await page.setViewportSize({ width, height: 1600 });
      await page.goto(f.path);
      await page.getByRole('button', { name: 'Enter Edit Mode' }).tap();
      await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit Smally', exact: true })).toHaveCSS('opacity', '1');
      await handlesInside(page, `corners at ${width}`);
      const s = page.locator(`.tab-canvas [data-node-id="${f.id('s')}"]`);
      const sb = (await s.boundingBox())!;
      expect(sb.width, 'Smally is a Small tile').toBeLessThan(60);
      // Just past Smally's top-right corner: into Righty (right), into Up (above), and the corner point.
      const spots: [string, number, number, string][] = [
        ['Righty, beside the corner', sb.x + sb.width + 4, sb.y + 4, f.id('r')],
        ['Righty, at the corner', sb.x + sb.width + 2, sb.y + 2, f.id('r')],
        ['Up, above the corner', sb.x + sb.width - 4, sb.y - 4, f.id('u')],
        ['Up, at the corner', sb.x + sb.width - 2, sb.y - 2, f.id('u')]
      ];
      for (const [name, x, y, owner] of spots) {
        const hit = await page.evaluate(([px, py]) => {
          const e = document.elementFromPoint(px, py);
          return { node: e?.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null, handle: e?.closest('[data-edit-handle]')?.getAttribute('aria-label') ?? null };
        }, [x, y] as const);
        expect(hit.node, `${width}: ${name} is that neighbour`).toBe(owner);
        expect(hit.handle, `${width}: ${name} is not Smally's handle`).not.toBe('Edit Smally');
        await page.touchscreen.tap(x, y);
        await page.waitForTimeout(350);
        await expect(page.getByRole('dialog', { name: /Smally/ }), `${width}: ${name}: never Smally's dialog`).toHaveCount(0);
        if ((await page.getByRole('dialog').count()) > 0) await page.keyboard.press('Escape');
      }
      // A tap on Smally's centre selects Smally (no dialog).
      await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2);
      await expect(s).toHaveClass(/selected/);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      // Its own handle (inside its corner) still edits it.
      await page.getByRole('button', { name: 'Edit Smally', exact: true }).tap();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: 'Exit Edit Mode' }).tap();
      await expect(page.getByRole('toolbar', { name: 'Editing' })).toHaveCount(0);
    }
  });

  test('the Showcase at 1280 and 1416: every handle inside its item; a tap on Minimised Small\'s centre opens it, on each Small tile\'s centre selects it', async ({ page, context }) => {
    test.setTimeout(120_000);
    const sc = await showcase(page, context, 'v3 Showcase');
    const id = sc.id;
    for (const width of [1280, 1416]) {
      await page.setViewportSize({ width, height: 2400 });
      await page.goto(sc.path);
      await page.getByRole('button', { name: 'Enter Edit Mode' }).tap();
      await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
      for (const tab of ['Grid', 'Sizes', 'Folders']) {
        await page.getByRole('tab', { name: `Switch to ${tab} tab`, exact: true }).tap();
        await expect(page.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
        await handlesInside(page, `${tab} at ${width}`);
      }
      await page.getByRole('tab', { name: 'Switch to Sizes tab', exact: true }).tap();
      const smalls = [id('sc-sz-s'), ...(await page.locator(`.tab-canvas [data-node-id="${id('sc-f-small')}"] .folder-body [data-node-id]`).evaluateAll(
        (els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getAttribute('data-node-id')!)))];
      expect(smalls.length).toBeGreaterThan(3);
      for (const sid of smalls) {
        const t = page.locator(`.tab-canvas [data-node-id="${sid}"]`).first();
        const b = (await t.boundingBox())!;
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
        await expect(t, `${sid} at ${width}: selected`).toHaveClass(/selected/);
        await expect(page.getByRole('dialog'), `${sid} at ${width}: no dialog`).toHaveCount(0);
        await page.waitForTimeout(350);
      }
      const face = page.locator(`.tab-canvas [data-node-id="${id('sc-f-min-s')}"] .folder-collapsed-tile`);
      const fb = (await face.boundingBox())!;
      expect(Math.min(fb.width, fb.height), 'Minimised Small is a small tile').toBeLessThan(80);
      await page.touchscreen.tap(fb.x + fb.width / 2, fb.y + fb.height / 2);
      await expect(page.locator(`.tab-canvas [data-node-id="${id('sc-f-min-s')}"]`).first()).toHaveAttribute('role', 'group');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Undo/ }).tap();
      await expect(face).toBeVisible();
      await page.getByRole('button', { name: 'Exit Edit Mode' }).tap();
      await expect(page.getByRole('toolbar', { name: 'Editing' })).toHaveCount(0);
    }
  });
});

// ---------------------------------------------------------------- (4) touch long-press on a minimised folder

test.describe('walkthrough 1 D (4): a touch long-press on a minimised folder in edit mode', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1416, height: 1600 } });

  test('opens its menu only, never the folder — even when the tablet sends a click after the release', async ({ page, context }) => {
    const sc = await showcase(page, context, 'v3 Showcase');
    const id = sc.id;
    await page.goto(sc.path);
    await page.getByRole('tab', { name: 'Switch to Sizes tab', exact: true }).tap();
    await page.getByRole('button', { name: 'Enter Edit Mode' }).tap();
    const toolbar = page.getByRole('toolbar', { name: 'Editing' });
    await expect(toolbar).toBeVisible();
    const undo = toolbar.getByRole('button', { name: /Undo/ });
    await expect(undo).toBeDisabled();
    for (const fid of ['sc-f-min-s', 'sc-f-min-m', 'sc-f-min-l']) {
      const slot = page.locator(`.tab-canvas [data-node-id="${id(fid)}"]`).first();
      const face = slot.locator('.folder-collapsed-tile');
      // A real long-press (touch start, held, touch end).
      await longPress(page, face, 700, { fx: 0.5, fy: 0.6 });
      const menu = page.getByRole('menu');
      await expect(menu, `${fid}: its menu`).toBeVisible();
      await page.waitForTimeout(500); // past the click's open delay
      await expect(slot, `${fid}: still minimised`).toHaveClass(/collapsed/);
      // Some tablets send a click after the release: it must not open the folder behind its menu.
      await face.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
      await page.waitForTimeout(500);
      await expect(slot, `${fid}: still minimised after the release's click`).toHaveClass(/collapsed/);
      await expect(menu).toBeVisible();
      await expect(undo, `${fid}: nothing changed`).toBeDisabled();
      // Close it (the touch release left focus on the tile: give the menu the key, as a keyboard would).
      await menu.getByRole('menuitem').first().focus();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    }
    // A plain tap still opens one (M5 §3a.8), undoable.
    const face = page.locator(`.tab-canvas [data-node-id="${id('sc-f-min-m')}"] .folder-collapsed-tile`);
    await face.tap();
    await expect(page.locator(`.tab-canvas [data-node-id="${id('sc-f-min-m')}"]`).first()).toHaveAttribute('role', 'group');
    await undo.tap();
    await expect(face).toBeVisible();
  });
});
