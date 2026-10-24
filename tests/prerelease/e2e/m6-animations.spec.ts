import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M6 §7.13 (design/specs/2026-10-23-hops-v3-m6-folder-shapes-design.md): drop and merge animations.
// - A tile dropped into a folder shrinks into it; a merge draws both tiles together, then the new
//   folder pops. Each finishes within ~300 ms.
// - None with the global "Animations" setting off (Settings → Global settings), none under
//   prefers-reduced-motion.
// - Decoration only: the saved result is identical with animations on and off.
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

async function setAnimations(page: Page, context: BrowserContext, on: boolean) {
  const r = await page.request.put('/api/settings/display.animations', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    data: { value: on ? 'true' : 'false' }
  });
  expect(r.status(), await r.text()).toBe(200);
}

test.afterEach(async ({ page, context }) => {
  await setAnimations(page, context, true); // the default, for every other spec
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
    const log: { what: string; kind?: string; t: number }[] = [];
    (window as unknown as { __anim: typeof log }).__anim = log;
    new MutationObserver((muts) => {
      const t = performance.now();
      for (const m of muts) {
        if (m.type === 'attributes') {
          const el = m.target as HTMLElement;
          log.push({ what: el.hasAttribute('data-drop-pop') ? 'pop-start' : 'pop-end', t });
          continue;
        }
        m.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement && n.dataset.testid === 'drop-anim') log.push({ what: 'add', kind: n.dataset.kind, t });
        });
        m.removedNodes.forEach((n) => {
          if (n instanceof HTMLElement && n.dataset.testid === 'drop-anim') log.push({ what: 'remove', kind: n.dataset.kind, t });
        });
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-drop-pop'] });
  });
}
const animLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __anim: { what: string; kind?: string; t: number }[] }).__anim.slice());
const clearLog = (page: Page) => page.evaluate(() => { (window as unknown as { __anim: unknown[] }).__anim.length = 0; });

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

  test('a drop into a folder and a merge each animate, and finish within ~300 ms', async ({ page, context }) => {
    await setAnimations(page, context, true);
    const f = await importDash(page, context);
    await recordAnimations(page);
    const errors = await openEditing(page, f.path, f.id('t'));
    await clearLog(page);

    const c = await box(node(page, f.id('c')));
    await dragCentre(page, node(page, f.id('t')), c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(600);
    let log = await animLog(page);
    const into = log.filter((e) => e.kind === 'into');
    expect(into.map((e) => e.what)).toEqual(['add', 'remove']);
    expect(into[1].t - into[0].t, 'the drop animation lasts at most ~300 ms').toBeLessThanOrEqual(350);
    await expect(page.locator('[data-testid="drop-anim"]')).toHaveCount(0);

    await clearLog(page);
    const v = await box(node(page, f.id('v')));
    await dragCentre(page, node(page, f.id('u')), v.x + v.width / 2, v.y + v.height / 2);
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(600);
    log = await animLog(page);
    const adds = log.filter((e) => e.what === 'add');
    expect(adds.map((e) => e.kind)).toEqual(['merge', 'merge']); // the dragged tile and the target tile
    expect(log.filter((e) => e.what === 'pop-start'), 'the new folder pops').toHaveLength(1);
    expect(log.filter((e) => e.what === 'pop-end')).toHaveLength(1);
    const start = Math.min(...log.map((e) => e.t));
    const end = Math.max(...log.map((e) => e.t));
    expect(end - start, 'gather + pop last at most ~300 ms').toBeLessThanOrEqual(380);
    await expect(page.locator('[data-testid="drop-anim"]')).toHaveCount(0);
    await expect(page.locator('[data-drop-pop]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the setting off: no animation at all, for a drop or a merge', async ({ page, context }) => {
    await setAnimations(page, context, false);
    const f = await importDash(page, context);
    await recordAnimations(page);
    const errors = await openEditing(page, f.path, f.id('t'));
    await clearLog(page);
    await dropThenMerge(page, f);
    expect(await animLog(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('reduced motion: no animation at all, even with the setting on', async ({ page, context }) => {
    await setAnimations(page, context, true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const f = await importDash(page, context);
    await recordAnimations(page);
    const errors = await openEditing(page, f.path, f.id('t'));
    await clearLog(page);
    await dropThenMerge(page, f);
    expect(await animLog(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the saved result is identical with animations on and off', async ({ page, context }) => {
    const shapes: unknown[] = [];
    for (const on of [true, false]) {
      await setAnimations(page, context, on);
      const f = await importDash(page, context);
      await recordAnimations(page);
      await openEditing(page, f.path, f.id('t'));
      await clearLog(page);
      await dropThenMerge(page, f);
      expect((await animLog(page)).length > 0, `animations ${on ? 'played' : 'did not play'}`).toBe(on);
      await saveDraft(page);
      shapes.push(await savedShape(page, f.id('dash'), f.prefix));
    }
    expect(shapes[0]).toEqual(shapes[1]);
    // And it is the expected edit: Tee inside Mini; You and Vee in a new folder.
    const root = shapes[0] as AnyNode[];
    expect(root.find((n) => n.id === 'c')?.content?.children.map((n) => n.id)).toEqual(['k1', 't']);
    expect(root.find((n) => n.id === 'NEW')?.content?.children.map((n) => n.id)).toEqual(['v', 'u']);
  });

  test('Global settings shows the Animations switch, on by default', async ({ page }) => {
    await page.goto('/settings/global');
    const box = page.getByLabel('Animations', { exact: true });
    await expect(box).toBeVisible();
    await expect(box).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Display', level: 3 })).toBeVisible();
  });
});
