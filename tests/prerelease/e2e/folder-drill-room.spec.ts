import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken, flourishesDone } from '../helpers';

// A folder opened inside another that does not fit makes room: the outer box is drawn taller (on this
// screen only, never saved) and what is below it in its columns moves down. Needs real layout.

let seq = 0;
const made: string[] = [];
type Child = Record<string, unknown>;
type AnyNode = { id: string; content?: { children: AnyNode[] } };

const kid = (id: string, name: string, extra: Child = {}): Child => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, ...extra
});
const tile = (id: string, name: string, x: number, y: number): Child => kid(id, name, { placement: { x, y, w: 2, h: 2 } });
const folder = (id: string, name: string, box: { x: number; y: number; w: number; h: number } | null, children: Child[], extra: Child = {}): Child => ({
  id, kind: 'folder', name, display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
  ...(box ? { placement: box } : {}), content: { children }, ...extra
});
const kids = (id: (s: string) => string, n: number, prefix = 'K') =>
  Array.from({ length: n }, (_, i) => kid(id(`${prefix.toLowerCase()}${i + 1}`), `${prefix}${i + 1}`));

/** Import one dashboard (stored form, layoutVersion 2, one Main tab). */
async function importDash(page: Page, context: BrowserContext, children: (id: (s: string) => string) => Child[]) {
  const p = `m8c${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `room ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{ id: id('tab'), name: 'Main', order: 0, root: { columns: 24, children: children(id) } }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm8c.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
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
    expect(typeof rev, `cleanup: dashboard ${id} has a revision`).toBe('number');
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) }
    });
    expect(r.ok(), `cleanup: delete dashboard ${id}: ${r.status()} ${await r.text()}`).toBeTruthy();
  }
});

const node = (page: Page, id: string) => page.locator(`.tab-canvas [data-node-id="${id}"]`).first();
const nested = (page: Page, id: string) => page.locator(`.nested-box[data-nested-folder="${id}"]`).first();
const noRoom = (page: Page) => page.locator('[data-folder-no-room]');
const openSub = (page: Page, id: string) => node(page, id).locator('.folder-collapsed-tile').click();
async function rect(l: Locator) {
  await flourishesDone(l.page());
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}
async function placements(page: Page, dashId: string) {
  const cfg = await (await page.request.get('/api/config')).json();
  return JSON.stringify(cfg.dashboards.find((d: { id: string }) => d.id === dashId).tabs);
}
/** Every tile is drawn whole, inside the box of the sub-folder that holds it. */
async function allShown(page: Page, subId: string, tileIds: string[]) {
  const outer = await rect(nested(page, subId));
  for (const t of tileIds) {
    const b = await rect(node(page, t));
    expect(b.y + b.height, `${t} inside the box`).toBeLessThanOrEqual(outer.y + outer.height + 1);
  }
}

