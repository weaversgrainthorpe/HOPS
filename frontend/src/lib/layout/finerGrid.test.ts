// Finer grid (spec §9, plan Task 2): 24 columns; Small 1 x 1, Medium 2 x 2, Large 4 x 4.
// Existing layouts are doubled by the one-time data update (Task 1), and doubled data under 24
// columns must render with exactly the px boxes old data had under 12.
import { describe, it, expect } from 'vitest';
import {
  ROOT_COLUMNS, GRID_TITLE_ROWS, containerMetrics, folderInnerMetrics, minimisedPlacement, nodeBox, nodeFit,
  overlayMetrics, planCanvas, OVERLAY_PANEL_CHROME_PX, requiredFolderHeightPx, type ContainerMetrics
} from './geometry';
import { blankFolder, blankTile, sizeShown, sizeSpan } from '$lib/editor/editorActions';
import { freeSide, mergeIntoNewFolder, resizedPlacement, setTabLayout, setFolderLayout } from '$lib/editor/treeOps';
import type { FolderNode, LayoutDashboard, LayoutNode, LayoutTab, Placement, TileNode } from '$lib/types/layout';

const p = (x: number, y: number, w = 1, h = 1): Placement => ({ x, y, w, h });
const tile = (id: string, pl: Placement, extra: Record<string, unknown> = {}): LayoutNode =>
  ({ kind: 'tile', id, name: id, url: 'http://x', placement: pl, ...extra }) as unknown as LayoutNode;
const folder = (id: string, pl: Placement, children: LayoutNode[], over: Partial<FolderNode> = {}): FolderNode =>
  ({ kind: 'folder', id, name: id, display: 'expanded', placement: pl, content: { columns: pl.w, children }, ...over });

/** What Task 1's data update does to a node that sits in a GRID container: x, y, w, h doubled. */
const dbl = (q: Placement): Placement => ({ x: q.x * 2, y: q.y * 2, w: q.w * 2, h: q.h * 2 });
/** A grid folder (in a grid parent) as the data update leaves it: placement, columns and content doubled. */
function doubleGridFolder(f: FolderNode, contentGrid = true): FolderNode {
  const kids = f.content.children.map((c) => {
    const pl = contentGrid ? dbl(c.placement) : c.placement;
    return c.kind === 'folder' ? { ...doubleGridFolder(c, contentGrid), placement: pl } : { ...c, placement: pl };
  });
  return { ...f, placement: dbl(f.placement), content: { ...f.content, columns: (f.content.columns ?? f.placement.w) * (contentGrid ? 2 : 1), children: kids } };
}
const box = (b: { leftPx: number; topPx: number; widthPx: number; heightPx: number }) =>
  [b.leftPx, b.topPx, b.widthPx, b.heightPx].map((v) => Math.round(v * 1000) / 1000);

describe('the grid is 24 columns', () => {
  it('ROOT_COLUMNS is 24 and a folder title takes 2 rows', () => {
    expect(ROOT_COLUMNS).toBe(24);
    expect(GRID_TITLE_ROWS).toBe(2);
  });
  it('free side is round(designWidth / 12 / 8) / 2: exactly half the old side (6.5 at 1280; Ruling 2)', () => {
    expect(freeSide({ id: 't', name: 't', root: { columns: 160, children: [] }, designWidth: 1280 } as LayoutTab)).toBe(6.5);
    expect(freeSide({ id: 't', name: 't', root: { columns: 160, children: [] } } as LayoutTab)).toBe(6.5);
    expect(freeSide({ id: 't', name: 't', root: { columns: 160, children: [] }, designWidth: 960 } as LayoutTab)).toBe(5);
    expect(freeSide({ id: 't', name: 't', root: { columns: 160, children: [] }, designWidth: 1920 } as LayoutTab)).toBe(10);
  });
});

