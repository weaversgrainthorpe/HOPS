// rule 3: between the phone breakpoint and the reference width, an open folder whose stored
// box is too short at THIS cell is drawn taller, and what is below it in its columns moves down.
// Render-only: the stored placements are never changed.
import { describe, it, expect } from 'vitest';
import {
  screenGrowth, clampPlacement, drilledFolderRows, minOpenFolderCells, nestedPaging, nodeBox, openFolderContentBox, screenRows, sizeSpan,
  placeholderKey, REFERENCE_CELL_PX, type ContainerMetrics
} from './geometry';
import type { FolderNode, Placement } from '../types/layout';

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

// A folder opened inside a folder: the outer box is drawn tall enough for ALL its items, up to about
// one screen; past that its page bar pages them. Render-only, like the narrow-screen growth.
describe('drilledFolderRows (the rows a drilled folder wants)', () => {
  const box = p(0, 0, 24, 4);
  const shown = (h: number, levels: number, count: number, cell = 50, size = 'medium', pl = box) =>
    nestedPaging(openFolderContentBox(nodeBox({ ...pl, h }, m(cell)), 'folder-flat'), levels, size, cell, count, 0);
  const rows = (levels: number, count: number, maxRows = 40, cell = 50, size = 'medium', pl = box) =>
    drilledFolderRows({ shape: 'folder-flat' }, pl, m(cell), { levels, contentSize: size, count }, maxRows);

  it('all the items fit: the smallest box showing every one on one page, with no page bar', () => {
    const h = rows(1, 4);
    expect(h).toBeGreaterThan(4);
    expect(shown(h, 1, 4)).toMatchObject({ noRoom: false, pages: 1, pageBar: false });
    expect(shown(h - 1, 1, 4).noRoom).toBe(true); // one row less would not do
  });

  it('asks for every row of items: more items than a row want more rows, and it stays the smallest box', () => {
    const h = rows(1, 60);
    expect(h).toBeGreaterThan(rows(1, 4));
    expect(shown(h, 1, 60).pages).toBe(1);
    expect(shown(h - 1, 1, 60).pages).toBeGreaterThan(1);
  });

  it('already fits: exactly the stored rows', () => {
    const tall = p(0, 0, 24, 10);
    expect(rows(1, 4, 40, 50, 'medium', tall)).toBe(10);
  });

  it('a cap is honoured: the page bar then pages the rest, and the box is never above it', () => {
    const h = rows(1, 300, 12);
    expect(h).toBe(12);
    expect(shown(h, 1, 300)).toMatchObject({ noRoom: false, pageBar: true });
  });

  it('a cap never leaves less than one row of items (and the page bar they need)', () => {
    const h = rows(1, 60, 2);
    expect(h).toBeGreaterThan(2);
    expect(shown(h, 1, 60).noRoom).toBe(false);
    expect(shown(h - 1, 1, 60).noRoom).toBe(true);
    // An unmeasured window (a cap of 0) does the same.
    expect(rows(1, 60, 0)).toBe(h);
  });

  it('a stored box above the cap keeps its size and never shrinks', () => {
    expect(rows(1, 300, 12, 50, 'medium', p(0, 0, 24, 20))).toBe(20);
  });

  it('a folder three levels deep counts every inset bar', () => {
    const h = rows(3, 4);
    expect(h).toBeGreaterThan(rows(1, 4));
    expect(shown(h, 3, 4)).toMatchObject({ noRoom: false, pages: 1 });
    expect(shown(h - 1, 3, 4).noRoom).toBe(true);
  });

  it('too narrow for one item at this depth: no height can help, so none is asked for', () => {
    const thin = p(0, 0, 2, 4);
    expect(rows(1, 4, 40, 40, 'medium', thin)).toBe(4);
    expect(shown(4, 1, 4, 40, 'medium', thin).noRoom).toBe(true); // the note stays
  });

  it('an empty sub-folder is short of nothing while its body holds "Empty folder": no growth, no "no room"', () => {
    expect(shown(4, 1, 0, 60)).toMatchObject({ noRoom: false, noRoomInside: false });
    expect(rows(1, 0, 40, 60)).toBe(4);
  });

  it('an empty sub-folder so deep that the bars run out gets only the room for that text', () => {
    const short = p(0, 0, 24, 3);
    const h = rows(3, 0, 40, 40, 'medium', short);
    expect(h).toBeGreaterThan(3);
    expect(shown(h, 3, 0, 40, 'medium', short).noRoom).toBe(false);
    expect(shown(h - 1, 3, 0, 40, 'medium', short).noRoom).toBe(true);
    expect(h).toBeLessThan(rows(3, 1, 40, 40, 'medium', short));
  });

  it('an empty sub-folder too narrow for one item is still too narrow: stored rows, and the note', () => {
    const thin = p(0, 0, 2, 4);
    expect(shown(4, 1, 0, 40, 'medium', thin).noRoom).toBe(true);
    expect(rows(1, 0, 40, 40, 'medium', thin)).toBe(4);
  });

  it('every contents size, every shape: the wanted box shows every item', () => {
    for (const size of ['small', 'medium', 'large']) {
      for (const shape of ['rounded', 'simple-tab', 'folder-open']) {
        const h = drilledFolderRows({ shape }, box, m(50), { levels: 2, contentSize: size, count: 30 }, 60);
        const g = nestedPaging(openFolderContentBox(nodeBox({ ...box, h }, m(50)), shape), 2, size, 50, 30, 0);
        expect(g, `${size} ${shape}`).toMatchObject({ noRoom: false, pages: 1 });
      }
    }
  });
});

