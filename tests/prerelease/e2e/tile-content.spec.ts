import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getCsrfToken, flourishesDone } from '../helpers';

// Tiles and minimised folders use their space by ONE rule (name at the top, the icon a fixed share of
// the height, the description under it), and the dashboard's "Tile content size" scales what's drawn
// inside them, never the boxes. Synthetic data; needs real layout.
// HOPS_SHOTS_DIR (test-harness switch, not an app setting): also save before/after screenshots there.

const SHOTS = process.env.HOPS_SHOTS_DIR || '';
const SHOT_TAG = process.env.HOPS_SHOTS_TAG || 'after';

let seq = 0;
const made: string[] = [];
type Child = Record<string, unknown>;

const tile = (id: string, name: string, size: string, box: { x: number; y: number } | null, extra: Child = {}): Child => {
  const span = size === 'small' ? 1 : size === 'large' ? 4 : 2;
  return {
    id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase().replace(/\W/g, '')}.example.lan/`, icon: 'mdi:home-assistant',
    openMode: 'newtab', size, order: 0, ...(box ? { placement: { ...box, w: span, h: span } } : {}), ...extra
  };
};
const mini = (id: string, name: string, size: string, x: number, y: number, extra: Child = {}): Child => {
  const span = size === 'small' ? 1 : size === 'large' ? 4 : 2;
  return {
    id, kind: 'folder', name, display: 'collapsed', shape: 'rounded', size, contentSize: 'small',
    placement: { x, y, w: Math.max(2, span), h: Math.max(3, span) },
    content: { children: ['Alpha', 'Beta', 'Gamma', 'Delta'].map((n, i) => tile(`${id}-k${i}`, n, 'medium', null, { icon: ['mdi:lan', 'mdi:server', 'mdi:router', 'mdi:database'][i] })) },
    ...extra
  };
};

async function importDash(page: Page, context: BrowserContext, children: (id: (s: string) => string) => Child[], settings: Child = {}) {
  const p = `tc${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `content ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    ...settings,
    tabs: [{ id: id('tab'), name: 'Main', order: 0, root: { columns: 24, children: children(id) } }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'tc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  return { r, path: `/${p}`, id, dashId: id('dash') };
}

async function importOk(page: Page, context: BrowserContext, children: (id: (s: string) => string) => Child[], settings: Child = {}) {
  const res = await importDash(page, context, children, settings);
  expect(res.r.status(), await res.r.text()).toBe(200);
  made.push(res.dashId);
  return res;
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

/** Every size beside each other: tiles with and without a description, minimised folders (Icons inside, Its own icon, a tab shape). */
const showcase = (id: (s: string) => string): Child[] => [
  tile(id('l1'), 'WARP', 'large', { x: 0, y: 0 }),
  tile(id('l2'), 'VISTA', 'large', { x: 4, y: 0 }, { description: 'Vision and stats' }),
  mini(id('lf'), 'Ulanzi Matrix', 'large', 8, 0),
  mini(id('lo'), 'Servers', 'large', 12, 0, { minimisedIcon: 'own', icon: 'mdi:folder-home' }),
  tile(id('l3'), 'HomeAssistant', 'large', { x: 16, y: 0 }),
  mini(id('lt'), 'Paper folder', 'large', 20, 0, { shape: 'folder-paper' }),
  tile(id('m1'), 'WARP', 'medium', { x: 0, y: 4 }),
  tile(id('m2'), 'VISTA', 'medium', { x: 2, y: 4 }, { description: 'Vision and stats' }),
  mini(id('mf'), 'Ulanzi Matrix', 'medium', 4, 4),
  mini(id('mo'), 'Servers', 'medium', 6, 4, { minimisedIcon: 'own', icon: 'mdi:folder-home' }),
  tile(id('m3'), 'HomeAssistant', 'medium', { x: 8, y: 4 }),
  mini(id('mt'), 'Paper folder', 'medium', 10, 4, { shape: 'folder-paper' }),
  tile(id('s1'), 'WARP', 'small', { x: 0, y: 7 }),
  tile(id('s2'), 'VISTA', 'small', { x: 1, y: 7 }, { description: 'Vision and stats' }),
  mini(id('sf'), 'Ulanzi Matrix', 'small', 2, 7),
  mini(id('so'), 'Servers', 'small', 4, 7, { minimisedIcon: 'own', icon: 'mdi:folder-home' }),
  tile(id('s3'), 'HomeAssistant', 'small', { x: 6, y: 7 }),
  tile(id('s4'), 'Home Assistant Server', 'small', { x: 7, y: 7 }),
  mini(id('st'), 'Paper folder', 'small', 8, 7, { shape: 'folder-paper' }),
  {
    id: id('box'), kind: 'folder', name: 'Home Automation', display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'large',
    placement: { x: 0, y: 10, w: 22, h: 6 },
    content: {
      children: [
        tile(id('b1'), 'HomeAssistant', 'large', null), tile(id('b2'), 'WARP', 'large', null), tile(id('b3'), 'HALo', 'large', null),
        tile(id('b4'), 'HAV5', 'large', null), tile(id('b5'), 'VISTA', 'large', null, { description: 'VISTA' })
      ]
    }
  }
];

const node = (page: Page, id: string) => page.locator(`.tab-canvas [data-node-id="${id}"]`).first();

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${SHOT_TAG}-${name}.png`), fullPage: true });
}