describe('span table', () => {
  it('grid: Small 1 x 1, Medium 2 x 2, Large 4 x 4; no size is Medium', () => {
    expect(sizeSpan('small', 'grid')).toEqual({ w: 1, h: 1 });
    expect(sizeSpan('medium', 'grid')).toEqual({ w: 2, h: 2 });
    expect(sizeSpan('large', 'grid')).toEqual({ w: 4, h: 4 });
    expect(sizeSpan(undefined, 'grid')).toEqual({ w: 2, h: 2 });
  });
  it('free: one cell = side units, rounded (Medium = 13 units at 1280 = the old side)', () => {
    expect(sizeSpan('small', 'free', 6.5)).toEqual({ w: 7, h: 7 });
    expect(sizeSpan('medium', 'free', 6.5)).toEqual({ w: 13, h: 13 });
    expect(sizeSpan('large', 'free', 6.5)).toEqual({ w: 26, h: 26 });
    expect(sizeSpan('medium', 'free', 5)).toEqual({ w: 10, h: 10 });
  });
  it('the dialog shows a size only when the span matches the stored size; a doubled old Small is Custom', () => {
    const t = (size: string | undefined, pl: Placement) => tile('t', pl, size ? { size } : {}) as TileNode;
    expect(sizeShown(t('small', p(0, 0, 1, 1)), 'grid')).toBe('small');
    expect(sizeShown(t('medium', p(0, 0, 2, 2)), 'grid')).toBe('medium');
    expect(sizeShown(t(undefined, p(0, 0, 2, 2)), 'grid')).toBe('medium');
    expect(sizeShown(t('large', p(0, 0, 4, 4)), 'grid')).toBe('large');
    expect(sizeShown(t('large', p(0, 0, 2, 2)), 'grid')).toBe('custom'); // spec §9: Sample's stored-large Netflix
    expect(sizeShown(t('small', p(0, 0, 2, 2)), 'grid')).toBe('custom');
    expect(sizeShown(t('medium', p(0, 0, 1, 1)), 'grid')).toBe('custom');
  });
});

describe('new items', () => {
  it('a new tile is 2 x 2 (Medium)', () => {
    expect(blankTile().placement).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(blankTile().size).toBe('medium');
  });
  it('a new folder is the old 4 x 3 doubled, 8 columns inside', () => {
    expect(blankFolder().placement).toEqual({ x: 0, y: 0, w: 8, h: 6 });
    expect(blankFolder().content.columns).toBe(8);
  });
});

describe('minimised folder', () => {
  const tab = (dw?: number) => ({ id: 't', name: 't', root: { columns: 160, children: [] }, ...(dw ? { designWidth: dw } : {}) }) as LayoutTab;
  it('grid: one Medium tile (2 x 2) at its top-left', () => {
    expect(minimisedPlacement({ x: 4, y: 6, w: 8, h: 6 }, 'grid', tab())).toEqual({ x: 4, y: 6, w: 2, h: 2 });
  });
  it('free: a square two dashboard columns wide, the same px as before the finer grid (13 units at 1280)', () => {
    // Before: round(1280 / 12 / 8) = 13. Two 24-column cells measured exactly: round(1280 * 2 / 24 / 8) = 13.
    expect(minimisedPlacement({ x: 44, y: 50, w: 20, h: 16 }, 'free', tab(1280))).toEqual({ x: 44, y: 50, w: 13, h: 13 });
    expect(minimisedPlacement({ x: 0, y: 0, w: 20, h: 16 }, 'free', tab(960))).toMatchObject({ w: 10, h: 10 });
  });
  it('grid: a folder narrower or shorter than a Medium minimises to its own footprint, never larger', () => {
    // A 1 x 1 (or 1-wide / 1-high) grid folder, reachable by resizing: the minimised tile stays inside
    // the footprint it had, so it can never draw over a neighbour or be clamped at column 23.
    expect(minimisedPlacement({ x: 23, y: 3, w: 1, h: 1 }, 'grid', tab())).toEqual({ x: 23, y: 3, w: 1, h: 1 });
    expect(minimisedPlacement({ x: 5, y: 0, w: 1, h: 6 }, 'grid', tab())).toEqual({ x: 5, y: 0, w: 1, h: 2 });
    expect(minimisedPlacement({ x: 5, y: 0, w: 6, h: 1, z: 3 }, 'grid', tab())).toEqual({ x: 5, y: 0, w: 2, h: 1, z: 3 });
  });
  it('grid: a non-finite w or h gives a Medium in that direction, never NaN (final review Minor 5)', () => {
    expect(minimisedPlacement({ x: 1, y: 2, w: NaN, h: 1 }, 'grid', tab())).toEqual({ x: 1, y: 2, w: 2, h: 1 });
    expect(minimisedPlacement({ x: 1, y: 2, w: 1, h: Infinity }, 'grid', tab())).toEqual({ x: 1, y: 2, w: 1, h: 2 });
    expect(minimisedPlacement({ x: 1, y: 2, w: 'x', h: undefined } as never, 'grid', tab())).toEqual({ x: 1, y: 2, w: 2, h: 2 });
  });
});

