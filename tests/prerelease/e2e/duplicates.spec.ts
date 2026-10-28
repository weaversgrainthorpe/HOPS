import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// Duplicate finder (Settings › Dashboards): tiles with the same address across dashboards, tabs and
// folders; merge keeps the chosen tile and deletes the rest only after a confirmed preview.
// Synthetic data only; the unique host keeps the group apart from anything else on the server.

let seq = 0;
const made: string[] = [];

async function setup(page: Page, context: BrowserContext, extra = false) {
  const p = `dup${Date.now().toString(36)}${(seq++).toString(36)}`;
  const host = `${p}.example.lan`;
  const tile = (tid: string, name: string, url: string, extra: Record<string, unknown> = {}) => ({
    id: tid, kind: 'tile', type: 'link', name, url, icon: 'mdi:lan', openMode: 'newtab', size: 'medium', order: 0, ...extra
  });
  const settings = { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null };
  const a = {
    id: `${p}-a`, name: `Home ${p}`, order: 0, path: `/${p}a`, revision: 1, settings,
    tabs: [{ id: `${p}-a1`, name: 'Main', order: 0, root: { columns: 24, children: [
      tile(`${p}-plex1`, 'Plex', `https://${host}/`, { placement: { x: 0, y: 0, w: 2, h: 2 } }),
      tile(`${p}-www`, 'WwwOne', `https://www.${host}/`, { placement: { x: 2, y: 0, w: 2, h: 2 } })
    ] } }]
  };
  const b = {
    id: `${p}-b`, name: `Media ${p}`, order: 1, path: `/${p}b`, revision: 1, settings,
    tabs: [{ id: `${p}-b1`, name: 'Servers', order: 0, root: { columns: 24, children: [...(extra ? [tile(`${p}-plex4`, 'Plex loose', `https://${host}/`, { placement: { x: 12, y: 0, w: 2, h: 2 } })] : []), {
      id: `${p}-f`, kind: 'folder', name: 'Boxes', display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
      placement: { x: 0, y: 0, w: 12, h: 9 },
      content: { children: [tile(`${p}-plex2`, 'Plex copy', `HTTPS://${host.toUpperCase()}:443`, { openMode: 'iframe', awayUrl: 'https://away.example.lan/' }), ...(extra ? [tile(`${p}-plex3`, 'Plex copy 3', `https://${host}/`)] : [])] }
    }] } }]
  };
  const doc = (d: unknown, t: string) => ({ format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [d] }, t });
  for (const d of [a, b]) {
    const r = await page.request.post('/api/config/import', {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) },
      multipart: { file: { name: 'd.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc(d, ''))) } }
    });
    expect(r.status(), await r.text()).toBe(200);
    made.push(d.id);
  }
  return { p, host, a, b };
}

async function tileIds(page: Page, dashId: string): Promise<string[]> {
  const cfg = await (await page.request.get('/api/config')).json();
  const out: string[] = [];
  const walk = (c: { children?: Array<{ kind: string; id: string; content?: unknown }> }) => {
    for (const n of c.children ?? []) {
      if (n.kind === 'tile') out.push(n.id);
      else walk(n.content as never);
    }
  };
  for (const t of cfg.dashboards.find((d: { id: string }) => d.id === dashId).tabs) walk(t.root);
  return out;
}

test.afterEach(async ({ page, context }) => {
  while (made.length) {
    const id = made.pop()!;
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
    if (typeof rev !== 'number') continue;
    await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, { headers: { 'X-CSRF-Token': await getCsrfToken(context) } });
  }
});

