import { test, expect, type Page, type Locator } from '@playwright/test';
import { setSetting } from '../helpers';

// Global settings is one long
// page in logical groups; the sidebar lists the groups under "Global settings" (phones: a chip row
// at the top of the page). A link scrolls its group's heading into view, highlights it, focuses
// the heading and puts its id in the address; a deep link works; scrolling moves the highlight.
// In a REAL browser: scrolling, IntersectionObserver and layout need Chromium.

const GROUPS = [
  { id: 'server', label: 'Server' },
  { id: 'sign-in-security', label: 'Sign-in & security' },
  { id: 'uploads', label: 'Uploads' },
  { id: 'editing', label: 'Editing' },
  { id: 'look-motion', label: 'Look & motion' },
  { id: 'status-checks', label: 'Status checks' },
  { id: 'discovery', label: 'Discovery' },
];

const subList = (p: Page) => p.getByRole('list', { name: 'Global settings groups' });
const chips = (p: Page) => p.getByRole('navigation', { name: 'Setting groups' });
const heading = (p: Page, label: string) => p.getByRole('heading', { name: label, level: 3, exact: true });

async function open(p: Page, path = '/settings/global') {
  await p.goto(path);
  await expect(heading(p, 'Server')).toBeVisible({ timeout: 10_000 });
}

/** The heading is in the window, below whatever covers the top (the navbar, phones' chip row). */
async function expectHeadingShown(p: Page, label: string) {
  const h = heading(p, label);
  await expect(h).toBeInViewport();
  await expect.poll(async () => {
    const covered = await p.evaluate(() => {
      let bottom = document.querySelector('nav.navbar')!.getBoundingClientRect().bottom;
      const row = document.querySelector('nav.group-chips');
      if (row && getComputedStyle(row).display !== 'none') bottom = Math.max(bottom, row.getBoundingClientRect().bottom);
      return bottom;
    });
    const box = await h.boundingBox();
    return box !== null && box.y >= covered - 1;
  }).toBe(true);
}

async function expectCurrent(links: Locator, label: string) {
  await expect(links.locator('[aria-current="location"]')).toHaveCount(1);
  await expect(links.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'location');
}

test.describe('global settings groups', () => {
  test('desktop: the sidebar lists the groups in order, only on Global settings', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    await expect(subList(page).getByRole('link')).toHaveText(GROUPS.map((g) => g.label));
    await expect(chips(page)).toBeHidden();
    // The headings on the page are in the same order (no "Other": every server key is placed).
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(GROUPS.map((g) => g.label));
    await expectCurrent(subList(page), 'Server');
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Backups', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Backups', level: 2 })).toBeVisible();
    await expect(subList(page)).toHaveCount(0);
  });

  test('desktop: every group link scrolls its heading into view, highlights it, focuses it and sets the hash', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    for (const g of [...GROUPS.slice(1), GROUPS[0], GROUPS[3]]) {
      await subList(page).getByRole('link', { name: g.label, exact: true }).click();
      await expectHeadingShown(page, g.label);
      await expectCurrent(subList(page), g.label);
      await expect(heading(page, g.label)).toBeFocused();
      await expect(page).toHaveURL(new RegExp(`/settings/global#${g.id}$`));
    }
  });

  test('reduced motion: a link jumps (no glide)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    await subList(page).getByRole('link', { name: 'Discovery', exact: true }).click();
    const first = await page.evaluate(() => window.scrollY);
    expect(first).toBeGreaterThan(0);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.scrollY)).toBe(first);
    await expectHeadingShown(page, 'Discovery');
  });

  test('a deep link with a hash opens at that group', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/settings/global#status-checks');
    await expect(heading(page, 'Status checks')).toBeVisible({ timeout: 10_000 });
    await expectHeadingShown(page, 'Status checks');
    await expectCurrent(subList(page), 'Status checks');
    await expect(heading(page, 'Status checks')).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test('scrolling moves the highlight to the group in view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    await expectCurrent(subList(page), 'Server');
    await page.mouse.move(800, 400);
    for (const g of [GROUPS[2], GROUPS[4]]) {
      // Wheel until the group's heading is near the top of the window.
      const y = (await heading(page, g.label).boundingBox())!.y;
      await page.mouse.wheel(0, y - 120);
      await expect.poll(async () => (await heading(page, g.label).boundingBox())!.y).toBeLessThan(200);
      await expectCurrent(subList(page), g.label);
    }
    // And back up to the top.
    await page.mouse.wheel(0, -100_000);
    await expectCurrent(subList(page), 'Server');
  });

  test('scrolling by hand to the bottom highlights the last group, and back up moves it off', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    await page.mouse.move(800, 400);
    await page.mouse.wheel(0, 100_000);
    await expect.poll(() => page.evaluate(() => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2)).toBe(true);
    await expectCurrent(subList(page), 'Discovery');
    // A little way back up, the highlight leaves the last group again.
    await page.mouse.wheel(0, -400);
    await expect(subList(page).getByRole('link', { name: 'Discovery', exact: true })).not.toHaveAttribute('aria-current', 'location');
  });

  test('phone (390): the groups are a chip row at the top of the page, and the chips work', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(chips(page)).toBeVisible();
    await expect(subList(page)).toBeHidden();
    await expect(chips(page).getByRole('link')).toHaveText(GROUPS.map((g) => g.label));
    // The chip row is above the first group, and the page never scrolls sideways.
    const rowBox = (await chips(page).boundingBox())!;
    expect(rowBox.y).toBeLessThan((await heading(page, 'Server').boundingBox())!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const g of [...GROUPS.slice(1), GROUPS[0]]) {
      const chip = chips(page).getByRole('link', { name: g.label, exact: true });
      await chip.click();
      await expectHeadingShown(page, g.label);
      await expectCurrent(chips(page), g.label);
      await expect(chip).toBeInViewport();
      await expect(page).toHaveURL(new RegExp(`#${g.id}$`));
    }
  });
});