describe('nodeFit: Small (1 x 1) is always compact', () => {
  it('a 1 x 1 grid tile is compact even when its cell is wide; a 2 x 2 at that width fills', () => {
    const m = containerMetrics({ columns: 24, children: [] }, 'grid', 24 * 150);
    expect(nodeFit(p(0, 0, 1, 1), m)).toBe('compact');
    expect(nodeFit(p(0, 0, 2, 2), m)).toBe('fill');
    const at1280 = containerMetrics({ columns: 24, children: [] }, 'grid', 1280);
    expect(nodeFit(p(0, 0, 2, 2), at1280)).toBe('compact'); // 106.7 px, as the old 1 x 1 cell
  });
});

describe('pixel equivalence: doubled data under 24 columns = old data under 12', () => {
  const kidsOld: LayoutNode[] = [tile('k1', p(0, 0)), tile('k2', p(1, 0)), tile('k3', p(0, 1, 2, 1)), tile('k4', p(3, 2))];
  const folders: [string, FolderNode][] = [
    ['plain', folder('f', p(1, 2, 4, 3), kidsOld)],
    ['taller than content', folder('f', p(0, 0, 4, 7), kidsOld)],
    ['content deeper than its height', folder('f', p(0, 0, 4, 2), kidsOld)],
    ['fewer columns than its width', folder('f', p(2, 1, 6, 4), kidsOld, { content: { columns: 4, children: kidsOld } })],
    ['folder-tab, no title', folder('f', p(0, 0, 5, 3), kidsOld, { shape: 'folder-tab', showTitle: false })],
    ['nested', folder('f', p(0, 0, 6, 5), [tile('k1', p(0, 0)), folder('g', p(2, 0, 3, 3), [tile('k9', p(0, 0)), tile('k8', p(1, 1))])])]
  ];
  /**
   * The OLD (12-column) build's px for a grid folder in a grid parent, written out independently of
   * the new code: title 1 row, so content rows = max(h - 1, deepest child); chrome 40 px title
   * (39 for folder-tab, 0 without a title) + 18 px body padding/border, as FolderView's CSS.
   */
  const oldBoxes = (f: FolderNode, u: number, r: number): number[][] => {
    const pl = f.placement;
    const fb = { leftPx: pl.x * u, topPx: pl.y * r, widthPx: pl.w * u, heightPx: pl.h * r };
    const title = f.showTitle === false ? 0 : f.shape === 'folder-tab' ? 39 : 40;
    const cols = f.content.columns ?? pl.w;
    const deepest = Math.max(0, ...f.content.children.map((c) => c.placement.y + c.placement.h));
    const iu = (fb.widthPx - 18) / cols;
    const ir = (fb.heightPx - title - 18) / Math.max(1, pl.h - 1, deepest);
    const out: number[][] = [box(fb), [fb.heightPx]];
    for (const c of f.content.children) {
      const q = c.placement;
      out.push(box({ leftPx: q.x * iu, topPx: q.y * ir, widthPx: q.w * iu, heightPx: q.h * ir }));
      if (c.kind === 'folder') out.push(...oldBoxes(c, iu, ir));
    }
    return out;
  };
  const childBoxes = (f: FolderNode, parent: ContainerMetrics): number[][] => {
    const inner = folderInnerMetrics(f, parent);
    const out: number[][] = [box(nodeBox(f.placement, parent)), [Math.round(requiredFolderHeightPx(f, parent) * 1000) / 1000]];
    for (const c of f.content.children) {
      out.push(box(nodeBox(c.placement, inner)));
      if (c.kind === 'folder') out.push(...childBoxes(c, inner));
    }
    return out;
  };
  for (const width of [1280, 1440, 1920]) {
    for (const [name, f] of folders) {
      it(`grid folder in a grid parent (${name}) at ${width}px`, () => {
        const newM = containerMetrics({ columns: 24, children: [] }, 'grid', width);
        const want = oldBoxes(f, width / 12, width / 12).map((b) => b.map((v) => Math.round(v * 1000) / 1000));
        expect(childBoxes(doubleGridFolder(f), newM)).toEqual(want);
      });
    }
  }
  it('grid folder in a free parent: placement kept, content doubled, same px', () => {
    const free = containerMetrics({ columns: 160, children: [] }, 'free', 1280);
    const f = folder('f', p(10, 10, 40, 20), kidsOld, { layout: 'grid', content: { columns: 4, children: kidsOld } });
    const d = { ...doubleGridFolder(f), placement: f.placement };
    expect(childBoxes(d, free)).toEqual(childBoxes(f, free));
  });
  it('folder overlay / maximised panel: same unit px and child boxes (grid tab)', () => {
    const t = (cols: number): LayoutTab => ({ id: 't', name: 't', root: { columns: cols, children: [] } });
    const f = folder('f', p(0, 0, 4, 3), kidsOld);
    for (const [width, body] of [[1280, 1800], [1280, 300], [1920, 1886]]) {
      const o = overlayMetrics(planCanvas('grid', width, t(12)), t(12), 'grid', f, body);
      const n = overlayMetrics(planCanvas('grid', width, t(24)), t(24), 'grid', doubleGridFolder(f), body);
      expect(n.panelWidthPx).toBeCloseTo(o.panelWidthPx, 6);
      kidsOld.forEach((k, i) => {
        expect(box(nodeBox(doubleGridFolder(f).content.children[i].placement, n.metrics))).toEqual(box(nodeBox(k.placement, o.metrics)));
      });
    }
  });
  it('folder overlay of a grid folder in a free tab: same unit px', () => {
    const t: LayoutTab = { id: 't', name: 't', layout: 'free', designWidth: 1280, root: { columns: 160, children: [] } };
    const f = folder('f', p(0, 0, 40, 30), kidsOld, { layout: 'grid', content: { columns: 4, children: kidsOld } });
    const plan = planCanvas('free', 1600, t);
    // The old build's unit was one of 12 dashboard columns (1600 / 12) for 4 content columns; now
    // one of 24 for the doubled 8 content columns — the same panel and the same child px.
    const n = overlayMetrics(plan, t, 'grid', { ...doubleGridFolder(f), placement: f.placement }, 1800);
    expect(n.metrics.unitPx * 2).toBeCloseTo(1600 / 12, 6);
    expect(n.panelWidthPx).toBeCloseTo(4 * (1600 / 12) + OVERLAY_PANEL_CHROME_PX, 6);
  });
});

