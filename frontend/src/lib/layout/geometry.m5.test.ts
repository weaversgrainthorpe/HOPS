// M5 (one folder model, consistent tile sizes): the span table, the folder page maths, the
// minimised-folder footprint and the removal of free mode.
import { describe, it, expect } from 'vitest';
import {
  LAYOUT_VERSION, sizeSpan, folderPage, minimisedPlacement, planCanvas, isRenderable, isPlaced,
  containerMetrics, folderInnerMetrics, previewChildren, ROOT_COLUMNS
} from './geometry';
import type { FolderNode, LayoutNode, LayoutTab } from '../types/layout';

const tab: LayoutTab = { id: 't', name: 't', root: { columns: 24, children: [] } };
const tile = (id: string, extra: Record<string, unknown> = {}): LayoutNode =>
  ({ kind: 'tile', id, name: id, url: 'http://x', ...extra }) as unknown as LayoutNode;

describe('the layout version marker', () => {
  it('is 1 (the M5 form the server stores)', () => {
    expect(LAYOUT_VERSION).toBe(1);
  });
});

describe('sizeSpan: the one span table (S 1, M 2, L 4 cells each way)', () => {
  it('maps each size to its cells', () => {
    expect(sizeSpan('small')).toBe(1);
    expect(sizeSpan('medium')).toBe(2);
    expect(sizeSpan('large')).toBe(4);
  });
  it('a missing or unknown size is Medium (as the server reads it)', () => {
    for (const s of [undefined, null, '', 'custom', 3]) expect(sizeSpan(s)).toBe(2);
  });
});

describe('folderPage: how many items one page of an open folder holds', () => {
  it('Medium items (2 x 2 cells) in a 500 x 300 px content box at 50 px cells', () => {
    expect(folderPage({ widthPx: 500, heightPx: 300 }, 'medium', 50)).toEqual({ perRow: 5, rowsPerPage: 3, perPage: 15 });
  });
  it('Small and Large contents', () => {
    expect(folderPage({ widthPx: 500, heightPx: 300 }, 'small', 50)).toEqual({ perRow: 10, rowsPerPage: 6, perPage: 60 });
    expect(folderPage({ widthPx: 500, heightPx: 300 }, 'large', 50)).toEqual({ perRow: 2, rowsPerPage: 1, perPage: 2 });
  });
  it('an exact fit counts despite float error', () => {
    // 200 / (2 * 100/3) is 2.9999999999999996 in floating point.
    expect(folderPage({ widthPx: 200, heightPx: 200 }, 'medium', 100 / 3).perRow).toBe(3);
  });
  it('a box smaller than one item still shows one (never zero, never NaN)', () => {
    expect(folderPage({ widthPx: 10, heightPx: 10 }, 'large', 50)).toEqual({ perRow: 1, rowsPerPage: 1, perPage: 1 });
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(folderPage({ widthPx: 500, heightPx: 300 }, 'medium', bad)).toEqual({ perRow: 1, rowsPerPage: 1, perPage: 1 });
    }
    expect(folderPage({ widthPx: NaN, heightPx: -1 }, 'medium', 50)).toEqual({ perRow: 1, rowsPerPage: 1, perPage: 1 });
  });
  it('a bigger box shows more per page', () => {
    const small = folderPage({ widthPx: 400, heightPx: 200 }, 'medium', 50).perPage;
    const big = folderPage({ widthPx: 800, heightPx: 400 }, 'medium', 50).perPage;
    expect(big).toBeGreaterThan(small);
  });
});

describe('minimisedPlacement: a minimised folder is a tile of its own size in its kept space', () => {
  it('draws at its size at the top-left of the space it keeps', () => {
    expect(minimisedPlacement({ x: 3, y: 4, w: 8, h: 6, z: 2 }, 'large')).toEqual({ x: 3, y: 4, w: 4, h: 4, z: 2 });
    expect(minimisedPlacement({ x: 3, y: 4, w: 8, h: 6 }, 'small')).toEqual({ x: 3, y: 4, w: 1, h: 1 });
    expect(minimisedPlacement({ x: 3, y: 4, w: 8, h: 6 }, undefined)).toEqual({ x: 3, y: 4, w: 2, h: 2 });
  });
  it('is clamped to the kept space when the tile would be bigger', () => {
    expect(minimisedPlacement({ x: 0, y: 0, w: 3, h: 1 }, 'large')).toEqual({ x: 0, y: 0, w: 3, h: 1 });
  });
});

describe('free mode is gone', () => {
  it('planCanvas is grid (24 columns) or stacked, whatever the tab says', () => {
    const legacy = { ...tab, layout: 'free', designWidth: 1280 } as unknown as LayoutTab;
    expect(planCanvas(1200, legacy)).toEqual({ kind: 'grid', cellPx: 1200 / ROOT_COLUMNS });
    expect(planCanvas(500, tab)).toEqual({ kind: 'stacked' });
    expect(planCanvas(0, tab)).toEqual({ kind: 'stacked' });
  });
  it('container metrics have no mode', () => {
    const m = containerMetrics(tab.root, 1200);
    expect(m).toEqual({ columns: 24, unitPx: 50, rowPx: 50, innerWidthPx: 1200 });
  });
});

describe('folder contents have no placements', () => {
  it('a child without a placement is renderable; only a placed node can sit on a tab', () => {
    expect(isRenderable(tile('a'))).toBe(true);
    expect(isPlaced(tile('a'))).toBe(false);
    expect(isPlaced(tile('a', { placement: { x: 0, y: 0, w: 2, h: 2 } }))).toBe(true);
    expect(isRenderable({ kind: 'folder', id: 'f', content: {} })).toBe(false);
  });
  it('previews are the first four renderable children in their order', () => {
    const f = {
      kind: 'folder', id: 'f', name: 'f', display: 'collapsed', size: 'medium', contentSize: 'medium',
      placement: { x: 0, y: 0, w: 6, h: 4 },
      content: { children: [tile('e'), tile('d'), { bad: 1 }, tile('c'), tile('b'), tile('a')] }
    } as unknown as FolderNode;
    expect(previewChildren(f).map((n) => n.id)).toEqual(['e', 'd', 'c', 'b']);
  });
  it("an open folder's contents flow at its contents size, in the tab's cell", () => {
    const f = {
      kind: 'folder', id: 'f', name: 'f', display: 'expanded', size: 'medium', contentSize: 'medium',
      placement: { x: 0, y: 0, w: 8, h: 6 }, content: { children: [] }
    } as unknown as FolderNode;
    const parent = containerMetrics(tab.root, 1200); // 50 px cells
    const inner = folderInnerMetrics(f, parent);
    expect(inner.unitPx).toBe(50);
    expect(inner.flow).toEqual({ span: 2, perRow: 3 }); // (400 - 18) px / 100 px
    const small = folderInnerMetrics({ ...f, contentSize: 'small' }, parent);
    expect(small.flow).toEqual({ span: 1, perRow: 7 });
  });
});
