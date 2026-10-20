import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M4 Task 9: layered backgrounds in a REAL browser (Chromium has layout, compositing and
// IntersectionObserver; jsdom has none of them).
//
// Not repeated here (already covered elsewhere, controller ruling for Task 9):
// - m4-status.spec.ts: a tile on under an off dashboard — badge, dialog text, notice, stored Dismiss.
// - m4-backgrounds.spec.ts: the folder picker (preset at 50% saved, reloaded, drawn), Inherit,
//   the failed-image badge for a missing (404) picture in edit mode, the maximised backdrop and
//   the corner controls.
//
// Added here:
// 1. A see-through folder (opacity 0) shows exactly what is behind it, measured in screen
//    pixels, while the tile inside it stays fully opaque.
// 2. At most four folder slideshows animate; scrolling moves the set; reduced motion and the
//    dashboard's "animated folder backgrounds" setting switch every one of them off.

let seq = 0;
const made: string[] = [];

const placement = (x: number, y: number, w = 1, h = 1) => ({ x, y, w, h });

type Child = Record<string, unknown>;

/** Import one dashboard whose Main tab holds `children(id)`; returns its path and id maker. */
async function importDash(
  page: Page,
  context: BrowserContext,
  children: (id: (s: string) => string) => Child[],
  opts: { background?: Record<string, unknown>; animated?: boolean | null } = {}
) {
  const p = `m4bs${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash: Record<string, unknown> = {
    id: id('dash'), name: `M4 bg status ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: opts.animated ?? null, defaultLayout: null
    },
    defaultLayout: 'grid',
    tabs: [{ id: id('tab'), name: 'Main', order: 0, layout: 'inherit', root: { columns: 12, children: children(id) } }]
  };
  if (opts.background) dash.background = opts.background;
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm4bs.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
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

const tile = (id: string, name: string, x = 0, y = 0, extra: Child = {}) => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, placement: placement(x, y), ...extra
});

type RGB = [number, number, number];

/** Screen colours at the given viewport points, read from one real screenshot (decoded by the browser). */
async function pixelsAt(page: Page, points: [number, number][]): Promise<RGB[]> {
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  return page.evaluate(
    async ({ b64, pts }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const scale = img.naturalWidth / window.innerWidth;
      return pts.map(([x, y]) => {
        const d = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
        return [d[0], d[1], d[2]] as [number, number, number];
      });
    },
    { b64: png.toString('base64'), pts: points }
  );
}
const dist = (a: RGB, b: RGB) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

