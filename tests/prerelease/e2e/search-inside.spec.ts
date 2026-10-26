import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

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
  const p = `srch${Date.now().toString(36)}${(seq++).toString(36)}`;
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

test.describe('search inside folders', () => {
  test('finds a tile 3 levels deep in a minimised paged folder on another tab, with its path', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto(f.path);
    const input = await search(page, 'sonarr');
    const hit = page.getByRole('button', { name: /Sonarr/ });
    await expect(hit).toHaveCount(1);
    await expect(hit).toContainText('Media › Downloads › Archive › Sonarr');
    await input.fill('sonarr.example'); // URL host matches too
    await expect(hit).toHaveCount(1);
    await input.press('Escape');
    await expect(input).toHaveCount(0);
  });

  test('Enter opens the tile (new tab) and leaves the dashboard where it was', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto(f.path);
    const input = await search(page, 'sonarr');
    await expect(page.getByRole('button', { name: /Sonarr/ })).toHaveCount(1);
    await context.route('**://sonarr.example.lan/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));
    const popup = context.waitForEvent('page');
    await input.press('Enter');
    const tab = await popup;
    await tab.waitForLoadState();
    expect(tab.url()).toContain('sonarr.example.lan');
    await expect(page.locator('[data-search-hit]')).toHaveCount(0);
  });

  test('Shift+Enter shows it: right tab, folder open, right page, tile highlighted', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto(f.path);
    const input = await search(page, 'sonarr');
    await expect(page.getByRole('button', { name: /Sonarr/ })).toHaveCount(1);
    await input.press('Shift+Enter');
    const tile = page.locator(`.tab-canvas [data-node-id="${f.id('sonarr')}"]`);
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAttribute('data-search-hit', /pulse|still/);
    await expect(page.locator(`.nested-box[data-nested-folder="${f.id('arch')}"] [data-folder-page]`)).not.toHaveAttribute('data-folder-page', '0');
    await expect(page.locator(`.tab-canvas [data-node-id="${f.id('plain')}"]`)).toHaveCount(0); // on the Media tab
  });

  test('a folder is a result and Enter opens it', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto(f.path);
    const input = await search(page, 'archive');
    const hit = page.getByRole('button', { name: /Archive/ });
    await expect(hit).toContainText('Media › Downloads › Archive');
    await input.press('Enter');
    const arch = page.locator(`.nested-box[data-nested-folder="${f.id('arch')}"]`);
    await expect(arch).toBeVisible();
    await expect(page.locator(`.tab-canvas [data-node-id="${f.id('dl')}"]`)).not.toHaveClass(/collapsed/);
  });
});
