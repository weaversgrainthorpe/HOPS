import { describe, it, expect } from 'vitest';
import { readingOrder, clampPlacement, previewChildren, planCanvas, isRenderable, isPlaced } from './geometry';
import {
  containerMetrics, nodeBox, folderChrome, folderContentBox, folderInnerMetrics,
  overlayBodyPx, scrollbarPx, ROOT_COLUMNS, overlayMetrics, OVERLAY_PANEL_CHROME_PX, pointToCell
} from './geometry';
import type { Container } from '../types/layout';
import type { FolderNode, LayoutNode, LayoutTab, Placement } from '../types/layout';

const p = (x: number, y: number, w = 1, h = 1): Placement => ({ x, y, w, h });
/** A tile; `pl` only on a tab (M5: folder contents have no placements). */
const tile = (id: string, pl?: Placement): LayoutNode =>
  ({ kind: 'tile', id, name: id, url: 'http://x', ...(pl ? { placement: pl } : {}) }) as unknown as LayoutNode;
const folder = (children: LayoutNode[] = []): FolderNode => ({
  kind: 'folder', id: 'f', name: 'f', display: 'collapsed', size: 'medium', contentSize: 'medium', placement: p(0, 0),
  content: { children }
});
const tab = (over: Partial<LayoutTab> = {}): LayoutTab =>
  ({ id: 't', name: 't', root: { columns: 24, children: [] }, ...over });

describe('readingOrder (tab level)', () => {
  it('orders by y then x', () => {
    const r = readingOrder([{ placement: p(1, 0) }, { placement: p(0, 1) }, { placement: p(0, 0) }]);
    expect(r.map((n) => [n.placement.x, n.placement.y])).toEqual([[0, 0], [1, 0], [0, 1]]);
  });
  it('equal placements keep array order and input is not mutated', () => {
    const input = [{ id: 1, placement: p(0, 0) }, { id: 2, placement: p(0, 0) }, { id: 3, placement: p(0, 0) }];
    expect(readingOrder(input).map((n) => n.id)).toEqual([1, 2, 3]);
    expect(input.map((n) => n.id)).toEqual([1, 2, 3]);
  });
});

