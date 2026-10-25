// M6 (Jonathan, 2026-10-25): "phones should get text size buttons, unless it will cause issues."
// The text-size buttons now show at every width — phones included (they used to hide at 768 px and
// below). On a phone they fit the bar through its compaction ladder (fitBar): at 320, 360, 390 and
// 414 px, view and edit mode, signed in and signed out, both buttons show with a tap target of at
// least 40 px (as does every other bar control), nothing overlaps or leaves the screen, the page never
// scrolls sideways, and the title stays centred where it can be (else as near the centre as the wider
// side allows). And they work there: A+ grows the stacked (phone) layout's tile text, A- shrinks it.
// Under 360 px only, and only when that makes the title whole, the pair folds into one 40 px "Text
// size" button that opens the same two buttons just below it (the fallback the brief allows at 320).
import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test';
import { getCsrfToken } from '../helpers';

const WIDTHS = [320, 360, 390, 414];
const MIN_TAP = 40;

let seq = 0;
const made: string[] = [];

test.afterEach(async ({ page, context }) => {
  // This browser remembers the text size: back to the default for the next test.
  await page.evaluate(() => localStorage.setItem('hops_text_size', 'medium')).catch(() => {});
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

/** A one-tab dashboard called `name` with a few tiles of each size (the phone stacks them). */
async function phoneDash(page: Page, context: BrowserContext, name: string, header?: Record<string, unknown>) {
  const p = `pts${Date.now().toString(36)}${(seq++).toString(36)}`;
  const tile = (id: string, label: string, size: string, x: number, s: number) => ({
    kind: 'tile', id: `${p}-${id}`, name: label, url: `http://${id}.test`, icon: 'mdi:home', description: 'A description',
    openMode: 'newtab', size, order: 0, placement: { x, y: 0, w: s, h: s }
  });
  const dash = {
    id: `${p}-dash`, name, order: 0, path: `/${p}`, revision: 1, ...(header ? { header } : {}),
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{ id: `${p}-tab`, name: 'Main', order: 0, root: { columns: 24, children: [
      tile('a', 'Router', 'medium', 0, 2), tile('b', 'NAS', 'small', 2, 1), tile('c', 'Printer', 'large', 3, 4)
    ] } }]
  };
  const doc = { format: 'hops-export', schemaVersion: 3, exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'pts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(dash.id);
  return { path: dash.path };
}

async function anonPage(browser: Browser): Promise<{ page: Page; ctx: BrowserContext }> {
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }
  });
  return { page: await ctx.newPage(), ctx };
}

const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
type Box = { left: number; right: number; top: number; bottom: number };
const overlaps = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

const more = (page: Page) => page.locator('.navbar').getByRole('button', { name: 'Text size', exact: true });
const down = (page: Page) => page.locator('.navbar').getByRole('button', { name: 'Decrease text size' });
const up = (page: Page) => page.locator('.navbar').getByRole('button', { name: 'Increase text size' });

/**
 * The phone bar holds with the text-size buttons in it: both show, each a tap target of at least 40 px
 * that a tap at its centre reaches (nothing covers it); every other bar control is 40 px too; nothing
 * overlaps (each text-size button on its own, the logo, version, status dot, title and every other
 * control) or leaves the screen; no sideways scroll; the title whole and centred, or else as near the
 * centre as the wider side allows.
 */
