import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCsrfToken } from '../helpers';

// Large tiles and merge:
//   - A Large tile's content is a scaled-up Medium — the icon about 45% of the tile's
//     shorter side, the name and description in Medium's proportions, the 12 / 11 px floors kept;
//     Medium looks as before; one rule for every size (container queries).
//   - Merge works the same inside folders — held on a tile's centre, a new sub-folder in its
//     place (contents size = the parent's), with the same cue; a quick drop inserts; one undo step.
// Every drag is a REAL mouse drag in Chromium; every result is checked in the SAVED document.

let seq = 0;
const made: string[] = [];

/** Import the bundled Showcase with every id prefixed; returns its path and the id mapper. */
async function importShowcase(page: Page, context: BrowserContext) {
  const fixture = JSON.parse(fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend/internal/configdoc/testdata/v3_showcase_export.json'), 'utf8'));
  const p = `w1b${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = fixture.config.dashboards[0];
  const prefix = (n: { id: string; content?: { children: unknown[] }; root?: { children: unknown[] } }) => {
    n.id = id(n.id);
    for (const c of (n.content ?? n.root)?.children ?? []) prefix(c as typeof n);
  };
  prefix(dash);
  for (const t of dash.tabs) prefix(t);
  dash.path = `/${p}`;
  dash.name = `Showcase ${p}`;
  fixture.config.dashboards = [dash];
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'sc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(dash.id);
  return { path: dash.path as string, id, dashId: dash.id as string };
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
const box = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
};


type Child = Record<string, unknown>;
type AnyNode = { id: string; kind: string; size?: string; contentSize?: string; placement?: unknown; content?: { children: AnyNode[] } };

const kid = (id: string, name: string, extra: Child = {}): Child => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase().replace(/\W/g, '')}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, ...extra
});

/** Import one dashboard (stored form, layoutVersion 2, one Main tab). */
async function importDash(page: Page, context: BrowserContext, children: (id: (s: string) => string) => Child[]) {
  const p = `w1d${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `W1B ${p}`, order: 0, path: `/${p}`, revision: 1,
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
    multipart: { file: { name: 'w1b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(id('dash'));
  return { path: `/${p}`, id, dashId: id('dash') };
}

// ---------------------------------------------------------------- Large is a scaled-up Medium

type Look = { side: number; h: number; icon: number; name: number; desc: number | null; top: number; bottom: number; fit: string };

/** A tile's drawn content: shorter side, icon graphic, name / description font sizes, and the content's extent. */
async function look(page: Page, id: string): Promise<Look> {
  return node(page, id).evaluate((cell) => {
    const btn = cell.querySelector('button.entry')!;
    const t = btn.getBoundingClientRect();
    const title = btn.querySelector('.title')!;
    const icon = btn.querySelector('.icon svg, .icon img')!.getBoundingClientRect();
    const sub = btn.querySelector('.subtitle');
    const shown = !!sub && getComputedStyle(sub).display !== 'none' && sub.getBoundingClientRect().height > 0;
    const last = shown ? sub!.getBoundingClientRect().bottom : icon.bottom;
    return {
      side: Math.min(t.width, t.height), h: t.height, icon: Math.max(icon.width, icon.height),
      name: parseFloat(getComputedStyle(title).fontSize),
      desc: shown ? parseFloat(getComputedStyle(sub!).fontSize) : null,
      top: title.getBoundingClientRect().top - t.top, bottom: t.bottom - last,
      fit: btn.classList.contains('compact') ? 'compact' : btn.classList.contains('fill') ? 'fill' : 'none'
    };
  });
}
const show = (l: Look) => `side ${l.side.toFixed(1)}: icon ${l.icon.toFixed(1)}, name ${l.name}px, desc ${l.desc ?? 'hidden'}px`;
/** The share of the tile's height its content (name top to last line) fills. */
const filled = (l: Look) => (l.h - l.top - l.bottom) / l.h;

/** Medium as it was drawn before Large was scaled up: it must not change. */
const MEDIUM_BEFORE: Record<number, { icon: number; name: number; desc: number; fill: number }> = {
  1280: { icon: 34.44, name: 12, desc: 11, fill: (101.31 - 15.59 - 15.61) / 101.31 },
  1920: { icon: 52.58, name: 16.24, desc: 13.92, fill: (154.66 - 26.78 - 26.78) / 154.66 }
};

async function sizesDash(page: Page, context: BrowserContext) {
  return importDash(page, context, (id) => [
    kid(id('lg'), 'Google', { description: 'Search Engine', icon: 'mdi:google', size: 'large', placement: { x: 0, y: 0, w: 4, h: 4 } }),
    kid(id('md'), 'YouTube', { description: 'Video Platform', icon: 'mdi:youtube', placement: { x: 4, y: 0, w: 2, h: 2 } }),
    kid(id('sm'), 'GitHub', { description: 'Code Repository', icon: 'mdi:github', size: 'small', placement: { x: 6, y: 0, w: 1, h: 1 } })
  ]);
}

for (const width of [1280, 1920]) test.describe(`Large is a scaled-up Medium (${width}px)`, () => {
  test.use({ viewport: { width, height: 1000 } });

  test('the Large icon is 40-50% of the tile\'s shorter side', async ({ page, context }) => {
    const f = await sizesDash(page, context);
    await page.goto(f.path);
    await expect(node(page, f.id('lg')).locator('.icon svg')).toBeVisible();
    const lg = await look(page, f.id('lg'));
    expect(lg.icon / lg.side, `Large: ${show(lg)}`).toBeGreaterThanOrEqual(0.4);
    expect(lg.icon / lg.side, `Large: ${show(lg)}`).toBeLessThanOrEqual(0.5);
  });

  test('a Large tile is a scaled-up Medium: the text in Medium\'s proportions, filled like Medium, centred', async ({ page, context }, info) => {
    const f = await sizesDash(page, context);
    await page.goto(f.path);
    await expect(node(page, f.id('lg')).locator('.icon svg')).toBeVisible();
    const [md, lg] = [await look(page, f.id('md')), await look(page, f.id('lg'))];
    await info.attach(`sizes-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    const what = `Medium ${show(md)}; Large ${show(lg)}`;
    // The name and description are the same share of the tile as Medium's (within 20%: Medium at 1280
    // sits at its 12 / 11 px floors, a little above its ratios).
    const near = (a: number, b: number) => Math.abs(a - b) / b;
    expect(near(lg.name / lg.side, md.name / md.side), `name share: ${what}`).toBeLessThanOrEqual(0.2);
    expect(lg.desc, `Large shows its description: ${what}`).not.toBeNull();
    expect(md.desc, `Medium shows its description: ${what}`).not.toBeNull();
    // Its description is Medium's share too, up to its upper bound (1.25rem, 20 px at
    // the default text size) — at 1920 the bound applies.
    const descWant = Math.min((md.desc! / md.side) * lg.side, 20);
    expect(lg.desc!, `description: ${what}`).toBeLessThanOrEqual(20.01);
    expect(near(lg.desc!, descWant), `description share (or its bound): ${what}`).toBeLessThanOrEqual(0.2);
    // The icon is at least Medium's share (about 45%, Medium about a third).
    expect(lg.icon / lg.side, `icon share: ${what}`).toBeGreaterThanOrEqual(md.icon / md.side);
    // No more empty space than Medium: the content fills at least Medium's share of the height (-5%).
    expect(filled(lg), `filled: Large ${filled(lg).toFixed(2)} vs Medium ${filled(md).toFixed(2)}`).toBeGreaterThanOrEqual(filled(md) - 0.05);
    // Centred, and inside the tile.
    expect(lg.top).toBeGreaterThanOrEqual(0);
    expect(lg.bottom).toBeGreaterThanOrEqual(0);
    expect(Math.abs(lg.top - lg.bottom), `centred: ${what}`).toBeLessThanOrEqual(0.06 * lg.h + 2);
  });

  test('Medium is unchanged (icon, name, description, fill) and Small keeps its floors-driven look', async ({ page, context }) => {
    const f = await sizesDash(page, context);
    await page.goto(f.path);
    await expect(node(page, f.id('md')).locator('.icon svg')).toBeVisible();
    const md = await look(page, f.id('md'));
    const was = MEDIUM_BEFORE[width];
    expect(Math.abs(md.icon - was.icon), `Medium icon: ${show(md)} vs ${was.icon}`).toBeLessThanOrEqual(1);
    expect(Math.abs(md.name - was.name), `Medium name: ${show(md)} vs ${was.name}`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(md.desc! - was.desc), `Medium description: ${show(md)} vs ${was.desc}`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(filled(md) - was.fill), `Medium fill ${filled(md).toFixed(3)} vs ${was.fill.toFixed(3)}`).toBeLessThanOrEqual(0.02);
    const sm = await look(page, f.id('sm'));
    expect(sm.name, `Small: ${show(sm)}`).toBe(12);
    expect(sm.icon / sm.side, `Small: ${show(sm)}`).toBeLessThanOrEqual(0.3);
  });

  test('the floors hold: a name is never under 12px, a description never under 11px, nothing spills out', async ({ page, context }) => {
    for (const vw of [width, 1024]) {
      await page.setViewportSize({ width: vw, height: 1000 });
      const f = await sizesDash(page, context);
      await page.goto(f.path);
      await expect(node(page, f.id('sm')).locator('.icon svg')).toBeVisible();
      for (const k of ['sm', 'md', 'lg']) {
        const l = await look(page, f.id(k));
        expect(l.name, `${k} at ${vw}px: ${show(l)}`).toBeGreaterThanOrEqual(12);
        if (l.desc !== null) expect(l.desc, `${k} at ${vw}px: ${show(l)}`).toBeGreaterThanOrEqual(11);
        expect(l.top, `${k} at ${vw}px: inside`).toBeGreaterThanOrEqual(0);
        expect(l.bottom, `${k} at ${vw}px: inside`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------- merge inside folders

/** The saved tab's children (GET /api/config). */
async function savedTabs(page: Page, dashId: string): Promise<{ name: string; root: { children: AnyNode[] } }[]> {
  const r = await page.request.get('/api/config');
  expect(r.status()).toBe(200);
  const d = (await r.json()).dashboards.find((x: { id: string }) => x.id === dashId);
  expect(d, 'the dashboard is saved').toBeTruthy();
  return d.tabs;
}
function find(ns: AnyNode[], id: string): AnyNode | undefined {
  for (const n of ns) {
    if (n.id === id) return n;
    const r = n.content ? find(n.content.children, id) : undefined;
    if (r) return r;
  }
  return undefined;
}
async function saveDraft(page: Page) {
  const save = page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ });
  await expect(save).toBeEnabled();
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await save.click();
  const r = await saved;
  expect(r.status(), await r.text()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
}

/** Open the Showcase's Sizes tab in edit mode; any page error fails the test. */
async function sizesInEdit(page: Page, context: BrowserContext) {
  const s = await importShowcase(page, context);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(s.path);
  await page.getByRole('tab', { name: 'Switch to Sizes tab', exact: true }).click();
  await expect(node(page, s.id('sc-big'))).toBeVisible();
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  return { ...s, errors };
}

/**
 * Press `from` near its top (where the name is), travel in small steps until the
 * pointer is on `to`'s centre, then steer so the DRAWN ghost sits on `to` (users aim with the ghost).
 * Returns the pointer position. The mouse stays down.
 */
async function dragGhostOnto(page: Page, from: Locator, to: Locator) {
  const a = await box(from);
  const t = await box(to);
  const x0 = a.x + a.width / 2, y0 = a.y + Math.min(24, a.height * 0.15);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  let x = t.x + t.width / 2, y = t.y + t.height / 2;
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(x0 + ((x - x0) * i) / 20, y0 + ((y - y0) * i) / 20);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(60);
  const g = await box(page.locator('.drag-layer .ghost'));
  // Inside a folder the ghost is drawn at the folder's item size (what the tile would be there).
  expect(Math.abs(g.width - t.width), `ghost ${g.width}px vs the folder's item ${t.width}px`).toBeLessThanOrEqual(1);
  const dx = t.x + t.width / 2 - (g.x + g.width / 2), dy = t.y + t.height / 2 - (g.y + g.height / 2);
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(x + (dx * i) / 5, y + (dy * i) / 5);
    await page.waitForTimeout(16);
  }
  x += dx;
  y += dy;
  return { x, y };
}

test.describe('merge works the same inside folders', () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  test('Showcase Sizes: "Big tile" held on "Large inside" makes a sub-folder in its place, at the folder\'s contents size; one Undo', async ({ page, context }) => {
    const s = await sizesInEdit(page, context);
    await dragGhostOnto(page, node(page, s.id('sc-big')), node(page, s.id('sc-ff-2')));
    await expect(page.locator('.drag-layer .cue')).toContainText(/hold to make a folder/i);
    await page.waitForTimeout(700);
    await expect(page.locator('.drag-layer .cue')).toHaveText(/^\s*Make a folder\s*$/i);
    await expect(page.locator('.drag-layer .reason')).toHaveCount(0);
    await page.mouse.up();
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click(); // keeps "New folder"
    await expect(dlg).toBeHidden();
    // Drawn in the folder, in Large inside's place: a minimised folder tile at the contents size.
    const ff = node(page, s.id('sc-ff'));
    await expect(node(page, s.id('sc-big'))).toBeHidden();
    const inside = await box(node(page, s.id('sc-ff-1')));
    const subBox = await box(ff.locator('[data-node-id]').filter({ hasText: 'New folder' }).first());
    expect(Math.abs(subBox.width - inside.width), 'the new sub-folder is drawn at the contents size').toBeLessThanOrEqual(1);
    // One undo step restores both; Redo makes it again.
    const bar = page.getByRole('toolbar', { name: 'Editing' });
    await bar.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(node(page, s.id('sc-big'))).toBeVisible();
    await expect(ff.locator(`[data-node-id="${s.id('sc-ff-2')}"]`)).toBeVisible();
    await expect(ff.locator('[data-node-id]').filter({ hasText: 'New folder' })).toHaveCount(0);
    await bar.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(node(page, s.id('sc-big'))).toBeHidden();
    await saveDraft(page);
    const tabs = await savedTabs(page, s.dashId);
    const sizes = tabs.find((t) => t.name === 'Sizes')!.root.children;
    const order = find(sizes, s.id('sc-ff'))!.content!.children;
    expect(order.map((n) => n.id)[0]).toBe(s.id('sc-ff-1'));
    const sub = order[1];
    expect(sub).toMatchObject({ kind: 'folder', size: 'medium', contentSize: 'medium' });
    expect(sub.content!.children.map((n) => n.id)).toEqual([s.id('sc-ff-2'), s.id('sc-big')]);
    expect(sub.content!.children.map((n) => n.size)).toEqual(['large', 'large']);
    expect(sizes.some((n) => n.id === s.id('sc-big')), 'Big tile left the tab').toBe(false);
    expect(s.errors).toEqual([]);
  });

  test('inside a Large-contents folder the new sub-folder\'s size and contents size are Large', async ({ page, context }) => {
    const s = await sizesInEdit(page, context);
    await dragGhostOnto(page, node(page, s.id('sc-fa')), node(page, s.id('sc-lg-1')));
    await page.waitForTimeout(700);
    await expect(page.locator('.drag-layer .cue')).toHaveText(/^\s*Make a folder\s*$/i);
    await page.mouse.up();
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await saveDraft(page);
    const sizes = (await savedTabs(page, s.dashId)).find((t) => t.name === 'Sizes')!.root.children;
    const order = find(sizes, s.id('sc-f-large'))!.content!.children;
    expect(order[0]).toMatchObject({ kind: 'folder', size: 'large', contentSize: 'large' });
    expect(order[0].content!.children.map((n) => n.id)).toEqual([s.id('sc-lg-1'), s.id('sc-fa')]);
    expect(s.errors).toEqual([]);
  });

  test('a quick drop on the same spot (no hold) inserts into the folder\'s order, no new folder', async ({ page, context }) => {
    const s = await sizesInEdit(page, context);
    await dragGhostOnto(page, node(page, s.id('sc-big')), node(page, s.id('sc-ff-2')));
    await expect(page.locator('.drag-layer .marker')).toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole('dialog', { name: 'Edit Folder' })).toHaveCount(0);
    await saveDraft(page);
    const sizes = (await savedTabs(page, s.dashId)).find((t) => t.name === 'Sizes')!.root.children;
    const ids = find(sizes, s.id('sc-ff'))!.content!.children.map((n) => n.id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain(s.id('sc-big'));
    expect(find(sizes, s.id('sc-ff'))!.content!.children.every((n) => n.kind === 'tile')).toBe(true);
    expect(s.errors).toEqual([]);
  });

  test('tab-level merge is unchanged: "Medium A" held on "Medium B" makes a Medium folder on the tab', async ({ page, context }) => {
    const s = await sizesInEdit(page, context);
    const a = await box(node(page, s.id('sc-fa')));
    const b = await box(node(page, s.id('sc-fb')));
    const x0 = a.x + a.width / 2, y0 = a.y + a.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    const x1 = b.x + b.width / 2, y1 = b.y + b.height / 2;
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / 20, y0 + ((y1 - y0) * i) / 20);
      await page.waitForTimeout(16);
    }
    const g = await box(page.locator('.drag-layer .ghost'));
    expect(Math.abs(g.width - a.width), 'on the tab the ghost is the tile\'s own size').toBeLessThanOrEqual(1);
    await page.waitForTimeout(700);
    await expect(page.locator('.drag-layer .cue')).toHaveText(/^\s*Make a folder\s*$/i);
    await page.mouse.up();
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await saveDraft(page);
    const sizes = (await savedTabs(page, s.dashId)).find((t) => t.name === 'Sizes')!.root.children;
    const made = sizes.find((n) => n.kind === 'folder' && n.content!.children.map((c) => c.id).join() === [s.id('sc-fb'), s.id('sc-fa')].join());
    expect(made, 'a new folder [Medium B, Medium A] on the tab').toBeTruthy();
    expect(made).toMatchObject({ size: 'medium', contentSize: 'medium' });
    expect(s.errors).toEqual([]);
  });
});
