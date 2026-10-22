// M5 (one folder model, consistent tile sizes): the span table, the folder page maths, the
// minimised-folder footprint and the removal of free mode.
import { describe, it, expect } from 'vitest';
import {
  LAYOUT_VERSION, sizeSpan, folderPage, minimisedPlacement, planCanvas, isRenderable, isPlaced,
  containerMetrics, previewChildren, ROOT_COLUMNS, nodeBox, FOLDER_CHROME, openFolderContentBox, folderPaging,
  folderFlowMetrics, PAGE_BAR_PX, phoneTrack, phoneColumnPx, phonePaging, PHONE_TILE_MIN_PX, PHONE_PAGE_RESERVE_PX,
  minOpenFolderCells, MIN_GRID_CELL_PX, largestContentSize, folderMinCells
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
  it('a missing or unknown size is drawn as Medium (the server refuses one on write)', () => {
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
    expect(planCanvas(500, tab)).toEqual({ kind: 'stacked', widthPx: 500 });
    expect(planCanvas(0, tab)).toEqual({ kind: 'stacked', widthPx: 0 });
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
    const content = openFolderContentBox(nodeBox(f.placement!, parent));
    const g = folderPaging(content, f.contentSize, parent.unitPx, 0, 0);
    expect(folderFlowMetrics(g, parent.unitPx, content.widthPx).unitPx).toBe(50);
    expect(folderFlowMetrics(g, parent.unitPx, content.widthPx).flow).toEqual({ span: 2, perRow: 3 }); // (400 - 18) px / 100 px
    const small = folderPaging(content, 'small', parent.unitPx, 0, 0);
    expect(folderFlowMetrics(small, parent.unitPx, content.widthPx).flow).toEqual({ span: 1, perRow: 7 });
  });
});

// ---- M5 Task 3: one Folder component pages its contents.
describe('openFolderContentBox: an open folder always has its title bar (M5 §3a.7)', () => {
  it('takes the bar, the border and the body padding off its box, whatever its look or title', () => {
    expect(FOLDER_CHROME).toEqual({ titlePx: 40, padXPx: 18, padYPx: 18 });
    expect(openFolderContentBox({ widthPx: 360, heightPx: 240 })).toEqual({ widthPx: 342, heightPx: 182 });
    expect(openFolderContentBox({ widthPx: 10, heightPx: 10 })).toEqual({ widthPx: 0, heightPx: 0 });
  });
});

describe('folderPaging: one page at a time, a page bar only when there is more than one page', () => {
  // 60 px cells: a Medium item is 120 px. 360 x 240 content: 3 per row, 2 rows = 6 a page.
  const box = { widthPx: 360, heightPx: 240 };
  it('everything fits: one page, no page bar', () => {
    const g = folderPaging(box, 'medium', 60, 6, 0);
    expect(g).toMatchObject({ span: 2, itemPx: 120, perRow: 3, rowsPerPage: 2, perPage: 6, pages: 1, pageBar: false, page: 0, start: 0, end: 6 });
  });
  it('overfull: the page bar takes its height first, then the rest pages', () => {
    const g = folderPaging(box, 'medium', 60, 7, 0);
    // 240 - 32 = 208 → one row of 3 a page.
    expect(g).toMatchObject({ pageBar: true, rowsPerPage: 1, perPage: 3, pages: 3, start: 0, end: 3 });
    expect(PAGE_BAR_PX).toBe(32);
  });
  it('page 2 shows the rest; a remembered page past the end clamps to the last (folder resized / items removed)', () => {
    expect(folderPaging(box, 'medium', 60, 7, 1)).toMatchObject({ page: 1, start: 3, end: 6 });
    expect(folderPaging(box, 'medium', 60, 7, 2)).toMatchObject({ page: 2, start: 6, end: 7 });
    expect(folderPaging(box, 'medium', 60, 7, 9)).toMatchObject({ page: 2, start: 6, end: 7 });
    expect(folderPaging(box, 'medium', 60, 4, 9)).toMatchObject({ page: 0, pages: 1, pageBar: false });
    for (const bad of [-1, NaN, 1.5, Infinity]) expect(folderPaging(box, 'medium', 60, 7, bad).page).toBe(bad === 1.5 ? 1 : 0);
  });
  it('a bigger box shows more per page', () => {
    const small = folderPaging(box, 'medium', 60, 20, 0);
    const big = folderPaging({ widthPx: 720, heightPx: 480 }, 'medium', 60, 20, 0);
    expect(big.perPage).toBeGreaterThan(small.perPage);
  });
  it('the contents size sets the item: Small 1 cell, Large 4', () => {
    expect(folderPaging(box, 'small', 60, 1, 0)).toMatchObject({ span: 1, itemPx: 60, perRow: 6 });
    expect(folderPaging(box, 'large', 60, 1, 0)).toMatchObject({ span: 4, itemPx: 240, perRow: 1 });
  });
  it('an empty folder is one empty page', () => {
    expect(folderPaging(box, 'medium', 60, 0, 3)).toMatchObject({ pages: 1, page: 0, start: 0, end: 0, pageBar: false });
  });
  it('the flow metrics of a page: perRow items of span cells, in the tab cell', () => {
    const g = folderPaging(box, 'medium', 60, 7, 0);
    expect(folderFlowMetrics(g, 60, 360)).toEqual({ columns: 6, unitPx: 60, rowPx: 60, innerWidthPx: 360, flow: { span: 2, perRow: 3 } });
  });
});

