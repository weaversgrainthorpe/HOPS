import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCsrfToken } from '../helpers';

// M6 §7.13 (design/specs/2026-10-23-hops-v3-m6-folder-shapes-design.md) + Ruling 5: drop and merge
// animations, clearly visible (~500 ms).
// - A tile dropped into a folder flies along a curve into it and the folder gulps; a merge draws both
//   tiles together, then the new folder pops. Every drop path animates: a minimised folder, a
//   sub-folder tile, a drilled-in inner box, a merge on the tab and inside a folder.
// - The global "Animations" setting (Settings → Global settings) is On / Off / Always: On plays nothing
//   under prefers-reduced-motion and the setting says so visibly; Always plays even then; Off never.
// - Decoration only: the saved result is identical whether animations play or not.
// Every drag is a REAL mouse drag in Chromium; the result is checked in the SAVED document.

let seq = 0;
const made: string[] = [];
type Child = Record<string, unknown>;
type AnyNode = { id: string; kind: string; name?: string; display?: string; placement?: unknown; content?: { children: AnyNode[] } };

const kid = (id: string, name: string, extra: Child = {}): Child => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, ...extra
});
const tile = (id: string, name: string, x: number, y: number): Child => kid(id, name, { placement: { x, y, w: 2, h: 2 } });

/** Tiles Tee, You and Vee in a row, and a minimised folder "Mini" (holding K1) below them. */
async function importDash(page: Page, context: BrowserContext) {
  const p = `m6a${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `M6 anim ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{ id: id('tab'), name: 'Main', order: 0, root: { columns: 24, children: [
      tile(id('t'), 'Tee', 0, 0), tile(id('u'), 'You', 3, 0), tile(id('v'), 'Vee', 6, 0),
      {
        id: id('c'), kind: 'folder', name: 'Mini', display: 'collapsed', shape: 'rounded', size: 'medium', contentSize: 'medium',
        placement: { x: 0, y: 4, w: 6, h: 6 }, content: { children: [kid(id('k1'), 'K1')] }
      }
    ] } }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm6a.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(id('dash'));
  return { path: `/${p}`, id, prefix: p };
}