describe('screenRows (the cap: one screen below the navbar)', () => {
  it('whole rows of the room below the navbar', () => {
    expect(screenRows(1000, 50)).toBe(20);
    expect(screenRows(1049, 50)).toBe(20);
  });
  it('an unmeasured room or row is no rows, never NaN or Infinity', () => {
    expect(screenRows(0, 50)).toBe(0);
    expect(screenRows(1000, 0)).toBe(0);
  });
});

describe('screenGrowth with a drilled folder', () => {
  const sub = (id: string, n: number, extra: Record<string, unknown> = {}) => folder(id, p(0, 0, 1, 1), n, extra) as unknown as FolderNode;
  /** `paths`: folder id -> the sub-folders drilled into. */
  const drills = (paths: Record<string, FolderNode[]>, rows = 40) => ({ path: (f: FolderNode) => paths[f.id] ?? [], maxRows: () => rows });
  const wantAt = (cell: number, pl: Placement, count: number, levels = 1, rows = 40) =>
    drilledFolderRows({ shape: 'folder-flat' }, pl, m(cell), { levels, contentSize: 'medium', count }, rows);

  it('grows the box to the wanted rows and pushes what is below by the same amount; stored values untouched', () => {
    const list = [folder('f', p(0, 0, 24, 4)), tile('t', p(4, 4, 2, 2))];
    const want = wantAt(50, p(0, 0, 24, 4), 4);
    const g = screenGrowth(list, m(50), drills({ f: [sub('s', 4)] }));
    expect(g.get('f')).toEqual({ placement: p(0, 0, 24, want), extra: want - 4 });
    expect(g.get('t')).toEqual({ placement: p(4, want, 2, 2), extra: 0 });
    expect(list[0].placement).toEqual(p(0, 0, 24, 4));
    expect(list[1].placement).toEqual(p(4, 4, 2, 2));
  });

  it('no sub-folder open, or one that fits: exactly as without a drill, at every width', () => {
    const list = [folder('f', p(0, 0, 24, 12)), tile('t', p(0, 12, 2, 2))];
    for (const cell of [32, 40, 50, 77, 104]) {
      expect(screenGrowth(list, m(cell), drills({}))).toEqual(screenGrowth(list, m(cell)));
    }
    expect(screenGrowth(list, m(50), drills({ f: [sub('s', 2)] })).size).toBe(0);
  });

  it('only the columns it covers move; what is beside it stays', () => {
    const list = [folder('f', p(0, 0, 12, 4)), tile('beside', p(12, 0, 2, 2)), tile('below', p(0, 4, 2, 2)), tile('far', p(14, 6, 2, 2))];
    const g = screenGrowth(list, m(50), drills({ f: [sub('s', 4)] }));
    expect(g.get('f')!.extra).toBeGreaterThan(0);
    expect(g.get('below')!.placement.y).toBe(4 + g.get('f')!.extra);
    expect(g.has('beside')).toBe(false);
    expect(g.has('far')).toBe(false);
  });

  it('pushes are transitive, and two drilled folders stacked add up', () => {
    const list = [folder('a', p(0, 0, 24, 4)), folder('b', p(0, 4, 12, 4)), tile('c', p(0, 8, 2, 2))];
    const g = screenGrowth(list, m(50), drills({ a: [sub('s', 4)], b: [sub('t', 4)] }));
    const ea = g.get('a')!.extra, eb = g.get('b')!.extra;
    expect(ea).toBeGreaterThan(0);
    expect(eb).toBeGreaterThan(0);
    expect(g.get('b')!.placement.y).toBe(4 + ea);
    expect(g.get('c')!.placement.y).toBe(8 + ea + eb);
  });

  it('two drilled folders side by side each grow for their own items and push only their own columns', () => {
    const list = [
      folder('l', p(0, 0, 12, 4)), folder('r', p(12, 0, 12, 4)), tile('ul', p(0, 4, 2, 2)), tile('ur', p(12, 4, 2, 2))
    ];
    const g = screenGrowth(list, m(50), drills({ l: [sub('s', 4)], r: [sub('t', 40)] }));
    expect(g.get('r')!.extra).toBeGreaterThan(g.get('l')!.extra);
    expect(g.get('ul')!.placement.y).toBe(4 + g.get('l')!.extra);
    expect(g.get('ur')!.placement.y).toBe(4 + g.get('r')!.extra);
  });

  it('the narrow-screen growth and the drill are one height: the larger, never added', () => {
    // At a 40 px cell this box already grows a row for its own page; a small sub-folder needs less.
    const list = [folder('f', p(0, 0, 24, 4)), tile('t', p(0, 4, 2, 2))];
    const narrow = screenGrowth(list, m(40)).get('f')!.extra;
    expect(narrow).toBe(1);
    const small = screenGrowth(list, m(40), drills({ f: [sub('s', 1, { contentSize: 'small' })] }));
    const want = wantAt(40, p(0, 0, 24, 4), 40);
    const big = screenGrowth(list, m(40), drills({ f: [sub('s', 40)] }));
    expect(small.get('f')!.extra).toBeGreaterThanOrEqual(narrow);
    expect(big.get('f')!.extra).toBe(want - 4);
    expect(big.get('t')!.placement.y).toBe(want);
  });

  it('a minimised folder keeps a remembered drill out of it (it is not drawn), and a flow never grows', () => {
    const list = [folder('f', p(0, 0, 24, 4), 12, { display: 'collapsed' })];
    expect(screenGrowth(list, m(50), drills({ f: [sub('s', 4)] })).size).toBe(0);
    const open = [folder('f', p(0, 0, 24, 4))];
    expect(screenGrowth(open, { ...m(50), flow: { span: 2, perRow: 4 } }, drills({ f: [sub('s', 4)] })).size).toBe(0);
  });

  it('never makes an overlap that was not stored: random packed layouts with random drills', () => {
    let seed = 11;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    for (let run = 0; run < 200; run++) {
      const list: ReturnType<typeof folder | typeof tile>[] = [];
      const paths: Record<string, FolderNode[]> = {};
      let x = 0, y = 0, shelf = 0;
      for (let i = 0; i < 12; i++) {
        const isF = rnd(2) === 0;
        const w = isF ? 3 + rnd(10) : 2, h = isF ? 3 + rnd(3) : 2;
        if (x + w > 24) { x = 0; y += shelf; shelf = 0; }
        list.push(isF ? folder(`n${i}`, p(x, y, w, h), rnd(20)) : tile(`n${i}`, p(x, y, w, h)));
        if (isF && rnd(2) === 0) paths[`n${i}`] = Array.from({ length: 1 + rnd(3) }, (_, d) => sub(`s${i}-${d}`, rnd(40)));
        x += w + rnd(2);
        shelf = Math.max(shelf, h + rnd(2));
      }
      for (const cell of [32, 40, 50, 77]) {
        const g = screenGrowth(list, m(cell), drills(paths, 8 + rnd(20)));
        const drawn = list.map((n) => clampPlacement(g.get(n.id)?.placement ?? n.placement, 24));
        for (let i = 0; i < drawn.length; i++) {
          for (let j = i + 1; j < drawn.length; j++) {
            const a = drawn[i], b = drawn[j];
            const meet = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            expect(meet, `run ${run} cell ${cell}: ${list[i].id} / ${list[j].id}`).toBe(false);
          }
        }
      }
    }
  });

  it('wanted rows read the STORED box: the same drill always gives the same growth (no feedback)', () => {
    const list = [folder('f', p(0, 0, 24, 4))];
    const once = screenGrowth(list, m(50), drills({ f: [sub('s', 60)] }, 10));
    const grown = [folder('f', once.get('f')!.placement)];
    expect(once.get('f')!.placement.h).toBe(10);
    expect(screenGrowth(grown, m(50), drills({ f: [sub('s', 60)] }, 10)).size).toBe(0);
  });

  it('sizeSpan of the sub-folder, not the outer folder, sets what is wanted', () => {
    const list = [folder('f', p(0, 0, 24, 4), 12, { contentSize: 'small' })];
    const large = screenGrowth(list, m(50), drills({ f: [sub('s', 2, { contentSize: 'large' })] })).get('f')!;
    const small = screenGrowth(list, m(50), drills({ f: [sub('s', 2, { contentSize: 'small' })] })).get('f');
    expect(sizeSpan('large')).toBeGreaterThan(sizeSpan('small'));
    expect(large.extra).toBeGreaterThan(small?.extra ?? 0);
  });
});