describe('phone (stacked): folder items are the phone tab tiles, paged to fit the viewport', () => {
  it('the phone tab grid per viewport width (ContainerView .container-stacked): column minimum and gap', () => {
    expect(phoneTrack(390)).toEqual({ minPx: 100, gapPx: 12 });
    expect(phoneTrack(700)).toEqual({ minPx: 120, gapPx: 12 });
    expect(phoneTrack(1000)).toEqual({ minPx: 135, gapPx: 14 });
  });
  it('a phone tab column: as many as fit the canvas, sharing it (auto-fill, 1fr)', () => {
    expect(phoneColumnPx(358, { minPx: 100, gapPx: 12 })).toBeCloseTo((358 - 2 * 12) / 3);
    expect(phoneColumnPx(50, { minPx: 100, gapPx: 12 })).toBe(50);
  });
  it('items are the tab tile\'s column wide and its size\'s height; as many a row as fit the folder', () => {
    const vp = { widthPx: 390, heightPx: 844 };
    const g = phonePaging(358 - FOLDER_CHROME.padXPx, 358, vp, 'medium', 30, 0);
    const col = (358 - 24) / 3;
    expect(g.itemPx).toBeCloseTo(col);
    expect(g.rowPx).toBe(PHONE_TILE_MIN_PX.medium);
    expect(g.gapPx).toBe(12);
    expect(g.perRow).toBe(2); // 340 px < 3 columns + 2 gaps
    expect(g.pageBar).toBe(true);
  });
  it('rows come from a pixel budget so a page fits the viewport — Large included', () => {
    const vp = { widthPx: 390, heightPx: 844 };
    for (const size of ['small', 'medium', 'large'] as const) {
      const g = phonePaging(340, 358, vp, size, 100, 0);
      const pageH = g.rowsPerPage * g.rowPx + (g.rowsPerPage - 1) * g.gapPx;
      expect(pageH + PHONE_PAGE_RESERVE_PX, size).toBeLessThanOrEqual(844);
      expect(g.rowsPerPage, size).toBeGreaterThanOrEqual(1);
    }
    expect(phonePaging(340, 358, vp, 'large', 100, 0).rowsPerPage).toBeLessThan(phonePaging(340, 358, vp, 'small', 100, 0).rowsPerPage);
    // A tiny viewport still shows one row (never zero).
    expect(phonePaging(340, 358, { widthPx: 390, heightPx: 100 }, 'large', 5, 0).rowsPerPage).toBe(1);
  });
  it('the page is clamped as on a tab', () => {
    const vp = { widthPx: 390, heightPx: 844 };
    const g = phonePaging(340, 358, vp, 'medium', 3, 9);
    expect(g).toMatchObject({ page: 0, pages: 1, pageBar: false, start: 0, end: 3 });
  });
});

describe('the pop-over / maximise sizing is gone (M5 §2: one component draws every folder)', () => {
  it('has no overlay or folder-interior row-fitting exports', async () => {
    const g = await import('./geometry');
    for (const k of ['overlayMetrics', 'overlayBodyPx', 'OVERLAY_GUTTER_PX', 'OVERLAY_PANEL_CHROME_PX', 'folderInnerMetrics', 'folderChrome']) {
      expect(k in g, k).toBe(false);
    }
  });
});

// M5 Task 4 (§3.5, Task 2 review): the smallest open folder holds its bar, its border and padding,
// one item at its contents size and the page bar — at EVERY grid width (a grid cell is never
// narrower than PHONE_BREAKPOINT_PX / ROOT_COLUMNS = 32 px; below that the tab stacks).
describe('minOpenFolderCells: the smallest open folder', () => {
  it('is title + padding + one item + page bar, in whole cells', () => {
    expect(MIN_GRID_CELL_PX).toBe(32);
    expect(minOpenFolderCells('small')).toEqual({ w: 2, h: 4 });
    expect(minOpenFolderCells('medium')).toEqual({ w: 3, h: 5 });
    expect(minOpenFolderCells('large')).toEqual({ w: 5, h: 7 });
  });
  it.each([32, 40, 50, 80])('at %i px cells, one item and the page bar fit inside that box', (cell) => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const m = minOpenFolderCells(size);
      const content = openFolderContentBox({ widthPx: m.w * cell, heightPx: m.h * cell });
      expect(content.widthPx).toBeGreaterThanOrEqual(sizeSpan(size) * cell);
      expect(content.heightPx - PAGE_BAR_PX).toBeGreaterThanOrEqual(sizeSpan(size) * cell);
      // Overfull: the page bar shows, and the rows shown really fit above it (never a clipped item).
      const g = folderPaging(content, size, cell, 50, 0);
      expect(g.pageBar).toBe(true);
      expect(g.rowsPerPage * g.itemPx).toBeLessThanOrEqual(content.heightPx - PAGE_BAR_PX);
      expect(g.perRow * g.itemPx).toBeLessThanOrEqual(content.widthPx);
    }
  });
});

// Fix round 1: the minimum is taken at the LARGEST contents size of the folder and every folder in it
// (a drilled-into sub-folder's page is drawn in the same box, at its own contents size).
describe('the smallest open folder fits its largest contents size', () => {
  const f = (id: string, contentSize: string, children: unknown[] = []) =>
    ({ kind: 'folder', id, name: id, display: 'expanded', size: 'medium', contentSize, content: { children } }) as unknown as FolderNode;
  it('is the largest of the folder and every sub-folder, however deep', () => {
    expect(largestContentSize(f('a', 'small'))).toBe('small');
    expect(largestContentSize(f('a', 'small', [tile('t'), f('b', 'medium', [f('c', 'large')])]))).toBe('large');
    expect(largestContentSize(f('a', 'medium', [f('b', 'small')]))).toBe('medium');
  });
  it('folderMinCells uses it', () => {
    expect(folderMinCells(f('a', 'small', [f('b', 'large')]))).toEqual(minOpenFolderCells('large'));
    expect(folderMinCells(f('a', 'small'))).toEqual(minOpenFolderCells('small'));
  });
});