async function phoneBarHolds(page: Page, label: string, o: { whole: boolean } = { whole: true }) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    { message: `${label}: no sideways scroll`, timeout: 2000 }).toBeLessThanOrEqual(0);
  await settle(page);
  await reveal(page, label);
  for (const [name, b] of [['Decrease text size', down(page)], ['Increase text size', up(page)]] as const) {
    await expect(b, `${label}: ${name} shows`).toBeVisible();
    // Tappable: a real tap at its centre lands on it (trial: checks actionability without pressing). At
    // the end of the range one is disabled; the hit test below still checks nothing covers it.
    if (await b.isEnabled()) await b.click({ trial: true, timeout: 3000 });
  }
  const r = await page.evaluate(() => {
    const view = document.documentElement.clientWidth;
    const shown = (e: Element) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const box = (e: Element) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width, h: b.height }; };
    const name = (e: Element) => `${e.getAttribute('aria-label') ?? e.className} ${(e.getAttribute('aria-label') ? '' : (e.textContent ?? '').trim())}`.trim().slice(0, 60);
    // The pieces: the logo, version, status dot, title, every right-hand control — and the two text-size
    // buttons each on their own (not just their group).
    const els = [...document.querySelectorAll(
      '.navbar .logo img, .navbar .version, .navbar .backend-dot-btn, .navbar .custom-text, .navbar .center-title, .navbar .switcher-compact, .navbar .nav-right > :not(.text-size), .navbar .text-size-more, .navbar .text-size-btn'
    )].filter(shown);
    // Tap targets: the right-hand controls (buttons and links), the text-size buttons and the title's switcher.
    const taps = [...document.querySelectorAll('.navbar .nav-right > button, .navbar .nav-right > a, .navbar .text-size-more, .navbar .text-size-btn, .navbar .switcher-btn')].filter(shown);
    // Each tap target's centre hits that target (not something drawn over it).
    const covered = taps.filter((e) => {
      const b = e.getBoundingClientRect();
      const hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
      return !(hit && (hit === e || e.contains(hit)));
    }).map(name);
    const bar = document.querySelector('.navbar .nav-content') as HTMLElement;
    const bs = getComputedStyle(bar);
    const bb = bar.getBoundingClientRect();
    const title = document.querySelector('.navbar .center-title');
    const text = title?.querySelector('.title-text') as HTMLElement | null;
    const sides = (['.navbar .nav-left', '.navbar .nav-right'] as const).map((sel) => document.querySelector(sel)!.getBoundingClientRect());
    return {
      view, sideways: document.documentElement.scrollWidth - view,
      gap: parseFloat(bs.columnGap) || 0,
      leftSide: { right: sides[0].right, width: sides[0].width },
      rightSide: { left: sides[1].left, width: sides[1].width },
      barMid: (bb.left + parseFloat(bs.paddingLeft) + bb.right - parseFloat(bs.paddingRight)) / 2,
      title: title && shown(title) ? box(title) : null,
      titleCut: text ? text.scrollWidth > text.clientWidth + 0.5 : null,
      pieces: els.map((e) => ({ n: name(e), ...box(e) })),
      taps: taps.map((e) => ({ n: name(e), ...box(e) })),
      covered
    };
  });
  expect(r.sideways, `${label}: no sideways scroll`).toBeLessThanOrEqual(0);
  expect(r.taps.filter((t) => t.n.includes('text size')).length, `${label}: both text-size buttons`).toBe(2);
  for (const t of r.taps) {
    expect(Math.min(t.w, t.h), `${label}: ${t.n} is a ${MIN_TAP} px tap target (${t.w.toFixed(1)} x ${t.h.toFixed(1)})`)
      .toBeGreaterThanOrEqual(MIN_TAP - 0.01);
  }
  expect(r.covered, `${label}: every control's centre reaches it`).toEqual([]);
  for (let i = 0; i < r.pieces.length; i++) {
    const a = r.pieces[i];
    expect(a.left, `${label}: ${a.n} on screen`).toBeGreaterThanOrEqual(-0.5);
    expect(a.right, `${label}: ${a.n} on screen`).toBeLessThanOrEqual(r.view + 0.5);
    for (let j = i + 1; j < r.pieces.length; j++) {
      const b = r.pieces[j];
      expect(overlaps(a, b), `${label}: ${a.n} / ${b.n} overlap`).toBe(false);
    }
  }
  if (r.title) {
    if (o.whole) expect(r.titleCut, `${label}: the title is whole`).toBe(false);
    const mid = (r.title.left + r.title.right) / 2;
    const off = Math.abs(mid - r.barMid);
    if (off > 1) {
      // Not centrable here: off towards the narrower side, right up against the wider one.
      const rightWider = r.rightSide.width > r.leftSide.width;
      expect(mid < r.barMid, `${label}: off centre only away from the wider side`).toBe(rightWider);
      const slack = rightWider ? r.rightSide.left - r.title.right : r.title.left - r.leftSide.right;
      expect(slack, `${label}: the title is as near the centre as the wider side allows`).toBeLessThanOrEqual(r.gap + 1);
    }
  }
}

