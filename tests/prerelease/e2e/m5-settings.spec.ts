import { test, expect, type Page, type Browser, type BrowserContext } from '@playwright/test';
import { signInDialog } from '../helpers';

// M5 §9 (design/specs/2026-10-22-hops-v3-m5-folders-design.md): Settings is a sidebar of sections,
// each its own page with its own address; the content uses the width; the sidebar meets WCAG AA;
// on phones the sidebar is a section menu at the top. In a REAL browser: history, layout and
// computed colours need Chromium.

const PAGES = [
  { label: 'Dashboards', path: '/settings/dashboards', heading: 'Dashboards' },
  { label: 'Global settings', path: '/settings/global', heading: 'Global settings' },
  { label: 'Backups', path: '/settings/backups', heading: 'Backups' },
  { label: 'Password', path: '/settings/password', heading: 'Password' },
  { label: 'Factory reset', path: '/settings/reset', heading: 'Factory reset' },
];
const ALL_ITEMS = ['Dashboards', 'Global settings', 'Discovery', 'Backups', 'Logs', 'Password', 'Factory reset', 'Log out'];

const sidebar = (p: Page) => p.getByRole('navigation', { name: 'Settings sections' });
const urlOf = (path: string) => new RegExp(`${path.replace(/\//g, '\\/')}$`);

async function expectOn(p: Page, pg: (typeof PAGES)[number]) {
  await expect(p).toHaveURL(urlOf(pg.path));
  await expect(p.getByRole('heading', { name: pg.heading, level: 2, exact: true })).toBeVisible();
  // Exactly one current item, and it is this page's.
  await expect(sidebar(p).locator('[aria-current="page"]')).toHaveCount(1);
  await expect(sidebar(p).getByRole('link', { name: pg.label, exact: true })).toHaveAttribute('aria-current', 'page');
}

async function anonPage(browser: Browser): Promise<{ page: Page; ctx: BrowserContext }> {
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }
  });
  return { page: await ctx.newPage(), ctx };
}