test.describe('duplicate finder', () => {
  test('lists the group with paths and differences; www is not a duplicate', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto('/settings/dashboards/duplicates');
    const group = page.locator(`[data-dup-group="https://${f.host}"]`);
    await expect(group).toBeVisible();
    await expect(group.locator('[data-dup-tile]')).toHaveCount(2);
    await expect(group.locator(`[data-dup-tile="${f.p}-plex1"]`)).toContainText(`${f.a.name} › Main`);
    const second = group.locator(`[data-dup-tile="${f.p}-plex2"]`);
    await expect(second).toContainText(`${f.b.name} › Servers › Boxes`);
    await expect(second).toContainText('away address https://away.example.lan/');
    await expect(second).toContainText('opens iframe');
    await expect(page.locator(`[data-dup-group="https://www.${f.host}"]`)).toHaveCount(0);
  });

  test('merge keeps the chosen tile, deletes the others after confirmation', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto('/settings/dashboards/duplicates');
    const group = page.locator(`[data-dup-group="https://${f.host}"]`);
    await group.locator(`[data-dup-tile="${f.p}-plex2"] input[type=radio]`).check();
    await group.getByRole('button', { name: /Merge/ }).click();
    await expect(group.locator('[data-merge-deletes]')).toHaveText(`Deletes 1 tile: ${f.a.name} › Plex`);
    await expect(group.locator('[data-merge-preview]')).toContainText('backup');
    // Nothing deleted yet.
    expect(await tileIds(page, f.a.id)).toContain(`${f.p}-plex1`);
    await group.getByRole('button', { name: /^Delete 1 tile$/ }).click();
    await expect(page.locator(`[data-dup-group="https://${f.host}"]`)).toHaveCount(0);
    expect(await tileIds(page, f.a.id)).toEqual([`${f.p}-www`]);
    expect(await tileIds(page, f.b.id)).toEqual([`${f.p}-plex2`]);
  });

  test('cancel leaves everything as it was', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto('/settings/dashboards/duplicates');
    const group = page.locator(`[data-dup-group="https://${f.host}"]`);
    await group.getByRole('button', { name: /Merge/ }).click();
    await expect(group.locator('[data-merge-preview]')).toBeVisible();
    await group.getByRole('button', { name: 'Cancel' }).click();
    await expect(group.locator('[data-merge-preview]')).toHaveCount(0);
    await expect(group.locator('[data-dup-tile]')).toHaveCount(2);
    expect(await tileIds(page, f.a.id)).toEqual([`${f.p}-plex1`, `${f.p}-www`]);
    expect(await tileIds(page, f.b.id)).toEqual([`${f.p}-plex2`]);
  });

  test('a dashboard changed elsewhere refuses the merge visibly and deletes nothing', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto('/settings/dashboards/duplicates');
    const group = page.locator(`[data-dup-group="https://${f.host}"]`);
    await group.getByRole('button', { name: /Merge/ }).click();
    // Another browser saved dashboard B (the one the merge deletes from) meanwhile: the server answers the revision clash with 409.
    await page.route(`**/api/dashboards/${f.b.id}`, (r) => r.request().method() === 'PUT'
      ? r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'conflict', currentRevision: 9 }) })
      : r.continue());
    await group.getByRole('button', { name: /^Delete 1 tile$/ }).click();
    await expect(page.locator('[data-merge-refusal]')).toContainText('changed somewhere else');
    expect(await tileIds(page, f.b.id)).toEqual([`${f.p}-plex2`]);
  });

  test('scope control narrows the groups and the count; folder shows only same-folder copies', async ({ page, context }) => {
    const f = await setup(page, context, true);
    await page.goto('/settings/dashboards/duplicates');
    const group = page.locator(`[data-dup-group="https://${f.host}"]`);
    const count = page.locator('[data-dup-count]');
    await expect(page.getByRole('radio', { name: 'All' })).toBeChecked();
    await expect(group).toHaveCount(1);
    await expect(group.locator('[data-dup-tile]')).toHaveCount(4);
    await page.getByRole('radio', { name: 'Dashboard' }).check();
    await expect(group).toHaveCount(1);
    await expect(group.locator('[data-dup-tile]')).toHaveCount(3);
    await expect(group.locator(`[data-dup-tile="${f.p}-plex1"]`)).toHaveCount(0);
    await expect(count).toContainText('within the same dashboard');
    await page.getByRole('radio', { name: 'Folder' }).check();
    await expect(group.locator('[data-dup-tile]')).toHaveCount(2);
    await expect(group.locator(`[data-dup-tile="${f.p}-plex2"]`)).toBeVisible();
    await expect(group.locator(`[data-dup-tile="${f.p}-plex3"]`)).toBeVisible();
    await expect(group.locator(`[data-dup-tile="${f.p}-plex4"]`)).toHaveCount(0);
    await expect(count).toContainText('1 group within the same folder');
    // Remembered per browser.
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Folder' })).toBeChecked();
    await page.getByRole('radio', { name: 'All' }).check();
    await expect(group.locator('[data-dup-tile]')).toHaveCount(4);
  });

  test('scope with nothing left shows a scope-specific empty state', async ({ page, context }) => {
    await setup(page, context); // one copy per dashboard
    await page.goto('/settings/dashboards/duplicates');
    await page.getByRole('radio', { name: 'Dashboard' }).check();
    await expect(page.locator('[data-state="none"]')).toContainText('No duplicates within the same dashboard');
    await page.getByRole('radio', { name: 'All' }).check();
  });

  test('merge at the dashboard scope deletes only the shown copies', async ({ page, context }) => {
    const f = await setup(page, context, true);
    await page.goto('/settings/dashboards/duplicates');
    await page.getByRole('radio', { name: 'Dashboard' }).check();
    const group = page.locator(`[data-dup-group="https://${f.host}"]`);
    await group.getByRole('button', { name: /Merge/ }).click();
    await expect(group.locator('[data-merge-deletes]')).toContainText('Deletes 2 tiles');
    await expect(group.locator('[data-merge-deletes]')).not.toContainText(f.a.name);
    await group.getByRole('button', { name: /^Delete 2 tiles$/ }).click();
    await expect(group).toHaveCount(0);
    expect(await tileIds(page, f.a.id)).toEqual([`${f.p}-plex1`, `${f.p}-www`]);
    expect(await tileIds(page, f.b.id)).toEqual([`${f.p}-plex4`]);
    await page.getByRole('radio', { name: 'All' }).check();
  });
});
