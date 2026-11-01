import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// Dragging an item to the bottom edge of the window scrolls the page by itself (the vertical
// edge scroll), and the held item is still the one being dragged. Needs Chromium (real layout).

let seq = 0;
const made: string[] = [];

async function seed(page: Page, context: BrowserContext) {
  const p = `iesc${Date.now().toString(36)}${(seq++).toString(36)}`;
  const tile = (id: string, name: string, x: number, y: number) => ({
    id: `${p}-${id}`, kind: 'tile', type: 'link', name, url: `https://${id}.example.lan/`, icon: 'mdi:lan',
    openMode: 'newtab', size: 'medium', order: 0, placement: { x, y, w: 2, h: 2 }
  });
  const dash = {
    id: `${p}-dash`, name: `Edge ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
    tabs: [{ id: `${p}-t1`, name: 'Main', order: 0, root: { columns: 24, children: [tile('a', 'Alpha', 0, 0), ...Array.from({ length: 6 }, (_, i) => tile(`z${i}`, `Far${i}`, 2 * i, 40))] } }]
  };
  const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 's.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(dash.id);
  return { path: `/${p}`, alpha: `${p}-a` };
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

test.use({ viewport: { width: 1280, height: 700 } });

test('dragging a tile to the bottom edge scrolls the page down by itself, and back up at the top edge', async ({ page, context }) => {
  const f = await seed(page, context);
  await page.goto(f.path);
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  const alpha = page.locator(`[data-node-id="${f.alpha}"]`);
  const a = (await alpha.boundingBox())!;
  const x = a.x + a.width / 2;
  const y0 = a.y + a.height / 2;
  const scrollY = () => page.evaluate(() => window.scrollY);
  expect(await scrollY()).toBe(0);

  await page.mouse.move(x, y0);
  await page.mouse.down();
  // Small steps, as a person drags, to 10 px above the bottom of the window.
  const yEnd = 700 - 10;
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(x, y0 + ((yEnd - y0) * i) / 20);
    await page.waitForTimeout(16);
  }
  await expect.poll(scrollY, { message: 'held at the bottom edge, the page scrolls on by itself' }).toBeGreaterThan(200);
  // Back to the top edge: it scrolls up again.
  const down = await scrollY();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(x, yEnd - ((yEnd - 10) * i) / 20);
    await page.waitForTimeout(16);
  }
  await expect.poll(scrollY, { message: 'held at the top edge, it scrolls back up' }).toBeLessThan(down);
  await page.mouse.up();
});
