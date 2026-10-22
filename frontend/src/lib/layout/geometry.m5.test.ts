// M5 (one folder model, consistent tile sizes): the span table, the folder page maths, the
// minimised-folder footprint and the removal of free mode.
import { describe, it, expect } from 'vitest';
import {
  LAYOUT_VERSION, sizeSpan, folderPage, minimisedPlacement, planCanvas, isRenderable, isPlaced,
  containerMetrics, previewChildren, ROOT_COLUMNS, nodeBox, FOLDER_CHROME, openFolderContentBox, folderPaging,
  folderFlowMetrics, PAGE_BAR_PX, phoneFolderBox, STACKED_CELL_PX, PHONE_FOLDER_ROWS
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

describe('phone (stacked): the same paging, full width', () => {
  it('a phone folder is PHONE_FOLDER_ROWS rows of items at STACKED_CELL_PX cells, with room for the page bar', () => {
    const b = phoneFolderBox(400, 'medium');
    const item = 2 * STACKED_CELL_PX;
    expect(b.widthPx).toBe(400);
    expect(folderPaging(b, 'medium', STACKED_CELL_PX, 1, 0).rowsPerPage).toBe(PHONE_FOLDER_ROWS);
    expect(folderPaging(b, 'medium', STACKED_CELL_PX, 100, 0).rowsPerPage).toBe(PHONE_FOLDER_ROWS);
    expect(b.heightPx).toBe(PHONE_FOLDER_ROWS * item + PAGE_BAR_PX);
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