type Mode = 'on' | 'off' | 'always';
/** The bundled Showcase, every id prefixed so this copy never collides with another. */
async function showcase(page: Page, context: BrowserContext) {
  const fixture = JSON.parse(fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend/internal/configdoc/testdata/v3_showcase_export.json'), 'utf8'));
  const p = `m6s${Date.now().toString(36)}${(seq++).toString(36)}`;
  const dash = fixture.config.dashboards[0];
  const prefix = (n: { id: string; content?: { children: unknown[] }; root?: { children: unknown[] } }) => {
    n.id = `${p}-${n.id}`;
    for (const c of (n.content ?? n.root)?.children ?? []) prefix(c as typeof n);
  };
  prefix(dash);
  for (const t of dash.tabs) prefix(t);
  dash.path = `/${p}`;
  dash.name = `M6 anim showcase ${p}`;
  const doc = { format: 'hops-export', schemaVersion: 3, exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm6s.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(dash.id);
  return { path: dash.path as string, id: (s: string) => `${p}-${s}`, prefix: p };
}

async function setAnimations(page: Page, context: BrowserContext, mode: Mode | boolean) {
  const value = mode === true ? 'on' : mode === false ? 'off' : mode;
  const r = await page.request.put('/api/settings/display.animations', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    data: { value }
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

/** Record, with timestamps, every animation ghost added / removed and every folder pop started / ended. */
async function recordAnimations(page: Page) {
  await page.addInitScript(() => {
    const log: { what: string; kind?: string; t: number; z?: number }[] = [];
    (window as unknown as { __anim: typeof log }).__anim = log;
    // Ruling 3: when the drop ended, and when a dialog appeared (relative to the animation).
    window.addEventListener('pointerup', () => log.push({ what: 'pointerup', t: performance.now() }), true);
    new MutationObserver((muts) => {
      const t = performance.now();
      for (const m of muts) {
        if (m.type === 'attributes') {
          const el = m.target as HTMLElement;
          const what = m.attributeName === 'data-drop-release' ? 'release' : 'pop';
          log.push({ what: `${what}-${el.hasAttribute(m.attributeName!) ? 'start' : 'end'}`, t });
          continue;
        }
        m.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement && n.dataset.testid === 'drop-anim') {
            log.push({ what: 'add', kind: n.dataset.kind, t, z: Number(getComputedStyle(n).zIndex) });
          }
          if (n instanceof HTMLElement && (n.matches('[role="dialog"]') || n.querySelector('[role="dialog"]'))) {
            log.push({ what: 'dialog', t });
          }
        });
        m.removedNodes.forEach((n) => {
          if (n instanceof HTMLElement && n.dataset.testid === 'drop-anim') log.push({ what: 'remove', kind: n.dataset.kind, t });
        });
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-drop-pop', 'data-drop-release'] });
    // Every frame: where each animation ghost is drawn (its centre, transforms included) and how opaque.
    const frames: { t: number; ghosts: { kind?: string; x: number; y: number; op: number }[]; gulp: boolean }[] = [];
    (window as unknown as { __frames: typeof frames }).__frames = frames;
    const tick = () => {
      const gs = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="drop-anim"]'));
      const gulp = !!document.querySelector('[data-drop-gulp]');
      if (gs.length || gulp) {
        frames.push({
          t: performance.now(), gulp,
          ghosts: gs.map((g) => {
            const r = g.getBoundingClientRect();
            return { kind: g.dataset.kind, x: r.left + r.width / 2, y: r.top + r.height / 2, op: Number(getComputedStyle(g).opacity) };
          })
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
type Frame = { t: number; ghosts: { kind?: string; x: number; y: number; op: number }[]; gulp: boolean };
const sampled = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames.slice());
const clearFrames = (page: Page) => page.evaluate(() => { (window as unknown as { __frames: unknown[] }).__frames.length = 0; });
/** How long animation ghosts were on screen, and the furthest any visible one moved from where it began. */
function measure(frames: Frame[]) {
  const withGhosts = frames.filter((f) => f.ghosts.length > 0);
  if (withGhosts.length === 0) return { ms: 0, travel: 0, gulp: frames.some((f) => f.gulp) };
  const ms = withGhosts[withGhosts.length - 1].t - withGhosts[0].t;
  let travel = 0;
  const start = withGhosts[0].ghosts;
  for (const f of withGhosts) {
    f.ghosts.forEach((g, i) => {
      if (start[i] && g.op > 0.2) travel = Math.max(travel, Math.hypot(g.x - start[i].x, g.y - start[i].y));
    });
  }
  return { ms, travel, gulp: frames.some((f) => f.gulp) };
}
type AnimEvent = { what: string; kind?: string; t: number; z?: number };
const animLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __anim: AnimEvent[] }).__anim.slice());
const anim = (log: AnimEvent[]) => log.filter((e) => e.what !== 'pointerup' && e.what !== 'dialog');
const clearLog = async (page: Page) => {
  await page.evaluate(() => { (window as unknown as { __anim: unknown[] }).__anim.length = 0; });
  await clearFrames(page);
};

const node = (page: Page, id: string) => page.locator(`.tab-canvas [data-node-id="${id}"]`).first();
const box = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
};

async function openEditing(page: Page, path: string, first: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(path);
  await expect(node(page, first)).toBeVisible();
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  return errors;
}

/** Grab `l` at its centre and travel in small steps to (x1, y1), still pressed. */
async function dragCentre(page: Page, l: Locator, x1: number, y1: number) {
  const s = await box(l);
  const x0 = s.x + s.width / 2, y0 = s.y + s.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 20, y0 + ((y1 - y0) * i) / 20);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(120);
}

/** Tee into Mini (a drop into a minimised folder), then You merged onto Vee (a new folder, named in its dialog). */
async function dropThenMerge(page: Page, f: { id: (s: string) => string }) {
  const c = await box(node(page, f.id('c')));
  await dragCentre(page, node(page, f.id('t')), c.x + c.width / 2, c.y + c.height / 2);
  await expect(page.locator('.drag-layer .cue')).toContainText('Into "Mini"');
  await page.mouse.up();
  // The change is made at the drop, not after the animation: the item is out of the tab at once.
  await expect(node(page, f.id('t'))).toHaveCount(0, { timeout: 200 });
  await page.waitForTimeout(500);

  const v = await box(node(page, f.id('v')));
  await dragCentre(page, node(page, f.id('u')), v.x + v.width / 2, v.y + v.height / 2);
  await page.waitForTimeout(700);
  await expect(page.locator('.drag-layer .cue')).toHaveText(/^\s*Make a folder\s*$/i);
  await page.mouse.up();
  const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
  await expect(dlg).toBeVisible();
  await page.waitForTimeout(500);
  await dlg.getByRole('button', { name: /^Save/ }).click();
  await expect(dlg).toBeHidden();
}

async function saveDraft(page: Page) {
  const save = page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ });
  await expect(save).toBeEnabled();
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await save.click();
  const r = await saved;
  expect(r.status(), await r.text()).toBe(200);
}

/** The saved tab root with this dashboard's id prefix stripped and generated ids replaced by NEW. */
async function savedShape(page: Page, dashId: string, prefix: string): Promise<unknown> {
  const d = (await (await page.request.get('/api/config')).json()).dashboards.find((x: { id: string }) => x.id === dashId);
  expect(d, 'the dashboard is saved').toBeTruthy();
  const norm = (ns: AnyNode[]): unknown =>
    ns.map((n) => ({
      ...n,
      id: n.id.startsWith(`${prefix}-`) ? n.id.slice(prefix.length + 1) : 'NEW',
      ...(n.content ? { content: { ...n.content, children: norm(n.content.children) } } : {})
    }));
  return norm(d.tabs[0].root.children);
}

test.describe('M6 drop and merge animations (§7.13)', () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  test('a drop into a folder and a merge are clearly visible: on screen >= 400 ms, moving >= 40 px', async ({ page, context }) => {
    await setAnimations(page, context, 'on');
    const f = await importDash(page, context);
    await recordAnimations(page);
    const errors = await openEditing(page, f.path, f.id('t'));
    await clearLog(page);

    const c = await box(node(page, f.id('c')));
    await dragCentre(page, node(page, f.id('t')), c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(900);
    let log = anim(await animLog(page));
    const into = log.filter((e) => e.kind === 'into');
    expect(into.map((e) => e.what)).toEqual(['add', 'remove']);
    let m = measure(await sampled(page));
    expect(m.ms, 'the drop animation is on screen for at least 400 ms').toBeGreaterThanOrEqual(400);
    expect(into[1].t - into[0].t, 'and done in about 500 ms').toBeLessThanOrEqual(700);
    expect(m.travel, 'the dropped tile visibly travels').toBeGreaterThanOrEqual(40);
    expect(m.gulp, 'the folder gulps').toBe(true);
    await expect(page.locator('[data-testid="drop-anim"]')).toHaveCount(0);
    await expect(page.locator('[data-drop-gulp]')).toHaveCount(0);

    await clearLog(page);
    const v = await box(node(page, f.id('v')));
    await dragCentre(page, node(page, f.id('u')), v.x + v.width / 2, v.y + v.height / 2);
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(900);
    log = anim(await animLog(page));
    const adds = log.filter((e) => e.what === 'add');
    expect(adds.map((e) => e.kind)).toEqual(['merge', 'merge']); // the dragged tile and the target tile
    expect(log.filter((e) => e.what === 'pop-start'), 'the new folder pops').toHaveLength(1);
    expect(log.filter((e) => e.what === 'pop-end')).toHaveLength(1);
    m = measure(await sampled(page));
    expect(m.ms, 'the merge is on screen for at least 300 ms before the pop').toBeGreaterThanOrEqual(300);
    expect(m.travel, 'the merged tiles visibly move').toBeGreaterThanOrEqual(40);
    const start = Math.min(...log.map((e) => e.t));
    const end = Math.max(...log.map((e) => e.t));
    expect(end - start, 'gather + pop last at least 400 ms').toBeGreaterThanOrEqual(400);
    expect(end - start, 'and about 500 ms in all').toBeLessThanOrEqual(700);
    await expect(page.locator('[data-testid="drop-anim"]')).toHaveCount(0);
    await expect(page.locator('[data-drop-pop]')).toHaveCount(0);
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    expect(errors).toEqual([]);
  });

  // Ruling 3: after a merge the folder dialog opens only once the animation has ended (<= 300 ms),
  // at once when animations are off or under reduced motion; no animation layer ever draws above it.
  test('merge: the folder dialog opens when the animation ends, and nothing animates above it', async ({ page, context }) => {
    await setAnimations(page, context, true);
    const f = await importDash(page, context);
    await recordAnimations(page);
    await openEditing(page, f.path, f.id('t'));
    const v = await box(node(page, f.id('v')));
    await dragCentre(page, node(page, f.id('u')), v.x + v.width / 2, v.y + v.height / 2);
    await page.waitForTimeout(700);
    await expect(page.locator('.drag-layer .cue')).toHaveText(/^\s*Make a folder\s*$/i);
    await clearLog(page);
    await page.mouse.up();
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    // Visible, so nothing from the animation is left on screen with it.
    await expect(page.locator('[data-testid="drop-anim"]')).toHaveCount(0);
    await expect(page.locator('[data-drop-pop]')).toHaveCount(0);
    const log = await animLog(page);
    const up = log.find((e) => e.what === 'pointerup')!.t;
    const opened = log.find((e) => e.what === 'dialog')!.t;
    const ghosts = log.filter((e) => e.what === 'add');
    expect(ghosts.length, 'the merge animated').toBe(2);
    const modalZ = await page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--z-modal')));
    for (const g of ghosts) expect(g.z!, 'an animation ghost sits below dialogs').toBeLessThan(modalZ);
    const lastAnim = Math.max(...log.filter((e) => e.what === 'remove' || e.what === 'pop-end').map((e) => e.t));
    expect(opened, 'the dialog opens after the animation has ended').toBeGreaterThanOrEqual(lastAnim);
    expect(opened - up, 'and no later than ~500 ms after the drop').toBeLessThanOrEqual(700);
    await dlg.getByRole('button', { name: 'Cancel' }).click();
  });

  for (const how of ['off', 'reduced motion'] as const) {
    test(`merge with animations ${how}: the folder dialog opens at once`, async ({ page, context }) => {
      await setAnimations(page, context, how === 'off' ? 'off' : 'on');
      if (how === 'reduced motion') await page.emulateMedia({ reducedMotion: 'reduce' });
      const f = await importDash(page, context);
      await recordAnimations(page);
      await openEditing(page, f.path, f.id('t'));
      const v = await box(node(page, f.id('v')));
      await dragCentre(page, node(page, f.id('u')), v.x + v.width / 2, v.y + v.height / 2);
      await page.waitForTimeout(700);
      await clearLog(page);
      await page.mouse.up();
      await expect(page.getByRole('dialog', { name: 'Edit Folder' })).toBeVisible();
      const log = await animLog(page);
      expect(anim(log)).toEqual([]);
      const up = log.find((e) => e.what === 'pointerup')!.t;
      const opened = log.find((e) => e.what === 'dialog')!.t;
      expect(opened - up, 'opened straight away, not after an animation delay').toBeLessThan(120);
    });
  }

  test('the setting off: no animation at all, for a drop or a merge', async ({ page, context }) => {
    await setAnimations(page, context, false);
    const f = await importDash(page, context);
    await recordAnimations(page);
    const errors = await openEditing(page, f.path, f.id('t'));
    await clearLog(page);
    await dropThenMerge(page, f);
    expect(anim(await animLog(page))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('On under reduced motion: no animation at all, and the setting says so visibly', async ({ page, context }) => {
    await setAnimations(page, context, 'on');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const f = await importDash(page, context);
    await recordAnimations(page);
    const errors = await openEditing(page, f.path, f.id('t'));
    await clearLog(page);
    await dropThenMerge(page, f);
    expect(anim(await animLog(page))).toEqual([]);
    expect(errors).toEqual([]);
    // Never a silent no-op: Settings → Global settings says why nothing plays on this device.
    await page.goto('/settings/global');
    const sel = page.getByLabel('Animations', { exact: true });
    await expect(sel).toHaveValue('on');
    const note = page.getByText('Your device asks for reduced motion — animations are off on this device');
    await expect(note).toBeVisible();
    await sel.selectOption('always');
    await expect(note).toBeHidden();
  });

  test('Always: the animations play even under reduced motion', async ({ page, context }) => {
    await setAnimations(page, context, 'always');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const f = await importDash(page, context);
    await recordAnimations(page);
    const errors = await openEditing(page, f.path, f.id('t'));
    await clearLog(page);
    await dropThenMerge(page, f);
    const log = anim(await animLog(page));
    expect(log.filter((e) => e.what === 'add').map((e) => e.kind)).toEqual(['into', 'merge', 'merge']);
    expect(log.filter((e) => e.what === 'pop-start')).toHaveLength(1);
    expect(measure(await sampled(page)).travel).toBeGreaterThanOrEqual(40);
    expect(errors).toEqual([]);
    await page.goto('/settings/global');
    await expect(page.getByLabel('Animations', { exact: true })).toHaveValue('always');
    await expect(page.getByText('Your device asks for reduced motion — animations are off on this device')).toHaveCount(0);
  });

  test('the saved result is identical with animations on and off', async ({ page, context }) => {
    const shapes: unknown[] = [];
    for (const on of [true, false]) {
      await setAnimations(page, context, on ? 'on' : 'off');
      const f = await importDash(page, context);
      await recordAnimations(page);
      await openEditing(page, f.path, f.id('t'));
      await clearLog(page);
      await dropThenMerge(page, f);
      expect(anim(await animLog(page)).length > 0, `animations ${on ? 'played' : 'did not play'}`).toBe(on);
      await saveDraft(page);
      shapes.push(await savedShape(page, f.id('dash'), f.prefix));
    }
    expect(shapes[0]).toEqual(shapes[1]);
    // And it is the expected edit: Tee inside Mini; You and Vee in a new folder.
    const root = shapes[0] as AnyNode[];
    expect(root.find((n) => n.id === 'c')?.content?.children.map((n) => n.id)).toEqual(['k1', 't']);
    expect(root.find((n) => n.id === 'NEW')?.content?.children.map((n) => n.id)).toEqual(['v', 'u']);
  });

  test('Global settings shows Animations as On / Off / Always, On by default, and no note on a device with motion', async ({ page }) => {
    await page.goto('/settings/global');
    const sel = page.getByLabel('Animations', { exact: true });
    await expect(sel).toBeVisible();
    await expect(sel).toHaveValue('on');
    await expect(sel.locator('option')).toHaveText(['On', 'Off', 'Always']);
    await expect(page.getByRole('heading', { name: 'Display', level: 3 })).toBeVisible();
    await expect(page.getByText('Your device asks for reduced motion — animations are off on this device')).toHaveCount(0);
  });

  // Ruling 5: every drop path animates, on the M5/M6 Showcase.
  test('every drop path animates: a minimised folder, a sub-folder tile, a drilled-in inner box, a merge inside a folder', async ({ page, context }) => {
    await setAnimations(page, context, 'on');
    const sc = await showcase(page, context);
    await recordAnimations(page);
    // Folders tab: "Nested sizes" is drilled into its "Small-contents child" (this browser's memory).
    await page.goto(sc.path);
    await page.evaluate((d) => localStorage.setItem(`hops.folderNav.${d.dash}`, JSON.stringify({ page: {}, drill: { [d.f]: [d.a] } })),
      { dash: sc.id('sc-dash'), f: sc.id('sc-f-nest'), a: sc.id('sc-f-nest-a') });
    const errors = await openEditing(page, sc.path, sc.id('sc-r1'));
    const cue = page.locator('.drag-layer .cue');
    const check = async (what: string, kinds: string[], gulpOrPop: 'gulp' | 'pop') => {
      await page.waitForTimeout(900);
      const log = anim(await animLog(page));
      expect(log.filter((e) => e.what === 'add').map((e) => e.kind), `${what}: animated`).toEqual(kinds);
      const m = measure(await sampled(page));
      expect(m.ms, `${what}: on screen >= 300 ms`).toBeGreaterThanOrEqual(gulpOrPop === 'gulp' ? 400 : 300);
      expect(m.travel, `${what}: moves >= 40 px`).toBeGreaterThanOrEqual(40);
      if (gulpOrPop === 'gulp') expect(m.gulp, `${what}: the folder gulps`).toBe(true);
      else expect(log.filter((e) => e.what === 'pop-start'), `${what}: the new folder pops`).toHaveLength(1);
      await expect(page.locator('[data-testid="drop-anim"], [data-drop-gulp], [data-drop-pop]')).toHaveCount(0);
    };

    // A minimised folder.
    await clearLog(page);
    let t = await box(node(page, sc.id('sc-f-six')));
    await dragCentre(page, node(page, sc.id('sc-r1')), t.x + t.width / 2, t.y + t.height / 2);
    await expect(cue).toContainText('Into "Six tiles (collapsed)"');
    await page.mouse.up();
    await check('minimised folder', ['into'], 'gulp');

    // A sub-folder tile (Level 2, inside the open Level 1 folder).
    await clearLog(page);
    t = await box(node(page, sc.id('sc-f-l2')));
    await dragCentre(page, node(page, sc.id('sc-r2')), t.x + t.width / 2, t.y + t.height / 2);
    await expect(cue).toContainText('Into "Level 2 folder');
    await page.mouse.up();
    await check('sub-folder tile', ['into'], 'gulp');

    // A merge inside a folder (L1 tile 1 onto L1 tile 2).
    await clearLog(page);
    t = await box(node(page, sc.id('sc-l1-t2')));
    await dragCentre(page, node(page, sc.id('sc-l1-t1')), t.x + t.width / 2, t.y + t.height / 2);
    await page.waitForTimeout(700);
    await expect(cue).toHaveText(/^\s*Make a folder\s*$/i);
    await page.mouse.up();
    await check('merge inside a folder', ['merge', 'merge'], 'pop');
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancel' }).click();

    // A drilled-in folder's inner box (its empty page area).
    await page.getByRole('button', { name: 'Folders', exact: true }).or(page.getByText('Folders', { exact: true })).first().click();
    const inner = page.locator(`.nested-box[data-nested-folder="${sc.id('sc-f-nest-a')}"]`).first();
    await expect(inner).toBeVisible();
    await clearLog(page);
    const ib = await box(inner);
    await dragCentre(page, node(page, sc.id('sc-mf-1')), ib.x + 120, ib.y + 160);
    await page.mouse.up();
    // Mixed 1 leaves the Mixed folder for another folder, so it pops out first (§8.1); the box still gulps.
    await check('drilled-in inner box', ['out'], 'gulp');
    expect(errors).toEqual([]);
  });
});

// ------------------------------------------------------------------ §8.1: out of a folder

/** Ghost on screen >= 400 ms, moving >= 40 px, and the source's release puff; nothing left behind. */
async function expectOut(page: Page, what: string) {
  await page.waitForTimeout(900);
  const log = anim(await animLog(page));
  expect(log.filter((e) => e.what === 'add').map((e) => e.kind), `${what}: it pops out`).toEqual(['out']);
  const m = measure(await sampled(page));
  expect(m.ms, `${what}: on screen >= 400 ms`).toBeGreaterThanOrEqual(400);
  const out = log.filter((e) => e.kind === 'out');
  expect(out[1].t - out[0].t, `${what}: and done in about 500 ms`).toBeLessThanOrEqual(750);
  expect(m.travel, `${what}: it travels >= 40 px`).toBeGreaterThanOrEqual(40);
  expect(log.filter((e) => e.what === 'release-start'), `${what}: the source puffs`).toHaveLength(1);
  expect(log.filter((e) => e.what === 'release-end')).toHaveLength(1);
  await expect(page.locator('[data-testid="drop-anim"], [data-drop-gulp], [data-drop-release]')).toHaveCount(0);
}

/** An empty spot on the Grid tab: row 0, well right of Example (sc-r3). */
async function emptyGridSpot(page: Page, sc: { id: (s: string) => string }) {
  const r3 = await box(node(page, sc.id('sc-r3')));
  return { x: r3.x + r3.width + 420, y: r3.y + r3.height / 2 };
}

async function menuTo(page: Page, l: Locator, dest: RegExp, mode: 'Move' | 'Copy', inTab?: RegExp) {
  await l.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move/Copy to…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Move or copy' });
  await expect(dlg).toBeVisible();
  if (inTab) await dlg.getByRole('treeitem', { name: inTab }).getByRole('button', { name: 'Expand' }).click();
  await dlg.getByRole('treeitem', { name: dest }).first().click();
  await dlg.getByRole('button', { name: mode, exact: true }).click();
  await expect(dlg).toBeHidden();
}

/**
 * Every way out of a folder, on the Showcase (`after` runs after each, e.g. the animation check):
 * an open folder's tile dragged to the tab and to another folder; a minimised sub-folder dragged out;
 * menu Copy out of a folder; menu Move of a minimised sub-folder; a drilled-in inner box's tile dragged
 * to its outer box (its title bar).
 */
async function everyWayOut(page: Page, sc: { id: (s: string) => string }, after: (what: string) => Promise<void>) {
  const cue = page.locator('.drag-layer .cue');
  const step = async (what: string, act: () => Promise<void>) => {
    await clearLog(page);
    await act();
    await after(what);
  };
  await step('open folder → the tab', async () => {
    const at = await emptyGridSpot(page, sc);
    await dragCentre(page, node(page, sc.id('sc-l1-t1')), at.x, at.y);
    await page.mouse.up();
    await expect(node(page, sc.id('sc-l1-t1'))).toBeVisible();
  });
  await step('open folder → another folder', async () => {
    const six = await box(node(page, sc.id('sc-f-six')));
    await dragCentre(page, node(page, sc.id('sc-l1-t2')), six.x + six.width / 2, six.y + six.height / 2);
    await expect(cue).toContainText('Into "Six tiles (collapsed)"');
    await page.mouse.up();
  });
  await step('minimised sub-folder dragged out to the tab', async () => {
    const at = await emptyGridSpot(page, sc);
    await dragCentre(page, node(page, sc.id('sc-f-l2')), at.x + 220, at.y);
    await page.mouse.up();
  });
  await step('menu Copy out of a folder (to another folder)', async () => {
    await menuTo(page, node(page, sc.id('sc-l1-t3')), /Slideshow folder$/, 'Copy', /(^|\s)Grid$/);
  });
  // Folders tab: Nested sizes drilled into its Small-contents child (set before editing began).
  await page.getByRole('button', { name: 'Folders', exact: true }).or(page.getByText('Folders', { exact: true })).first().click();
  const inner = page.locator(`.nested-box[data-nested-folder="${sc.id('sc-f-nest-a')}"]`).first();
  await expect(inner).toBeVisible();
  await step('menu Move of a minimised sub-folder out of a drilled-in box (to the tab)', async () => {
    await menuTo(page, node(page, sc.id('sc-f-nest-b')), /(^|\s)Folders$/, 'Move');
    await expect(node(page, sc.id('sc-f-nest-b'))).toBeVisible();
  });
  await step('drilled-in inner box → its outer box', async () => {
    const bar = node(page, sc.id('sc-f-nest')).locator(`[data-crumb="${sc.id('sc-f-nest')}"]`).first();
    const b = await box(bar);
    await dragCentre(page, node(page, sc.id('sc-nesta-1')), b.x + b.width / 2, b.y + b.height / 2);
    await expect(cue).toContainText('Into "Nested sizes');
    await page.mouse.up();
  });
}

async function openShowcaseOut(page: Page, context: BrowserContext, mode: Mode, reduced = false) {
  await setAnimations(page, context, mode);
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  const sc = await showcase(page, context);
  await recordAnimations(page);
  await page.goto(sc.path);
  await page.evaluate((d) => localStorage.setItem(`hops.folderNav.${d.dash}`, JSON.stringify({ page: {}, drill: { [d.f]: [d.a] } })),
    { dash: sc.id('sc-dash'), f: sc.id('sc-f-nest'), a: sc.id('sc-f-nest-a') });
  const errors = await openEditing(page, sc.path, sc.id('sc-r1'));
  return { sc, errors };
}

test.describe('M6 §8.1: items animate out of folders', () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  test('every way out of a folder pops out of the source and hops to its new spot (>= 400 ms, >= 40 px)', async ({ page, context }) => {
    const { sc, errors } = await openShowcaseOut(page, context, 'on');
    await everyWayOut(page, sc, (what) => expectOut(page, what));
    expect(errors).toEqual([]);
  });

  for (const [mode, reduced] of [['off', false], ['on', true]] as const) {
    test(`${mode === 'off' ? 'Off' : 'On under reduced motion'}: nothing plays for any way out of a folder`, async ({ page, context }) => {
      const { sc, errors } = await openShowcaseOut(page, context, mode, reduced);
      await everyWayOut(page, sc, async (what) => {
        await page.waitForTimeout(300);
        expect(anim(await animLog(page)), `${what}: no animation`).toEqual([]);
      });
      expect(errors).toEqual([]);
    });
  }

  test('the saved result is identical with and without the out-of-folder animations', async ({ page, context }) => {
    test.setTimeout(90_000); // every way out, twice
    const shapes: unknown[] = [];
    for (const mode of ['on', 'off'] as const) {
      const { sc } = await openShowcaseOut(page, context, mode);
      let played = 0;
      await everyWayOut(page, sc, async () => {
        await page.waitForTimeout(mode === 'on' ? 900 : 200);
        played += anim(await animLog(page)).filter((e) => e.what === 'add').length;
      });
      expect(played > 0, `animations ${mode === 'on' ? 'played' : 'did not play'}`).toBe(mode === 'on');
      await saveDraft(page);
      const d = (await (await page.request.get('/api/config')).json()).dashboards.find((x: { id: string }) => x.id === sc.id('sc-dash'));
      const norm = (ns: AnyNode[]): unknown =>
        ns.map((n) => ({
          ...n,
          id: n.id.startsWith(`${sc.prefix}-`) ? n.id.slice(sc.prefix.length + 1) : 'NEW',
          ...(n.content ? { content: { ...n.content, children: norm(n.content.children) } } : {})
        }));
      shapes.push(d.tabs.map((t: { root: { children: AnyNode[] } }) => norm(t.root.children)));
    }
    expect(shapes[0]).toEqual(shapes[1]);
    // And it is the expected edit: L1 tile 1 and Level 2 on the Grid tab, L1 tile 2 in Six tiles, a
    // copy of L1 tile 3 in the Slideshow folder, Grand-child on the Folders tab, Child 1 in Nested sizes.
    const [grid, , folders] = shapes[0] as AnyNode[][];
    expect(grid.map((n) => n.id)).toEqual(expect.arrayContaining(['sc-l1-t1', 'sc-f-l2']));
    expect(grid.find((n) => n.id === 'sc-f-six')!.content!.children.map((n) => n.id)).toContain('sc-l1-t2');
    expect(grid.find((n) => n.id === 'sc-f-l1')!.content!.children.map((n) => n.id)).toEqual(['sc-l1-t3']);
    expect(grid.find((n) => n.id === 'sc-f-slide')!.content!.children.map((n) => n.id)).toEqual(['sc-slide-1', 'sc-slide-2', 'NEW']);
    expect(folders.map((n) => n.id)).toContain('sc-f-nest-b');
    expect(folders.find((n) => n.id === 'sc-f-nest')!.content!.children.map((n) => n.id)).toContain('sc-nesta-1');
  });
});