// Every setting is still editable and saved from the page (the regrouping kept per-key Save).
interface Def { key: string; value: string; type: string; min?: number; max?: number; enum?: string[] }

test.describe('every global setting still saves', () => {
  const restore: Array<[string, string]> = [];
  test.afterEach(async ({ page }) => {
    while (restore.length) {
      const [k, v] = restore.pop()!;
      await setSetting(page, k, v);
    }
  });

  test('each setting can be changed and saved on the page', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const list: Def[] = (await (await page.request.get('/api/settings')).json()).settings;
    expect(list.length).toBeGreaterThan(0);
    await open(page);
    const MB = 1048576;
    for (const s of list) {
      const input = page.locator(`[id="setting-${s.key}"]`);
      const row = page.locator('.row', { has: input });
      await input.scrollIntoViewIfNeeded();
      let want: string;
      if (s.type === 'bool') {
        want = s.value === 'true' ? 'false' : 'true';
        await input.click();
      } else if (s.enum && s.enum.length) {
        want = s.enum.find((o) => o !== s.value)!;
        await input.selectOption(want);
      } else if (s.type === 'cidr_list') {
        want = JSON.stringify([...JSON.parse(s.value || '[]'), '10.99.0.0/16']);
        await input.fill('10.99.0.0/16');
        await row.getByRole('button', { name: 'Add' }).click();
      } else if (s.key === 'status.dead_after_hours') {
        // Set in hours or days, stored in hours: 2 days → 48.
        want = s.value === '48' ? '72' : '48';
        await input.fill(String(Number(want) / 24));
        await page.locator(`[data-unit-for="${s.key}"]`).selectOption('days');
      } else if (s.key === 'auth.session_idle_hours') {
        // 0 is "Off": the number box is disabled until a unit is chosen.
        want = s.value === '1' ? '2' : '1';
        await page.locator(`[data-unit-for="${s.key}"]`).selectOption('hours');
        await input.fill(want);
      } else if (s.type === 'bytes') {
        const mb = Number(s.value) / MB === 1 ? 2 : 1;
        want = String(mb * MB);
        await input.fill(String(mb));
      } else {
        const min = s.min ?? 0;
        want = String(Number(s.value) === min ? min + 1 : min);
        if (s.key === 'server.port') want = String(Number(s.value) === 18999 ? 18998 : 18999);
        await input.fill(want);
      }
      restore.push([s.key, s.value]);
      await row.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(row.getByRole('button', { name: 'Save', exact: true }), s.key).toBeDisabled();
      const after: Def[] = (await (await page.request.get('/api/settings')).json()).settings;
      expect(after.find((x) => x.key === s.key)!.value, s.key).toBe(want);
    }
  });
});
