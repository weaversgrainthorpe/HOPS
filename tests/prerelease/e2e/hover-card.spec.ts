import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// One hover popup for tiles and folders (HOPS's own, not the browser's native title, so it can be
// sized): line 1 the name (larger), line 2 the description when there is one. It shows after a short
// hover and on keyboard focus, and goes on mouse leave, blur and Escape. Never a native title as well.

const made: string[] = [];

async function importDash(page: Page, context: BrowserContext) {
  const p = `hc${Date.now().toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const kid = (k: string, name: string): Record<string, unknown> => ({
    id: id(k), kind: 'tile', type: 'link', name, url: `https://${k}.example.lan/`, icon: 'mdi:lan', openMode: 'newtab', size: 'medium', order: 0
  });
  const dash = {
    id: id('dash'), name: `hover ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{
      id: id('tab'), name: 'Main', order: 0,
      root: {
        columns: 24,
        children: [
          { ...kid('nas', 'NAS'), description: 'Files and backups', placement: { x: 0, y: 0, w: 2, h: 2 } },
          { ...kid('plain', 'Plain'), placement: { x: 2, y: 0, w: 2, h: 2 } },
          {
            id: id('media'), kind: 'folder', name: 'Media', description: 'Films and music', display: 'collapsed', shape: 'rounded',
            size: 'medium', contentSize: 'medium', placement: { x: 4, y: 0, w: 8, h: 4 },
            content: { children: [kid('jelly', 'Jelly'), kid('sonar', 'Sonar')] }
          }
        ]
      }
    }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'hc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(dash.id);
  return { path: `/${p}`, id };
}

test.afterEach(async ({ page, context }) => {
  while (made.length) {
    const id = made.pop()!;
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
    expect(typeof rev, `cleanup: dashboard ${id} has a revision`).toBe('number');
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) }
    });
    expect(r.ok(), `cleanup: delete dashboard ${id}: ${r.status()}`).toBeTruthy();
  }
});

const node = (page: Page, id: string) => page.locator(`.tab-canvas [data-node-id="${id}"]`);
const card = (page: Page) => page.getByTestId('hover-card');

/** The popup is wholly on screen and not on top of its anchor (it never takes the click). */
async function onScreenBeside(page: Page, anchor: { x: number; y: number; width: number; height: number }) {
  const b = (await card(page).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
  expect(b.y >= anchor.y + anchor.height || b.y + b.height <= anchor.y, 'above or below its anchor').toBe(true);
}

test('hover a tile: the popup shows its name, then its description; no native title; leaving hides it', async ({ page, context }) => {
  const f = await importDash(page, context);
  await page.goto(f.path);
  const nas = node(page, f.id('nas')).locator('button.entry');
  await expect(nas).toBeVisible();
  await expect(nas).not.toHaveAttribute('title', /.*/);
  await nas.hover();
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('.hc-name')).toHaveText('NAS');
  await expect(card(page).locator('.hc-desc')).toHaveText('Files and backups');
  // The name is the larger line; the popup sits above everything and never takes a click.
  const s = await card(page).evaluate((el) => {
    const name = getComputedStyle(el.querySelector('.hc-name')!);
    const desc = getComputedStyle(el.querySelector('.hc-desc')!);
    return { name: parseFloat(name.fontSize), weight: name.fontWeight, desc: parseFloat(desc.fontSize), z: getComputedStyle(el).zIndex, pe: getComputedStyle(el).pointerEvents };
  });
  expect(s.name).toBe(16);
  expect(Number(s.weight)).toBeGreaterThanOrEqual(600);
  expect(s.desc).toBeLessThan(s.name);
  expect(Number(s.z)).toBeGreaterThanOrEqual(1500);
  expect(s.pe).toBe('none');
  await onScreenBeside(page, (await nas.boundingBox())!);
  await page.mouse.move(2, 400);
  await expect(card(page)).toHaveCount(0);
});

test('hover a minimised folder: the popup shows its name and description', async ({ page, context }) => {
  const f = await importDash(page, context);
  await page.goto(f.path);
  const slot = node(page, f.id('media'));
  const face = slot.locator('.folder-collapsed-tile');
  await expect(face).toBeVisible();
  await expect(slot).not.toHaveAttribute('title', /.*/);
  await face.hover();
  await expect(card(page).locator('.hc-name')).toHaveText('Media');
  await expect(card(page).locator('.hc-desc')).toHaveText('Films and music');
  await onScreenBeside(page, (await face.boundingBox())!);
  await page.mouse.move(2, 400);
  await expect(card(page)).toHaveCount(0);
});

test('keyboard focus shows the popup; Escape hides it', async ({ page, context }) => {
  const f = await importDash(page, context);
  await page.goto(f.path);
  const nas = node(page, f.id('nas')).locator('button.entry');
  const plain = node(page, f.id('plain')).locator('button.entry');
  await expect(plain).toBeVisible();
  await nas.focus();
  await page.keyboard.press('Tab');
  await expect(plain).toBeFocused();
  await expect(card(page).locator('.hc-name')).toHaveText('Plain');
  await expect(card(page).locator('.hc-desc')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  await expect(plain).toBeFocused(); // Escape only puts the popup away
  // Tab on to the minimised folder: its popup.
  await page.keyboard.press('Tab');
  await expect(card(page).locator('.hc-name')).toHaveText('Media');
});

test('reduced motion: the popup appears without animation', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const f = await importDash(page, context);
  await page.goto(f.path);
  await node(page, f.id('nas')).locator('button.entry').hover();
  await expect(card(page)).toBeVisible();
  expect(await card(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test('both themes: the popup on a tile and on a minimised folder uses the theme (screenshots kept)', async ({ page, context }) => {
  const f = await importDash(page, context);
  for (const theme of ['dark', 'light'] as const) {
    await page.goto(f.path);
    await page.evaluate((t) => localStorage.setItem('hops_theme', t), theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const [what, loc] of [
      ['tile', node(page, f.id('nas')).locator('button.entry')],
      ['folder', node(page, f.id('media')).locator('.folder-collapsed-tile')]
    ] as const) {
      await loc.hover();
      await expect(card(page)).toBeVisible();
      // The theme's own surface and text (the pair every dialog uses), never fixed colours.
      const c = await card(page).evaluate((el) => {
        const probe = document.createElement('div');
        probe.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary)';
        document.body.appendChild(probe);
        const want = getComputedStyle(probe);
        const r = { bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color, wantBg: want.backgroundColor, wantFg: want.color };
        probe.remove();
        return r;
      });
      expect(c.bg).toBe(c.wantBg);
      expect(c.fg).toBe(c.wantFg);
      await card(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished))); // faded in
      await page.screenshot({ path: test.info().outputPath(`${what}-${theme}.png`) });
      await page.mouse.move(2, 400);
      await expect(card(page)).toHaveCount(0);
    }
  }
});
