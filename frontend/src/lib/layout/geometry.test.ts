import { describe, it, expect } from 'vitest';
import {
  resolveMode, readingOrder, clampPlacement, previewChildren, planCanvas, isRenderable
} from './geometry';
import {
  containerMetrics, nodeBox, folderChrome, folderContentBox, folderInnerMetrics, requiredFolderHeightPx,
  overlayBodyPx, scrollbarPx, ROOT_COLUMNS, overlayMetrics, OVERLAY_PANEL_CHROME_PX, pointToCell
} from './geometry';
import type { Container } from '../types/layout';
import type { FolderNode, LayoutDashboard, LayoutNode, LayoutTab, Placement } from '../types/layout';

const p = (x: number, y: number, w = 1, h = 1): Placement => ({ x, y, w, h });
const tile = (id: string, pl: Placement): LayoutNode =>
  ({ kind: 'tile', id, name: id, url: 'http://x', placement: pl }) as unknown as LayoutNode;
const folder = (layout?: FolderNode['layout'], children: LayoutNode[] = []): FolderNode => ({
  kind: 'folder', id: 'f', name: 'f', layout, display: 'collapsed', placement: p(0, 0),
  content: { columns: 4, children }
});
const tab = (over: Partial<LayoutTab> = {}): LayoutTab =>
  ({ id: 't', name: 't', root: { columns: 12, children: [] }, ...over });
const dash = (over: Partial<LayoutDashboard> = {}): LayoutDashboard =>
  ({ id: 'd', name: 'd', path: '/d', revision: 1, tabs: [], ...over });

describe('resolveMode', () => {
  it('folder free beats tab grid', () => {
    expect(resolveMode(dash(), tab({ layout: 'grid' }), [folder('free')])).toBe('free');
  });
  it('innermost concrete folder wins', () => {
    expect(resolveMode(dash(), tab(), [folder('free'), folder('grid'), folder('inherit')])).toBe('grid');
  });
  it('inherit all the way falls to dashboard default', () => {
    expect(resolveMode(dash({ defaultLayout: 'free' }), tab({ layout: 'inherit' }), [folder('inherit'), folder()])).toBe('free');
  });
  it('nothing set is grid', () => {
    expect(resolveMode(dash(), tab(), [])).toBe('grid');
  });
});

describe('readingOrder', () => {
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
  const mk = (n: number) => folder('grid', Array.from({ length: n }, (_, i) => tile('t' + i, p(i, 0))));
  it('caps at 4', () => {
    expect(previewChildren(mk(0))).toHaveLength(0);
    expect(previewChildren(mk(1))).toHaveLength(1);
    expect(previewChildren(mk(6))).toHaveLength(4);
  });
});

describe('planCanvas', () => {
  it('grid', () => {
    expect(planCanvas('grid', 1440, tab())).toEqual({ kind: 'grid', cellPx: 120 });
    expect(planCanvas('grid', 767, tab())).toEqual({ kind: 'stacked' });
  });
  it('free', () => {
    expect(planCanvas('free', 1920, tab({ designWidth: 1280 }))).toEqual({ kind: 'free', scale: 1.5 });
    expect(planCanvas('free', 700, tab({ designWidth: 1280 }))).toEqual({ kind: 'stacked' });
    expect(planCanvas('free', 768, tab({ designWidth: 1280 }))).toEqual({ kind: 'free', scale: 0.6 });
  });
  it('free defaults designWidth to 1280', () => {
    expect(planCanvas('free', 1280, tab())).toEqual({ kind: 'free', scale: 1 });
  });
});

describe('isRenderable', () => {
  it('accepts valid tile and folder', () => {
    expect(isRenderable(tile('a', p(0, 0)))).toBe(true);
    expect(isRenderable(folder('grid', [tile('a', p(0, 0))]))).toBe(true);
  });
  it('rejects unknown kind, missing placement, bad folder content', () => {
    expect(isRenderable({ kind: 'widget', placement: p(0, 0) })).toBe(false);
    expect(isRenderable({ kind: 'tile', id: 'a' })).toBe(false);
    expect(isRenderable({ kind: 'tile', placement: { x: 'a', y: 0, w: 1, h: 1 } })).toBe(false);
    expect(isRenderable({ kind: 'folder', placement: p(0, 0), content: {} })).toBe(false);
    expect(isRenderable(null)).toBe(false);
  });
});

