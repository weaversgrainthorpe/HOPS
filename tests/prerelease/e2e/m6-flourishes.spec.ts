import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M6 §9 (design/specs/2026-10-23-hops-v3-m6-folder-shapes-design.md): visual flourishes, in a REAL
// browser. For each one we check three things:
// - it really runs: we sample it every frame and measure how long it is on screen and how far it
//   travels or scales;
// - it plays nothing under Off, or under On with reduced motion;
// - the saved result is identical with and without animations.
// The flourishes:
//   1. a folder opens or minimises;
//   2. drill in and up;
//   3. a page change;
//   4. delete (and undo of a delete);
//   5. the edit glide (undo and redo included);
//   6. the Save tick (on success only);
//   7. a new tile pops in;
//   9. the status dot pulses on a change (never on first load), in view mode too.

let seq = 0;
const made: string[] = [];
type Child = Record<string, unknown>;
type AnyNode = { id: string; kind: string; content?: { children: AnyNode[] } };

const kid = (id: string, name: string, extra: Child = {}): Child => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, ...extra
});
const tile = (id: string, name: string, x: number, y: number, extra: Child = {}): Child =>
  kid(id, name, { placement: { x, y, w: 2, h: 2 }, ...extra });

/**
 * Tiles Tee, You, Vee and Stat (status checked) in a row. Below them: a minimised folder "Mini"
 * holding a sub-folder "Sub" (with K1) and K2, and an open folder "Pages" with 24 tiles (several pages).
 */
async function importDash(page: Page, context: BrowserContext) {
  const p = `m6f${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `M6 flourish ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{ id: id('tab'), name: 'Main', order: 0, root: { columns: 24, children: [
      tile(id('t'), 'Tee', 0, 0), tile(id('u'), 'You', 3, 0), tile(id('v'), 'Vee', 6, 0),
      tile(id('s'), 'Stat', 9, 0, { statusCheck: { type: 'http', enabled: true, interval: 60 } }),
      {
        id: id('c'), kind: 'folder', name: 'Mini', display: 'collapsed', shape: 'rounded', size: 'medium', contentSize: 'medium',
        placement: { x: 0, y: 4, w: 8, h: 8 }, content: { children: [
          { id: id('sub'), kind: 'folder', name: 'Sub', display: 'collapsed', shape: 'rounded', size: 'medium', contentSize: 'medium',
            content: { children: [kid(id('k1'), 'K1')] } },
          kid(id('k2'), 'K2')
        ] }
      },
      {
        id: id('pg'), kind: 'folder', name: 'Pages', display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
        placement: { x: 10, y: 4, w: 8, h: 8 },
        content: { children: Array.from({ length: 24 }, (_, i) => kid(id(`p${i}`), `P${i}`)) }
      }
    ] } }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm6f.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(id('dash'));
  return { path: `/${p}`, id, prefix: p, dashId: id('dash') };
}
type Dash = Awaited<ReturnType<typeof importDash>>;

type Mode = 'on' | 'off' | 'always';
async function setAnimations(page: Page, context: BrowserContext, mode: Mode) {
  const r = await page.request.put('/api/settings/display.animations', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    data: { value: mode }
  });
  expect(r.status(), await r.text()).toBe(200);
}

