import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// The tab bar is one row at any tab count; the arrows appear only when the tabs don't fit, only
// scroll, and the open tab is always in view. Needs Chromium (real layout).

let seq = 0;
const made: string[] = [];

async function seed(page: Page, context: BrowserContext, tabCount: number) {
  const p = `rail${Date.now().toString(36)}${(seq++).toString(36)}`;
  const tabs = Array.from({ length: tabCount }, (_, i) => ({
    id: `${p}-t${i + 1}`, name: `Tab ${i + 1}`, order: i,
    root: {
      columns: 24,
      children: i === 44
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

  test('the page never scrolls sideways on a phone with 60 tabs', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const many = await seed(page, context, 60);
    await page.goto(many);
    await expect(rightArrow(page)).toBeVisible();
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw).toBeLessThanOrEqual(iw);
  });
});
