// rule 3: between the phone breakpoint and the reference width, an open folder whose stored
// box is too short at THIS cell is drawn taller, and what is below it in its columns moves down.
// Render-only: the stored placements are never changed.
import { describe, it, expect } from 'vitest';
import { screenGrowth, clampPlacement, minOpenFolderCells, REFERENCE_CELL_PX, type ContainerMetrics } from './geometry';
import type { Placement } from '../types/layout';

const m = (cell: number): ContainerMetrics => ({ columns: 24, unitPx: cell, rowPx: cell, innerWidthPx: 24 * cell });
const p = (x: number, y: number, w: number, h: number): Placement => ({ x, y, w, h });
const kids = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'tile', id: `k${i}`, name: 'k' }));
const folder = (id: string, pl: Placement, n = 12, extra: Record<string, unknown> = {}) => ({
  kind: 'folder', id, name: id, size: 'medium', contentSize: 'medium', display: 'expanded', shape: 'folder-flat',
  placement: pl, content: { children: kids(n) }, ...extra
});
const tile = (id: string, pl: Placement) => ({ kind: 'tile', id, name: id, size: 'medium', placement: pl });

describe('screenGrowth (render-only growth)', () => {
  it('at the reference cell and wider, a folder at its minimum is not grown: nothing moves', () => {
    const min = minOpenFolderCells('medium');
    const list = [folder('f', p(0, 0, 24, min.h)), tile('t', p(0, min.h, 2, 2))];
    for (const cell of [REFERENCE_CELL_PX, 80, 104]) expect(screenGrowth(list, m(cell)).size).toBe(0);
  });

  it('at a 40 px cell, a 24 x 4 folder with a full row grows one row and the tile below moves down by it', () => {
    const list = [folder('f', p(0, 0, 24, 4)), tile('t', p(4, 4, 2, 2))];
    const g = screenGrowth(list, m(40));
    expect(g.get('f')).toEqual({ placement: p(0, 0, 24, 5), extra: 1 });
    expect(g.get('t')).toEqual({ placement: p(4, 5, 2, 2), extra: 0 });
    // The stored placements are untouched (render-only).
    expect(list[0].placement).toEqual(p(0, 0, 24, 4));
    expect(list[1].placement).toEqual(p(4, 4, 2, 2));
  });

  it('only items in the columns it covers move; items beside it stay', () => {
    const list = [folder('f', p(0, 0, 12, 4)), tile('beside', p(12, 0, 2, 2)), tile('below', p(0, 4, 2, 2)), tile('far', p(14, 6, 2, 2))];
    const g = screenGrowth(list, m(40));
    expect(g.get('f')!.extra).toBe(1);
    expect(g.get('below')!.placement).toEqual(p(0, 5, 2, 2));
    expect(g.has('beside')).toBe(false);
    expect(g.has('far')).toBe(false);
  });

  it('pushes are transitive: what is below a pushed item moves too, and two growths add up', () => {
    const list = [folder('a', p(0, 0, 24, 4)), folder('b', p(0, 4, 12, 4)), tile('c', p(0, 8, 2, 2)), tile('d', p(20, 8, 2, 2))];
    const g = screenGrowth(list, m(40));
    expect(g.get('b')).toEqual({ placement: p(0, 5, 12, 5), extra: 1 });
    expect(g.get('c')!.placement).toEqual(p(0, 10, 2, 2)); // pushed by a (1) and by b's growth (1)
    expect(g.get('d')!.placement).toEqual(p(20, 9, 2, 2)); // only under a
  });

  it('a minimised folder never grows (it keeps its space), and a one-tile Rounded folder fits as stored', () => {
    const list = [folder('min', p(0, 0, 24, 4), 12, { display: 'collapsed' }), folder('r', p(0, 4, 24, 4), 1, { shape: 'rounded' })];
    expect(screenGrowth(list, m(40)).size).toBe(0);
  });

  it('a box too NARROW for one item is not grown (its "too small" note shows instead)', () => {
    expect(screenGrowth([folder('f', p(0, 0, 2, 4))], m(40)).size).toBe(0);
  });

  it('a folder page (flow metrics) and an unmeasured width never grow', () => {
    const list = [folder('f', p(0, 0, 24, 4))];
    expect(screenGrowth(list, { ...m(40), flow: { span: 2, perRow: 4 } }).size).toBe(0);
    expect(screenGrowth(list, m(0)).size).toBe(0);
  });

  it('never makes an overlap that was not stored: random packed layouts at 32, 40 and 50 px cells', () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    for (let run = 0; run < 200; run++) {
      // Shelf-pack a random mix of folders (at or above a small minimum) and tiles: no stored overlaps.
      const list: ReturnType<typeof folder | typeof tile>[] = [];
      let x = 0, y = 0, shelf = 0;
      for (let i = 0; i < 12; i++) {
        const isF = rnd(2) === 0;
        const w = isF ? 3 + rnd(10) : 2, h = isF ? 3 + rnd(3) : 2;
        if (x + w > 24) { x = 0; y += shelf; shelf = 0; }
        list.push(isF ? folder(`n${i}`, p(x, y, w, h), rnd(20)) : tile(`n${i}`, p(x, y, w, h)));
        x += w + rnd(2);
        shelf = Math.max(shelf, h + rnd(2));
      }
      for (const cell of [32, 40, 50]) {
        const g = screenGrowth(list, m(cell));
        const drawn = list.map((n) => clampPlacement(g.get(n.id)?.placement ?? n.placement, 24));
        for (let i = 0; i < drawn.length; i++) {
          for (let j = i + 1; j < drawn.length; j++) {
            const a = drawn[i], b = drawn[j];
            const meet = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            expect(meet, `run ${run} cell ${cell}: ${list[i].id} / ${list[j].id}`).toBe(false);
          }
        }
        for (const [, v] of g) expect(v.extra).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('items stored overlapping (z-stacked) are neither above the other: each moves only by what is above it', () => {
    const list = [folder('f', p(0, 0, 24, 4)), tile('a', p(0, 4, 4, 4)), tile('b', p(2, 6, 2, 2), )];
    const g = screenGrowth(list, m(40));
    expect(g.get('a')!.placement.y).toBe(5);
    expect(g.get('b')!.placement.y).toBe(7);
  });
});
