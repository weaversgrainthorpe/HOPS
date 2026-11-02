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

  test('dragging a tile: a tab at the end of the visible row opens when held, once, and the row still edge-scrolls', async ({ page, context }) => {
    const many = await seed(page, context, 60, undefined, 0);
    await page.goto(many);
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    const strip = page.locator('[data-drag-tabbar]');
    const stripBox = (await strip.boundingBox())!;
    const right = stripBox.x + stripBox.width;
    // The last tab that starts inside the row: it ends within reveal's margin of the row's end, or past it.
    const index = await strip.evaluate((el, end) => {
      const tabs = [...el.querySelectorAll<HTMLElement>('[data-tab-button]')];
      return tabs.findLastIndex((t) => t.getBoundingClientRect().left < end - 20) + 1;
    }, right);
    const edge = (await tab(page, index).boundingBox())!;
    expect(edge.x + edge.width, 'the tab is in the last 24 px of the row').toBeGreaterThan(right - 24);

    const item = page.locator(`[data-node-id$="-far"]`);
    const from = (await item.boundingBox())!;
    const x = edge.x + Math.min(10, (right - edge.x) / 2);
    const y = edge.y + edge.height / 2;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(from.x + from.width / 2 + ((x - from.x - from.width / 2) * i) / 10, from.y + from.height / 2 + ((y - from.y - from.height / 2) * i) / 10);
      await page.waitForTimeout(16);
    }
    await expect(tab(page, index)).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    const scrolled = await strip.evaluate((el) => el.scrollLeft);
    expect(scrolled, 'opening it scrolled the row').toBeGreaterThan(0);

    // Still held: another tab is under the pointer now, and it does not open by itself.
    await page.waitForTimeout(1_500);
    await expect(tab(page, index)).toHaveAttribute('aria-selected', 'true');
    expect(await strip.evaluate((el) => el.scrollLeft)).toBe(scrolled);

    // The rail's ends still edge-scroll.
    const r = (await rail(page).boundingBox())!;
    await page.mouse.move(r.x + r.width - 40, y, { steps: 3 });
    await page.mouse.move(r.x + r.width - 20, y, { steps: 3 });
    await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(scrolled + 100);
    await page.keyboard.press('Escape');
    await page.mouse.up();
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

  test('arrows have a 44px hit area and the row does not grow', async ({ page, context }) => {
    const few = await seed(page, context, 3);
    const many = await seed(page, context, 60);
    await page.goto(few);
    await expect(tab(page, 1)).toBeVisible();
    const hFew = (await page.locator('[data-dashboard-tabs]').boundingBox())!.height;
    await page.goto(many);
    await expect(rightArrow(page)).toBeVisible();
    const hMany = (await page.locator('[data-dashboard-tabs]').boundingBox())!.height;
    expect(Math.abs(hMany - hFew)).toBeLessThanOrEqual(1);
    const arrows = page.locator('[data-rail-arrow]');
    await expect(arrows).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const b = (await arrows.nth(i).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    expect((await rail(page).boundingBox())!.height).toBeLessThanOrEqual(hFew + 6);
  });

  test('the focus ring hugs the visible box, on a working arrow and on one at its end', async ({ page, context }) => {
    const many = await seed(page, context, 60);
    await page.goto(many);
    await expect(rightArrow(page)).toBeVisible();

    const ring = (arrow: ReturnType<Page['getByRole']>) =>
      arrow.evaluate((el) => {
        const btn = getComputedStyle(el);
        const box = getComputedStyle(el, '::before');
        const r = getComputedStyle(el, '::after');
        const inset = (s: CSSStyleDeclaration) => [s.top, s.right, s.bottom, s.left];
        return {
          buttonOutline: btn.outlineStyle,
          buttonOpacity: btn.opacity,
          ring: r.outlineStyle,
          reach: parseFloat(r.outlineWidth) + parseFloat(r.outlineOffset),
          ringWidth: parseFloat(r.outlineWidth),
          ringColor: r.outlineColor,
          sameBox: JSON.stringify(inset(r)) === JSON.stringify(inset(box)),
          accent: (() => {
            const probe = document.createElement('i');
            probe.style.color = 'var(--accent-solid)';
            document.body.append(probe);
            const c = getComputedStyle(probe).color;
            probe.remove();
            return c;
          })()
        };
      });
    const byKeyboard = async (arrow: ReturnType<Page['getByRole']>) => {
      await arrow.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(arrow).toBeFocused();
    };

    // The rail's own outlines are gone, so the only ring is the one on the visible box.
    const start = page.getByRole('button', { name: 'Scroll to the first tab' });
    await expect(start).toHaveAttribute('aria-disabled', 'true');
    for (const arrow of [rightArrow(page), start]) {
      await byKeyboard(arrow);
      const r = await ring(arrow);
      expect(r.buttonOutline).toBe('none');
      expect(r.ring).toBe('solid');
      expect(r.sameBox).toBe(true);
      expect(r.reach).toBeLessThanOrEqual(3);
      expect(r.ringWidth).toBe(2);
      expect(r.ringColor).toBe(r.accent);
      expect(r.buttonOpacity).toBe('1'); // nothing dims the ring, even on an arrow at its end
    }

    // Unfocused, an arrow at its end still looks disabled, with no ring on the hit area.
    await rightArrow(page).focus();
    const rest = await start.evaluate((el) => ({
      outline: getComputedStyle(el).outlineStyle,
      box: getComputedStyle(el, '::before').opacity,
      edge: getComputedStyle(el, '::before').borderTopStyle,
      ring: getComputedStyle(el, '::after').content
    }));
    expect(rest).toEqual({ outline: 'none', box: '0.3', edge: 'dashed', ring: 'none' });
  });

  test('light theme: no white line on a coloured open tab', async ({ page, context }) => {
    await page.addInitScript(() => localStorage.setItem('hops_theme', 'light'));
    const coloured = await seed(page, context, 3, '#7c3aed');
    await page.goto(coloured);
    await expect(tab(page, 1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const open = tab(page, 1);
    const colours = await open.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { top: cs.borderTopColor, left: cs.borderLeftColor, strip: getComputedStyle(el, '::after').backgroundColor };
    });
    const isWhite = (c: string) => {
      const m = c.match(/\d+(\.\d+)?/g)!.map(Number);
      return m[0] >= 247 && m[1] >= 247 && m[2] >= 247 && (m[3] ?? 1) > 0.5;
    };
    expect(isWhite(colours.top), `border-top ${colours.top}`).toBe(false);
    expect(isWhite(colours.left), `border-left ${colours.left}`).toBe(false);
    expect(isWhite(colours.strip), `top strip ${colours.strip}`).toBe(false);
    // And the pixels: 1px below the open tab's top edge, across its middle, none are white.
    // The clip is in viewport coordinates, so bring the tab into view first and check it is there.
    await open.scrollIntoViewIfNeeded();
    const box = (await open.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.y >= 0 && box.y + box.height <= vp.height && box.x >= 0 && box.x + box.width <= vp.width,
      `the open tab is inside the viewport (${JSON.stringify(box)})`).toBe(true);
    const png = await page.screenshot({ clip: { x: box.x + box.width / 4, y: box.y + 1, width: box.width / 2, height: 1 } });
    const px = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(0, 0, img.width, 1).data);
    }, png.toString('base64'));
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i] >= 247 && px[i + 1] >= 247 && px[i + 2] >= 247, `white pixel at ${i / 4}: ${px.slice(i, i + 3)}`).toBe(false);
    }
  });

  test('the tab row is one Tab stop', async ({ page, context }) => {
    const forty = await seed(page, context, 40);
    await page.goto(forty);
    await expect(tab(page, 1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-tab-button][tabindex="0"]')).toHaveCount(1);
    await expect(tab(page, 1)).toHaveAttribute('tabindex', '0');
    await expect(tab(page, 2)).toHaveAttribute('tabindex', '-1');
    const before = page.getByRole('button', { name: 'Scroll tabs left' });
    await before.focus(); // the arrow just before the row
    await page.keyboard.press('Tab');
    await expect(tab(page, 1)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-tab-button]:focus')).toHaveCount(0);
    // After moving along the row, Tab still leaves it at once, and the new open tab is the stop.
    await tab(page, 1).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 2)).toBeFocused();
    await expect(tab(page, 2)).toHaveAttribute('tabindex', '0');
    await expect(tab(page, 1)).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-tab-button]:focus')).toHaveCount(0);
  });

  test('Tab lands on an open tab that is scrolled off, and shows it (200 tabs)', async ({ page, context }) => {
    const many = await seed(page, context, 200);
    await page.goto(many);
    await expect(tab(page, 1)).toBeVisible();
    await page.locator('[data-dashboard-tabs]').evaluate((el) => (el.scrollLeft = 0));
    await tab(page, 1).focus();
    await page.keyboard.press('End');
    await expect(tab(page, 200)).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Scroll to the first tab' }).click();
    await expect(tab(page, 200)).not.toBeInViewport();
    await page.getByRole('button', { name: 'Scroll tabs left' }).focus();
    await page.keyboard.press('Tab');
    await expect(tab(page, 200)).toBeFocused();
    await expect(tab(page, 200)).toBeInViewport();
  });

  test('edit mode: the row is still one Tab stop, handle included', async ({ page, context }) => {
    const forty = await seed(page, context, 40);
    await page.goto(forty);
    await expect(tab(page, 1)).toBeVisible();
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    const handle = (n: number) => page.getByRole('button', { name: `Edit Tab ${n} tab` });
    await expect(page.locator('[data-tab-button][tabindex="0"]')).toHaveCount(1);
    await expect(page.locator('.tab-container [data-edit-handle][tabindex="0"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Scroll tabs left' }).focus();
    await page.keyboard.press('Tab');
    await expect(tab(page, 1)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(handle(1)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-tab-button]:focus, .tab-container [data-edit-handle]:focus')).toHaveCount(0);
    await tab(page, 1).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 2)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(handle(2)).toBeFocused();
  });
});
