// M5 §8 (Ruling 16, Jonathan 2026-10-23): the navbar's row of dashboard links and its "More ▾" menu are
// gone. Signed in, the title IS the dashboard switcher ("Sample ▾"): a menu button listing every
// dashboard in Settings order, the current one marked; choosing one opens it. The usual menu keys:
// Enter or Space opens it, the arrows move, Escape closes it and focus returns to the title. It works
// the same in edit mode, where the unsaved-changes guard still asks first. Signed out: a plain title,
// no switcher. The title is back in the centre of the bar: centred, whole, never overlapping, never
// scrolling sideways — at 375, 1280, 1416 and 1920, view and edit mode, with 4 and with 8 dashboards.
import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test';
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
  const doc = { format: 'hops-export', schemaVersion: 3, exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'sw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(dash.id as string);
}

/** The bundled M5 Showcase, every id prefixed so this copy never collides with another. */
async function showcase(page: Page, context: BrowserContext, name: string) {
  const fixture = JSON.parse(fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend/internal/configdoc/testdata/v3_showcase_export.json'), 'utf8'));
  const p = `sw${Date.now().toString(36)}${(seq++).toString(36)}`;
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
  return { path: dash.path as string, id: (s: string) => `${p}-${s}`, dashId: dash.id as string };
}

/** A small one-tab dashboard called `name`. */
async function plainDash(page: Page, context: BrowserContext, name: string, header?: Record<string, unknown>) {
  const p = `sw${Date.now().toString(36)}${(seq++).toString(36)}`;
  await importDoc(page, context, {
    id: `${p}-dash`, name, order: 0, path: `/${p}`, revision: 1, ...(header ? { header } : {}),
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{ id: `${p}-tab`, name: 'Main', order: 0, root: { columns: 24, children: [
      { kind: 'tile', id: `${p}-a`, name: 'A tile', url: 'http://a.test', icon: 'mdi:home', openMode: 'newtab', size: 'medium', order: 0, placement: { x: 0, y: 0, w: 2, h: 2 } }
    ] } }]
  });
  return { path: `/${p}`, id: (s: string) => `${p}-${s}`, dashId: `${p}-dash` };
}

/** Jonathan's dev set (Sample, Weavers, Sample (Imported), v3 Showcase), plus more to make `total`. */
async function dashboards(page: Page, context: BrowserContext, total: number) {
  const names = ['Weavers', 'Sample (Imported)', 'Kitchen display', 'Garage', 'Home office', 'Media room', 'Network'];
  const have = ((await (await page.request.get('/api/config')).json()).dashboards as unknown[]).length;
  expect(have, 'the fresh test server has its Sample dashboard only').toBe(1);
  for (let i = 0; i < total - have - 1; i++) await plainDash(page, context, names[i]);
  return showcase(page, context, 'v3 Showcase');
}

/** Every dashboard, in Settings (display) order, as the server stores it. */
async function ordered(page: Page) {
  const cfg = await (await page.request.get('/api/config')).json();
  return (cfg.dashboards as { id: string; name: string; path: string; order?: number }[])
    .map((d, i) => ({ d, i, k: typeof d.order === 'number' ? d.order : Infinity }))
    .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k - b.k))
    .map((x) => x.d);
}

async function anonPage(browser: Browser): Promise<{ page: Page; ctx: BrowserContext }> {
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }
  });
  return { page: await ctx.newPage(), ctx };
}

const switcher = (page: Page) => page.locator('.navbar').getByRole('button', { name: /switch dashboard$/ });
const menu = (page: Page) => page.getByRole('menu', { name: 'Dashboards' });
const items = (page: Page) => menu(page).getByRole('menuitem');
const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function enterEdit(page: Page) {
  await page.getByRole('button', { name: 'Enter Edit Mode' }).click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
}

type Box = { left: number; right: number; top: number; bottom: number };
const overlaps = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

