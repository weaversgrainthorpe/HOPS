import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M4 Task 4 fix round 1 (Ruling 10), in a REAL browser: jsdom has no layout, so
// "the failure badge never covers content" and "the maximised backdrop is
// translucent" are checked here. (Task 9 adds the full background suite.)

let seq = 0;
let made: { id: string } | null = null;

const placement = (x: number, y: number, w = 1, h = 1) => ({ x, y, w, h });
const tile = (id: string, name: string) => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, placement: placement(0, 0)
});

/** Import one dashboard whose Main tab holds `children(id)`; returns its path and id maker. */
async function importDash(page: Page, context: BrowserContext, children: (id: (s: string) => string) => unknown[]) {
  const p = `m4b${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `M4 backgrounds ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null, defaultLayout: null
    },
    defaultLayout: 'grid',
    tabs: [{ id: id('tab'), name: 'Main', order: 0, layout: 'inherit', root: { columns: 12, children: children(id) } }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm4.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made = { id: id('dash') };
  return { path: `/${p}`, id };
}

async function importFixture(page: Page, context: BrowserContext) {
  const p = `m4b${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  // A same-origin asset path that does not exist: the image fails to load.
  const broken = { type: 'image', value: `/backgrounds/${p}-missing.jpg` };
  const folder = (key: string, name: string, x: number, extra: Record<string, unknown> = {}) => ({
    id: id(key), kind: 'folder', name, layout: 'inherit', display: 'expanded', shape: 'rounded', showTitle: true,
    placement: placement(x, 1, 4, 3), background: broken,
    content: { columns: 4, children: [tile(id(`${key}-t`), `${name}Tile`)] }, ...extra
  });
  const dash = {
    id: id('dash'), name: `M4 backgrounds ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null, defaultLayout: null
    },
    defaultLayout: 'grid',
    tabs: [{
      id: id('tab'), name: 'Main', order: 0, layout: 'inherit',
      root: {
        columns: 12,
        children: [
          tile(id('anchor'), 'Anchor'),
          folder('ft', 'Titled', 0),
          folder('fu', 'Untitled', 4, { showTitle: false }),
          folder('fc', 'Collapsed', 8, { display: 'collapsed', placement: placement(8, 1, 2, 2) })
        ]
      }
    }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm4.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made = { id: id('dash') };
  return { path: `/${p}`, id };
}

test.afterEach(async ({ page, context }) => {
  if (!made) return;
  const id = made.id;
  made = null;
  const cfg = await (await page.request.get('/api/config')).json();
  const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
  expect(typeof rev, `cleanup: dashboard ${id} has a revision`).toBe('number');
  const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) }
  });
  expect(r.ok(), `cleanup: delete dashboard ${id}: ${r.status()} ${await r.text()}`).toBeTruthy();
});

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  return b;
}

