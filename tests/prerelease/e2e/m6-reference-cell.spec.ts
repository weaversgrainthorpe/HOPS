import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M6 §13: folders are sized at a 1920 desktop cell. On a narrower grid (1024 here), a folder whose
// saved box is too short for one row there is drawn taller and what is below it moves down (render
// only, never saved). Edit mode draws the SAVED box and says so in place of its contents (option A),
// so drag/drop geometry is exact. Synthetic data only.

const made: string[] = [];
type Child = Record<string, unknown>;
const kid = (id: string, name: string): Child => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0
});

async function importDash(page: Page, context: BrowserContext) {
  const p = `rc${Date.now().toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const kids = (n: number, tag: string) => Array.from({ length: n }, (_, i) => kid(id(`${tag}${i}`), `${tag}${i}`));
  const dash = {
    id: id('dash'), name: `Reference ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{
      id: id('tab'), name: 'Main', order: 0, root: {
        columns: 24, children: [
          // A tab shape at the Medium minimum (24 x 4) with a full row: too short for one row at 1024.
          { id: id('infra'), kind: 'folder', name: 'Infra', display: 'expanded', shape: 'folder-flat', size: 'medium',
            contentSize: 'medium', placement: { x: 0, y: 0, w: 24, h: 4 }, content: { children: kids(11, 'I') } },
          { ...kid(id('next'), 'Next'), placement: { x: 0, y: 4, w: 2, h: 2 } }
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
    multipart: { file: { name: 'rc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  expect((await r.json()).foldersEnlarged ?? []).toEqual([]); // 24 x 4 is at the minimum: not enlarged
  made.push(id('dash'));
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
    expect(r.ok(), `cleanup: delete dashboard ${id}: ${r.status()} ${await r.text()}`).toBeTruthy();
  }
});

test('1024: view mode draws the folder taller and moves what is below; edit mode shows the saved size and says so', async ({ page, context }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  const { path, id } = await importDash(page, context);
  await page.goto(path);
  const infra = page.locator(`.tab-canvas [data-node-id="${id('infra')}"]`).first();
  const next = page.locator(`.tab-canvas [data-node-id="${id('next')}"]`).first();
  await expect(infra).toBeVisible();

  // View mode: one row taller here, every tile shown, no note; the tile below moved down by the row.
  await expect(infra).toHaveAttribute('data-render-grown', '1');
  await expect(infra.locator('[data-folder-too-small]')).toHaveCount(0);
  await expect(infra.locator('[data-folder-page-content] .cell')).toHaveCount(11);
  const vi = (await infra.boundingBox())!, vn = (await next.boundingBox())!;
  expect(vn.y).toBeGreaterThanOrEqual(vi.y + vi.height - 1); // never overlapping

  // Edit mode (option A): the saved 24 x 4 box, the note in place of its contents, nothing clipped.
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  await expect(infra).not.toHaveAttribute('data-render-grown', /.*/);
  const note = infra.locator(`[data-folder-taller-here="${id('infra')}"]`);
  await expect(note).toHaveText('Taller on this screen — shown at its saved size while editing. Edit on a wider screen, or make it bigger.');
  await expect(infra.locator('[data-folder-page-content]')).toHaveCount(0);
  const ei = (await infra.boundingBox())!, en = (await next.boundingBox())!;
  expect(ei.height).toBeLessThan(vi.height); // the saved size, one row shorter
  expect(en.y).toBeGreaterThanOrEqual(ei.y + ei.height - 1);
  expect(en.y).toBeLessThan(vn.y); // the tile is back at its saved row

  // Nothing was saved by drawing it taller: the stored box is still 24 x 4.
  const cfg = await (await page.request.get('/api/config')).json();
  const dash = cfg.dashboards.find((d: { id: string }) => d.id === id('dash'));
  const stored = dash.tabs[0].root.children.find((n: { id: string }) => n.id === id('infra'));
  expect([stored.placement.w, stored.placement.h]).toEqual([24, 4]);
});

test('1920 (the reference): the same folder is drawn at its saved size, with no note in either mode', async ({ page, context }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  const { path, id } = await importDash(page, context);
  await page.goto(path);
  const infra = page.locator(`.tab-canvas [data-node-id="${id('infra')}"]`).first();
  await expect(infra.locator('[data-folder-page-content] .cell')).toHaveCount(11);
  await expect(infra).not.toHaveAttribute('data-render-grown', /.*/);
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  await expect(infra.locator('[data-folder-taller-here]')).toHaveCount(0);
  await expect(infra.locator('[data-folder-page-content] .cell')).toHaveCount(11);
});
