// M6 §7.12: the "Backend: Online / version / ms" box is a small coloured dot in the header next to
// the logo. Green online, red offline; hover, focus or tap shows the version and round-trip time.
// The bottom-left box is gone; a failure is still visible (red dot + "Backend offline" name + Retry).
import { test, expect } from '@playwright/test';

test.describe('backend status dot', () => {
  test('green dot next to the logo, tooltip on hover with version and ms, no bottom box', async ({ page }) => {
    await page.goto('/settings');
    const dot = page.getByRole('button', { name: 'Backend online' });
    await expect(dot).toBeVisible();
    await expect(page.getByText('Backend: Online')).toHaveCount(0);
    const bg = await dot.locator('.backend-dot').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(bg).toBe('rgb(34, 197, 94)');
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
    const dot = page.getByRole('button', { name: 'Backend offline' });
    await expect(dot).toBeVisible();
    const bg = await dot.locator('.backend-dot').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(bg).toBe('rgb(239, 68, 68)');
    await dot.click();
    await expect(page.getByRole('tooltip')).toContainText(/unreachable/i);
    await page.unroute('**/api/version');
    await page.getByRole('tooltip').getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('button', { name: 'Backend online' })).toBeVisible();
  });

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
