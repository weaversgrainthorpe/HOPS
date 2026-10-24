// Batch-fix round 2: text outside the dialogs on EVERY theme preset × light/dark — the settings
// section titles (large text, >= 3:1) and the navbar's active Edit toggle (white on the warning
// fill, >= 4.5:1).
import { test, expect, type Locator, type Page } from '@playwright/test';
import { getCsrfToken } from '../helpers';

const PRESETS = ['default', 'metallic', 'modern', 'subtle', 'cyberpunk', 'sunset', 'ocean', 'forest'];

/** The element's text colour against the opaque colour behind it. */
async function contrast(l: Locator) {
  return l.evaluate((el) => {
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
    let bg = [255, 255, 255, 255];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = px(getComputedStyle(e).backgroundColor);
      if (c[3] === 255) { bg = c; break; }
    }
    const fg = px(getComputedStyle(el).color);
    const x = lum(fg), y = lum(bg);
    return { ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05), fg: getComputedStyle(el).color, bg: `rgb(${bg.slice(0, 3)})` };
  });
}

async function usePreset(page: Page, mode: string, preset: string) {
  await page.addInitScript(([t, p]) => {
    localStorage.setItem('hops_theme', t);
    localStorage.setItem('hops_theme_preset', p);
  }, [mode, preset]);
}

let dashId = '';
let dashPath = '';
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: 'auth.json' });
  const page = await context.newPage();
  const p = `pc${Date.now().toString(36)}`;
  dashId = `${p}-dash`;
  dashPath = `/${p}`;
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [{
      id: dashId, name: `Preset contrast ${p}`, order: 0, path: dashPath, revision: 1,
      settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
      tabs: [{ id: `${p}-tab`, name: 'Main', order: 0, root: { columns: 24, children: [
        { id: `${p}-t`, kind: 'tile', type: 'link', name: 'Router', url: 'https://router.example.lan/', icon: 'mdi:lan', openMode: 'newtab', size: 'medium', order: 0, placement: { x: 0, y: 0, w: 2, h: 2 } }
      ] } }]
    }] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'pc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  await context.close();
});

test.afterAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: 'auth.json' });
  const page = await context.newPage();
  const cfg = await (await page.request.get('/api/config')).json();
  const rev = cfg.dashboards.find((d: { id: string }) => d.id === dashId)?.revision;
  const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(dashId)}?revision=${rev}`, {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) }
  });
  expect(r.ok(), `cleanup: ${r.status()}`).toBeTruthy();
  await context.close();
});

for (const mode of ['dark', 'light'] as const) {
  test(`${mode}: settings section titles are >= 3:1 (large text) on every preset`, async ({ page }) => {
    for (const preset of PRESETS) {
      await usePreset(page, mode, preset);
      await page.goto('/settings/discovery');
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      const title = page.locator('.section-title').first();
      await expect(title).toBeVisible();
      const c = await contrast(title);
      expect(c.ratio, `${preset}: section title ${c.fg} on ${c.bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  test(`${mode}: the active Edit toggle's text is >= 4.5:1 on every preset`, async ({ page }) => {
    for (const preset of PRESETS) {
      await usePreset(page, mode, preset);
      await page.goto(dashPath);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await page.locator('[aria-label="Enter Edit Mode"]').click();
      const toggle = page.locator('.edit-toggle.active');
      await expect(toggle).toBeVisible();
      await page.mouse.move(5, 600); // not hovered: the resting active look
      const label = toggle.locator('.edit-label');
      const c = await contrast((await label.count()) ? label : toggle);
      expect(c.ratio, `${preset}: Edit toggle ${c.fg} on ${c.bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}
