import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// The tab bar is one row at any tab count; the arrows appear only when the tabs don't fit, only
// scroll, and the open tab is always in view. Needs Chromium (real layout).

let seq = 0;
const made: string[] = [];

async function seed(page: Page, context: BrowserContext, tabCount: number, firstColor?: string, tileTab = 44) {
  const p = `rail${Date.now().toString(36)}${(seq++).toString(36)}`;
  const tabs = Array.from({ length: tabCount }, (_, i) => ({
    id: `${p}-t${i + 1}`, name: `Tab ${i + 1}`, order: i,
    ...(i === 0 && firstColor ? { color: firstColor } : {}),
    root: {
      columns: 24,
      children: i === tileTab
        ? [{ id: `${p}-far`, kind: 'tile', type: 'link', name: 'Faraway', url: 'https://faraway.example.lan/', icon: 'mdi:lan', openMode: 'newtab', size: 'medium', order: 0, placement: { x: 0, y: 0, w: 2, h: 2 } }]
        : []
    }
  }));
  const dash = {
    id: `${p}-dash`, name: `Rail ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
    tabs
  };
  const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 's.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(dash.id);
  return `/${p}`;
}

test.afterEach(async ({ page, context }) => {
  while (made.length) {
    const id = made.pop()!;
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
    expect(typeof rev).toBe('number');
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, { headers: { 'X-CSRF-Token': await getCsrfToken(context) } });
    expect(r.ok()).toBeTruthy();
  }
});

const tab = (page: Page, n: number) => page.getByRole('tab', { name: `Switch to Tab ${n} tab` });
const rail = (page: Page) => page.locator('[data-drag-tabrail]');
const rightArrow = (page: Page) => page.getByRole('button', { name: 'Scroll tabs right' });

test.use({ viewport: { width: 1280, height: 800 } });

test.describe('one-row tab bar', () => {
  test('one row at any count: the bar is as tall with 60 tabs as with 3', async ({ page, context }) => {
    const few = await seed(page, context, 3);
    const many = await seed(page, context, 60);
    await page.goto(few);
    await expect(tab(page, 1)).toBeVisible();
    const h3 = (await rail(page).boundingBox())!.height;
    await page.goto(many);
    await expect(tab(page, 1)).toBeVisible();
    const h60 = (await rail(page).boundingBox())!.height;
    expect(Math.abs(h60 - h3)).toBeLessThanOrEqual(2);
  });

  test('arrows only when the tabs do not fit', async ({ page, context }) => {
    const few = await seed(page, context, 3);
    const many = await seed(page, context, 60);
    await page.goto(few);
    await expect(tab(page, 3)).toBeVisible();
    await expect(rightArrow(page)).toHaveCount(0);
    await page.goto(many);
    await expect(rightArrow(page)).toBeVisible();
  });

  test('the arrows only scroll: the open tab does not change', async ({ page, context }) => {
    const many = await seed(page, context, 60);
    await page.goto(many);
    await page.getByRole('button', { name: 'Scroll to the last tab' }).click();
    await expect(tab(page, 60)).toBeInViewport();
    await expect(tab(page, 1)).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 60)).toHaveAttribute('aria-selected', 'false');
  });

  for (const [label, size] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]] as const) {
    test(`a tab opened without clicking it is in view (${label})`, async ({ page, context }) => {
      await page.setViewportSize(size);
      const many = await seed(page, context, 60);
      await page.goto(many);
      await expect(tab(page, 1)).toBeVisible(); // the page is up before '/' is pressed
      await page.keyboard.press('/');
      const input = page.getByRole('textbox', { name: /search tiles/i });
      await expect(input).toBeVisible();
      await input.fill('Faraway');
      await expect(page.getByRole('button', { name: /Faraway/ })).toHaveCount(1);
      await input.press('Shift+Enter');
      await expect(tab(page, 45)).toHaveAttribute('aria-selected', 'true');
      await expect(tab(page, 45)).toBeInViewport();
    });
  }

  test('keyboard: End selects the last tab in view, ArrowLeft the one before', async ({ page, context }) => {
    const many = await seed(page, context, 60);
    await page.goto(many);
    await tab(page, 1).focus();
    await page.keyboard.press('End');
    await expect(tab(page, 60)).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 60)).toBeInViewport();
    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, 59)).toHaveAttribute('aria-selected', 'true');
  });

  test('keyboard: arrows at either end keep focus on the tab row (never jump to the tiles)', async ({ page, context }) => {
    // A tile on the last tab: the tiles' arrow navigation has something it could wrongly focus.
    const few = await seed(page, context, 3, undefined, 2);
    await page.goto(few);
    await tab(page, 3).click();
    await expect(page.getByText('Faraway', { exact: true }).first()).toBeVisible();
    await tab(page, 3).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 3)).toBeFocused();
    await expect(tab(page, 3)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, 2)).toBeFocused();
    await expect(tab(page, 2)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(tab(page, 1)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, 1)).toBeFocused();
    await expect(tab(page, 1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(tab(page, 3)).toBeFocused();
    await expect(tab(page, 3)).toHaveAttribute('aria-selected', 'true');
  });

  test('an arrow that reaches its end keeps keyboard focus', async ({ page, context }) => {
    const many = await seed(page, context, 60);
    await page.goto(many);
    const last = page.getByRole('button', { name: 'Scroll to the last tab' });
    await last.focus();
    await page.keyboard.press('Enter');
    await expect(last).toHaveAttribute('aria-disabled', 'true');
    await expect(last).toBeFocused();
    await expect(tab(page, 60)).toBeInViewport();
  });

  test('the page never scrolls sideways on a phone with 60 tabs', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const many = await seed(page, context, 60);
    await page.goto(many);
    await expect(rightArrow(page)).toBeVisible();
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw).toBeLessThanOrEqual(iw);
  });
  test('drag a tab past the visible part of the row', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const many = await seed(page, context, 60);
    const dashId = made.at(-1)!;
    await page.goto(many);
    await expect(tab(page, 1)).toBeVisible();
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    const strip = page.locator('[data-drag-tabbar]');
    await expect(strip).toHaveCount(1);
    const atEnd = () => strip.evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    expect(await atEnd()).toBe(false);

    // Grab Tab 2 and travel, in small steps as a person does, to 20 px inside the rail's right end.
    const from = (await tab(page, 2).boundingBox())!;
    const r = (await rail(page).boundingBox())!;
    const x0 = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    const x1 = r.x + r.width - 20;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / 20, y);
      await page.waitForTimeout(16);
    }
    // Held there, the row scrolls on by itself until its end: Tab 60 comes into view. 20 px inside
    // the end scrolls 12 px a frame; ~5000 px of hidden tabs take about 8-9 s, so allow 15 s.
    await expect.poll(atEnd, { timeout: 15_000 }).toBe(true);
    await expect(tab(page, 60)).toBeInViewport({ ratio: 1 });
    // Edge-scrolling never switched the open tab.
    await expect(tab(page, 1)).toHaveAttribute('aria-selected', 'true');

    const to = (await tab(page, 60).boundingBox())!;
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x1 + (to.x + to.width / 2 - x1) * (i / 10), y);
      await page.waitForTimeout(16);
    }
    await expect(page.locator('.drag-layer .reason')).toHaveCount(0);
    await page.mouse.up();

    const save = page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ });
    await expect(save).toBeEnabled();
    const saved = page.waitForResponse((res) => res.request().method() === 'PUT' && /\/api\/dashboards\//.test(res.url()));
    await save.click();
    const res = await saved;
    expect(res.status(), await res.text()).toBe(200);

    const cfg = await (await page.request.get('/api/config')).json();
    const d = cfg.dashboards.find((x: { id: string }) => x.id === dashId);
    // The saved tab order is the array's order.
    const names: string[] = d.tabs.map((t: { name: string }) => t.name);
    const at = names.indexOf('Tab 2');
    expect([58, 59]).toContain(at);
    expect(Math.abs(at - names.indexOf('Tab 60'))).toBe(1);
    // Every other tab keeps its order.
    const others = Array.from({ length: 60 }, (_, i) => `Tab ${i + 1}`).filter((n) => n !== 'Tab 2');
    expect(names.filter((n) => n !== 'Tab 2')).toEqual(others);
    expect(errors).toEqual([]);
  });

  test('the open tab stands out (style D)', async ({ page, context }) => {
    const plain = await seed(page, context, 3);
    await page.goto(plain);
    await expect(tab(page, 1)).toHaveAttribute('aria-selected', 'true');
    const open = tab(page, 1);
    const style = await open.evaluate((el) => ({
      weight: Number(getComputedStyle(el).fontWeight),
      topLine: getComputedStyle(el, '::after').height,
      glow: getComputedStyle(el).boxShadow
    }));
    expect(style.weight).toBeGreaterThanOrEqual(700);
    expect(style.topLine).toBe('4px');
    expect(style.glow).toContain('rgb');

    // A tab with its own colour keeps it: the open tab's fill is not the accent.
    const coloured = await seed(page, context, 3, '#7c3aed');
    await page.goto(coloured);
    await expect(tab(page, 1)).toHaveAttribute('aria-selected', 'true');
    const fill = await tab(page, 1).evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
    expect(fill).toBe('rgb(124, 58, 237)');
  });
});