describe('robustness', () => {
  it('planCanvas never returns an undrawable plan', () => {
    for (const dw of [0, NaN, -5]) {
      expect(planCanvas('free', 1280, tab({ designWidth: dw }))).toEqual({ kind: 'free', scale: 1 });
    }
    for (const w of [0, NaN, -10, Infinity]) {
      expect(planCanvas('free', w, tab())).toEqual({ kind: 'stacked' });
      expect(planCanvas('grid', w, tab())).toEqual({ kind: 'stacked' });
    }
    for (const columns of [0, -1, NaN]) {
      expect(planCanvas('grid', 1440, tab({ root: { columns, children: [] } }))).toEqual({ kind: 'grid', cellPx: 120 });
    }
    expect(planCanvas('grid', 1440, { id: 't', name: 't' } as unknown as LayoutTab)).toEqual({ kind: 'grid', cellPx: 120 });
  });
  const bad = [null, 'str', { kind: 'tile', id: 'np' }] as unknown as { placement?: Placement }[];
  it('readingOrder puts malformed children last, in array order, without throwing', () => {
    const v1 = { placement: p(1, 0) }, v0 = { placement: p(0, 0) };
    const r = readingOrder([bad[0], v1, bad[1], bad[2], v0]);
    expect(r).toEqual([v0, v1, bad[0], bad[1], bad[2]]);
  });
  it('previewChildren skips non-renderable children', () => {
    const f = folder('grid', [null, tile('a', p(1, 0)), 'x', tile('b', p(0, 0))] as unknown as LayoutNode[]);
    expect(previewChildren(f).map((n) => n.id)).toEqual(['b', 'a']);
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

// ---- M3 Task 1: one geometry source (containerMetrics / nodeBox / folderChrome) ----

const ffold = (over: Partial<FolderNode> = {}): FolderNode => ({
  kind: 'folder', id: 'ff', name: 'ff', display: 'expanded', placement: p(0, 0, 5, 4),
  content: { columns: 5, children: [] }, ...over
});

describe('containerMetrics: one columns fallback everywhere', () => {
  const root = (columns: unknown): Container => ({ columns, children: [] }) as unknown as Container;
  for (const bad of [0, -2, undefined, NaN]) {
    it(`root columns ${String(bad)} falls back to ROOT_COLUMNS, as planCanvas and clampPlacement do`, () => {
      const m = containerMetrics(root(bad), 'grid', 1440);
      expect(m.columns).toBe(ROOT_COLUMNS);
      expect(m.unitPx).toBe(120);
      const plan = planCanvas('grid', 1440, tab({ root: root(bad) }));
      expect(plan).toEqual({ kind: 'grid', cellPx: m.unitPx });
      expect(clampPlacement({ x: 20, y: 0, w: 1, h: 1 }, bad as number).x).toBe(ROOT_COLUMNS - 1);
    });
    it(`folder content.columns ${String(bad)} falls back to placement.w`, () => {
      const f = ffold({ content: { columns: bad as number, children: [] } });
      const m = containerMetrics(f.content, 'grid', 500, { folder: f });
      expect(m.columns).toBe(5);
      expect(m.unitPx).toBe(100);
    });
  }
  it('fractional columns floor the same way for a root, a folder, planCanvas and clampPlacement', () => {
    const r = containerMetrics(root(2.7), 'grid', 1000);
    expect(r.columns).toBe(2);
    expect(r.unitPx).toBe(500);
    expect(planCanvas('grid', 1000, tab({ root: root(2.7) }))).toEqual({ kind: 'grid', cellPx: 500 });
    expect(clampPlacement({ x: 5, y: 0, w: 1, h: 1 }, 2.7).x).toBe(1);
    const f = ffold({ content: { columns: 2.7, children: [] } });
    expect(containerMetrics(f.content, 'grid', 1000, { folder: f }).columns).toBe(2);
  });
  it('a folder with bad content.columns and a fractional placement.w floors w', () => {
    const f = ffold({ placement: { x: 0, y: 0, w: 3.9, h: 2 }, content: { columns: 0, children: [] } });
    expect(containerMetrics(f.content, 'grid', 300, { folder: f }).columns).toBe(3);
  });
  it('grid rows default to square cells; rowPx overrides; free rows are always the unit', () => {
    const c = root(12);
    expect(containerMetrics(c, 'grid', 1200).rowPx).toBe(100);
    expect(containerMetrics(c, 'grid', 1200, { rowPx: 40 }).rowPx).toBe(40);
    const free = containerMetrics(root(160), 'free', 1280, { rowPx: 40 });
    expect(free.unitPx).toBe(8);
    expect(free.rowPx).toBe(8);
    expect(free.innerWidthPx).toBe(1280);
  });
  it('never returns non-finite sizes', () => {
    for (const w of [NaN, -5, Infinity]) {
      const m = containerMetrics(root(12), 'grid', w);
      expect(Number.isFinite(m.unitPx) && m.unitPx >= 0).toBe(true);
      expect(Number.isFinite(m.rowPx) && m.rowPx >= 0).toBe(true);
    }
  });
});

describe('nodeBox', () => {
  const m = containerMetrics({ columns: 12, children: [] }, 'grid', 1200, { rowPx: 50 });
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

describe('free folder scale subtracts the chrome', () => {
  const parent = containerMetrics({ columns: 160, children: [] }, 'free', 1920);
  const f = ffold({ layout: 'free', placement: p(0, 0, 40, 10), content: { columns: 40, children: [] } });
  it("a free folder's children never exceed its inner width", () => {
    const inner = folderInnerMetrics(f, parent);
    const box = nodeBox(f.placement, parent);
    expect(inner.mode).toBe('free');
    expect(inner.innerWidthPx).toBeCloseTo(box.widthPx - folderChrome(f.shape, true).padXPx, 6);
    expect(inner.unitPx * inner.columns).toBeCloseTo(inner.innerWidthPx, 6);
    const child = nodeBox({ x: 35, y: 0, w: 30, h: 1 }, inner);
    expect(child.leftPx + child.widthPx).toBeLessThanOrEqual(inner.innerWidthPx + 1e-9);
  });
  it('requiredFolderHeightPx grows a free folder to title + padding + content, never below its box', () => {
    const tall = ffold({ layout: 'free', placement: p(0, 0, 40, 1), content: { columns: 40, children: [tile('t', p(0, 2, 5, 50))] } });
    const inner = folderInnerMetrics(tall, parent);
    const ch = folderChrome(tall.shape, true);
    expect(requiredFolderHeightPx(tall, parent)).toBeCloseTo(ch.titlePx + ch.padYPx + 52 * inner.rowPx, 6);
    const short = ffold({ layout: 'free', placement: p(0, 0, 40, 100), content: { columns: 40, children: [tile('t', p(0, 0, 1, 1))] } });
    expect(requiredFolderHeightPx(short, parent)).toBe(nodeBox(short.placement, parent).heightPx);
    const collapsed = { ...tall, display: 'collapsed' as const };
    expect(requiredFolderHeightPx(collapsed, parent)).toBe(nodeBox(tall.placement, parent).heightPx);
  });
  it('a grid folder in a grid parent fits its rows to the folder height (fractional h floored)', () => {
    const gp = containerMetrics({ columns: 12, children: [] }, 'grid', 1440);
    const g = ffold({ placement: { x: 0, y: 0, w: 6, h: 3.8 }, content: { columns: 6, children: [] } });
    const inner = folderInnerMetrics(g, gp);
    const ch = folderChrome(undefined, true);
    expect(inner.rowPx).toBeCloseTo((3 * 120 - ch.titlePx - ch.padYPx) / 2, 6);
    expect(requiredFolderHeightPx(g, gp)).toBe(360);
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
  const t = tab();
  const f = ffold({ placement: p(0, 0, 3, 2), content: { columns: 3, children: [] } });
  it('keeps the dashboard cell when the viewport allows; panel = content + chrome', () => {
    const o = overlayMetrics({ kind: 'grid', cellPx: 120 }, t, 'grid', f, 2000);
    expect(o.metrics.columns).toBe(3);
    expect(o.metrics.unitPx).toBe(120);
    expect(o.metrics.rowPx).toBe(120);
    expect(o.metrics.innerWidthPx).toBe(360);
    expect(o.panelWidthPx).toBe(360 + OVERLAY_PANEL_CHROME_PX);
  });
  it('shrinks to the body width when the viewport is narrow', () => {
    const o = overlayMetrics({ kind: 'grid', cellPx: 120 }, t, 'grid', f, 300);
    expect(o.metrics.unitPx).toBe(100);
    expect(o.metrics.innerWidthPx).toBe(300);
  });
  it('a bad content.columns falls back to placement.w', () => {
    const bad = ffold({ placement: p(0, 0, 4, 2), content: { columns: 0, children: [] } });
    expect(overlayMetrics({ kind: 'grid', cellPx: 120 }, t, 'grid', bad, 2000).metrics.columns).toBe(4);
  });
  it('free mode uses the free unit', () => {
    const o = overlayMetrics({ kind: 'free', scale: 1 }, t, 'free', ffold({ content: { columns: 40, children: [] } }), 2000);
    expect(o.metrics.mode).toBe('free');
    expect(o.metrics.unitPx).toBe(8);
    expect(o.metrics.innerWidthPx).toBe(320);
  });
});

describe('pointToCell (M3 Task 6: right-clicked cell)', () => {
  it('maps a point inside the container to the cell under it, from the metrics', () => {
    const m = containerMetrics({ columns: 12, children: [] }, 'grid', 1200);
    expect(pointToCell(m, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(pointToCell(m, 250, 199)).toEqual({ x: 2, y: 1 });
  });
  it('clamps to the columns and never goes negative', () => {
    const m = containerMetrics({ columns: 4, children: [] }, 'grid', 400);
    expect(pointToCell(m, 5000, -20)).toEqual({ x: 3, y: 0 });
  });
  it('free containers use 8 px design units', () => {
    const m = containerMetrics({ columns: 160, children: [] }, 'free', 1280);
    expect(pointToCell(m, 81, 17)).toEqual({ x: 10, y: 2 });
  });
  it('degenerate metrics give the origin', () => {
    const m = containerMetrics({ columns: 12, children: [] }, 'grid', 0);
    expect(pointToCell(m, 50, 50)).toEqual({ x: 0, y: 0 });
  });
});