/**
 * The bar holds (§8): no link row and no More; the title whole and centred in the bar (±1 px); nothing
 * overlaps or leaves the screen; the page never scrolls sideways. `strict: false` (a long title on a
 * phone, where no compaction level leaves room to centre it whole): centred, or else as near the centre
 * as the wider side allows — right up against that side (one bar gap from it). `whole: false` (a
 * phone, since M6 gave it the text-size buttons: a longer title such as "v3 Showcase ▾" shortens with an
 * ellipsis below 414 px — m6-phone-text-size.spec.ts): the title may be shortened, never overlapping.
 */
async function barHolds(page: Page, label: string, o: { strict: boolean; whole?: boolean; maxOff?: number } = { strict: true }) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    { message: `${label}: no sideways scroll`, timeout: 2000 }).toBeLessThanOrEqual(0);
  await settle(page);
  const r = await page.evaluate(() => {
    const view = document.documentElement.clientWidth;
    const shown = (e: Element) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const box = (e: Element) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
    const els = [...document.querySelectorAll('.navbar .logo img, .navbar .wordmark, .navbar .version, .navbar .custom-text, .navbar .center-title, .navbar .nav-right > *')].filter(shown);
    const bar = document.querySelector('.navbar .nav-content') as HTMLElement;
    const bs = getComputedStyle(bar);
    const bb = bar.getBoundingClientRect();
    const title = document.querySelector('.navbar .center-title');
    const text = title?.querySelector('.title-text') as HTMLElement | null;
    const sides = (['.navbar .nav-left', '.navbar .nav-right'] as const).map((sel) => document.querySelector(sel)!.getBoundingClientRect());
    return {
      gap: parseFloat(bs.columnGap) || 0,
      leftSide: { right: sides[0].right, width: sides[0].width },
      rightSide: { left: sides[1].left, width: sides[1].width },
      view, sideways: document.documentElement.scrollWidth - view,
      linkRow: document.querySelectorAll('.navbar .nav-link, .navbar .nav-links, .navbar .nav-more-btn').length,
      barMid: (bb.left + parseFloat(bs.paddingLeft) + bb.right - parseFloat(bs.paddingRight)) / 2,
      title: title && shown(title) ? box(title) : null,
      titleCut: text ? text.scrollWidth > text.clientWidth + 0.5 : null,
      pieces: els.map((e) => ({ n: `${e.className} ${(e.textContent ?? '').trim()}`.slice(0, 60), ...box(e) }))
    };
  });
  expect(r.sideways, `${label}: no sideways scroll`).toBeLessThanOrEqual(0);
  expect(r.linkRow, `${label}: no dashboard link row, no More`).toBe(0);
  await expect(page.getByRole('button', { name: 'More dashboards' }), `${label}: no More`).toHaveCount(0);
  expect(r.title, `${label}: there is a title`).not.toBeNull();
  if (o.whole !== false) expect(r.titleCut, `${label}: the title is whole`).toBe(false);
  const mid = (r.title!.left + r.title!.right) / 2;
  const off = Math.abs(mid - r.barMid);
  if (o.strict || off <= 1) {
    expect(off, `${label}: the title is centred (its middle ${mid.toFixed(1)}, the bar's ${r.barMid.toFixed(1)})`).toBeLessThanOrEqual(1);
  } else {
    // As near the centre as it can be: off towards the narrower side, right up against the wider one —
    // and, where given, never further off than `maxOff`.
    if (o.maxOff !== undefined) expect(off, `${label}: off centre by ${off.toFixed(1)} px, at most ${o.maxOff}`).toBeLessThanOrEqual(o.maxOff);
    const rightWider = r.rightSide.width > r.leftSide.width;
    expect(mid < r.barMid, `${label}: off centre only away from the wider side`).toBe(rightWider);
    const slack = rightWider ? r.rightSide.left - r.title!.right : r.title!.left - r.leftSide.right;
    expect(slack, `${label}: the title is as near the centre as the wider side allows`).toBeLessThanOrEqual(r.gap + 1);
    // Wider: the title's own box spans only the title (plus the switcher's chevron), not spare room.
    const t = await page.locator('.navbar .center-title').evaluate((e) => ({ w: e.getBoundingClientRect().width, sw: e.scrollWidth }));
    expect(t.w, `${label}: the title box is the title`).toBeLessThanOrEqual(t.sw + 1);
  }
  for (let i = 0; i < r.pieces.length; i++) {
    const a = r.pieces[i];
    expect(a.left, `${label}: ${a.n} on screen`).toBeGreaterThanOrEqual(-0.5);
    expect(a.right, `${label}: ${a.n} on screen`).toBeLessThanOrEqual(r.view + 0.5);
    for (let j = i + 1; j < r.pieces.length; j++) {
      const b = r.pieces[j];
      if (a.n.startsWith('logo') || b.n.startsWith('logo')) continue; // the logo's own img + text
      expect(overlaps(a, b), `${label}: ${a.n} / ${b.n} overlap`).toBe(false);
    }
  }
}

