import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// A folder STORED below its smallest open box (an old save, or data from before the minimum — import
// and edits can no longer make one) is never drawn squashed silently: edit mode flags it with the
// reason and a one-click, undoable "Make it big enough"; view mode draws no clipped items and says so.
// Synthetic data. The stored box is shrunk in GET /api/config's answer, since every write path now
// refuses or enlarges an undersized box.

const made: string[] = [];
type Child = Record<string, unknown>;

const kid = (id: string, name: string): Child => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0
});

async function importDash(page: Page, context: BrowserContext) {
  const p = `bm${Date.now().toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `Below min ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{
      id: id('tab'), name: 'Main', order: 0, root: {
        columns: 24, children: [
          {
            id: id('media'), kind: 'folder', name: 'Media', display: 'expanded', shape: 'rounded', size: 'medium',
            contentSize: 'medium', placement: { x: 0, y: 0, w: 3, h: 6 },
            content: { children: [kid(id('k1'), 'Plex'), kid(id('k2'), 'Jelly')] }
          },
          { ...kid(id('next'), 'Next'), placement: { x: 0, y: 6, w: 2, h: 2 } }
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
    multipart: { file: { name: 'bm.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(id('dash'));
  return { path: `/${p}`, id };
}

/** Serve the stored folder `folderId` as if saved at 2×4 (below Medium's 3×6). */
async function storedTooSmall(page: Page, folderId: string) {
  await page.route('**/api/config', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const resp = await route.fetch();
    const cfg = await resp.json();
    for (const d of cfg.dashboards ?? []) {
      for (const t of d.tabs ?? []) {
        for (const n of t.root?.children ?? []) if (n.id === folderId) n.placement = { ...n.placement, w: 2, h: 4 };
      }
    }
    await route.fulfill({ response: resp, json: cfg });
  });
}

test.afterEach(async ({ page, context }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
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

test('view mode: a stored too-small folder draws no clipped items and says so', async ({ page, context }) => {
  const { path, id } = await importDash(page, context);
  await storedTooSmall(page, id('media'));
  await page.goto(path);
  const media = page.locator(`.tab-canvas [data-node-id="${id('media')}"]`).first();
  await expect(media).toBeVisible();
  await expect(media.locator('[data-folder-too-small]')).toContainText('Too small to show its contents');
  await expect(media.locator('[data-folder-page-content]')).toHaveCount(0);
  await expect(page.locator('[data-folder-below-min]')).toHaveCount(0); // the badge is edit mode's
});

test('edit mode: the warning names the sizes; "Make it big enough" fixes it, undoably', async ({ page, context }) => {
  const { path, id } = await importDash(page, context);
  await storedTooSmall(page, id('media'));
  await page.goto(path);
  await expect(page.locator(`.tab-canvas [data-node-id="${id('media')}"]`).first()).toBeVisible();
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  const bar = page.getByRole('toolbar', { name: 'Editing' });
  await expect(bar).toBeVisible();

  const note = page.locator(`[data-folder-below-min="${id('media')}"]`);
  await expect(note).toContainText('Smaller than it can be drawn (2×4; needs at least 3×6)');
  await note.getByRole('button', { name: 'Make it big enough' }).click();
  await expect(note).toHaveCount(0);
  await expect(page.locator(`.tab-canvas [data-node-id="${id('media')}"] [data-folder-page-content]`)).toHaveCount(1);

  await bar.getByRole('button', { name: /Undo/ }).click();
  await expect(note).toBeVisible();
  await expect(note).toContainText('2×4');
  await bar.getByRole('button', { name: /Redo/ }).click();
  await expect(note).toHaveCount(0);

  // Saved: the server takes the enlarged box (3×6, neighbour clear of it).
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await bar.getByRole('button', { name: /Save/ }).click();
  const r = await saved;
  expect(r.status(), await r.text()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
  await page.unrouteAll({ behavior: 'wait' });
  const body = JSON.parse(r.request().postData() ?? '{}');
  const kids = (body.dashboard ?? body).tabs[0].root.children as { id: string; placement: { w: number; h: number } }[];
  const m = kids.find((k) => k.id === id('media'))!;
  expect([m.placement.w, m.placement.h]).toEqual([3, 6]);
});