describe('clampPlacement', () => {
  it('clips width to the right edge', () => {
    expect(clampPlacement({ x: 10, y: 0, w: 6, h: 1 }, 12)).toEqual({ x: 10, y: 0, w: 2, h: 1 });
  });
  it('lifts negatives and zeros to minimums', () => {
    expect(clampPlacement({ x: -3, y: -1, w: 0, h: 0 }, 12)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
  it('keeps z', () => {
    expect(clampPlacement({ x: 0, y: 0, w: 1, h: 1, z: 3 }, 12).z).toBe(3);
  });
});

describe('previewChildren', () => {
  const mk = (n: number) => folder(Array.from({ length: n }, (_, i) => tile('t' + i)));
  it('caps at 4', () => {
    expect(previewChildren(mk(0))).toHaveLength(0);
    expect(previewChildren(mk(1))).toHaveLength(1);
    expect(previewChildren(mk(6))).toHaveLength(4);
  });
});

describe('planCanvas', () => {
  it('grid at a desktop width, stacked below the phone breakpoint', () => {
    expect(planCanvas(1440, tab())).toEqual({ kind: 'grid', cellPx: 60 });
    expect(planCanvas(767, tab())).toEqual({ kind: 'stacked' });
  });
});

describe('isRenderable / isPlaced', () => {
  it('accepts valid tiles and folders, with or without a placement', () => {
    expect(isRenderable(tile('a', p(0, 0)))).toBe(true);
    expect(isRenderable(tile('a'))).toBe(true);
    expect(isRenderable(folder([tile('a')]))).toBe(true);
  });
  it('rejects unknown kind and bad folder content; a bad placement is not placed', () => {
    expect(isRenderable({ kind: 'widget', placement: p(0, 0) })).toBe(false);
    expect(isPlaced({ kind: 'tile', id: 'a' })).toBe(false);
    expect(isPlaced({ kind: 'tile', placement: { x: 'a', y: 0, w: 1, h: 1 } })).toBe(false);
    expect(isRenderable({ kind: 'folder', placement: p(0, 0), content: {} })).toBe(false);
    expect(isRenderable(null)).toBe(false);
  });
});

describe('robustness', () => {
  it('planCanvas never returns an undrawable plan', () => {
    for (const w of [0, NaN, -10, Infinity]) {
      expect(planCanvas(w, tab())).toEqual({ kind: 'stacked' });
    }
    for (const columns of [0, -1, NaN]) {
      expect(planCanvas(1440, tab({ root: { columns, children: [] } }))).toEqual({ kind: 'grid', cellPx: 60 });
    }
    expect(planCanvas(1440, { id: 't', name: 't' } as unknown as LayoutTab)).toEqual({ kind: 'grid', cellPx: 60 });
  });
  const bad = [null, 'str', { kind: 'tile', id: 'np' }] as unknown as { placement?: Placement }[];
  it('readingOrder puts malformed children last, in array order, without throwing', () => {
    const v1 = { placement: p(1, 0) }, v0 = { placement: p(0, 0) };
    const r = readingOrder([bad[0], v1, bad[1], bad[2], v0]);
    expect(r).toEqual([v0, v1, bad[0], bad[1], bad[2]]);
  });
  it('previewChildren skips non-renderable children and keeps the order', () => {
    const f = folder([null, tile('a'), 'x', tile('b')] as unknown as LayoutNode[]);
    expect(previewChildren(f).map((n) => n.id)).toEqual(['a', 'b']);
  });
  it('clampPlacement guards non-finite and fractional values', () => {
    expect(clampPlacement({ x: NaN, y: Infinity, w: NaN, h: NaN }, NaN)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(clampPlacement({ x: 1.7, y: 2.9, w: 2.5, h: 1.2 }, 12)).toEqual({ x: 1, y: 2, w: 2, h: 1 });
  });
});

describe('clampPlacement z validation', () => {
  const base = { x: 0, y: 0, w: 1, h: 1 };
  it('drops non-numeric and NaN z, truncates, and clamps', () => {
    expect(clampPlacement({ ...base, z: '1;background:url(https://evil/x)' as any }, 12).z).toBeUndefined();
    expect(clampPlacement({ ...base, z: NaN }, 12).z).toBeUndefined();
    expect(clampPlacement({ ...base, z: Infinity }, 12).z).toBeUndefined();
    expect(clampPlacement({ ...base, z: 2.7 }, 12).z).toBe(2);
    expect(clampPlacement({ ...base, z: 1e9 }, 12).z).toBe(1000);
    expect(clampPlacement({ ...base, z: -1e9 }, 12).z).toBe(-1000);
  });
});

// ---- one geometry source (containerMetrics / nodeBox / folderChrome) ----

const ffold = (over: Partial<FolderNode> = {}): FolderNode => ({
  kind: 'folder', id: 'ff', name: 'ff', display: 'expanded', size: 'medium', contentSize: 'medium',
  placement: p(0, 0, 5, 4), content: { children: [] }, ...over
});

describe('containerMetrics: one columns fallback everywhere', () => {
  const root = (columns: unknown): Container => ({ columns, children: [] }) as unknown as Container;
  for (const bad of [0, -2, undefined, NaN]) {
    it(`root columns ${String(bad)} falls back to ROOT_COLUMNS, as planCanvas and clampPlacement do`, () => {
      const m = containerMetrics(root(bad), 1440);
      expect(m.columns).toBe(ROOT_COLUMNS);
      expect(m.unitPx).toBe(60); // 1440 / 24
      const plan = planCanvas(1440, tab({ root: root(bad) }));
      expect(plan).toEqual({ kind: 'grid', cellPx: m.unitPx });
      expect(clampPlacement({ x: 40, y: 0, w: 1, h: 1 }, bad as number).x).toBe(ROOT_COLUMNS - 1);
    });
  }
  it('fractional columns floor the same way for a root, planCanvas and clampPlacement', () => {
    const r = containerMetrics(root(2.7), 1000);
    expect(r.columns).toBe(2);
    expect(r.unitPx).toBe(500);
    expect(planCanvas(1000, tab({ root: root(2.7) }))).toEqual({ kind: 'grid', cellPx: 500 });
    expect(clampPlacement({ x: 5, y: 0, w: 1, h: 1 }, 2.7).x).toBe(1);
  });
  it('rows default to square cells; rowPx overrides', () => {
    const c = root(12);
    expect(containerMetrics(c, 1200).rowPx).toBe(100);
    expect(containerMetrics(c, 1200, { rowPx: 40 }).rowPx).toBe(40);
  });
  it('never returns non-finite sizes', () => {
    for (const w of [NaN, -5, Infinity]) {
      const m = containerMetrics(root(12), w);
      expect(Number.isFinite(m.unitPx) && m.unitPx >= 0).toBe(true);
      expect(Number.isFinite(m.rowPx) && m.rowPx >= 0).toBe(true);
    }
  });
});

describe('nodeBox', () => {
  const m = containerMetrics({ columns: 12, children: [] }, 1200, { rowPx: 50 });
  it('floors fractional h (and w, x, y) after clampPlacement', () => {
    expect(nodeBox({ x: 1.5, y: 2.2, w: 2.9, h: 2.7 }, m)).toEqual({ leftPx: 100, topPx: 100, widthPx: 200, heightPx: 100 });
  });
  it('clamps to the container width', () => {
    const b = nodeBox({ x: 11, y: 0, w: 6, h: 1 }, m);
    expect(b.leftPx + b.widthPx).toBe(m.innerWidthPx);
  });
});

describe('folderChrome', () => {
  it('the folder-tab look has its own values, different from the rounded look', () => {
    expect(folderChrome('folder-tab', true)).not.toEqual(folderChrome(undefined, true));
    expect(folderChrome('rounded', true)).toEqual(folderChrome(undefined, true));
  });
  it('no title means no title bar', () => {
    expect(folderChrome(undefined, false).titlePx).toBe(0);
    expect(folderChrome('folder-tab', false).titlePx).toBe(0);
    expect(folderChrome(undefined, true).titlePx).toBeGreaterThan(0);
  });
  it('folderContentBox subtracts the chrome', () => {
    const ch = folderChrome(undefined, true);
    const box = { leftPx: 0, topPx: 0, widthPx: 600, heightPx: 400 };
    expect(folderContentBox(ffold(), box, ch)).toEqual({ widthPx: 600 - ch.padXPx, heightPx: 400 - ch.titlePx - ch.padYPx });
  });
});

describe("an open folder's contents (M5: in order, at its contents size, in the tab's cell)", () => {
  const gp = containerMetrics({ columns: 24, children: [] }, 1440); // 60 px cells
  it('the item side is the contents span in tab cells, whatever the folder width', () => {
    for (const w of [6, 12, 20]) {
      const inner = folderInnerMetrics(ffold({ placement: p(0, 0, w, 6) }), gp);
      expect(inner.unitPx).toBe(60);
      expect(inner.flow!.span).toBe(2);
    }
  });
  it('as many per row as fit the content box (never fewer than one)', () => {
    const ch = folderChrome(undefined, true);
    const inner = folderInnerMetrics(ffold({ placement: p(0, 0, 12, 6) }), gp);
    expect(inner.flow!.perRow).toBe(Math.floor((12 * 60 - ch.padXPx) / 120));
    expect(folderInnerMetrics(ffold({ placement: p(0, 0, 1, 6) }), gp).flow!.perRow).toBe(1);
  });
  it('a folder without a placement (inside a folder) still has sane metrics', () => {
    const inner = folderInnerMetrics(ffold({ placement: undefined }), gp);
    expect(inner.flow).toEqual({ span: 2, perRow: 1 });
    expect(inner.innerWidthPx).toBe(0);
  });
});

describe('overlay viewport width', () => {
  it('subtracts a measured 15px scrollbar', () => {
    expect(scrollbarPx(1000, 985)).toBe(15);
    expect(overlayBodyPx(1000, 985)).toBe(overlayBodyPx(985, 985));
    expect(overlayBodyPx(1000, 985)).toBeLessThan(overlayBodyPx(1000, 1000));
  });
  it('an unmeasurable clientWidth (0) means no scrollbar, never a zero-width body', () => {
    expect(scrollbarPx(400, 0)).toBe(0);
    expect(overlayBodyPx(400, 0)).toBe(400 - 32 - 34);
  });
});

describe('overlayMetrics (one source for overlay and maximised panels)', () => {
  const kids = (n: number) => Array.from({ length: n }, (_, i) => tile('k' + i));
  it('keeps the dashboard cell when the viewport allows; as many per row as it has; panel = content + chrome', () => {
    const o = overlayMetrics({ kind: 'grid', cellPx: 60 }, ffold({ content: { children: kids(3) } }), 2000);
    expect(o.metrics.unitPx).toBe(60);
    expect(o.metrics.flow).toEqual({ span: 2, perRow: 3 });
    expect(o.metrics.innerWidthPx).toBe(360);
    expect(o.panelWidthPx).toBe(360 + OVERLAY_PANEL_CHROME_PX);
  });
  it('wraps at the body width', () => {
    const o = overlayMetrics({ kind: 'grid', cellPx: 60 }, ffold({ content: { children: kids(10) } }), 500);
    expect(o.metrics.flow!.perRow).toBe(4); // 500 / 120
  });
  it('shrinks the cell when even one item is wider than the body', () => {
    const o = overlayMetrics({ kind: 'grid', cellPx: 60 }, ffold({ contentSize: 'large', content: { children: kids(1) } }), 200);
    expect(o.metrics.unitPx).toBe(50); // 200 / 4
    expect(o.metrics.innerWidthPx).toBe(200);
  });
});

describe('pointToCell (M3 Task 6: right-clicked cell)', () => {
  it('maps a point inside the container to the cell under it, from the metrics', () => {
    const m = containerMetrics({ columns: 12, children: [] }, 1200);
    expect(pointToCell(m, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(pointToCell(m, 250, 199)).toEqual({ x: 2, y: 1 });
  });
  it('clamps to the columns and never goes negative', () => {
    const m = containerMetrics({ columns: 4, children: [] }, 400);
    expect(pointToCell(m, 5000, -20)).toEqual({ x: 3, y: 0 });
  });
  it('degenerate metrics give the origin', () => {
    const m = containerMetrics({ columns: 12, children: [] }, 0);
    expect(pointToCell(m, 50, 50)).toEqual({ x: 0, y: 0 });
  });
});
