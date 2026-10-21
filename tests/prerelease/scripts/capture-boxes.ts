import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCsrfToken } from '../helpers';

// Captures the pixel box of every [data-node-id] element and every tab button, for every tab of
// every fixture dashboard, at 1280x900 and 1920x1080, into fixtures/grid-before-boxes.json.
//
// Run it ONCE on the pre-change build (finer-grid plan, Task 0) to record the "before" boxes;
// finer-grid.spec.ts compares the post-change build against that file.
//
//   npx playwright test --config=capture-boxes.config.ts
//
// Deterministic by construction: ids come from the fixtures, keys are sorted, numbers are rounded
// to 0.01 px, and the layout is awaited by polling (frames), never by sleeping.

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../fixtures');
const FIXTURES = ['v3-showcase-old-form.json', 'synthetic-sample-old-form.json', 'synthetic-weavers-old-form.json'];
const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 1920, height: 1080 }];
const OUT = path.join(FIX, 'grid-before-boxes.json');

type Box = { x: number; y: number; w: number; h: number };
type TabRec = { nodes: Record<string, Box>; tabs: Record<string, Box> };
type Dash = { id: string; path: string; tabs: { id: string; name: string }[] };

/** Every node and tab-button box in page coordinates, keyed by data-node-id / tab aria-label. */
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const nodes: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const tabs: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const add = (out: typeof nodes, key: string, el: Element) => {
      const r = el.getBoundingClientRect();
      let k = key;
      for (let i = 2; k in out; i++) k = `${key}#${i}`;
      out[k] = { x: r2(r.x + scrollX), y: r2(r.y + scrollY), w: r2(r.width), h: r2(r.height) };
    };
    document.querySelectorAll('[data-node-id]').forEach((el) => add(nodes, el.getAttribute('data-node-id') ?? '', el));
    document.querySelectorAll('[data-dashboard-tabs] [role="tab"]').forEach((el) => add(tabs, el.getAttribute('aria-label') ?? '', el));
    return { nodes, tabs };
  });
}

/** Resolves once the boxes have not changed for 30 consecutive animation frames (polling, no sleeps). */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const w = window as unknown as { __prev?: string; __same?: number };
    const sig = JSON.stringify([...document.querySelectorAll('[data-node-id], [data-dashboard-tabs] [role="tab"]')]
      .map((el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
    if (sig === w.__prev) w.__same = (w.__same ?? 0) + 1; else { w.__prev = sig; w.__same = 0; }
    return (w.__same ?? 0) >= 30 && document.querySelectorAll('[data-node-id]').length > 0;
  }, undefined, { polling: 'raf', timeout: 20_000 });
}

const sortKeys = (o: unknown): unknown => Array.isArray(o) ? o.map(sortKeys)
  : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys((o as Record<string, unknown>)[k])])) : o;

test('capture the pre-change layout boxes', async ({ page, context }) => {
  test.setTimeout(240_000);
  const dashboards: Record<string, unknown>[] = [];
  for (const f of FIXTURES) {
    const b = JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
    dashboards.push(...b.config.dashboards);
  }
  const bundle = { format: 'hops-export', schemaVersion: 3, exportType: 'full', config: { dashboards } };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'fixtures.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) } },
  });
  expect(r.status(), await r.text()).toBe(200);
  const cfg = await (await page.request.get('/api/config')).json();
  const stored: Dash[] = dashboards.map((d) => {
    const s = cfg.dashboards.find((x: Dash) => x.id === d.id);
    expect(s, `fixture dashboard ${d.id} was imported`).toBeTruthy();
    return s;
  });

  const result: Record<string, Record<string, Record<string, TabRec>>> = {};
  for (const d of stored) {
    result[d.id] = {};
    for (const vp of VIEWPORTS) {
      const key = `${vp.width}x${vp.height}`;
      result[d.id][key] = {};
      await page.setViewportSize(vp);
      await page.goto(d.path);
      for (const t of d.tabs) {
        const tabBtn = page.getByRole('tab', { name: `Switch to ${t.name} tab`, exact: true });
        await tabBtn.click();
        await expect(tabBtn).toHaveAttribute('aria-selected', 'true');
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        // Tab buttons are keyed by tab id; node boxes by node id.
        const snap = await snapshot(page);
        const tabs: Record<string, Box> = {};
        for (const tt of d.tabs) {
          const box = snap.tabs[`Switch to ${tt.name} tab`] ?? snap.tabs[tt.name];
          expect(box, `tab button ${tt.name} present in ${d.id} at ${key}`).toBeTruthy();
          tabs[tt.id] = box;
        }
        expect(Object.keys(snap.nodes).length, `${d.id}/${t.id} at ${key} renders nodes`).toBeGreaterThan(0);
        result[d.id][key][t.id] = { nodes: snap.nodes, tabs };
      }
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(sortKeys(result), null, 1) + '\n');
});
