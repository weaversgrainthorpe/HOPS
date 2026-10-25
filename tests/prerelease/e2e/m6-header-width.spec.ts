// Walkthrough: "on the header the left part has a lot of space to its left and the right part a lot of
// space on its right". The header's contents span the full width with the same 2rem gutter as the
// tab bar and canvas below, so on a wide screen the logo lines up with the tabs and the controls with
// the canvas's right edge.
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1920, height: 900 } });

test('header contents use the full width, aligned with the tab bar and canvas', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('.nav-content');
  await expect(nav).toBeVisible();
  const navBox = (await nav.boundingBox())!;
  expect(navBox.x).toBeLessThanOrEqual(1);
  expect(navBox.width).toBeGreaterThanOrEqual(1918);

  const firstLeft = await nav.evaluate((el) => (el.firstElementChild as HTMLElement).getBoundingClientRect().left);
  const right = page.locator('.nav-right');
  const rightEdge = await right.evaluate((el) => el.getBoundingClientRect().right);
  expect(firstLeft).toBeGreaterThanOrEqual(30);
  expect(firstLeft).toBeLessThanOrEqual(40);
  expect(1920 - rightEdge).toBeGreaterThanOrEqual(30);
  expect(1920 - rightEdge).toBeLessThanOrEqual(40);

  const tabs = page.locator('.dashboard-header');
  if (await tabs.count()) {
    const tabsLeft = await tabs.first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left + parseFloat(getComputedStyle(el).paddingLeft);
    });
    expect(Math.abs(firstLeft - tabsLeft)).toBeLessThanOrEqual(8);
  }
});