test.describe('a folder opened inside a folder makes room', () => {
  test('the cap is one screen below the navbar, measured from the one navbar height', async ({ page, context }) => {
    const d = await importDash(page, context, (id) => [
      folder(id('home'), 'Home', { x: 0, y: 0, w: 24, h: 4 }, [folder(id('sub'), 'Sub', null, kids(id, 80))])
    ]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(d.path);
    await openSub(page, d.id('sub'));
    await expect(nested(page, d.id('sub'))).toBeVisible();
    for (const size of [{ width: 1280, height: 800 }, { width: 1000, height: 600 }]) {
      await page.setViewportSize(size);
      const m = await page.evaluate(() => ({
        room: document.querySelector('.screen-room-probe')!.getBoundingClientRect().height,
        navbar: document.querySelector('.navbar')!.getBoundingClientRect().height
      }));
      expect(m.navbar, 'the probe knows the real navbar').toBeGreaterThan(0);
      expect(m.room).toBeCloseTo(size.height - m.navbar, 0);
    }
  });

  test('a placeholder below the folder moves down with everything else', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const d = await importDash(page, context, (id) => [
      folder(id('home'), 'Home', { x: 0, y: 0, w: 24, h: 4 }, [kid(id('a'), 'Alpha'), folder(id('sub'), 'Sub', null, kids(id, 24))]),
      tile(id('t'), 'Below', 0, 4),
      tile(id('odd'), 'Odd', 2, 4)
    ]);
    // A node this build can't draw never gets past the server: the read is altered on its way in.
    const spoil = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(spoil);
      else if (o && typeof o === 'object') {
        const n = o as Record<string, unknown>;
        if (n.id === d.id('odd')) n.kind = 'widget';
        Object.values(n).forEach(spoil);
      }
    };
    await page.route(/\/api\/config/, async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      spoil(json);
      await route.fulfill({ response: res, json });
    });
    const logged: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') logged.push(m.text()); });
    await page.goto(d.path);
    const held = page.locator('.tab-canvas .node-placeholder');
    await expect(held).toBeVisible();
    const before = await rect(held);
    await openSub(page, d.id('sub'));
    await expect(nested(page, d.id('sub'))).toBeVisible();
    const box = await rect(node(page, d.id('home')));
    const after = await rect(held);
    const below = await rect(node(page, d.id('t')));
    expect(after.y, 'it moved').toBeGreaterThan(before.y);
    expect(after.y, 'it is not under the folder').toBeGreaterThanOrEqual(box.y + box.height - 1);
    expect(after.y, 'level with the tile beside it').toBeCloseTo(below.y, 0);
    expect(logged.some((t) => t.includes("can't display node"))).toBe(true);
  });

  test('all its items show, what is below moves down, closing puts it back, nothing is saved, and it works signed out', async ({ page, context, browser }) => {
    const d = await importDash(page, context, (id) => [
      folder(id('home'), 'Home', { x: 0, y: 0, w: 24, h: 4 }, [
        kid(id('a'), 'Alpha'),
        folder(id('sub'), 'Sub', null, kids(id, 4))
      ]),
      folder(id('below'), 'Below', { x: 0, y: 4, w: 12, h: 4 }, [kid(id('b'), 'Beta')])
    ]);
    const tiles = [1, 2, 3, 4].map((n) => d.id(`k${n}`));
    const before = await placements(page, d.id('dash'));
    await page.goto(d.path);
    const home = node(page, d.id('home'));
    const below = node(page, d.id('below'));
    await expect(home).toBeVisible();
    const homeAt = await rect(home);
    const belowAt = await rect(below);

    await openSub(page, d.id('sub'));
    await expect(nested(page, d.id('sub'))).toBeVisible();
    await expect(noRoom(page)).toHaveCount(0);
    for (const t of tiles) await expect(node(page, t)).toBeVisible();
    await allShown(page, d.id('sub'), tiles);
    await expect(page.locator('[data-page-bar]')).toHaveCount(0);

    const homeOpen = await rect(home);
    const belowOpen = await rect(below);
    expect(homeOpen.height).toBeGreaterThan(homeAt.height);
    expect(belowOpen.y).toBeGreaterThanOrEqual(homeOpen.y + homeOpen.height - 1); // no overlap
    expect(belowOpen.y).toBeGreaterThan(belowAt.y);

    // Back up: the stored box and what is below return to their places.
    await nested(page, d.id('sub')).getByRole('button', { name: 'Minimise Sub' }).click();
    await expect(nested(page, d.id('sub'))).toHaveCount(0);
    await expect.poll(async () => (await rect(below)).y).toBeCloseTo(belowAt.y, 0);
    expect((await rect(home)).height).toBeCloseTo(homeAt.height, 0);

    // Drilled again, and reloaded: drill is this browser's memory; the saved layout is untouched.
    await openSub(page, d.id('sub'));
    await expect(nested(page, d.id('sub'))).toBeVisible();
    await page.reload();
    await expect(nested(page, d.id('sub'))).toBeVisible(); // this browser's memory, not the layout
    await expect(noRoom(page)).toHaveCount(0);
    expect(await placements(page, d.id('dash'))).toBe(before);

    // Signed out: a viewer gets the same, with nothing to resize.
    const anon = await browser.newContext({
      baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }
    });
    try {
      const p = await anon.newPage();
      await p.goto(d.path);
      await openSub(p, d.id('sub'));
      await expect(nested(p, d.id('sub'))).toBeVisible();
      await expect(noRoom(p)).toHaveCount(0);
      for (const t of tiles) await expect(node(p, t)).toBeVisible();
      await expect.poll(async () => (await rect(node(p, d.id('below')))).y).toBeGreaterThan(belowAt.y);
    } finally {
      await anon.close();
    }
    expect(await placements(page, d.id('dash'))).toBe(before);
  });

  test('only the columns it covers move; a tile beside it stays', async ({ page, context }) => {
    const d = await importDash(page, context, (id) => [
      folder(id('home'), 'Home', { x: 0, y: 0, w: 12, h: 4 }, [folder(id('sub'), 'Sub', null, kids(id, 4))]),
      tile(id('beside'), 'Beside', 14, 0),
      tile(id('under'), 'Under', 14, 4),
      tile(id('below'), 'Below', 0, 4)
    ]);
    await page.goto(d.path);
    await expect(node(page, d.id('home'))).toBeVisible();
    const beside = await rect(node(page, d.id('beside')));
    const under = await rect(node(page, d.id('under')));
    const below = await rect(node(page, d.id('below')));
    await openSub(page, d.id('sub'));
    await expect(nested(page, d.id('sub'))).toBeVisible();
    await expect(noRoom(page)).toHaveCount(0);
    await expect.poll(async () => (await rect(node(page, d.id('below')))).y).toBeGreaterThan(below.y);
    expect((await rect(node(page, d.id('beside')))).y).toBeCloseTo(beside.y, 0);
    expect((await rect(node(page, d.id('under')))).y).toBeCloseTo(under.y, 0);
  });

  test('60 tiles: the box stops at about one screen and the page bar pages the rest; minimising returns everything', async ({ page, context }) => {
    const d = await importDash(page, context, (id) => [
      folder(id('home'), 'Home', { x: 0, y: 0, w: 24, h: 4 }, [folder(id('sub'), 'Sub', null, kids(id, 60))]),
      tile(id('below'), 'Below', 0, 4)
    ]);
    await page.goto(d.path);
    const below = node(page, d.id('below'));
    await expect(below).toBeVisible();
    const belowAt = await rect(below);
    await openSub(page, d.id('sub'));
    await expect(nested(page, d.id('sub')).locator('[data-page-bar="next"]')).toBeVisible();
    await expect(noRoom(page)).toHaveCount(0);
    const home = await rect(node(page, d.id('home')));
    const cap = (await page.evaluate(() => window.innerHeight)) - 71;
    expect(home.height).toBeLessThanOrEqual(cap);
    expect(home.height).toBeGreaterThan(cap * 0.8);
    await expect(node(page, d.id('k1'))).toBeVisible();

    const perPage = Number(await nested(page, d.id('sub')).locator('.nested-body').getAttribute('data-folder-per-page'));
    await nested(page, d.id('sub')).locator('[data-page-bar="next"]').click();
    await expect(node(page, d.id(`k${perPage + 1}`))).toBeVisible();
    expect((await rect(node(page, d.id('home')))).height).toBeCloseTo(home.height, 0); // paging does not move the box

    await page.getByRole('button', { name: 'Minimise Home' }).click();
    await expect(nested(page, d.id('sub'))).toHaveCount(0);
    await expect.poll(async () => (await rect(below)).y).toBeLessThanOrEqual(belowAt.y + 1);
  });

  test('a folder three levels deep shows its items', async ({ page, context }) => {
    const d = await importDash(page, context, (id) => [
      folder(id('home'), 'Home', { x: 0, y: 0, w: 24, h: 4 }, [
        folder(id('s1'), 'One', null, [folder(id('s2'), 'Two', null, [folder(id('s3'), 'Three', null, kids(id, 5))])])
      ]),
      tile(id('below'), 'Below', 0, 4)
    ]);
    await page.goto(d.path);
    await openSub(page, d.id('s1'));
    await expect(noRoom(page)).toHaveCount(0);
    await openSub(page, d.id('s2'));
    await expect(noRoom(page)).toHaveCount(0);
    await openSub(page, d.id('s3'));
    await expect(nested(page, d.id('s3'))).toBeVisible();
    await expect(noRoom(page)).toHaveCount(0);
    for (let n = 1; n <= 5; n++) await expect(node(page, d.id(`k${n}`))).toBeVisible();
    await allShown(page, d.id('s3'), [1, 2, 3, 4, 5].map((n) => d.id(`k${n}`)));
    const home = await rect(node(page, d.id('home')));
    expect((await rect(node(page, d.id('below')))).y).toBeGreaterThanOrEqual(home.y + home.height - 1);
  });

  test('on a narrow screen the narrow-screen growth and the drill are one height: the larger, with no overlap', async ({ page, context }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    const d = await importDash(page, context, (id) => [
      folder(id('home'), 'Home', { x: 0, y: 0, w: 24, h: 4 }, [folder(id('sub'), 'Sub', null, kids(id, 12))]),
      folder(id('below'), 'Below', { x: 0, y: 4, w: 24, h: 4 }, [kid(id('b'), 'Beta')]),
      tile(id('last'), 'Last', 0, 8)
    ]);
    await page.goto(d.path);
    await openSub(page, d.id('sub'));
    await expect(nested(page, d.id('sub'))).toBeVisible();
    await expect(noRoom(page)).toHaveCount(0);
    for (let n = 1; n <= 12; n++) await expect(node(page, d.id(`k${n}`))).toBeVisible();
    const home = await rect(node(page, d.id('home')));
    const below = await rect(node(page, d.id('below')));
    const last = await rect(node(page, d.id('last')));
    expect(below.y).toBeGreaterThanOrEqual(home.y + home.height - 1);
    expect(last.y).toBeGreaterThanOrEqual(below.y + below.height - 1);
  });

  test('edit mode shows the stored box and says make it bigger; leaving it makes room again', async ({ page, context }) => {
    const d = await importDash(page, context, (id) => [
      folder(id('home'), 'Home', { x: 0, y: 0, w: 24, h: 4 }, [folder(id('sub'), 'Sub', null, kids(id, 4))]),
      tile(id('below'), 'Below', 0, 4)
    ]);
    await page.goto(d.path);
    const home = node(page, d.id('home'));
    await expect(home).toBeVisible();
    const storedH = (await rect(home)).height;
    await openSub(page, d.id('sub'));
    await expect(nested(page, d.id('sub'))).toBeVisible();
    await expect.poll(async () => (await rect(home)).height).toBeGreaterThan(storedH);

    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(noRoom(page)).toHaveCount(1);
    await expect(noRoom(page)).toHaveText('Not enough room — make the folder bigger.');
    expect((await rect(home)).height).toBeCloseTo(storedH, 0);

    await page.getByRole('button', { name: 'Exit Edit Mode' }).click();
    await expect(noRoom(page)).toHaveCount(0);
    await expect.poll(async () => (await rect(home)).height).toBeGreaterThan(storedH);
  });

  test('a phone stacks the folder and shows every item, never the note', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const d = await importDash(page, context, (id) => [
      folder(id('home'), 'Home', { x: 0, y: 0, w: 24, h: 4 }, [folder(id('sub'), 'Sub', null, kids(id, 12))]),
      tile(id('below'), 'Below', 0, 4)
    ]);
    await page.goto(d.path);
    await openSub(page, d.id('sub'));
    await expect(nested(page, d.id('sub'))).toBeVisible();
    await expect(noRoom(page)).toHaveCount(0);
    await expect(page.locator('[data-page-bar]')).toHaveCount(0);
    for (let n = 1; n <= 12; n++) await expect(node(page, d.id(`k${n}`))).toBeAttached();
    const home = await rect(node(page, d.id('home')));
    const lastTile = await rect(node(page, d.id('k12')));
    expect(lastTile.y + lastTile.height).toBeLessThanOrEqual(home.y + home.height + 1);
    expect((await rect(node(page, d.id('below')))).y).toBeGreaterThanOrEqual(home.y + home.height - 1);
  });

  test('too narrow for one item: a viewer gets the plain note', async ({ page, context }) => {
    const d = await importDash(page, context, (id) => [
      // 3 wide is this contents size's minimum: each inset level takes 18 px, so two in, one item is too wide.
      folder(id('home'), 'Home', { x: 0, y: 0, w: 3, h: 6 }, [
        folder(id('s1'), 'One', null, [folder(id('s2'), 'Two', null, kids(id, 4))])
      ])
    ]);
    await page.goto(d.path);
    await openSub(page, d.id('s1'));
    await expect(nested(page, d.id('s1'))).toBeVisible();
    await openSub(page, d.id('s2'));
    await expect(nested(page, d.id('s2'))).toBeVisible();
    await expect(noRoom(page)).toHaveCount(1);
    await expect(noRoom(page)).toHaveText('Not enough room to show this folder.');
  });
});