test.describe('M5 §9 settings: sidebar and separate pages', () => {
  test('/settings opens Dashboards; each sidebar item opens its own address; Back/Forward and bookmarks work', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/settings');
    await expectOn(page, PAGES[0]);
    await expect(sidebar(page).locator('a, button')).toHaveText(ALL_ITEMS);

    // Forward through every section by the sidebar.
    for (const pg of PAGES.slice(1)) {
      await sidebar(page).getByRole('link', { name: pg.label, exact: true }).click();
      await expectOn(page, pg);
    }
    // Discovery is a section too (M5 §11), at /settings/discovery, highlighted like the others.
    await sidebar(page).getByRole('link', { name: 'Discovery', exact: true }).click();
    await expectOn(page, { label: 'Discovery', path: '/settings/discovery', heading: 'Discovery' });

    // Back walks the same pages in reverse, each with its highlight; /settings itself is not in
    // the history (it redirected), so Back from Dashboards leaves Settings.
    for (const pg of [...PAGES].reverse()) {
      await page.goBack();
      await expectOn(page, pg);
    }
    // Forward again.
    for (const pg of PAGES.slice(1)) {
      await page.goForward();
      await expectOn(page, pg);
    }

    // Bookmarks: a fresh load of each address opens that page.
    for (const pg of PAGES) {
      await page.goto(pg.path);
      await expectOn(page, pg);
    }
  });

  for (const width of [1280, 1920]) {
    test(`at ${width}px the content uses the width beside the sidebar (no centred narrow column)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/settings/global');
      await expect(page.locator('.row').first()).toBeVisible();
      const m = await page.evaluate(() => {
        const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const side = document.querySelector('nav[aria-label="Settings sections"]')!.closest('aside')!.getBoundingClientRect();
        return {
          view: window.innerWidth, doc: document.documentElement.scrollWidth,
          sideLeft: side.left, sideRight: side.right,
          content: { left: r('.settings-content').left, width: r('.settings-content').width },
          row: { left: r('.row').left, width: r('.row').width },
        };
      });
      expect(m.doc, 'no sideways scroll').toBeLessThanOrEqual(m.view);
      expect(m.sideLeft, 'the sidebar sits at the left edge').toBeLessThanOrEqual(1);
      // The content starts right beside the sidebar: no big empty margin between them.
      expect(m.content.left - m.sideRight, 'gap between the sidebar and the content').toBeLessThanOrEqual(48);
      // And it is as wide as the space allows. M6 §7.8 superseded the old ~1100px cap: the content
      // uses the FULL width beside the sidebar (paragraphs keep their own 75ch measure).
      const room = m.view - m.sideRight - 2 * 32;
      expect(m.content.width, `content width at ${width}px`).toBeGreaterThanOrEqual(room - 2);
      expect(m.content.width).toBeLessThanOrEqual(room + 0.5);
      // The setting rows really use it (not a narrow column inside a wide box).
      expect(m.row.width, 'a setting row fills the content width').toBeGreaterThanOrEqual(m.content.width - 2);
    });
  }

  test('sidebar contrast (computed colours): every item, the current item, hover and keyboard focus meet WCAG AA', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/settings/backups');
    await expectOn(page, PAGES[2]);

    // Contrast from the browser's computed colours: the text colour against the first opaque
    // background behind it (semi-transparent layers are blended in), per WCAG 2.x relative luminance.
    const measure = (sel: string) => page.evaluate((selector) => {
      type RGBA = [number, number, number, number];
      const parse = (c: string): RGBA => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) throw new Error(`unparsed colour ${c}`);
        const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
      };
      const over = (top: RGBA, under: RGBA): RGBA => {
        const a = top[3] + under[3] * (1 - top[3]);
        if (a === 0) return [0, 0, 0, 0];
        return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a) as RGBA;
      };
      const background = (el: Element | null): RGBA => {
        const layers: RGBA[] = [];
        for (let e = el; e; e = e.parentElement) {
          const bg = parse(getComputedStyle(e).backgroundColor);
          if (bg[3] > 0) layers.push(bg);
          if (bg[3] >= 1) break;
        }
        let out: RGBA = [255, 255, 255, 1]; // the canvas
        for (const l of layers.reverse()) out = over(l, out);
        return out;
      };
      const lum = (c: RGBA) => {
        const ch = c.slice(0, 3).map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
      };
      const ratio = (a: RGBA, b: RGBA) => {
        const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (l1 + 0.05) / (l2 + 0.05);
      };
      return Array.from(document.querySelectorAll(selector)).map((el) => {
        const cs = getComputedStyle(el);
        const bg = background(el);
        const fg = over(parse(cs.color), bg);
        const outlineVisible = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
        const sideBg = background(el.closest('aside'));
        return {
          name: (el.textContent ?? '').trim(),
          text: ratio(fg, bg),
          bg: cs.backgroundColor,
          outline: outlineVisible ? ratio(over(parse(cs.outlineColor), sideBg), sideBg) : 0,
          outlineVsItem: outlineVisible ? ratio(over(parse(cs.outlineColor), bg), bg) : 0,
        };
      });
    }, sel);

    const items = await measure('nav[aria-label="Settings sections"] :is(a, button)');
    expect(items.map((i) => i.name)).toEqual(ALL_ITEMS);
    for (const i of items) expect(i.text, `${i.name}: text contrast`).toBeGreaterThanOrEqual(4.5);
    const [title] = await measure('aside h1');
    expect(title.text, 'the sidebar title').toBeGreaterThanOrEqual(4.5);

    // The current item is clearly highlighted: its own background, unlike every other item's.
    const current = items.find((i) => i.name === 'Backups')!;
    for (const i of items.filter((x) => x.name !== 'Backups')) {
      expect(i.bg, `${i.name} is not highlighted like the current item`).not.toBe(current.bg);
    }
    const [cur] = await measure('nav[aria-label="Settings sections"] [aria-current="page"]');
    expect(cur.text, 'current item text').toBeGreaterThanOrEqual(4.5);

    // Hover keeps AA.
    await sidebar(page).getByRole('link', { name: 'Password', exact: true }).hover();
    const hovered = (await measure('nav[aria-label="Settings sections"] a:hover'))[0];
    expect(hovered.name).toBe('Password');
    expect(hovered.text, 'hovered item text').toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(900, 600);

    // Keyboard focus is visible: a ring (≥ 3:1 against the sidebar, WCAG 1.4.11) on every item,
    // the current one included, and the focused item's text keeps AA.
    await sidebar(page).getByRole('link', { name: 'Dashboards', exact: true }).focus();
    for (const name of ALL_ITEMS) {
      if (name !== 'Dashboards') await page.keyboard.press('Tab');
      const [f] = await measure('nav[aria-label="Settings sections"] :is(a, button):focus-visible');
      expect(f?.name, `Tab reaches ${name}`).toBe(name);
      expect(f.outline, `${name}: focus ring vs the sidebar`).toBeGreaterThanOrEqual(3);
      expect(f.outlineVsItem, `${name}: focus ring vs its own background`).toBeGreaterThanOrEqual(3);
      expect(f.text, `${name}: focused text`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('phone (390px): the sidebar is a section menu at the top; it fits, and it navigates', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings/dashboards');
    await expectOn(page, PAGES[0]);
    const menu = sidebar(page);
    const menuBox = (await menu.boundingBox())!;
    const h2 = (await page.getByRole('heading', { name: 'Dashboards', level: 2 }).boundingBox())!;
    expect(menuBox.y + menuBox.height, 'the menu is above the page content').toBeLessThanOrEqual(h2.y);
    expect(h2.x, 'the content is not pushed aside by a sidebar').toBeLessThan(40);
    const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
    expect(w.doc, 'no sideways scroll').toBeLessThanOrEqual(w.view);
    const items = menu.locator('a, button');
    await expect(items).toHaveText(ALL_ITEMS);
    for (let i = 0; i < ALL_ITEMS.length; i++) {
      const b = (await items.nth(i).boundingBox())!;
      expect(b.x, `${ALL_ITEMS[i]}: left edge`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${ALL_ITEMS[i]}: right edge`).toBeLessThanOrEqual(w.view + 0.5);
      expect(b.height, `${ALL_ITEMS[i]}: a usable target`).toBeGreaterThanOrEqual(32);
    }
    await menu.getByRole('link', { name: 'Password', exact: true }).click();
    await expectOn(page, PAGES[3]);
    const after = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(after).toBeLessThanOrEqual(w.view);
  });

  test('logged out, a deep settings address asks for the password in place and then shows that page', async ({ browser }) => {
    const { page: anon, ctx } = await anonPage(browser);
    try {
      await anon.goto('/settings/backups');
      const dlg = anon.getByRole('dialog', { name: 'Sign in' });
      await expect(dlg).toBeVisible();
      await expect(dlg).toContainText('Sign in to open Settings.');
      await expect(anon).toHaveURL(/\/settings\/backups$/);
      // Nothing admin behind the dialog.
      await expect(sidebar(anon)).toHaveCount(0);
      await expect(anon.getByRole('button', { name: 'Open Backups' })).toHaveCount(0);
      await signInDialog(anon);
      await expectOn(anon, PAGES[2]);
      await expect(anon.getByRole('button', { name: 'Open Backups' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('Factory reset is only on its own page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const pg of PAGES) {
      await page.goto(pg.path);
      await expectOn(page, pg);
      if (pg.path === '/settings/global') await expect(page.locator('.row').first()).toBeVisible();
      const reset = page.getByRole('button', { name: /Factory Reset/i });
      if (pg.path === '/settings/reset') await expect(reset).toHaveCount(1);
      else await expect(reset, `no Factory Reset on ${pg.path}`).toHaveCount(0);
    }
  });
});