// ---------------------------------------------------------------- editor ops in the new units

function gridDash(children: LayoutNode[]): LayoutDashboard {
  return { id: 'd', name: 'D', path: '/d', revision: 1, tabs: [{ id: 't', name: 'T', root: { columns: 24, children } }] };
}
const rootKids = (d: LayoutDashboard) => d.tabs[0].root.children;

describe('merge lays out Medium tiles (the old layout doubled)', () => {
  it('three 2 x 2 tiles: folder 6 wide, 2 rows of tile + 2 title rows', () => {
    const d = gridDash([tile('a', p(0, 0, 2, 2)), tile('b', p(6, 0, 2, 2)), tile('c', p(12, 4, 2, 2))]);
    const r = mergeIntoNewFolder(d, ['b', 'a'], 'c', new Set(['a', 'b', 'c']));
    const f = rootKids(r.dashboard).find((n) => n.id === r.folderId) as FolderNode;
    expect(f.placement).toEqual({ x: 12, y: 4, w: 6, h: 4 });
    expect(f.content.columns).toBe(6);
    expect(f.content.children.map((c) => c.placement)).toEqual([p(0, 0, 2, 2), p(2, 0, 2, 2), p(4, 0, 2, 2)]);
  });
  it('six members: 4 per row (8 wide), 2 rows → h 4 + 2', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const d = gridDash(ids.map((id, i) => tile(id, p(i * 2, 0, 2, 2))));
    const r = mergeIntoNewFolder(d, ids.slice(1), 'a', new Set(ids));
    const f = rootKids(r.dashboard).find((n) => n.id === r.folderId) as FolderNode;
    expect(f.placement).toMatchObject({ w: 8, h: 6 });
    expect(f.content.children[4].placement).toEqual(p(0, 2, 2, 2));
  });
  it('a merged folder (not a tile) takes a Medium slot', () => {
    const d = gridDash([tile('a', p(0, 0, 2, 2)), folder('g', p(4, 0, 8, 6), [tile('x', p(0, 0, 2, 2))])]);
    const r = mergeIntoNewFolder(d, ['g'], 'a', new Set(['a', 'g', 'x']));
    const f = rootKids(r.dashboard).find((n) => n.id === r.folderId) as FolderNode;
    expect(f.content.children.map((c) => c.placement)).toEqual([p(0, 0, 2, 2), p(2, 0, 2, 2)]);
    expect(f.placement).toMatchObject({ w: 4, h: 4 });
  });
});

