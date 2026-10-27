import { test, expect, type Page } from '@playwright/test';
import { getCsrfToken, startScan } from '../helpers';

// Discovery's sub-menu under "Discovery" in the Settings sidebar (same look as Global settings'
// group list; phones: a chip row on the page), full-width Settings prose, and the detector
// honesty note on the Scan page and the Manage detectors list. Real browser: layout needs Chromium.

const ITEMS = [
  { label: 'Scan', href: '/settings/discovery' },
  { label: 'Diagnostics', href: '/settings/discovery/diagnostics' },
  { label: 'Manage detectors', href: '/settings/discovery/detectors' },
];

const subList = (p: Page) => p.getByRole('list', { name: 'Discovery pages' });
const chips = (p: Page) => p.getByRole('navigation', { name: 'Discovery pages' });

let scanId = '';
async function ensureScan(page: Page): Promise<string> {
  if (scanId) return scanId;
  await page.goto('/settings/discovery');
    scanId = await startScan(page);
  return scanId;
}

test.describe('Discovery sub-menu (desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  const PAGES = [
    { path: '/settings/discovery', current: 'Scan' },
    { path: '/settings/discovery/diagnostics', current: 'Diagnostics' },
    { path: '/settings/discovery/detectors', current: 'Manage detectors' },
    { path: '/settings/discovery/new', current: 'Scan' },
    { path: '/settings/discovery/SCAN', current: 'Scan' },
  ];

  for (const pg of PAGES) {
    test(`${pg.path}: the sub-menu lists the three pages, ${pg.current} highlighted`, async ({ page }) => {
      const path = pg.path.replace('SCAN', await ensureScan(page));
      await page.goto(path);
      const list = subList(page);
      await expect(list).toBeVisible({ timeout: 10_000 });
      await expect(list.getByRole('link')).toHaveText(ITEMS.map((i) => i.label));
      for (const i of ITEMS) await expect(list.getByRole('link', { name: i.label, exact: true })).toHaveAttribute('href', i.href);
      await expect(list.locator('[aria-current="location"]')).toHaveCount(1);
      await expect(list.getByRole('link', { name: pg.current, exact: true })).toHaveAttribute('aria-current', 'location');
      // It sits under the Discovery item, which is the current section.
      const side = page.getByRole('navigation', { name: 'Settings sections' });
      await expect(list.locator('xpath=ancestor::li[1]').locator('> a.side-item')).toHaveText('Discovery');
      await expect(side.getByRole('link', { name: 'Discovery', exact: true })).toHaveAttribute('aria-current', 'page');
      // The phone chip row is not shown on a desktop.
      await expect(chips(page)).toBeHidden();
    });
  }

  test('not shown on other settings pages', async ({ page }) => {
    for (const p of ['/settings/dashboards', '/settings/global', '/settings/backups']) {
      await page.goto(p);
      await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
      await expect(subList(page)).toHaveCount(0);
    }
  });

  test('each item navigates, and the highlight follows', async ({ page }) => {
    await page.goto('/settings/discovery');
    for (const i of [ITEMS[1], ITEMS[2], ITEMS[0]]) {
      await subList(page).getByRole('link', { name: i.label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${i.href}$`));
      await expect(subList(page).getByRole('link', { name: i.label, exact: true })).toHaveAttribute('aria-current', 'location');
    }
  });

  test('looks like the Global settings group list (same classes and styling)', async ({ page }) => {
    await page.goto('/settings/discovery');
    await expect(subList(page)).toBeVisible();
    const disc = await page.evaluate(() => {
      const ul = document.querySelector('ul[aria-label="Discovery pages"]')!;
      const a = ul.querySelector('a')!;
      const u = getComputedStyle(ul), s = getComputedStyle(a);
      return { ulClass: ul.className, aClass: a.className, margin: u.marginLeft, border: u.borderLeftWidth, fs: s.fontSize, pad: s.padding };
    });
    await page.goto('/settings/global');
    await expect(page.getByRole('list', { name: 'Global settings groups' })).toBeVisible();
    const glob = await page.evaluate(() => {
      const ul = document.querySelector('ul[aria-label="Global settings groups"]')!;
      const a = ul.querySelector('a')!;
      const u = getComputedStyle(ul), s = getComputedStyle(a);
      return { ulClass: ul.className, aClass: a.className, margin: u.marginLeft, border: u.borderLeftWidth, fs: s.fontSize, pad: s.padding };
    });
    expect(disc.ulClass).toContain('sub-list');
    expect(disc.aClass).toContain('sub-item');
    expect({ ...disc, ulClass: '', aClass: '' }).toEqual({ ...glob, ulClass: '', aClass: '' });
  });
});

test.describe('Discovery sub-menu (phone, 390)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
  });

  test('the sidebar list is hidden; a chip row on the page does the job', async ({ page }) => {
    await page.goto('/settings/discovery/diagnostics');
    const row = chips(page);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(subList(page)).toBeHidden();
    await expect(row.getByRole('link')).toHaveText(ITEMS.map((i) => i.label));
    await expect(row.locator('[aria-current="location"]')).toHaveCount(1);
    await expect(row.getByRole('link', { name: 'Diagnostics', exact: true })).toHaveAttribute('aria-current', 'location');
    // The top section menu still shows Discovery as current.
    await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Discovery', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('chips navigate', async ({ page }) => {
    await page.goto('/settings/discovery');
    await expect(chips(page)).toBeVisible({ timeout: 10_000 });
    await chips(page).getByRole('link', { name: 'Manage detectors', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/discovery\/detectors$/);
    await expect(chips(page).getByRole('link', { name: 'Manage detectors', exact: true })).toHaveAttribute('aria-current', 'location');
    await chips(page).getByRole('link', { name: 'Scan', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/discovery$/);
  });

  test('no chip row on other settings pages', async ({ page }) => {
    await page.goto('/settings/backups');
    await expect(page.getByRole('heading', { name: 'Backups', level: 2 })).toBeVisible();
    await expect(chips(page)).toHaveCount(0);
  });
});

test.describe('Settings prose uses the full width', () => {
  test('diagnostics intro paragraph spans > 60% of the content width at 1920', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto('/settings/discovery/diagnostics');
    const intro = page.locator('p.lede').first();
    await expect(intro).toBeVisible({ timeout: 10_000 });
    const r = await page.evaluate(() => {
      const main = document.querySelector('.settings-main') as HTMLElement;
      const cs = getComputedStyle(main);
      const area = main.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { area, w: document.querySelector('p.lede')!.getBoundingClientRect().width };
    });
    expect(r.w / r.area, `${r.w} of ${r.area}`).toBeGreaterThan(0.6);
  });
});

test.describe('Detector honesty note', () => {
  const NOTE = 'Not every detector has been tested against a real installation.';
  for (const path of ['/settings/discovery', '/settings/discovery/detectors']) {
    test(`${path}: the note and its link`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(path);
      const note = page.locator('.lede-aside', { hasText: NOTE });
      await expect(note).toBeVisible({ timeout: 10_000 });
      await expect(note).toContainText("HOPS recognises many services, but we don't run every one of them ourselves.");
      await expect(note).toContainText("include the service's name and version, and if you can, the page title it shows.");
      await expect(note.locator('b')).toHaveText(NOTE);
      const link = note.getByRole('link', { name: 'raise an issue on GitHub' });
      await expect(link).toHaveAttribute('href', 'https://github.com/weaversgrainthorpe/HOPS/issues');
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  }
});

// The detectors page states the real number of bundled detectors (it was a hard-coded "~70" that went
// stale when the list grew), matching the "Bundled (N)" filter count.
test('the detectors intro states the live bundled-detector count', async ({ page }) => {
  await page.goto('/settings/discovery/detectors');
  const bundled = page.getByRole('button', { name: /^Bundled \(\d+\)$/ });
  await expect(bundled).toBeVisible();
  const n = Number((await bundled.textContent())!.match(/\((\d+)\)/)![1]);
  expect(n).toBeGreaterThan(80);
  await expect(page.locator('p.lede')).toContainText(`detectors for ${n} common homelab services`);
});