/**
 * Make sure both text-size buttons show: in the bar, or — folded, under 360 px only — by opening the
 * "Text size" button (itself a 40 px tap target), which shows them just below it.
 */
async function reveal(page: Page, label: string) {
  const view = await page.evaluate(() => document.documentElement.clientWidth);
  if (!(await more(page).isVisible())) return;
  expect(view, `${label}: the text-size buttons fold only under 360 px`).toBeLessThan(360);
  const mb = (await more(page).boundingBox())!;
  expect(Math.min(mb.width, mb.height), `${label}: "Text size" is a ${MIN_TAP} px tap target`).toBeGreaterThanOrEqual(MIN_TAP - 0.01);
  if ((await more(page).getAttribute('aria-expanded')) !== 'true') await more(page).click();
  await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(down(page), `${label}: folded, A- shows once opened`).toBeVisible();
  await expect(up(page), `${label}: folded, A+ shows once opened`).toBeVisible();
}

/** The stacked layout's tile text sizes (px), Medium, Small and Large tile names. */
async function tileText(page: Page) {
  return page.evaluate(() => {
    const stacked = document.querySelector('.tab-canvas .container-stacked');
    const px = (n: string) => {
      const el = [...document.querySelectorAll('.tab-canvas .entry .title')].find((e) => e.textContent?.trim() === n);
      return el ? parseFloat(getComputedStyle(el).fontSize) : NaN;
    };
    return { stacked: !!stacked, medium: px('Router'), small: px('NAS'), large: px('Printer') };
  });
}

/** A+ grows the stacked layout's tile text and A- shrinks it (and the bar still holds at each size). */
async function buttonsWork(page: Page, label: string, o: { whole: boolean }) {
  const base = await tileText(page);
  expect(base.stacked, `${label}: the phone (stacked) layout`).toBe(true);
  for (const k of ['medium', 'small', 'large'] as const) expect(base[k], `${label}: ${k} tile text`).toBeGreaterThan(0);
  await reveal(page, label);
  await up(page).click();
  await expect.poll(async () => (await tileText(page)).medium, { message: `${label}: A+ grows the tile text` }).toBeGreaterThan(base.medium);
  const bigger = await tileText(page);
  expect(bigger.small, `${label}: A+ grows Small tile text`).toBeGreaterThan(base.small);
  expect(bigger.large, `${label}: A+ grows Large tile text`).toBeGreaterThan(base.large);
  await phoneBarHolds(page, `${label}, one size up`, o);
  await reveal(page, label);
  await down(page).click();
  await expect.poll(async () => (await tileText(page)).medium, { message: `${label}: A- back` }).toBe(base.medium);
  await reveal(page, label);
  await down(page).click();
  await expect.poll(async () => (await tileText(page)).medium, { message: `${label}: A- shrinks the tile text` }).toBeLessThan(base.medium);
  const smaller = await tileText(page);
  expect(smaller.small, `${label}: A- shrinks Small tile text`).toBeLessThan(base.small);
  expect(smaller.large, `${label}: A- shrinks Large tile text`).toBeLessThan(base.large);
  await phoneBarHolds(page, `${label}, one size down`, o);
  await reveal(page, label);
  await up(page).click();
  await expect.poll(async () => (await tileText(page)).medium, { message: `${label}: back to the start` }).toBe(base.medium);
}

async function enterEdit(page: Page) {
  // Phones hide the pencil: start editing wide, then narrow.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Enter Edit Mode' }).click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
}