describe('folder minimum height scales with the cell', () => {
  it('a grid folder in a grid parent: content rows + 2 title rows', () => {
    const d = gridDash([folder('f', p(0, 0, 8, 8), [tile('x', p(0, 0, 2, 2)), tile('y', p(0, 2, 2, 2))])]);
    expect(resizedPlacement(d, 'f', 8, 1)).toEqual({ x: 0, y: 0, w: 8, h: 6 });
  });
  it('a free folder in a grid parent: rows measured on the old nominal cell, halved (80 / 2 = 40 px)', () => {
    // Before the finer grid the nominal cell was 80 px (12 columns); the same px under 24 columns is 40 px.
    // The folder is 8 cells = 320 px (the old 4 x 80); its free content unit is (320 - 18) / 80 = 3.775 px,
    // so the 30-unit tile needs 113.25 px + title 40 + padding 18 = 171.25 px = 4.28 fine rows → 5
    // (before: 2.14 old rows → 3 = 6 fine rows; the finer grid snaps to half an old row).
    const d = gridDash([folder('f', p(0, 0, 8, 2), [tile('x', p(0, 0, 10, 30))], { layout: 'free', content: { columns: 80, children: [tile('x', p(0, 0, 10, 30))] } })]);
    expect(resizedPlacement(d, 'f', 8, 1).h).toBe(5);
  });
  it('the free-folder resize floor matches the old floor at every width (never looser than half an old row)', () => {
    // Independent old reference: 12 columns, nominal 80 px cells, the folder at half the width.
    const OLD_CELL = 80;
    const chrome = 40 + 18; // rounded folder, title shown: title bar + body padding/border
    for (const w of [2, 3, 4, 6, 8, 12, 16, 24]) for (const tileH of [5, 13, 30, 60, 120]) {
      const kid = tile('x', p(0, 0, 10, tileH));
      const d = gridDash([folder('f', p(0, 0, w, 2), [kid], { layout: 'free', content: { columns: 80, children: [kid] } })]);
      const fine = resizedPlacement(d, 'f', w, 1).h;
      const boxPx = (w / 2) * OLD_CELL; // the same px box as the old w/2 columns
      const needPx = chrome + ((boxPx - 18) / 80) * tileH;
      const oldRows = Math.max(1, Math.ceil(needPx / OLD_CELL - 1e-9));
      // At any viewport width the old cell is c and a fine cell c / 2, so comparing in fine rows covers every width.
      expect(fine, `w=${w} tileH=${tileH}`).toBe(Math.max(1, Math.ceil(needPx / (OLD_CELL / 2) - 1e-9)));
      expect(fine, `w=${w} tileH=${tileH}: no looser than the old floor less half an old row`).toBeGreaterThanOrEqual(2 * oldRows - 1);
      expect(fine).toBeLessThanOrEqual(2 * oldRows);
    }
  });
});

