// The 24-column grid (spec §9) as it stands in M5: Small 1 x 1, Medium 2 x 2, Large 4 x 4 on every
// tab. The v3→v3 doubling, free mode and folder-interior placements are gone (M5 §2a, §3.8); the
// span table and folder-page maths are in geometry.m5.test.ts.
import { describe, it, expect } from 'vitest';
import { ROOT_COLUMNS, GRID_TITLE_ROWS, containerMetrics, minimisedPlacement, nodeFit, nodeBox } from './geometry';
import { blankFolder, blankTile } from '$lib/editor/editorActions';
import type { Placement } from '$lib/types/layout';

const p = (x: number, y: number, w = 1, h = 1): Placement => ({ x, y, w, h });

describe('the grid is 24 columns', () => {
  it('ROOT_COLUMNS is 24 and a folder title takes 2 rows', () => {
    expect(ROOT_COLUMNS).toBe(24);
    expect(GRID_TITLE_ROWS).toBe(2);
  });
  it('a Medium tile at 1280 px is the old 12-column cell (106.7 px)', () => {
    const m = containerMetrics({ columns: 24, children: [] }, 1280);
    expect(nodeBox(p(0, 0, 2, 2), m).widthPx).toBeCloseTo(1280 / 12, 6);
  });
});

describe('new items', () => {
  it('a new tile is Medium and has no placement until it is put somewhere', () => {
    expect(blankTile().size).toBe('medium');
    expect('placement' in blankTile()).toBe(false);
  });
  it('a new folder is Medium with Medium contents and the default open box (6 x 4)', () => {
    expect(blankFolder()).toMatchObject({ size: 'medium', contentSize: 'medium', placement: { x: 0, y: 0, w: 6, h: 4 } });
    expect(blankFolder().content).toEqual({ children: [] });
  });
});

describe('minimised folder', () => {
  it('a tile of its own size at its top-left', () => {
    expect(minimisedPlacement({ x: 4, y: 6, w: 8, h: 6 }, 'medium')).toEqual({ x: 4, y: 6, w: 2, h: 2 });
    expect(minimisedPlacement({ x: 4, y: 6, w: 8, h: 6 }, 'large')).toEqual({ x: 4, y: 6, w: 4, h: 4 });
  });
  it('a folder narrower or shorter than its tile minimises to its own footprint, never larger', () => {
    // The minimised tile stays inside the footprint the folder keeps, so it never draws over a neighbour.
    expect(minimisedPlacement({ x: 23, y: 3, w: 1, h: 1 }, 'medium')).toEqual({ x: 23, y: 3, w: 1, h: 1 });
    expect(minimisedPlacement({ x: 5, y: 0, w: 1, h: 6 }, 'medium')).toEqual({ x: 5, y: 0, w: 1, h: 2 });
    expect(minimisedPlacement({ x: 5, y: 0, w: 6, h: 1, z: 3 }, 'medium')).toEqual({ x: 5, y: 0, w: 2, h: 1, z: 3 });
  });
  it('a non-finite w or h gives its size in that direction, never NaN (final review Minor 5)', () => {
    expect(minimisedPlacement({ x: 1, y: 2, w: NaN, h: 1 }, 'medium')).toEqual({ x: 1, y: 2, w: 2, h: 1 });
    expect(minimisedPlacement({ x: 1, y: 2, w: 1, h: Infinity }, 'medium')).toEqual({ x: 1, y: 2, w: 1, h: 2 });
    expect(minimisedPlacement({ x: 1, y: 2, w: 'x', h: undefined } as never, 'medium')).toEqual({ x: 1, y: 2, w: 2, h: 2 });
  });
});

describe('nodeFit: Small (1 x 1) is always compact', () => {
  it('a 1 x 1 tile is compact even when its cell is wide; a 2 x 2 at that width fills', () => {
    const m = containerMetrics({ columns: 24, children: [] }, 24 * 150);
    expect(nodeFit(p(0, 0, 1, 1), m)).toBe('compact');
    expect(nodeFit(p(0, 0, 2, 2), m)).toBe('fill');
    const at1280 = containerMetrics({ columns: 24, children: [] }, 1280);
    expect(nodeFit(p(0, 0, 2, 2), at1280)).toBe('compact'); // 106.7 px, as the old 1 x 1 cell
  });
});