async function open(page: Page, p: string) {
  await page.goto(p);
  await expect(page.locator('.tab-canvas').first()).toBeVisible();
  await flourishesDone(page);
  await page.evaluate(() => document.fonts.ready);
}

type Rect = { x: number; y: number; width: number; height: number };
const inside = (r: Rect, box: Rect, slack = 1) =>
  r.x >= box.x - slack && r.y >= box.y - slack && r.x + r.width <= box.x + box.width + slack && r.y + r.height <= box.y + box.height + slack;

/** Every drawn part of every tile and minimised folder (name, icon, description) inside its box. */
async function contentStaysInside(page: Page) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    for (const box of Array.from(document.querySelectorAll('.tab-canvas .tc-box'))) {
      const b = box.getBoundingClientRect();
      for (const part of Array.from(box.querySelectorAll('.tc-name, .tc-icon, .tc-desc'))) {
        const r = part.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (getComputedStyle(part).display === 'none') continue;
        if (r.left < b.left - 1 || r.top < b.top - 1 || r.right > b.right + 1 || r.bottom > b.bottom + 1) {
          out.push(`${box.closest('[data-node-id]')?.getAttribute('data-node-id')} ${part.className}: ${JSON.stringify(r)} outside ${JSON.stringify(b)}`);
        }
      }
    }
    return out;
  });
  expect(bad, 'content spilled out of its tile').toEqual([]);
}

const iconOf = (page: Page, id: string) => node(page, id).locator('.tc-icon').first();

