import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// Search closes (Esc, wherever focus is; the Esc hint) -- reuses the inside-folders fixture.
// Search reaches every tile on the dashboard (other tabs, any folder depth, minimised and paged
// folders), shows the path as text, Enter opens, Shift+Enter shows where it lives, and a folder is a
// result too. Needs Chromium (real layout, real popups).

let seq = 0;
const made: string[] = [];
type Child = Record<string, unknown>;

const kid = (id: string, name: string, extra: Child = {}): Child => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase().replace(/\W+/g, '')}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, ...extra
});
const folder = (id: string, name: string, box: Child | null, children: Child[], extra: Child = {}): Child => ({
  id, kind: 'folder', name, display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
  ...(box ? { placement: box } : {}), content: { children }, ...extra
});

// Tab "Main": a plain tile. Tab "Media": Downloads (minimised) > Archive > Sonarr, with enough
// fillers that Sonarr sits on a later page of Archive.
async function setup(page: Page, context: BrowserContext) {
  const p = `srchc${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `Search ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
    tabs: [
      { id: id('t1'), name: 'Main', order: 0, root: { columns: 24, children: [kid(id('plain'), 'Plainone', { placement: { x: 0, y: 0, w: 2, h: 2 } })] } },
      {
        id: id('t2'), name: 'Media', order: 1,
        root: { columns: 24, children: [
          folder(id('dl'), 'Downloads', { x: 0, y: 0, w: 12, h: 9 }, [
            folder(id('arch'), 'Archive', null, [
              ...Array.from({ length: 15 }, (_, i) => kid(id(`f${i}`), `Filler${i}`)),
              kid(id('sonarr'), 'Sonarr')
            ])
          ], { display: 'collapsed' })
        ] }
      }
    ]
  };
  const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 's.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(id('dash'));
  return { path: `/${p}`, id };
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

async function search(page: Page, q: string) {
  await expect(page.locator('.tab-canvas')).toBeVisible(); // the page is up before '/' is pressed
  await page.keyboard.press('/');
  const input = page.getByRole('textbox', { name: /search tiles/i });
  await expect(input).toBeVisible();
  await input.fill(q);
  return input;
}


const panel = (page: Page) => page.getByRole('dialog', { name: /global search/i });

test.describe('search closes', () => {
  test('Esc closes from the text field', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto(f.path);
    const input = await search(page, 'sonarr');
    await input.press('Escape');
    await expect(panel(page)).toHaveCount(0);
  });

  test('Esc closes after clicking a blank part of the panel', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto(f.path);
    await search(page, 'sonarr');
    await expect(page.getByRole('button', { name: /Sonarr/ })).toHaveCount(1);
    await panel(page).locator('.search-input-row').click({ position: { x: 150, y: 5 } });
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
  });

  test('Esc closes with focus on a result button', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto(f.path);
    const input = await search(page, 'sonarr');
    await expect(page.getByRole('button', { name: /Sonarr/ })).toHaveCount(1);
    await input.press('Tab'); // the Esc hint
    await page.keyboard.press('Tab'); // the result
    await expect(page.getByRole('button', { name: /Sonarr/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
  });

  test('Esc closes with focus on the page behind (body)', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto(f.path);
    await search(page, 'sonarr');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
  });

  test('the Esc hint is a button that closes search', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto(f.path);
    await search(page, 'sonarr');
    await page.getByRole('button', { name: 'Close search' }).click();
    await expect(panel(page)).toHaveCount(0);
  });
});