test.describe('M4 backgrounds in a real browser', () => {
  test('the failed-image badge never covers a folder\'s content (edit mode)', async ({ page, context }) => {
    const f = await importFixture(page, context);
    await page.goto(f.path);
    await expect(page.locator(`[data-node-id="${f.id('anchor')}"]`)).toBeVisible();
    // View mode: no badge.
    await expect(page.locator('[data-bg-failed]')).toHaveCount(0);
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();

    const node = (k: string) => `[data-node-id="${f.id(k)}"]`;
    const cases: [string, string][] = [
      ['ft', `${node('ft')} > .folder-body`],
      ['fu', `${node('fu')} > .folder-body`],
      ['fc', `${node('fc')} .folder-collapsed-tile`]
    ];
    for (const [k, content] of cases) {
      const badge = page.locator(`${node(k)} [data-bg-failed="folder"]`);
      await expect(badge, `badge on ${k}`).toBeVisible();
      await expect(badge).toContainText("Background image couldn't be loaded");
      const bb = await badge.boundingBox();
      expect(bb, `badge box for ${k}`).toBeTruthy();
      expect(intersects(bb!, await boxOf(page, content)), `badge on ${k} overlaps its content`).toBe(false);
    }
  });

  test('a maximised folder sits over a translucent, dimmed backdrop', async ({ page, context }) => {
    const f = await importFixture(page, context);
    await page.goto(f.path);
    const titled = page.locator(`[data-node-id="${f.id('ft')}"]`);
    await expect(titled).toBeVisible();
    await titled.getByRole('button', { name: 'Maximise folder' }).click();
    const host = page.locator('.max-host');
    await expect(host).toBeVisible();
    const bg = await host.evaluate((el) => getComputedStyle(el).backgroundColor);
    const m = bg.match(/rgba?\(([^)]+)\)/);
    expect(m, `max-host background ${bg}`).toBeTruthy();
    const parts = m![1].split(',').map((s) => parseFloat(s));
    expect(parts.length, `max-host background ${bg} has an alpha`).toBe(4);
    expect(parts[3]).toBeGreaterThan(0);
    expect(parts[3]).toBeLessThan(1);
    // Leave the viewer's remembered view as it was.
    await host.getByRole('button', { name: 'Restore folder' }).click();
    await expect(host).toHaveCount(0);
  });

  // ---- M4 Task 5: the picker at folder level and the corner controls (call 6)

  const PRESET = '/presets/network-grid.jpg';
  const untitledAt = (id: (s: string) => string, key: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
    id: id(key), kind: 'folder', name: `Folder ${key}`, layout: 'inherit', display: 'expanded', shape: 'rounded',
    showTitle: false, placement: placement(x, y, 4, 3),
    content: { columns: 4, children: [tile(id(`${key}-t`), `${key}Tile`)] }, ...extra
  });

  async function enterEdit(page: Page) {
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  }
  async function saveDraft(page: Page) {
    const save = page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ });
    await expect(save).toBeEnabled();
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
    await save.click();
    const r = await saved;
    expect(r.status(), await r.text()).toBe(200);
  }
  async function storedFolder(page: Page, dashId: string, folderId: string) {
    const cfg = await (await page.request.get('/api/config')).json();
    const d = cfg.dashboards.find((x: { id: string }) => x.id === dashId);
    return d.tabs[0].root.children.find((n: { id: string }) => n.id === folderId);
  }
  /** Edit mode → double-click the folder → Background… → the folder-level picker. */
  async function openFolderPicker(page: Page, folderSel: string) {
    await page.locator(folderSel).dblclick({ position: { x: 20, y: 20 } });
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: /^Background/ }).click();
    const picker = page.getByRole('dialog', { name: 'Folder background' });
    await expect(picker).toBeVisible();
    return { dlg, picker };
  }

  test('folder picker: a preset picture at 50% opacity is saved, survives a reload and is drawn', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const f = await importDash(page, context, (id) => [tile(id('anchor'), 'Anchor'), untitledAt(id, 'fp', 0, 1, { showTitle: true })]);
    const sel = `[data-node-id="${f.id('fp')}"]`;
    await page.goto(f.path);
    await expect(page.locator(sel)).toBeVisible();
    await enterEdit(page);
    // Cancel discards a picked background (Ruling 11(5)): nothing reaches the draft.
    {
      const { dlg, picker } = await openFolderPicker(page, sel);
      await picker.getByRole('button', { name: /^Color$/ }).click();
      await picker.getByRole('button', { name: /^Save Background/ }).click();
      await expect(picker).toBeHidden();
      await expect(dlg.locator('.background-status')).toContainText(/applies when you save/);
      await dlg.getByRole('button', { name: /^Cancel$/ }).click();
      await expect(dlg).toBeHidden();
      await expect(page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ })).toBeDisabled();
      await expect(page.locator(`${sel} .folder-surface .background-root`)).toHaveCount(0);
    }
    const { dlg, picker } = await openFolderPicker(page, sel);
    await expect(dlg.locator('.background-status')).toContainText(/No background of its own/);
    // Folder level: no overlay or blur of its own (call 1).
    await picker.getByRole('button', { name: /^Image$/ }).click();
    await expect(picker.getByText(/Overlay Darkness/i)).toHaveCount(0);
    await expect(picker.getByText(/Overlay Blur/i)).toHaveCount(0);
    await picker.locator(`.image-card img[src="${PRESET}"]`).first().click();
    await picker.getByLabel(/^Background opacity/).fill('0.5');
    await picker.getByRole('button', { name: /^Save Background/ }).click();
    await expect(picker).toBeHidden();
    await expect(dlg.locator('.background-status')).toContainText(/Image, 50% opacity/);
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await expect(dlg).toBeHidden();
    await saveDraft(page);

    const stored = await storedFolder(page, f.id('dash'), f.id('fp'));
    expect(stored.background).toMatchObject({ type: 'image', value: PRESET, opacity: 0.5 });
    expect(stored.background).not.toHaveProperty('overlayOpacity');
    expect(stored.background.inherit).toBeFalsy();

    await page.reload();
    await expect(page.locator(sel)).toBeVisible();
    const root = page.locator(`${sel} .folder-surface .background-root`);
    await expect(root).toHaveCount(1);
    await expect.poll(() => root.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.5');
    await expect
      .poll(() => root.evaluate((el) => [...el.querySelectorAll('.background-layer')].map((l) => getComputedStyle(l).backgroundImage).join(' ')))
      .toContain('network-grid.jpg');
    // Once the picture is shown, the colour stand-in is gone (the image really loaded).
    await expect(page.locator(`${sel} .folder-surface-color`)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Inherit keeps the folder picture: switched off, stored, and restored on un-inherit', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      tile(id('anchor'), 'Anchor'),
      untitledAt(id, 'fi', 0, 1, { showTitle: true, background: { type: 'image', value: PRESET, opacity: 0.8 } })
    ]);
    const sel = `[data-node-id="${f.id('fi')}"]`;
    await page.goto(f.path);
    await expect(page.locator(`${sel} .folder-surface .background-root`)).toHaveCount(1);
    await enterEdit(page);

    let { dlg, picker } = await openFolderPicker(page, sel);
    const same = picker.getByRole('radio', { name: /^Same as / });
    await expect(same).not.toBeChecked();
    await same.check();
    await expect(same).toBeChecked();
    await picker.getByRole('button', { name: /^Save Background/ }).click();
    await expect(dlg.locator('.background-status')).toContainText(/kept/);
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await saveDraft(page);
    let stored = await storedFolder(page, f.id('dash'), f.id('fi'));
    expect(stored.background).toMatchObject({ inherit: true, type: 'image', value: PRESET, opacity: 0.8 });
    // Switched off: no picture drawn in the folder.
    await expect(page.locator(`${sel} .folder-surface .background-root`)).toHaveCount(0);

    ({ dlg, picker } = await openFolderPicker(page, sel));
    await expect(picker.getByRole('radio', { name: /^Same as / })).toBeChecked();
    await picker.getByRole('radio', { name: 'Its own background' }).check();
    await picker.getByRole('button', { name: /^Save Background/ }).click();
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await saveDraft(page);
    stored = await storedFolder(page, f.id('dash'), f.id('fi'));
    expect(stored.background).toMatchObject({ type: 'image', value: PRESET, opacity: 0.8 });
    expect(stored.background.inherit).toBeFalsy();
    await expect(page.locator(`${sel} .folder-surface .background-root`)).toHaveCount(1);
  });

  test('a row-0 untitled folder: corner controls sit outside the content, unclipped, clear of the badge tab', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      // Row 0, right-hand side; a broken picture so edit mode shows the failure tab too.
      untitledAt(id, 'f0', 8, 0, { background: { type: 'image', value: `/backgrounds/${id('nope')}.jpg` } }),
      tile(id('anchor'), 'Anchor')
    ]);
    const sel = `[data-node-id="${f.id('f0')}"]`;
    await page.goto(f.path);
    await expect(page.locator(sel)).toBeVisible();
    await page.locator(`${sel} > .folder-body`).hover();
    const controls = page.locator(`${sel} > .corner-controls`);
    await expect(controls).toBeVisible();
    await expect.poll(() => controls.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    const cb = (await controls.boundingBox())!;
    const body = await boxOf(page, `${sel} > .folder-body`);
    const folderBox = await boxOf(page, sel);
    expect(intersects(cb, body), 'corner controls overlap the folder content').toBe(false);
    // Just outside the top-right edge.
    expect(cb.y + cb.height).toBeLessThanOrEqual(folderBox.y + 1);
    expect(cb.x + cb.width).toBeLessThanOrEqual(folderBox.x + folderBox.width + 1);
    expect(cb.x).toBeGreaterThan(folderBox.x + folderBox.width / 2);
    // Not clipped: inside the viewport, and the button at its centre is what is hit there.
    expect(cb.y).toBeGreaterThanOrEqual(0);
    const max = controls.getByRole('button', { name: 'Maximise folder' });
    const mb = (await max.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => (document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null),
      [mb.x + mb.width / 2, mb.y + mb.height / 2]
    );
    expect(hit).toBe('Maximise folder');
    // And it works.
    await max.click();
    await expect(page.locator('.max-host')).toBeVisible();
    await page.locator('.max-host').getByRole('button', { name: 'Restore folder' }).click();
    await expect(page.locator('.max-host')).toHaveCount(0);

    // Edit mode: the failure tab hangs off the top-LEFT edge — clear of where the controls sit.
    await enterEdit(page);
    const badge = page.locator(`${sel} [data-bg-failed="folder"]`);
    await expect(badge).toBeVisible();
    const bb = (await badge.boundingBox())!;
    expect(intersects(bb, cb), 'failure tab and corner controls would collide').toBe(false);
    expect(intersects(bb, await boxOf(page, `${sel} > .folder-body`))).toBe(false);
    expect(bb.y).toBeGreaterThanOrEqual(0);
  });
});