test.describe('tile content uses the tile', () => {
  test.use({ viewport: { width: 1640, height: 1100 } });

  test('one rule: icons line up with or without a description; minimised folders match tiles; Small folders show their name', async ({ page, context }) => {
    const f = await importOk(page, context, showcase);
    await open(page, f.path);
    for (const [a, b] of [['l1', 'l2'], ['m1', 'm2'], ['s1', 's2']]) {
      const ra = (await iconOf(page, f.id(a)).boundingBox())!;
      const rb = (await iconOf(page, f.id(b)).boundingBox())!;
      expect(Math.abs(ra.y - rb.y), `${a}/${b}: the icon does not move for a description`).toBeLessThan(1);
      expect(Math.abs(ra.height - rb.height), `${a}/${b}: the icon keeps its size`).toBeLessThan(1);
    }
    // A Rounded minimised folder: its name and preview where a tile's name and icon are.
    // (Small: beside a tile whose name also takes two lines.)
    for (const [t, fo] of [['l1', 'lf'], ['m1', 'mf'], ['s4', 'sf']]) {
      const ti = (await iconOf(page, f.id(t)).boundingBox())!;
      const fi = (await iconOf(page, f.id(fo)).boundingBox())!;
      expect(Math.abs(ti.height - fi.height), `${fo}: the preview takes the icon's share`).toBeLessThan(2);
      const tn = node(page, f.id(t)).locator('.tc-name');
      const fn = node(page, f.id(fo)).locator('.tc-name');
      await expect(fn).toBeVisible();
      const [tfs, ffs] = await Promise.all([tn.evaluate((e) => getComputedStyle(e).fontSize), fn.evaluate((e) => getComputedStyle(e).fontSize)]);
      expect(ffs, `${fo}: the name is a tile's size`).toBe(tfs);
    }
    // The icon takes the tile's height less the name and ONE reserved description line: no tall empty band
    // under it on a tile without a description (it was 27% of a Large tile).
    for (const k of ['l1', 'm1']) {
      const band = await node(page, f.id(k)).evaluate((cell) => {
        const tc = cell.querySelector('.tc') as HTMLElement;
        const box = tc.getBoundingClientRect();
        const icon = cell.querySelector('.tc-icon')!.getBoundingClientRect();
        const content = box.bottom - parseFloat(getComputedStyle(tc).paddingBottom);
        return { inBox: (content - icon.bottom) / box.height, toEdge: (box.bottom - icon.bottom) / box.height, icon: icon.height / box.height };
      });
      console.log(`${k} at 100%: icon ${(band.icon * 100).toFixed(1)}% of the tile; empty band under it ${(band.inBox * 100).toFixed(1)}% (to the edge ${(band.toEdge * 100).toFixed(1)}%)`);
      expect(band.inBox, `${k}: the band under the icon is one description line`).toBeLessThanOrEqual(0.13);
      expect(band.icon, `${k}: the icon fills the tile`).toBeGreaterThan(0.55);
    }
    // A Small minimised folder's preview stays readable (Rounded and a tab shape): at least 12 px a cell.
    for (const k of ['sf', 'st']) {
      const cells = await node(page, f.id(k)).locator('.preview-cell').evaluateAll((els) =>
        els.filter((e) => getComputedStyle(e).display !== 'none').map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)));
      console.log(`${k}: preview cells ${cells.map((c) => c.toFixed(1)).join(', ')} px`);
      expect(cells.length, `${k}: shows icons`).toBeGreaterThanOrEqual(2);
      for (const c of cells) expect(c, `${k}: a preview cell is readable`).toBeGreaterThanOrEqual(12);
    }
    // "HomeAssistant" at Small breaks between its words ("Home / Assistant"), never mid-word.
    const lines = await node(page, f.id('s3')).locator('.tc-name').evaluate((el) => {
      const r = document.createRange();
      const t = el.childNodes;
      const tops = new Map<number, string>();
      for (const n of Array.from(t)) {
        if (n.nodeType !== Node.TEXT_NODE || !n.textContent?.trim()) continue;
        r.selectNodeContents(n);
        const top = Math.round(r.getClientRects()[0]?.top ?? 0);
        tops.set(top, (tops.get(top) ?? '') + n.textContent);
      }
      return [...tops.values()];
    });
    expect(lines.join('|').replace(/\s/g, '')).toMatch(/^(Home\|Assistant|HomeAssistant)$/);
    await contentStaysInside(page);
  });

  for (const scale of [75, 125]) {
    test(`content scale ${scale}%: content scales, boxes don't, nothing spills`, async ({ page, context }) => {
      const base = await importOk(page, context, showcase);
      await open(page, base.path);
      const boxBefore = (await node(page, base.id('l2')).boundingBox())!;
      const iconBefore = (await iconOf(page, base.id('l2')).boundingBox())!;
      const fs = (id: string) => node(page, id).locator('.tc-name').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      const nameBase = await fs(base.id('l2'));
      const f = await importOk(page, context, showcase, { contentScale: scale });
      await open(page, f.path);
      await expect(page.locator('.tab-canvas')).toHaveAttribute('data-content-scale', String(scale));
      const box = (await node(page, f.id('l2')).boundingBox())!;
      const icon = (await iconOf(page, f.id('l2')).boundingBox())!;
      expect(box.width).toBeCloseTo(boxBefore.width, 0);
      expect(box.height).toBeCloseTo(boxBefore.height, 0);
      if (scale > 100) expect(icon.height).toBeGreaterThanOrEqual(iconBefore.height - 1);
      else expect(icon.height).toBeLessThan(iconBefore.height - 5);
      // The text grows or shrinks with it.
      const nameAt = await fs(f.id('l2'));
      if (scale > 100) expect(nameAt).toBeGreaterThan(nameBase);
      else expect(nameAt).toBeLessThan(nameBase);
      // Large and Medium descriptions stay visible: at least one line.
      for (const k of ['l2', 'm2']) {
        const d = node(page, f.id(k)).locator('.tc-desc');
        await expect(d, `${k} at ${scale}%: its description shows`).toBeVisible();
        const lh = await d.evaluate((e) => ({ h: e.getBoundingClientRect().height, l: parseFloat(getComputedStyle(e).lineHeight) }));
        console.log(`${k} at ${scale}%: description ${lh.h.toFixed(1)}px (${(lh.h / lh.l).toFixed(2)} lines)`);
        expect(lh.h, `${k} at ${scale}%: at least one whole line`).toBeGreaterThanOrEqual(lh.l - 0.5);
      }
      await contentStaysInside(page);
      await shot(page, `scale-${scale}-1640`);
      await page.setViewportSize({ width: 1920, height: 1200 });
      await flourishesDone(page);
      await contentStaysInside(page);
      await shot(page, `scale-${scale}-1920`);
    });
  }

  test('the slider: set in the dashboard dialog, drawn at once in the editor, saved with the dashboard (its revision moves on)', async ({ page, context }) => {
    const f = await importOk(page, context, showcase);
    await open(page, f.path);
    const iconBefore = (await iconOf(page, f.id('l1')).boundingBox())!;
    const revBefore = (await (await page.request.get('/api/config')).json()).dashboards.find((d: { id: string }) => d.id === f.dashId).revision;
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit Dashboard' }).click();
    const dlg = page.getByRole('dialog', { name: 'Edit Dashboard' });
    await dlg.getByRole('tab', { name: 'Settings' }).click();
    const slider = dlg.getByRole('slider', { name: 'Tile content size' });
    await expect(slider).toHaveValue('100');
    await expect(dlg.getByRole('button', { name: 'Reset to 100%' })).toBeDisabled();
    // Keyboard: four steps right is 120%.
    await slider.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveValue('120');
    await expect(slider).toHaveAttribute('aria-valuetext', '120%');
    await expect(dlg.locator('output')).toHaveText('120%');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect(dlg).toHaveCount(0);
    // The editor draws the draft at once.
    await expect(page.locator('.tab-canvas')).toHaveAttribute('data-content-scale', '120');
    await page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => {
      const d = (await (await page.request.get('/api/config')).json()).dashboards.find((x: { id: string }) => x.id === f.dashId);
      return [d.contentScale, d.revision > revBefore];
    }).toEqual([120, true]);
    // Out of edit mode, a fresh load draws it.
    await open(page, f.path);
    await expect(page.locator('.tab-canvas')).toHaveAttribute('data-content-scale', '120');
    const iconAfter = (await iconOf(page, f.id('l1')).boundingBox())!;
    expect(iconAfter.height).toBeGreaterThan(iconBefore.height);
    await contentStaysInside(page);
  });

  test('a bad content scale is refused on import', async ({ page, context }) => {
    for (const bad of [130, 102, '110']) {
      const res = await importDash(page, context, showcase, { contentScale: bad });
      expect(res.r.status()).toBe(400);
      expect(await res.r.text()).toContain('tile content size');
    }
  });

  test('phone: the same rule inside the phone tiles; nothing spills at 125%', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 1400 });
    const f = await importOk(page, context, showcase);
    await open(page, f.path);
    await contentStaysInside(page);
    await shot(page, 'phone-390');
    const g = await importOk(page, context, showcase, { contentScale: 125 });
    await open(page, g.path);
    await contentStaysInside(page);
    await shot(page, 'phone-390-scale-125');
    const h = await importOk(page, context, showcase, { contentScale: 75 });
    await open(page, h.path);
    await contentStaysInside(page);
    await shot(page, 'phone-390-scale-75');
  });

  test('screenshots of every size (before/after)', async ({ page, context }) => {
    const f = await importOk(page, context, showcase);
    await open(page, f.path);
    await shot(page, 'sizes-1640');
    if (SHOTS) {
      // A Large row with and without descriptions, side by side, at 100%.
      const a = (await node(page, f.id('l1')).boundingBox())!;
      const b = (await node(page, f.id('l3')).boundingBox())!;
      await page.screenshot({ path: path.join(SHOTS, `${SHOT_TAG}-no-desc-large-100.png`), clip: { x: a.x - 4, y: a.y - 4, width: b.x + b.width - a.x + 8, height: a.height + 8 } });
    }
    await page.setViewportSize({ width: 1920, height: 1200 });
    await flourishesDone(page);
    await shot(page, 'sizes-1920');
  });
});