describe('screenGrowth: positioned placeholders (unrenderable nodes)', () => {
  const bad = (id: unknown, pl: unknown) => ({ kind: 'mystery', id, placement: pl });

  it('moves down with everything else, and passes the push on to what is below it', () => {
    const list = [folder('f', p(0, 0, 24, 4)), bad('b', p(0, 4, 2, 2)), tile('t', p(0, 6, 2, 2))];
    const g = screenGrowth(list, m(40));
    expect(g.get('f')!.extra).toBe(1);
    expect(g.get(placeholderKey(1))).toEqual({ placement: p(0, 5, 2, 2), extra: 0 });
    expect(g.get('t')!.placement).toEqual(p(0, 7, 2, 2));
  });

  it('never grows, and one with no id or a broken size is still pushed, each on its own', () => {
    const list = [
      folder('f', p(0, 0, 24, 4)), bad(undefined, { x: 3, y: 4, w: 'wide' }), bad(undefined, { x: 9, y: 4 })
    ];
    const g = screenGrowth(list, m(40));
    expect(g.get(placeholderKey(1))).toEqual({ placement: p(3, 5, 1, 1), extra: 0 });
    expect(g.get(placeholderKey(2))).toEqual({ placement: p(9, 5, 1, 1), extra: 0 });
  });

  it('with no position it stays out of it (it stacks after the grid), and beside the folder nothing moves', () => {
    const list = [folder('f', p(0, 0, 12, 4)), { kind: 'mystery', id: 'x' }, bad('beside', p(12, 0, 2, 2))];
    const g = screenGrowth(list, m(40));
    expect(g.get(placeholderKey(1))).toBeUndefined();
    expect(g.get(placeholderKey(2))).toBeUndefined();
  });

  it('a placeholder sharing a real id keeps both apart', () => {
    const list = [folder('f', p(0, 0, 24, 4)), tile('same', p(0, 4, 2, 2)), bad('same', p(4, 4, 2, 2))];
    const g = screenGrowth(list, m(40));
    expect(g.get('same')!.placement).toEqual(p(0, 5, 2, 2));
    expect(g.get(placeholderKey(2))!.placement).toEqual(p(4, 5, 2, 2));
  });
});