test.describe('M6: the text-size buttons on phones', () => {
  // A short title stays whole at every phone width; a longer one ("v3 Showcase") has room to be whole
  // at 414 (below that it shortens with an ellipsis, never overlapping anything).
  for (const [title, wholeFrom] of [['Home', 0], ['v3 Showcase', 414]] as const) {
    test(`"${title}": at 320, 360, 390 and 414, signed in (view and edit) and signed out: both buttons show, 40 px tap targets, no overlap, and A+/A- change the stacked tiles' text`, async ({ page, context, browser }) => {
      test.setTimeout(180_000);
      const d = await phoneDash(page, context, title);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(d.path);
      await expect(page.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
      for (const editing of [false, true]) {
        if (editing) await enterEdit(page);
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 800 });
          const label = `"${title}", signed in, ${editing ? 'edit' : 'view'} at ${width}`;
          const o = { whole: width >= wholeFrom };
          await phoneBarHolds(page, label, o);
          await buttonsWork(page, label, o);
          if (width >= 360) await expect(more(page), `${label}: not folded from 360 px up`).toBeHidden();
        }
      }
      const { page: anon, ctx } = await anonPage(browser);
      try {
        for (const width of WIDTHS) {
          await anon.setViewportSize({ width, height: 800 });
          if (width === WIDTHS[0]) {
            await anon.goto(d.path);
            await expect(anon.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
          }
          const label = `"${title}", signed out at ${width}`;
          const o = { whole: width >= wholeFrom };
          await phoneBarHolds(anon, label, o);
          await buttonsWork(anon, label, o);
          if (width >= 360) await expect(more(anon), `${label}: not folded from 360 px up`).toBeHidden();
        }
      } finally {
        await ctx.close();
      }
    });
  }

  test('at the largest and smallest text sizes, 320–414, signed in view and edit: the bar still holds and both buttons stay', async ({ page, context }) => {
    test.setTimeout(180_000);
    const d = await phoneDash(page, context, 'Home');
    await page.setViewportSize({ width: 414, height: 800 });
    await page.goto(d.path);
    await expect(page.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
    const rootPx = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    for (const editing of [false, true]) {
      if (editing) await enterEdit(page);
      for (const size of ['20px', '14px']) {
        await page.setViewportSize({ width: 414, height: 800 });
        while ((await rootPx()) !== size) await (size === '20px' ? up(page) : down(page)).click();
        await expect(size === '20px' ? up(page) : down(page), `${size}: at the end of the range`).toBeDisabled();
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 800 });
          await phoneBarHolds(page, `text ${size}, ${editing ? 'edit' : 'view'} at ${width}`);
        }
      }
    }
  });
  test('folded at 320 (a title that only fits whole that way): the "Text size" button opens the pair below it; a press keeps it open; Escape or a press outside closes it; wider, it unfolds', async ({ page, context }) => {
    const d = await phoneDash(page, context, 'Home');
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(d.path);
    await expect(page.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
    await expect(more(page), 'folded at 320 with "Home ▾"').toBeVisible();
    await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(down(page)).toBeHidden();
    await expect(up(page)).toBeHidden();
    await more(page).click();
    await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
    await phoneBarHolds(page, 'folded at 320, open');
    // The pair hangs below the bar, on screen.
    const bar = (await page.locator('.navbar').boundingBox())!;
    for (const b of [down(page), up(page)]) expect((await b.boundingBox())!.y, 'below the bar').toBeGreaterThanOrEqual(bar.y + bar.height - 0.5);
    await up(page).click();
    await expect(more(page), 'a press keeps it open').toHaveAttribute('aria-expanded', 'true');
    await down(page).click();
    await expect(up(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(more(page), 'Escape returns focus to it').toBeFocused();
    await expect(up(page)).toBeHidden();
    await more(page).click();
    await expect(up(page)).toBeVisible();
    await page.locator('.tab-canvas').click({ position: { x: 5, y: 5 } });
    await expect(more(page), 'a press outside closes it').toHaveAttribute('aria-expanded', 'false');
    await expect(up(page)).toBeHidden();
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(more(page), 'unfolded at 360').toBeHidden();
    await expect(up(page)).toBeVisible();
    await expect(down(page)).toBeVisible();
  });
  test('the title hidden (Ruling 20): signed in, the compact switcher and both text-size buttons fit at 320–414, view and edit', async ({ page, context }) => {
    test.setTimeout(120_000);
    const d = await phoneDash(page, context, 'No title here', { showLeft: true, showCenter: false });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(d.path);
    await expect(page.locator('.tab-canvas [data-node-id]').first()).toBeVisible();
    const compact = page.locator('.navbar').getByRole('button', { name: 'Dashboards — switch dashboard', exact: true });
    for (const editing of [false, true]) {
      if (editing) await enterEdit(page);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        const label = `title hidden, ${editing ? 'edit' : 'view'} at ${width}`;
        await phoneBarHolds(page, label);
        await expect(compact, `${label}: the compact switcher`).toBeVisible();
        await compact.click({ trial: true, timeout: 3000 });
        await buttonsWork(page, label, { whole: true });
      }
    }
  });
});