describe('free ↔ grid conversion in the new units (side 6.5 at 1280)', () => {
  const kids = [tile('a', p(0, 0, 2, 2)), tile('b', p(2, 0, 2, 2)), tile('s', p(4, 0, 1, 1)), tile('l', p(0, 2, 4, 4)),
    folder('f', p(6, 0, 8, 6), [tile('x', p(0, 0, 2, 2)), tile('y', p(2, 0, 2, 2))])];
  it('grid → free multiplies by 6.5, rounded to whole units; a Medium tile becomes 13 units (the old side)', () => {
    const out = setTabLayout(gridDash(kids), 't', 'free', 1280);
    expect(out.tabs[0].root.columns).toBe(160);
    expect(rootKids(out).find((n) => n.id === 'a')!.placement).toEqual(p(0, 0, 13, 13));
    expect(rootKids(out).find((n) => n.id === 's')!.placement).toEqual(p(26, 0, 7, 7)); // 4 x 6.5; 6.5 → 7
    expect(rootKids(out).find((n) => n.id === 'l')!.placement).toEqual(p(0, 13, 26, 26));
    const f = rootKids(out).find((n) => n.id === 'f') as FolderNode;
    expect(f.placement).toEqual(p(39, 0, 52, 39));
    expect(f.content.columns).toBe(52);
    expect(f.content.children.map((c) => c.placement)).toEqual([p(0, 0, 13, 13), p(13, 0, 13, 13)]);
  });
  it('grid → free rounds edges, not x and w separately: odd-x Smalls never overlap their neighbours', () => {
    // x=1 w=1 used to become [7, 14) while x=2 starts at 13: a one-unit overlap.
    const row = [0, 1, 2, 3, 4, 5].map((x) => tile(`s${x}`, p(x, 1, 1, 1)));
    const out = setTabLayout(gridDash(row), 't', 'free', 1280);
    const got = rootKids(out).map((n) => n.placement);
    for (let i = 0; i + 1 < got.length; i++) {
      expect(got[i].x + got[i].w, `s${i} ends where s${i + 1} starts`).toBe(got[i + 1].x);
    }
    for (const q of got) expect(q.y + q.h).toBe(13); // rows too: bottom edge = round(2 x 6.5)
    // And back to grid exactly.
    expect(rootKids(setTabLayout(out, 't', 'grid'))).toEqual(row);
  });
  it('grid → free → grid is exact (no drift)', () => {
    const d = gridDash(kids);
    const back = setTabLayout(setTabLayout(d, 't', 'free', 1280), 't', 'grid');
    expect(back.tabs[0].root.columns).toBe(24);
    expect(rootKids(back)).toEqual(rootKids(d));
  });
  it('a folder switched to free and back keeps its content exactly', () => {
    const d = gridDash(kids);
    const back = setFolderLayout(setFolderLayout(d, 'f', 'free'), 'f', 'inherit');
    expect((rootKids(back).find((n) => n.id === 'f') as FolderNode).content).toEqual((kids[4] as FolderNode).content);
  });
});