test.afterEach(async ({ page, context }) => {
  await setAnimations(page, context, 'on'); // the default, for every other spec
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

type Sample = { t: number; kind: string; id: string; x: number; y: number; w: number; h: number; op: number; dur: number };

/** Every frame: each element a flourish is playing on (data-flourish, or a delete's copy), as drawn. */
async function record(page: Page) {
  await page.addInitScript(() => {
    const out: Sample[] = [];
    (window as unknown as { __fl: Sample[] }).__fl = out;
    type Sample = { t: number; kind: string; id: string; x: number; y: number; w: number; h: number; op: number; dur: number };
    const tick = () => {
      const els = document.querySelectorAll<HTMLElement>('[data-flourish], [data-testid="flourish-ghost"]');
      if (els.length) {
        const t = performance.now();
        els.forEach((el) => {
          const r = el.getBoundingClientRect();
          const a = el.getAnimations()[0];
          out.push({
            t, kind: el.getAttribute('data-flourish') ?? el.dataset.kind ?? '?',
            id: el.getAttribute('data-node-id') ?? el.getAttribute('data-nested-folder') ?? el.getAttribute('data-folder-page-content') ??
              (el.hasAttribute('data-saved-tick') ? 'saved' : el.classList.contains('status-badge') ? 'status' : ''),
            x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height,
            op: Number(getComputedStyle(el).opacity), dur: a ? Number(a.effect?.getTiming().duration ?? 0) : 0
          });
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // When a drag begins (the shared cancel runs then).
    new MutationObserver(() => {
      const w = window as unknown as { __dragAt?: number };
      if (document.body.classList.contains('hops-dragging') && w.__dragAt === undefined) w.__dragAt = performance.now();
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
}
const samples = (page: Page) => page.evaluate(() => (window as unknown as { __fl: Sample[] }).__fl.slice());
const clear = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __fl: unknown[]; __dragAt?: number };
  w.__fl.length = 0;
  delete w.__dragAt;
});

/**
 * One flourish kind, measured: how long it was on screen (ms), its programmed duration, the furthest
 * its centre moved, the largest size change against where it ended (a ratio), and the opacity range.
 */
function stats(all: Sample[], kind: string, id?: string) {
  const s = all.filter((x) => x.kind === kind && (id === undefined || x.id === id));
  if (s.length === 0) return { n: 0, ms: 0, dur: 0, travel: 0, scale: 0, minOp: 1, maxOp: 0 };
  const first = s[0], last = s[s.length - 1];
  let travel = 0, scale = 0, minOp = 1, maxOp = 0;
  for (const x of s) {
    travel = Math.max(travel, Math.hypot(x.x - first.x, x.y - first.y));
    scale = Math.max(scale, Math.abs(x.w / Math.max(1, last.w) - 1), Math.abs(x.h / Math.max(1, last.h) - 1), Math.abs(x.w / Math.max(1, first.w) - 1));
    minOp = Math.min(minOp, x.op);
    maxOp = Math.max(maxOp, x.op);
  }
  return { n: s.length, ms: last.t - first.t, dur: Math.max(...s.map((x) => x.dur)), travel, scale, minOp, maxOp };
}

const node = (page: Page, id: string) => page.locator(`.tab-canvas [data-node-id="${id}"]`).first();
const box = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
};
const settle = (page: Page, ms = 600) => page.waitForTimeout(ms);

async function enterEdit(page: Page) {
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
}
async function open(page: Page, f: Dash) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(f.path);
  await expect(node(page, f.id('t'))).toBeVisible();
  return errors;
}

/** Grab `l` at its centre and travel in small steps to (x1, y1), then drop. */
async function dragTo(page: Page, l: Locator, x1: number, y1: number) {
  const s = await box(l);
  const x0 = s.x + s.width / 2, y0 = s.y + s.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 20, y0 + ((y1 - y0) * i) / 20);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
}

// ---- the flows (each one plays one or more flourishes) ----

/** 1 + 2 + 3 in view mode: open Mini, drill into Sub and back up, minimise Mini; Pages next and previous. */
async function viewFlows(page: Page, f: Dash) {
  await node(page, f.id('c')).locator('.folder-collapsed-tile').click();
  await expect(page.locator(`[data-folder-minimise="${f.id('c')}"]`)).toBeVisible();
  await settle(page);
  await node(page, f.id('sub')).locator('.folder-collapsed-tile').click();
  await expect(page.locator(`[data-nested-folder="${f.id('sub')}"]`)).toBeVisible();
  await settle(page);
  await page.getByRole('button', { name: 'Minimise Sub', exact: true }).click();
  await expect(node(page, f.id('sub'))).toBeVisible();
  await settle(page);
  await page.locator(`[data-folder-minimise="${f.id('c')}"]`).click();
  await expect(node(page, f.id('c')).locator('.folder-collapsed-tile')).toBeVisible();
  await settle(page);
  const pages = page.locator(`[data-node-id="${f.id('pg')}"]`);
  await pages.getByRole('button', { name: 'Next page' }).click();
  await settle(page, 450);
  await pages.getByRole('button', { name: 'Previous page' }).click();
  await settle(page, 450);
}

/** 4 + 5 + 7 in edit mode: delete Tee and undo it; copy-paste You; drag Vee away, undo and redo. */
async function editFlows(page: Page, f: Dash) {
  await node(page, f.id('t')).click();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog', { name: /Delete/ }).getByRole('button', { name: 'Delete' }).click();
  await expect(node(page, f.id('t'))).toHaveCount(0);
  await settle(page);
  await page.keyboard.press('Control+z');
  await expect(node(page, f.id('t'))).toBeVisible();
  await settle(page);
  await node(page, f.id('u')).click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.tab-canvas [data-node-id]').filter({ hasText: 'You' })).toHaveCount(2);
  await settle(page);
  await page.keyboard.press('Escape');
  const v = await box(node(page, f.id('v')));
  await dragTo(page, node(page, f.id('v')), v.x + v.width / 2 + 700, v.y + v.height / 2);
  await settle(page);
  await page.keyboard.press('Control+z');
  await settle(page);
  await page.keyboard.press('Control+Shift+z');
  await settle(page);
}

async function save(page: Page) {
  const btn = page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /^Save/ });
  await expect(btn).toBeEnabled();
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await btn.click();
  const r = await saved;
  expect(r.status(), await r.text()).toBe(200);
  await settle(page, 1100);
}

/** The saved tab root with this dashboard's id prefix stripped and generated ids replaced by NEW. */
async function savedShape(page: Page, f: Dash): Promise<unknown> {
  const d = (await (await page.request.get('/api/config')).json()).dashboards.find((x: { id: string }) => x.id === f.dashId);
  expect(d, 'the dashboard is saved').toBeTruthy();
  const norm = (ns: AnyNode[]): unknown =>
    ns.map((n) => ({
      ...n,
      id: n.id.startsWith(`${f.prefix}-`) ? n.id.slice(f.prefix.length + 1) : 'NEW',
      ...(n.content ? { content: { ...n.content, children: norm(n.content.children) } } : {})
    }));
  return norm(d.tabs[0].root.children);
}

test.describe('M6 §9 visual flourishes', () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  test('1, 2, 3: folder open / minimise, drill in / up and a page change really animate', async ({ page, context }) => {
    await setAnimations(page, context, 'on');
    const f = await importDash(page, context);
    await record(page);
    const errors = await open(page, f);
    await clear(page);
    await viewFlows(page, f);
    const s = await samples(page);

    const opened = stats(s, 'folder-open', f.id('c'));
    expect(opened.dur, 'open: about 300 ms').toBe(300);
    expect(opened.ms, 'open: on screen for most of it').toBeGreaterThanOrEqual(180);
    expect(opened.scale, 'open: it grows from its tile (its size changes by > 30%)').toBeGreaterThan(0.3);
    const minimised = stats(s, 'folder-minimise', f.id('c'));
    expect(minimised.dur).toBe(300);
    expect(minimised.ms).toBeGreaterThanOrEqual(180);
    expect(minimised.scale, 'minimise: it shrinks back into its tile').toBeGreaterThan(0.3);

    const drillIn = stats(s, 'drill-in', f.id('sub'));
    expect(drillIn.dur).toBe(300);
    expect(drillIn.ms).toBeGreaterThanOrEqual(180);
    expect(drillIn.scale, 'drill in: the inner box zooms forward from its tile').toBeGreaterThan(0.3);
    const drillUp = stats(s, 'drill-up', f.id('sub'));
    expect(drillUp.ms).toBeGreaterThanOrEqual(180);
    expect(drillUp.scale, 'drill up: the tile shrinks back from the box').toBeGreaterThan(0.3);
    const recede = stats(s, 'recede', f.id('c'));
    expect(recede.n, 'the outer folder recedes and comes forward').toBeGreaterThan(0);
    expect(recede.scale, 'slightly (2-4%)').toBeGreaterThan(0.015);
    expect(recede.scale).toBeLessThan(0.06);

    const pg = s.filter((x) => x.kind === 'page' && x.id === f.id('pg'));
    expect(pg.length).toBeGreaterThan(0);
    // Two slides: next (from the right, moving left), then previous (from the left, moving right).
    const split = pg.findIndex((x, i) => i > 0 && x.t - pg[i - 1].t > 200);
    expect(split, 'two page slides').toBeGreaterThan(0);
    const next = stats(pg.slice(0, split), 'page'), prev = stats(pg.slice(split), 'page');
    expect(next.dur).toBe(250);
    expect(next.ms).toBeGreaterThanOrEqual(150);
    expect(next.travel, 'the page visibly slides').toBeGreaterThanOrEqual(40);
    expect(pg[0].x, 'next: it comes in from the right').toBeGreaterThan(pg[split - 1].x);
    expect(prev.travel).toBeGreaterThanOrEqual(40);
    expect(pg[split].x, 'previous: it comes in from the left').toBeLessThan(pg[pg.length - 1].x);
    await expect(page.locator('[data-flourish]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('4, 5, 7: delete shrinks and fades, undo pops back, paste pops in, undo / redo glide; the dropped item keeps its own landing', async ({ page, context }) => {
    await setAnimations(page, context, 'on');
    const f = await importDash(page, context);
    await record(page);
    const errors = await open(page, f);
    await enterEdit(page);
    await clear(page);

    // 4. Delete: a copy of Tee shrinks and fades where it was.
    await node(page, f.id('t')).click();
    await page.keyboard.press('Delete');
    await page.getByRole('dialog', { name: /Delete/ }).getByRole('button', { name: 'Delete' }).click();
    await expect(node(page, f.id('t'))).toHaveCount(0, { timeout: 150 }); // the draft changed at once
    await settle(page);
    let s = await samples(page);
    const del = stats(s, 'delete');
    expect(del.dur).toBe(240);
    expect(del.ms).toBeGreaterThanOrEqual(150);
    expect(del.scale, 'it shrinks').toBeGreaterThan(0.25);
    expect(del.minOp, 'and fades').toBeLessThan(0.3);
    await expect(page.locator('[data-testid="flourish-ghost"]')).toHaveCount(0);

    // 4. Undo of the delete: Tee pops back in at its spot.
    await clear(page);
    await page.keyboard.press('Control+z');
    await expect(node(page, f.id('t'))).toBeVisible();
    await settle(page);
    s = await samples(page);
    const back = stats(s, 'pop-in', f.id('t'));
    expect(back.dur).toBe(280);
    expect(back.ms).toBeGreaterThanOrEqual(150);
    expect(back.scale, 'it pops (scale 0.6 → 1.05 → 1)').toBeGreaterThan(0.25);

    // 7. Paste: the new tile pops in.
    await clear(page);
    await node(page, f.id('u')).click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await settle(page);
    s = await samples(page);
    const pasted = s.filter((x) => x.kind === 'pop-in');
    expect(pasted.length, 'the pasted tile pops in').toBeGreaterThan(0);
    expect(pasted[0].id.startsWith(f.prefix), 'it is the NEW tile').toBe(false);
    expect(stats(s, 'pop-in').scale).toBeGreaterThan(0.25);
    await page.keyboard.press('Escape');

    // The dropped item keeps its own landing: no glide on Vee at the drop.
    await clear(page);
    const v0 = await box(node(page, f.id('v')));
    await dragTo(page, node(page, f.id('v')), v0.x + v0.width / 2 + 700, v0.y + v0.height / 2);
    await settle(page);
    s = await samples(page);
    expect(stats(s, 'glide', f.id('v')).n, 'the dropped item does not glide').toBe(0);
    const v1 = await box(node(page, f.id('v')));
    expect(v1.x - v0.x).toBeGreaterThan(300);

    // 5. Undo / redo: Vee glides back and forth (~220 ms).
    await clear(page);
    await page.keyboard.press('Control+z');
    await settle(page);
    s = await samples(page);
    const undoGlide = stats(s, 'glide', f.id('v'));
    expect(undoGlide.dur).toBe(220);
    expect(undoGlide.ms).toBeGreaterThanOrEqual(130);
    expect(undoGlide.travel, 'undo: it glides back').toBeGreaterThanOrEqual(40);
    await clear(page);
    await page.keyboard.press('Control+Shift+z');
    await settle(page);
    s = await samples(page);
    expect(stats(s, 'glide', f.id('v')).travel, 'redo: it glides again').toBeGreaterThanOrEqual(40);
    await expect(page.locator('[data-flourish]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('5: neighbours reflowed by a delete inside a folder glide to their new spots', async ({ page, context }) => {
    await setAnimations(page, context, 'on');
    const f = await importDash(page, context);
    await record(page);
    await open(page, f);
    await enterEdit(page);
    await clear(page);
    await node(page, f.id('p0')).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('dialog', { name: /Delete/ }).getByRole('button', { name: 'Delete' }).click();
    await settle(page);
    const s = await samples(page);
    const g = stats(s, 'glide', f.id('p1'));
    expect(g.dur).toBe(220);
    expect(g.travel, 'P1 glides into P0\'s spot').toBeGreaterThanOrEqual(40);
  });

  test('1 in edit mode: a click opens the folder with the open flourish (not the glide)', async ({ page, context }) => {
    await setAnimations(page, context, 'on');
    const f = await importDash(page, context);
    await record(page);
    await open(page, f);
    await enterEdit(page);
    await clear(page);
    await node(page, f.id('c')).locator('.folder-collapsed-tile').click();
    await expect(page.locator(`[data-folder-minimise="${f.id('c')}"]`)).toBeVisible();
    await settle(page);
    const s = await samples(page);
    expect(stats(s, 'folder-open', f.id('c')).scale).toBeGreaterThan(0.3);
    expect(stats(s, 'glide', f.id('c')).n).toBe(0);
  });

  test('Always plays even under reduced motion', async ({ page, context }) => {
    await setAnimations(page, context, 'always');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const f = await importDash(page, context);
    await record(page);
    await open(page, f);
    await clear(page);
    await node(page, f.id('c')).locator('.folder-collapsed-tile').click();
    await settle(page);
    expect(stats(await samples(page), 'folder-open', f.id('c')).scale).toBeGreaterThan(0.3);
  });

  test('a drag start stops a running flourish at once (shared cancel): nothing is left transformed', async ({ page, context }) => {
    await setAnimations(page, context, 'on');
    const f = await importDash(page, context);
    await record(page);
    await open(page, f);
    await enterEdit(page);
    const v0 = await box(node(page, f.id('v')));
    await dragTo(page, node(page, f.id('v')), v0.x + v0.width / 2 + 700, v0.y + v0.height / 2);
    await settle(page);
    const u = await box(node(page, f.id('u')));
    await page.mouse.move(u.x + u.width / 2, u.y + u.height / 2);
    await clear(page);
    // Undo starts Vee's glide; You is grabbed and dragged while it runs, which stops it.
    await page.keyboard.press('Control+z');
    await page.waitForFunction((id) => document.querySelector(`[data-node-id="${id}"]`)?.getAttribute('data-flourish') === 'glide',
      f.id('v'), { polling: 'raf' });
    await page.waitForTimeout(50); // one sampled frame of it, well inside its 220 ms
    await page.mouse.down();
    await page.mouse.move(u.x + u.width / 2 + 40, u.y + u.height / 2 + 40, { steps: 2 });
    await expect(page.locator('body.hops-dragging')).toHaveCount(1);
    const dragAt = await page.evaluate(() => (window as unknown as { __dragAt?: number }).__dragAt ?? 0);
    await expect(page.locator('[data-flourish]')).toHaveCount(0);
    expect(await node(page, f.id('v')).evaluate((el) => el.getAnimations().length), 'nothing left on Vee').toBe(0);
    const g = (await samples(page)).filter((x) => x.kind === 'glide' && x.id === f.id('v'));
    expect(g.length, 'the glide had started').toBeGreaterThan(0);
    expect(g[0].t + 220, 'it was still running when the drag began').toBeGreaterThan(dragAt);
    expect(g[g.length - 1].t, 'and nothing of it was drawn after that').toBeLessThanOrEqual(dragAt + 20);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

});