test.describe('M4 layered backgrounds in a real browser', () => {
  test('a see-through folder (opacity 0) reveals the wallpaper it sits over; its tile stays opaque', async ({ page, context }) => {
    // A flat wallpaper (a colour, no overlay) makes the pixels deterministic: inside and outside
    // the folder must then read the same colour, unless the folder draws something of its own.
    const WALL: RGB = [200, 40, 40];
    const f = await importDash(
      page,
      context,
      (id) => [
        tile(id('anchor'), 'Anchor', 11, 0),
        // The see-through folder: a vivid green colour look at opacity 0 — green must NOT show.
        {
          id: id('clear'), kind: 'folder', name: 'Clear', layout: 'inherit', display: 'expanded', shape: 'rounded',
          showTitle: false, color: '#00ff00', opacity: 0, placement: placement(0, 0, 6, 4),
          content: {
            columns: 6,
            children: [tile(id('inner'), 'Inner', 0, 0, { color: '#0000ff', opacity: 1 })]
          }
        },
        // A control: the same green, fully opaque — proves the sampling would see a folder colour.
        {
          id: id('solid'), kind: 'folder', name: 'Solid', layout: 'inherit', display: 'expanded', shape: 'rounded',
          showTitle: false, color: '#00ff00', opacity: 1, placement: placement(6, 0, 4, 4),
          content: { columns: 4, children: [tile(id('s-t'), 'SolidTile')] }
        }
      ],
      { background: { type: 'color', value: '#c82828', overlayOpacity: 0, overlayBlur: 0 } }
    );
    await page.goto(f.path);
    const clear = page.locator(`[data-node-id="${f.id('clear')}"]`);
    const solid = page.locator(`[data-node-id="${f.id('solid')}"]`);
    const inner = page.locator(`[data-node-id="${f.id('inner')}"]`);
    await expect(clear).toBeVisible();
    await expect(inner).toBeVisible();
    await expect(page.locator('.background-root[data-bg-level="dashboard"] .background-color')).toHaveCount(1);
    // No hover effect anywhere near the samples.
    await page.mouse.move(1, 1);

    const cb = (await clear.boundingBox())!;
    const sb = (await solid.boundingBox())!;
    const ib = (await inner.boundingBox())!;
    // Inside the clear folder, well away from its tile (top-left cell) and its border.
    const inside: [number, number] = [cb.x + cb.width * 0.75, cb.y + cb.height * 0.75];
    // Just outside the folder: below its bottom edge, still on the canvas.
    const outside: [number, number] = [cb.x + cb.width * 0.75, cb.y + cb.height + 12];
    const solidIn: [number, number] = [sb.x + sb.width * 0.5, sb.y + sb.height * 0.8];
    // On the inner tile's face, near its left edge (clear of the icon and label).
    const tileFace: [number, number] = [ib.x + 6, ib.y + ib.height / 2];
    // The page must actually be tall enough to hold the "outside" sample in the canvas.
    expect(outside[1]).toBeLessThan(page.viewportSize()!.height);

    await expect
      .poll(async () => {
        const [i, o] = await pixelsAt(page, [inside, outside]);
        return dist(i, o);
      }, { message: 'inside vs just outside the see-through folder' })
      .toBeLessThanOrEqual(3);

    const [i, o, s, t] = await pixelsAt(page, [inside, outside, solidIn, tileFace]);
    // What both show is the wallpaper itself (no overlay configured).
    expect(dist(o, WALL), `outside ${o} vs wallpaper ${WALL}`).toBeLessThanOrEqual(6);
    expect(dist(i, WALL), `inside ${i} vs wallpaper ${WALL}`).toBeLessThanOrEqual(6);
    // The opaque control folder really draws its green (so the method can see a folder surface).
    expect(dist(s, [0, 255, 0]), `solid folder ${s}`).toBeLessThanOrEqual(6);

    // The tile inside the see-through folder is fully opaque: nothing on its path fades it ...
    const chainOpacity = await inner.evaluate((el) => {
      let o = 1;
      for (let n: Element | null = el.querySelector('.entry') ?? el; n; n = n.parentElement) {
        o *= parseFloat(getComputedStyle(n).opacity);
      }
      return o;
    });
    expect(chainOpacity).toBe(1);
    // ... and on screen its face is its own blue, not blended with the wallpaper.
    expect(dist(t, [0, 0, 255]), `tile face ${t}`).toBeLessThanOrEqual(6);
  });

  // ---- the cap of four (Review Focus 3)

  const SLIDES = ['/presets/network-grid.jpg', '/presets/dark-gradient.jpg'];
  const slideFolder = (id: (s: string) => string, key: string, x: number, y: number) => ({
    id: id(key), kind: 'folder', name: `Slides ${key}`, layout: 'inherit', display: 'expanded', shape: 'rounded',
    showTitle: false, placement: placement(x, y, 2, 2),
    background: { type: 'slideshow', images: SLIDES, interval: 30, transition: 'crossfade' },
    content: { columns: 2, children: [tile(id(`${key}-t`), `T${key}`)] }
  });
  /** 10 slideshow folders on the first screen (two rows of five) and 5 more far below. */
  const slideshowDash = (id: (s: string) => string) => {
    const out: Child[] = [];
    for (let i = 0; i < 10; i++) out.push(slideFolder(id, `top${i}`, (i % 5) * 2, Math.floor(i / 5) * 2));
    for (let i = 0; i < 5; i++) out.push(slideFolder(id, `low${i}`, i * 2, 30));
    out.push(tile(id('anchor'), 'Anchor', 11, 0));
    return out;
  };
  const folderLayer = (page: Page, folderId: string) =>
    page.locator(`[data-node-id="${folderId}"] > .folder-surface > .background-root[data-bg-level="folder"]`);
  const animatingIds = (page: Page) =>
    page.locator('.folder-surface > .background-root[data-bg-level="folder"][data-animate="true"]').evaluateAll((els) =>
      els.map((e) => e.closest('[data-node-id]')?.getAttribute('data-node-id') ?? '?').sort()
    );
  const inViewport = (page: Page, ids: string[]) =>
    page.evaluate((ids) => ids.filter((id) => {
      const r = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      return !!r && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    }), ids);

  test('only four folder slideshows animate; scrolling moves the set; reduced motion stops them all', async ({ page, context }) => {
    const f = await importDash(page, context, slideshowDash, { animated: true });
    const top = Array.from({ length: 10 }, (_, i) => f.id(`top${i}`));
    const low = Array.from({ length: 5 }, (_, i) => f.id(`low${i}`));
    await page.goto(f.path);
    await page.mouse.move(1, 1);
    for (const id of top) await expect(folderLayer(page, id), `layer of ${id}`).toHaveCount(1);
    // All ten are really on the first screen, and the lower five are not.
    expect(await inViewport(page, top)).toEqual(top);
    expect(await inViewport(page, low)).toEqual([]);

    await expect.poll(async () => (await animatingIds(page)).length).toBe(4);
    const first = await animatingIds(page);
    for (const id of first) expect(top, `${id} animates but is not a top folder`).toContain(id);
    // The rest of the visible ones are drawn, still.
    for (const id of top.filter((x) => !first.includes(x))) {
      await expect(folderLayer(page, id)).toHaveAttribute('data-animate', 'false');
    }

    // Scroll the lower row into view (the top rows leave the screen): the set moves with it.
    await page.locator(`[data-node-id="${low[4]}"]`).scrollIntoViewIfNeeded();
    await expect.poll(async () => inViewport(page, top)).toEqual([]);
    await expect
      .poll(async () => {
        const now = await animatingIds(page);
        return now.length === 4 && now.every((id) => low.includes(id));
      }, { message: 'after scrolling, the four animating folders are lower ones' })
      .toBe(true);
    for (const id of first) await expect(folderLayer(page, id)).toHaveAttribute('data-animate', 'false');

    // Reduced motion: none at all, live (no reload).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(async () => (await animatingIds(page)).length).toBe(0);
    // The pictures are still drawn, just still.
    for (const id of low) await expect(folderLayer(page, id)).toHaveAttribute('data-animate', 'false');
    // And back.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(async () => (await animatingIds(page)).length).toBe(4);

    // Reduced motion from the first paint: nothing ever animates.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(f.path);
    for (const id of top) await expect(folderLayer(page, id)).toHaveCount(1);
    await expect.poll(async () => (await animatingIds(page)).length).toBe(0);
  });

  test('the dashboard\'s "animated folder backgrounds" off: no folder animates', async ({ page, context }) => {
    const f = await importDash(page, context, slideshowDash, { animated: false });
    const top = Array.from({ length: 10 }, (_, i) => f.id(`top${i}`));
    await page.goto(f.path);
    for (const id of top) await expect(folderLayer(page, id), `layer of ${id}`).toHaveCount(1);
    expect(await inViewport(page, top)).toEqual(top);
    // Give the controller its observer callbacks: every visible folder is drawn, none animates.
    for (const id of top) await expect(folderLayer(page, id)).toHaveAttribute('data-animate', 'false');
    await expect.poll(async () => (await animatingIds(page)).length).toBe(0);
  });
});
