import { describe, it, expect } from 'vitest';
import {
  resolveMode, readingOrder, clampPlacement, previewChildren, planCanvas,
  folderContentRowPx, isRenderable
} from './geometry';
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

describe('folderContentRowPx', () => {
  it('with title', () => expect(folderContentRowPx(3, 120, true)).toBe(152));
  it('without title', () => expect(folderContentRowPx(2, 120, false)).toBe(224));
  it('h=1 still yields one row', () => expect(folderContentRowPx(1, 120, true)).toBeGreaterThan(0));
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
  it('folderContentRowPx treats height < 1 as 1', () => {
    expect(folderContentRowPx(0, 120, true)).toBe(folderContentRowPx(1, 120, true));
  });
});
