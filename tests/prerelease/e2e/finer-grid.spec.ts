import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import { getCsrfToken } from '../helpers';
import { BEFORE_BOXES, VIEWPORTS, captureBoxes, fixtureDashboards, importFixtures, type Box, type BoxFile, type Dash } from '../boxes';

// Finer grid (spec §9, plan Task 3): pixel-equivalence acceptance. The three OLD-form (12-column)
// fixtures are imported through the real import (no gridUnit marker, so the server's old-form
// conversion doubles them), and every node and tab box must be where the pre-change build drew it
// (fixtures/grid-before-boxes.json, captured once on 9d445a3), within 1 px, at 1280 and 1920.
//
// Nothing may be skipped silently: the box sets must match key for key, and the totals are pinned
// (116 node + 27 tab boxes per viewport, 286 overall), so a shrunken capture or a box that stopped
// rendering fails here rather than passing by omission.

const NODES_PER_VIEWPORT = 116;
const TABS_PER_VIEWPORT = 27;
const TOL = 1;

const made: Dash[] = [];
test.afterEach(async ({ page, context }) => {
  while (made.length) {
    const d = made.pop()!;
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((x: Dash & { revision: number }) => x.id === d.id)?.revision;
    expect(typeof rev, `cleanup: dashboard ${d.id} has a revision`).toBe('number');
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(d.id)}?revision=${rev}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    });
    expect(r.ok(), `cleanup: delete dashboard ${d.id}: ${r.status()} ${await r.text()}`).toBeTruthy();
  }
});

/** Every difference between the recorded and the rendered boxes, plus how many boxes were compared. */
function compare(before: BoxFile, now: BoxFile) {
  const diffs: string[] = [];
  const matched: Record<string, { nodes: number; tabs: number }> = {};
  const sameKeys = (where: string, a: object, b: object) => {
    for (const k of Object.keys(a)) if (!(k in b)) diffs.push(`${where}: ${k} is missing now`);
    for (const k of Object.keys(b)) if (!(k in a)) diffs.push(`${where}: ${k} is new (not in the before boxes)`);
  };
  const near = (where: string, a: Box, b: Box) => {
    for (const c of ['x', 'y', 'w', 'h'] as const)
      if (Math.abs(a[c] - b[c]) > TOL) diffs.push(`${where}: ${c} ${a[c]} -> ${b[c]}`);
    return true;
  };
  sameKeys('dashboards', before, now);
  for (const [dash, byVp] of Object.entries(before)) {
    if (!now[dash]) continue;
    sameKeys(dash, byVp, now[dash]);
    for (const [vp, byTab] of Object.entries(byVp)) {
      if (!now[dash][vp]) continue;
      matched[vp] ??= { nodes: 0, tabs: 0 };
      sameKeys(`${dash} ${vp}`, byTab, now[dash][vp]);
      for (const [tab, rec] of Object.entries(byTab)) {
        const got = now[dash][vp][tab];
        if (!got) continue;
        for (const kind of ['nodes', 'tabs'] as const) {
          sameKeys(`${dash} ${vp} ${tab} ${kind}`, rec[kind], got[kind]);
          for (const [k, box] of Object.entries(rec[kind])) {
            if (!got[kind][k]) continue;
            near(`${dash} ${vp} ${tab} ${kind} ${k}`, box, got[kind][k]);
            matched[vp][kind]++;
          }
        }
      }
    }
  }
  return { diffs, matched };
}

test.describe('finer grid: old layouts look exactly as before', () => {
  test('every node and tab box of the imported old-form fixtures is within 1 px of the pre-change build (1280, 1920)', async ({ page, context }) => {
    test.setTimeout(240_000);
    const before: BoxFile = JSON.parse(fs.readFileSync(BEFORE_BOXES, 'utf8'));
    const stored = await importFixtures(page, context);
    made.push(...stored);

    // The imported documents are in the finer-grid form: the marker, and grid roots of 24 columns
    // (the old 12 doubled); free roots keep their design-unit columns.
    const cfg = await (await page.request.get('/api/config')).json();
    expect(cfg.gridUnit, 'GET /api/config carries the finer-grid marker').toBe(2);
    const exp = await page.request.get('/api/config/export');
    expect(exp.status()).toBe(200);
    expect((await exp.json()).config.gridUnit, 'the export carries the finer-grid marker').toBe(2);
    const authored = new Map(fixtureDashboards().map((d) => [d.id as string, d as unknown as Dash]));
    let gridRoots = 0;
    for (const d of stored) {
      const old = authored.get(d.id)!;
      for (const t of d.tabs) {
        const was = old.tabs.find((x) => x.id === t.id)!;
        const mode = t.layout === 'grid' || t.layout === 'free' ? t.layout : (d.defaultLayout ?? 'grid');
        if (mode === 'grid') {
          gridRoots++;
          expect(was.root.columns, `${d.id}/${t.id} was authored with 12 columns`).toBe(12);
          expect(t.root.columns, `${d.id}/${t.id}: grid root columns`).toBe(24);
        } else {
          expect(t.root.columns, `${d.id}/${t.id}: free root columns unchanged`).toBe(was.root.columns);
        }
      }
    }
    expect(gridRoots, 'grid tabs checked').toBe(6);

    const now = await captureBoxes(page, stored);
    const { diffs, matched } = compare(before, now);
    expect(diffs, `${diffs.length} box differences:\n${diffs.join('\n')}`).toEqual([]);
    // Equal counts: every recorded box was compared, at both viewports.
    for (const vp of VIEWPORTS) {
      const key = `${vp.width}x${vp.height}`;
      expect(matched[key], `boxes compared at ${key}`).toEqual({ nodes: NODES_PER_VIEWPORT, tabs: TABS_PER_VIEWPORT });
    }
    const total = Object.values(matched).reduce((s, m) => s + m.nodes + m.tabs, 0);
    expect(total, 'boxes compared overall').toBe(2 * (NODES_PER_VIEWPORT + TABS_PER_VIEWPORT));
    test.info().annotations.push({ type: 'boxes', description: `${total} of ${total} boxes within ${TOL}px` });
  });
});