/**
 * How far off centre a short title ("Sample ▾") may sit at 375 since the phone bar carries the text-size
 * pair: the right side is five 40 px controls (206 px) against the logo and status dot, so the title's
 * middle cannot come nearer than about 61 px (signed in; 51 signed out). Held to about a button and a half.
 */
const PHONE_MAX_OFF = 64;

/** The menu: open, on screen, every dashboard once in Settings order, the current one marked; closed again. */
async function menuHolds(page: Page, names: string[], current: string, label: string) {
  await switcher(page).click();
  await expect(menu(page), `${label}: the menu opens`).toBeVisible();
  await expect(items(page), `${label}: every dashboard, in Settings order`).toHaveText(names);
  const mb = (await menu(page).boundingBox())!;
  const view = await page.evaluate(() => document.documentElement.clientWidth);
  expect(mb.x, `${label}: the menu is on screen`).toBeGreaterThanOrEqual(-0.5);
  expect(mb.x + mb.width, `${label}: the menu is on screen`).toBeLessThanOrEqual(view + 0.5);
  await expect(menu(page).locator('[aria-current="page"]'), `${label}: the current one is marked`).toHaveText(current);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(switcher(page)).toBeFocused();
}

test.describe('§8 the dashboard switcher (Ruling 16)', () => {
  for (const total of [4, 8]) {
    test(`${total} dashboards at 375, 1280, 1416 and 1920, view and edit: no link row; the title is the switcher, centred and whole; nothing overlaps; no sideways scroll`, async ({ page, context }) => {
      test.setTimeout(90_000);
      const sc = await dashboards(page, context, total);
      const names = (await ordered(page)).map((d) => d.name);
      expect(names).toHaveLength(total);
      await page.setViewportSize({ width: 1920, height: 900 });
      await page.goto(sc.path);
      await expect(page.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
      for (const editing of [false, true]) {
        if (editing) await enterEdit(page); // at 1920 (phones have no pencil); edit mode stays on at 375
        for (const width of [1920, 1416, 1280, 375]) {
          await page.setViewportSize({ width, height: 900 });
          const label = `${total} dashboards, ${editing ? 'edit' : 'view'} at ${width}`;
          // 375: "v3 Showcase" + the chevron cannot be centred beside a phone's controls, and since M6 gave
          // phones the text-size buttons it shortens with an ellipsis there (whole from 414 px:
          // m6-phone-text-size.spec.ts); the short title test below holds 375 to a whole title.
          // Only 375 is relaxed: the phone widths (320–414) are held by m6-phone-text-size.spec.ts.
          await barHolds(page, label, { strict: width !== 375, whole: width !== 375 });
          await expect(switcher(page), `${label}: the switcher`).toBeVisible();
          await expect(switcher(page)).toHaveAccessibleName('v3 Showcase — switch dashboard');
          await expect(page.locator('.navbar .center-title')).toHaveText('v3 Showcase');
          await menuHolds(page, names, 'v3 Showcase', label);
          await page.getByRole('link', { name: 'Settings' }).click({ trial: true, timeout: 3000 });
          if (width > 480) {
            await page.getByRole('button', { name: editing ? 'Exit Edit Mode' : 'Enter Edit Mode' }).click({ trial: true, timeout: 3000 });
            await page.getByRole('button', { name: 'Log out' }).click({ trial: true, timeout: 3000 });
            await expect(page.locator('.navbar .logo img'), `${label}: logo`).toBeVisible();
            await expect(page.locator('.navbar .version'), `${label}: version`).toBeVisible();
          }
          // The text-size buttons never hide (walkthrough 1 D), phones included since M6.
          await page.getByRole('button', { name: 'Decrease text size' }).click({ trial: true, timeout: 3000 });
          await page.getByRole('button', { name: 'Increase text size' }).click({ trial: true, timeout: 3000 });
        }
        await page.setViewportSize({ width: 1920, height: 900 });
      }
    });
  }

  test('the keyboard: Enter or Space opens it on the current dashboard, the arrows (and Home/End) move and wrap, Escape closes it and focus returns; Enter opens a dashboard', async ({ page, context }) => {
    const sc = await dashboards(page, context, 4);
    const all = await ordered(page);
    const names = all.map((d) => d.name);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(sc.path);
    const btn = switcher(page);
    await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    // aria-controls names the menu only while it exists (batch review Minor 6).
    await expect(btn).not.toHaveAttribute('aria-controls');
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(btn).toHaveAttribute('aria-controls', (await menu(page).getAttribute('id'))!);
    await expect(items(page)).toHaveText(names);
    // Opens on the current dashboard (the Showcase, last).
    await expect(items(page).last()).toBeFocused();
    await expect(items(page).last()).toHaveAttribute('aria-current', 'page');
    for (let i = 0; i < names.length - 1; i++) await expect(items(page).nth(i)).not.toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('ArrowDown'); // wraps to the first
    await expect(items(page).first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items(page).nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(items(page).first()).toBeFocused();
    await page.keyboard.press('ArrowUp'); // wraps to the last
    await expect(items(page).last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(items(page).first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(items(page).last()).toBeFocused();
    // The page's own shortcuts never see the menu's keys: still on the same page, menu open.
    await expect(page).toHaveURL(new RegExp(`${sc.path}$`));
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(btn).toBeFocused();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).not.toHaveAttribute('aria-controls');
    // Space opens it too; Tab closes it.
    await page.keyboard.press(' ');
    await expect(menu(page)).toBeVisible();
    await expect(items(page).last()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu(page)).toHaveCount(0);
    // Enter on an item opens that dashboard; the title follows; the menu is gone.
    await btn.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown'); // the first (wrapped)
    await expect(items(page).first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${all[0].path}$`));
    await expect(page.locator('.navbar .center-title')).toHaveText(names[0]);
    await expect(menu(page)).toHaveCount(0);
    // Space on an item opens it as well.
    await switcher(page).focus();
    await page.keyboard.press('Enter');
    await expect(items(page).first()).toBeFocused(); // the current one, now the first
    await page.keyboard.press('End');
    await page.keyboard.press(' ');
    await expect(page).toHaveURL(new RegExp(`${sc.path}$`));
    await expect(page.locator('.navbar .center-title')).toHaveText('v3 Showcase');
  });

  test('the mouse: a click opens it; choosing one opens that dashboard; a click outside or on the title again closes it', async ({ page, context }) => {
    const sc = await dashboards(page, context, 8);
    const all = await ordered(page);
    await page.setViewportSize({ width: 1416, height: 900 });
    await page.goto(sc.path);
    await switcher(page).click();
    await expect(menu(page)).toBeVisible();
    await switcher(page).click();
    await expect(menu(page)).toHaveCount(0);
    await switcher(page).click();
    await page.mouse.click(5, 500);
    await expect(menu(page)).toHaveCount(0);
    const target = all[3];
    await switcher(page).click();
    await items(page).filter({ hasText: target.name }).click();
    await expect(page).toHaveURL(new RegExp(`${target.path}$`));
    await expect(page.locator('.navbar .center-title')).toHaveText(target.name);
    await expect(menu(page)).toHaveCount(0);
    await switcher(page).click();
    await expect(menu(page).locator('[aria-current="page"]')).toHaveText(target.name);
  });

  test('it lists the dashboards in Settings order: reordering them reorders the menu', async ({ page, context }) => {
    await dashboards(page, context, 4);
    const before = await ordered(page);
    const ids = before.map((d) => d.id);
    const moved = [...ids.slice(1), ids[0]]; // the first goes last
    const put = async (order: string[]) => {
      const r = await page.request.put('/api/dashboards/order', { headers: { 'X-CSRF-Token': await getCsrfToken(context) }, data: { order } });
      expect(r.status(), await r.text()).toBe(200);
    };
    await put(moved);
    try {
      const after = await ordered(page);
      expect(after.map((d) => d.id)).toEqual(moved);
      await page.goto(after[0].path);
      await switcher(page).click();
      await expect(items(page)).toHaveText(after.map((d) => d.name));
      await expect(menu(page).locator('[aria-current="page"]')).toHaveText(after[0].name);
    } finally {
      await put(ids);
    }
  });

  test('in edit mode: it works the same; with unsaved changes the guard asks first (Stay keeps them, Leave opens the other)', async ({ page, context }) => {
    const sc = await dashboards(page, context, 4);
    const all = await ordered(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(sc.path);
    await enterEdit(page);
    const toolbar = page.getByRole('toolbar', { name: 'Editing' });
    // No changes: it just goes; edit mode follows to the chosen dashboard (as it does for any link).
    await switcher(page).click();
    await items(page).filter({ hasText: all[1].name }).click();
    await expect(page).toHaveURL(new RegExp(`${all[1].path}$`));
    await expect(page.locator('.navbar .center-title')).toHaveText(all[1].name);
    await expect(toolbar).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toHaveCount(0);
    // Back to the Showcase (with the switcher, still editing) and make a change.
    await switcher(page).click();
    await items(page).filter({ hasText: 'v3 Showcase' }).click();
    await expect(page).toHaveURL(new RegExp(`${sc.path}$`));
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole('button', { name: 'Add tab' }).click();
    const tabDlg = page.getByRole('dialog', { name: 'New Tab' });
    await tabDlg.locator('input#name').fill('Unsaved tab');
    await tabDlg.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('tab', { name: 'Switch to Unsaved tab tab' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Save' })).toBeEnabled();
    // Switching asks first; Stay keeps the change and the page.
    await switcher(page).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    const ask = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Stay' }).click();
    await expect(ask).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${sc.path}$`));
    await expect(toolbar.getByRole('button', { name: 'Save' })).toBeEnabled();
    // Leave discards it and opens the chosen one.
    await switcher(page).click();
    await items(page).first().click();
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Leave' }).click();
    await expect(page).toHaveURL(new RegExp(`${all[0].path}$`));
    await expect(page.locator('.navbar .center-title')).toHaveText(all[0].name);
    // Still editing, on the chosen one, with nothing unsaved; the Showcase never got the new tab.
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Save' })).toBeDisabled();
    await switcher(page).click();
    await items(page).filter({ hasText: 'v3 Showcase' }).click();
    await expect(page).toHaveURL(new RegExp(`${sc.path}$`));
    await expect(page.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Switch to Unsaved tab tab' })).toHaveCount(0);
  });

  // Since M6 a phone's bar also carries the two text-size buttons, so its right-hand side is too wide for
  // any title to sit in the exact centre at 375: a short title stays whole, as near the centre as that
  // side allows (barHolds' strict: false) and never more than PHONE_MAX_OFF from it, and the switcher's
  // menu still holds.
  test('on a phone (375), a short title is whole and as near the centre as the controls allow — signed in (the switcher) and signed out, view and edit', async ({ page, context, browser }) => {
    await dashboards(page, context, 4);
    const sample = (await ordered(page)).find((d) => d.name === 'Sample')!;
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(sample.path);
    await expect(switcher(page)).toHaveAccessibleName('Sample — switch dashboard');
    for (const editing of [false, true]) {
      if (editing) {
        await page.setViewportSize({ width: 1920, height: 900 });
        await enterEdit(page);
      }
      await page.setViewportSize({ width: 375, height: 800 });
      await barHolds(page, `signed in, ${editing ? 'edit' : 'view'} at 375`, { strict: false, maxOff: PHONE_MAX_OFF });
      await menuHolds(page, (await ordered(page)).map((d) => d.name), 'Sample', `signed in, ${editing ? 'edit' : 'view'} at 375`);
    }
    const { page: anon, ctx } = await anonPage(browser);
    try {
      await anon.setViewportSize({ width: 375, height: 800 });
      await anon.goto(sample.path);
      await expect(anon.locator('.navbar .center-title')).toHaveText('Sample');
      await barHolds(anon, 'signed out at 375', { strict: false, maxOff: PHONE_MAX_OFF });
    } finally {
      await ctx.close();
    }
  });

  test('signed out: a plain title, centred — no switcher, no menu, no link row', async ({ page, context, browser }) => {
    const sc = await dashboards(page, context, 8);
    const { page: anon, ctx } = await anonPage(browser);
    try {
      for (const width of [1920, 1416, 1280, 375]) {
        await anon.setViewportSize({ width, height: 900 });
        if (width === 1920) await anon.goto(sc.path);
        await expect(anon.locator('.navbar .center-title')).toHaveText('v3 Showcase');
        await expect(anon.locator('.navbar .center-title').getByRole('button'), `${width}: no switcher`).toHaveCount(0);
        await expect(anon.locator('.navbar').getByRole('button', { name: /switch dashboard/ })).toHaveCount(0);
        await expect(anon.locator('.navbar [aria-haspopup]')).toHaveCount(0);
        await barHolds(anon, `signed out at ${width}`, { strict: width !== 375, whole: width !== 375 });
      }
      // Clicking the title does nothing.
      await anon.setViewportSize({ width: 1280, height: 900 });
      await anon.locator('.navbar .center-title').click();
      await expect(anon.getByRole('menu')).toHaveCount(0);
      await expect(anon).toHaveURL(new RegExp(`${sc.path}$`));
    } finally {
      await ctx.close();
    }
  });
});

// Ruling 20 (Jonathan, 2026-10-23; batch review I1): a dashboard whose header hides its title still
// gives a signed-in admin the switcher — a compact "Dashboards ▾" in the title's place, the same menu,
// keys and unsaved-changes guard. Signed out: nothing there (no title, no switcher).
test.describe('Ruling 20: the title hidden — a compact "Dashboards ▾" switcher for an admin', () => {
  // Named as the title switcher is ("<what it shows> — switch dashboard"), so its visible text is in its
  // name (WCAG 2.5.3, label in name).
  const compact = (page: Page) => page.locator('.navbar').getByRole('button', { name: 'Dashboards — switch dashboard', exact: true });

  async function headless(page: Page, context: BrowserContext) {
    const d = await plainDash(page, context, 'No title here', { showLeft: true, showCenter: false });
    const cfg = await (await page.request.get('/api/config')).json();
    const stored = cfg.dashboards.find((x: { id: string }) => x.id === d.dashId);
    expect(stored?.header?.showCenter, 'the dashboard stores its title as hidden').toBe(false);
    return d;
  }

  test('signed in, view mode: "Dashboards ▾" in the title\'s place; its menu, keys and choosing a dashboard; the bar holds at every width', async ({ page, context }) => {
    const hd = await headless(page, context);
    const all = await ordered(page);
    const names = all.map((d) => d.name);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(hd.path);
    await expect(page.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
    // No title (hidden), but the compact switcher, named for what it does, centred where the title was.
    await expect(page.locator('.navbar .center-title')).toHaveCount(0);
    const btn = compact(page);
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('Dashboards');
    await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).not.toHaveAttribute('aria-controls');
    for (const width of [1920, 1416, 1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        { message: `${width}: no sideways scroll` }).toBeLessThanOrEqual(0);
      await settle(page);
      await expect(btn, `${width}: the compact switcher`).toBeVisible();
      const r = await page.evaluate(() => {
        const b = document.querySelector('.navbar .switcher-compact')!.getBoundingClientRect();
        const others = [...document.querySelectorAll('.navbar .logo img, .navbar .wordmark, .navbar .version, .navbar .nav-right > *')]
          .map((e) => e.getBoundingClientRect()).filter((x) => x.width > 0 && x.height > 0);
        const hit = others.some((o) => Math.min(o.right, b.right) - Math.max(o.left, b.left) > 0.5 && Math.min(o.bottom, b.bottom) - Math.max(o.top, b.top) > 0.5);
        return { left: b.left, right: b.right, view: document.documentElement.clientWidth, hit };
      });
      expect(r.left, `${width}: on screen`).toBeGreaterThanOrEqual(-0.5);
      expect(r.right, `${width}: on screen`).toBeLessThanOrEqual(r.view + 0.5);
      expect(r.hit, `${width}: it overlaps nothing`).toBe(false);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    // The keys: Enter opens it on the current dashboard; Escape closes it and focus returns.
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(btn).toHaveAttribute('aria-controls', (await menu(page).getAttribute('id'))!);
    await expect(items(page)).toHaveText(names);
    await expect(menu(page).locator('[aria-current="page"]')).toHaveText('No title here');
    await expect(menu(page).locator('[aria-current="page"]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(items(page).first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(btn).toBeFocused();
    // Choosing one opens it; there the title (shown) is the switcher again.
    const other = all.find((d) => d.id !== hd.dashId)!;
    await btn.click();
    await items(page).filter({ hasText: other.name }).click();
    await expect(page).toHaveURL(new RegExp(`${other.path}$`));
    await expect(switcher(page)).toHaveAccessibleName(`${other.name} — switch dashboard`);
    await expect(compact(page)).toHaveCount(0);
    // And back with it.
    await switcher(page).click();
    await items(page).filter({ hasText: 'No title here' }).click();
    await expect(page).toHaveURL(new RegExp(`${hd.path}$`));
    await expect(compact(page)).toBeVisible();
  });

  test('signed in, edit mode: the same; with unsaved changes the guard asks first (Stay, then Leave)', async ({ page, context }) => {
    const hd = await headless(page, context);
    const other = (await ordered(page)).find((d) => d.id !== hd.dashId)!;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(hd.path);
    await enterEdit(page);
    const toolbar = page.getByRole('toolbar', { name: 'Editing' });
    await expect(compact(page)).toBeVisible();
    await toolbar.getByRole('button', { name: 'Add tab' }).click();
    const tabDlg = page.getByRole('dialog', { name: 'New Tab' });
    await tabDlg.locator('input#name').fill('Unsaved tab');
    await tabDlg.getByRole('button', { name: 'Create' }).click();
    await expect(toolbar.getByRole('button', { name: 'Save' })).toBeEnabled();
    await compact(page).click();
    await items(page).filter({ hasText: other.name }).click();
    const ask = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Stay' }).click();
    await expect(page).toHaveURL(new RegExp(`${hd.path}$`));
    await expect(toolbar.getByRole('button', { name: 'Save' })).toBeEnabled();
    await compact(page).focus();
    await page.keyboard.press('Enter');
    await items(page).filter({ hasText: other.name }).focus();
    await page.keyboard.press('Enter');
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Leave' }).click();
    await expect(page).toHaveURL(new RegExp(`${other.path}$`));
    await expect(switcher(page)).toHaveAccessibleName(`${other.name} — switch dashboard`);
    await expect(toolbar).toBeVisible();
  });

  test('signed out: nothing in the title\'s place — no switcher, no menu, no title', async ({ page, context, browser }) => {
    const hd = await headless(page, context);
    const { page: anon, ctx } = await anonPage(browser);
    try {
      for (const width of [1920, 375]) {
        await anon.setViewportSize({ width, height: 900 });
        if (width === 1920) await anon.goto(hd.path);
        await expect(anon.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
        await expect(anon.locator('.navbar').getByRole('button', { name: /switch dashboard/i }), `${width}: no switcher`).toHaveCount(0);
        await expect(anon.locator('.navbar [aria-haspopup]')).toHaveCount(0);
        await expect(anon.locator('.navbar .center-title')).toHaveCount(0);
        await expect(anon.locator('.navbar .nav-center')).not.toContainText('Dashboards');
      }
    } finally {
      await ctx.close();
    }
  });
});
