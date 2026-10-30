// The "Backend: Online / version / ms" box is a small coloured dot in the header next to
// the logo. Green online, red offline; hover, focus or tap shows the version and round-trip time.
// The bottom-left box is gone; a failure is still visible (red dot + "Backend offline" name + Retry).
// The dot is >= 3:1 against the navbar on every preset, light and dark,
// and colour is never the only cue: a glyph inside it (tick online, ! degraded, cross offline) and
// the accessible name say the state.
import { test, expect, type Locator, type Page } from '@playwright/test';

const PRESETS = ['default', 'metallic', 'modern', 'subtle', 'cyberpunk', 'sunset', 'ocean', 'forest'];

/** Contrast of the dot's fill against the navbar, and of the glyph against the fill. */
async function dotContrast(dot: Locator) {
  return dot.evaluate((btn) => {
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const px = (css: string) => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#000';
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      return Array.from(probe.getImageData(0, 0, 1, 1).data);
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.slice(0, 3).map((x) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: number[], b: number[]) => {
      const x = lum(a), y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const fill = px(getComputedStyle(btn.querySelector('.backend-dot')!).backgroundColor);
    const glyph = btn.querySelector('.backend-dot svg');
    const nav = px(getComputedStyle(btn.closest('.navbar')!).backgroundColor);
    return {
      fillAlpha: fill[3],
      onNavbar: ratio(fill, nav),
      glyph: glyph ? ratio(px(getComputedStyle(glyph).color), fill) : 0
    };
  });
}

async function expectGlyph(page: Page, name: string, glyph: 'online' | 'degraded' | 'offline') {
  const dot = page.getByRole('button', { name });
  await expect(dot).toBeVisible();
  await expect(dot.locator(`.backend-dot svg[data-glyph="${glyph}"]`)).toBeVisible();
  const c = await dotContrast(dot);
  expect(c.fillAlpha).toBe(255);
  expect(c.onNavbar, `${name} dot on the navbar`).toBeGreaterThanOrEqual(3);
  expect(c.glyph, `${name} glyph on the dot`).toBeGreaterThanOrEqual(3);
  return dot;
}

test.describe('backend status dot', () => {
  test('green dot next to the logo, tooltip on hover with version and ms, no bottom box', async ({ page }) => {
    await page.goto('/settings');
    const dot = page.getByRole('button', { name: 'Backend online' });
    await expect(dot).toBeVisible();
    await expect(page.getByText('Backend: Online')).toHaveCount(0);
    await expectGlyph(page, 'Backend online', 'online');
    const logo = await page.locator('.navbar .logo').boundingBox();
    const d = await dot.boundingBox();
    expect(d!.x).toBeGreaterThan(logo!.x + logo!.width - 1);
    expect(d!.x - (logo!.x + logo!.width)).toBeLessThan(40);
    await dot.hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toContainText(/v\d+\.\d+\.\d+/);
    await expect(tip).toContainText(/\d+ ms/);
    await page.mouse.move(600, 400);
    await expect(tip).toHaveCount(0);
    await dot.focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('red dot and visible Retry when the backend is unreachable', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: 'Backend online' })).toBeVisible();
    await page.route('**/api/version', (r) => r.abort());
    await page.reload();
    const dot = await expectGlyph(page, 'Backend offline', 'offline');
    await dot.click();
    await expect(page.getByRole('tooltip')).toContainText(/unreachable/i);
    await page.unroute('**/api/version');
    await page.getByRole('tooltip').getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('button', { name: 'Backend online' })).toBeVisible();
  });

  test('reached but answering with an error: amber "!" dot named "Backend degraded", with Retry', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: 'Backend online' })).toBeVisible();
    await page.route('**/api/version', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
    await page.reload();
    const dot = await expectGlyph(page, 'Backend degraded', 'degraded');
    await dot.click();
    await expect(page.getByRole('tooltip')).toContainText(/answered with an error/i);
    await page.unroute('**/api/version');
    await page.getByRole('tooltip').getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('button', { name: 'Backend online' })).toBeVisible();
  });

  for (const mode of ['light', 'dark'] as const) {
    test(`${mode}: every preset's online, degraded and offline dot is >= 3:1 on the navbar`, async ({ page }) => {
      for (const preset of PRESETS) {
        await page.addInitScript(([t, p]) => {
          localStorage.setItem('hops_theme', t);
          localStorage.setItem('hops_theme_preset', p);
        }, [mode, preset]);
        for (const [route, name, glyph] of [
          [null, 'Backend online', 'online'],
          [500, 'Backend degraded', 'degraded'],
          ['abort', 'Backend offline', 'offline']
        ] as const) {
          await page.unroute('**/api/version');
          if (route === 500) await page.route('**/api/version', (r) => r.fulfill({ status: 500, body: '{}' }));
          if (route === 'abort') await page.route('**/api/version', (r) => r.abort());
          await page.goto('/settings');
          await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
          await test.step(`${preset} ${glyph}`, () => expectGlyph(page, name, glyph));
        }
      }
    });
  }

  for (const width of [375, 1280, 1920]) {
    test(`header at ${width}px: no horizontal scroll, dot visible, title not overlapped`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const res = await page.request.get('/api/config');
      const cfg = await res.json();
      const first = cfg.dashboards[0];
      await page.goto(first ? `/${first.path.replace(/^\//, '')}` : '/settings');
      const dot = page.getByRole('button', { name: 'Backend online' });
      await expect(dot).toBeVisible();
      await page.waitForTimeout(400);
      const scroll = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bar: (() => { const b = document.querySelector('.nav-content')!; return b.scrollWidth - b.clientWidth; })()
      }));
      expect(scroll.doc).toBeLessThanOrEqual(0);
      expect(scroll.bar).toBeLessThanOrEqual(0);
      const d = (await dot.boundingBox())!;
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x + d.width).toBeLessThanOrEqual(width);
      const title = page.locator('.center-title');
      if (await title.count()) {
        const t = (await title.boundingBox())!;
        expect(t.x).toBeGreaterThanOrEqual(d.x + d.width - 0.5);
        if (width >= 1280) {
          const bar = (await page.locator('.nav-content').boundingBox())!;
          expect(Math.abs(t.x + t.width / 2 - (bar.x + bar.width / 2))).toBeLessThanOrEqual(1.5);
        }
      }
    });
  }
});
