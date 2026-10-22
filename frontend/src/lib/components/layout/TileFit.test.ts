import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import TabCanvas from './TabCanvas.svelte';
import Entry from '../Entry.svelte';
import { COMPACT_TILE_PX, containerMetrics, sizeSpan } from '$lib/layout/geometry';
import type { LayoutDashboard, LayoutTab } from '$lib/types/layout';

// Ruling 22 (I1): inside the layout renderer a tile fills its grid cell exactly
// (no v2 min-height spilling into the next row); a cell under ~110 px renders a
// compact tile (icon + name, no description). jsdom has no layout engine and
// component CSS is not injected, so the fit is asserted on what decides it:
// the cell's track sizes and the inline styles that override Entry's
// min-height (inline beats any class rule).

let width = 1440;
class FakeRO {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    this.cb([{ target: el, contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

function tile(id: string, size: 'small' | 'medium' | 'large', x: number, y: number, w = 1, h = 1): any {
  return { kind: 'tile', id, name: 'N-' + id, description: 'Desc ' + id, url: 'http://x.test', icon: 'mdi:home', openMode: 'newtab', size, order: 0, placement: { x, y, w, h } };
}
/** A folder's child (M5: no placement). */
function kid(id: string, size: 'small' | 'medium' | 'large'): any {
  const t = tile(id, size, 0, 0);
  delete t.placement;
  return t;
}
function mk(children: any[]): { dash: LayoutDashboard; tab: LayoutTab } {
  const tab: LayoutTab = { id: 't1', name: 'Main', root: { columns: 24, children } };
  return { dash: { id: 'd1', name: 'Home', path: '/home', revision: 1, tabs: [tab] }, tab };
}
const px = (s: string, prop: string) => {
  const m = new RegExp(`${prop}:\\s*(?:repeat\\(\\d+,\\s*)?([\\d.]+)px`).exec(s);
  return m ? Number(m[1]) : NaN;
};

beforeEach(() => vi.stubGlobal('ResizeObserver', FakeRO));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('tiles fit their grid cell (Ruling 22)', () => {
  for (const w of [1440, 1024, 800]) {
    it(`at a ${w}px canvas no tile's box exceeds its cell`, async () => {
      width = w;
      // M5: on the tab every tile is exactly its Size's span (Small 1 x 1, Medium 2 x 2, Large 4 x 4);
      // inside a folder every item shows the folder's contents size (here Medium), in order.
      const { dash, tab } = mk([
        tile('r-s', 'small', 0, 0, 1, 1), tile('r-m', 'medium', 2, 0, 2, 2), tile('r-big', 'large', 6, 0, 4, 4),
        { kind: 'folder', id: 'f', name: 'F', display: 'expanded', size: 'medium', contentSize: 'medium',
          placement: { x: 0, y: 4, w: 12, h: 6 },
          content: { children: [kid('f-m', 'medium'), kid('f-l', 'large'), kid('f-s', 'small')] } }
      ]);
      const { container } = render(TabCanvas, { dashboard: dash, tab });
      await tick();
      const rootM = containerMetrics(tab.root, w);
      for (const id of ['r-s', 'r-m', 'r-big', 'f-m', 'f-l', 'f-s']) {
        const cell = container.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
        const grid = cell.parentElement as HTMLElement;
        const rowPx = px(grid.getAttribute('style') ?? '', 'grid-auto-rows');
        expect(rowPx).toBeGreaterThan(0);
        // A tab tile spans its rows; a folder item is one flow track of its contents size.
        const inFolder = id.startsWith('f-');
        const span = inFolder ? 1 : Number(/grid-row:\s*\d+\s*\/\s*span\s*(\d+)/.exec(cell.getAttribute('style') ?? '')![1]);
        const spanW = inFolder ? 1 : Number(/grid-column:\s*\d+\s*\/\s*span\s*(\d+)/.exec(cell.getAttribute('style') ?? '')![1]);
        const cellH = rowPx * span;
        // In a folder an item is its contents size in the tab's own cell (the same box as a tab tile).
        const cellW = (inFolder ? sizeSpan('medium') * rootM.unitPx : rootM.unitPx) * spanW;
        const box = cell.querySelector('.entry-container') as HTMLElement;
        const btn = cell.querySelector('button.entry') as HTMLElement;
        // The tile is sized by its cell: 100% of it, never a min-height of its own.
        expect(box.style.height).toBe('100%');
        expect(btn.style.height).toBe('100%');
        expect(btn.style.minHeight).toBe('0px');
        expect(btn.style.boxSizing).toBe('border-box');
        expect(btn.style.overflow).toBe('hidden');
        // Nothing between the tile and the grid track can grow it.
        expect(cell.style.minHeight === '' || cell.style.minHeight === '0px').toBe(true);
        // Compact exactly when the cell is too small for the full tile, or the tile is one cell
        // (Small: always compact, spec §9).
        const oneCell = inFolder ? sizeSpan('medium') === 1 : spanW === 1 && span === 1;
        const compact = oneCell || Math.min(cellW, cellH) < COMPACT_TILE_PX;
        expect(btn.classList.contains('compact')).toBe(compact);
        expect(btn.classList.contains('fill')).toBe(true);
        // Spec §10: one arrangement at every fit; the description is never dropped from a compact tile.
        expect(cell.querySelector('.subtitle'), `${id} keeps its description`).not.toBeNull();
      }
      // Consistent sizes (M5 §2): a Medium in a Medium folder is the same box as a Medium on the tab.
      const rootRow = px((container.querySelector('.container-grid') as HTMLElement).getAttribute('style') ?? '', 'grid-auto-rows');
      const flowRow = px((container.querySelector('.container-flow') as HTMLElement).getAttribute('style') ?? '', 'grid-auto-rows');
      expect(flowRow).toBeCloseTo(2 * rootRow, 1); // both are rounded to 0.01 px
      expect(container.querySelector('[data-node-id="r-s"] button.entry')!.classList.contains('compact')).toBe(true);
      if (w === 1440) {
        // 60px root cells, a Medium is 120px: full tiles with their description.
        expect(container.querySelector('[data-node-id="r-m"] button.entry')!.classList.contains('compact')).toBe(false);
        expect(container.querySelector('[data-node-id="f-l"] button.entry')!.classList.contains('compact')).toBe(false);
      } else {
        // 85px / 67px root cells: compact, on the tab and in the folder alike.
        expect(container.querySelector('[data-node-id="r-m"] button.entry')!.classList.contains('compact')).toBe(true);
        expect(container.querySelector('[data-node-id="f-m"] button.entry')!.classList.contains('compact')).toBe(true);
      }
    });
  }
});

describe('legacy Entry is unchanged', () => {
  it('without fit: no fill/compact class and no inline size overrides', () => {
    const { container } = render(Entry, { entry: { id: 'a', name: 'A', description: 'D', url: 'http://x', size: 'small' } as any });
    const btn = container.querySelector('button.entry') as HTMLElement;
    expect(btn.className).toMatch(/\bentry\b/);
    expect(btn.className).toMatch(/\bsmall\b/);
    expect(btn.classList.contains('fill')).toBe(false);
    expect(btn.classList.contains('compact')).toBe(false);
    expect(btn.style.height).toBe('');
    expect(btn.style.minHeight).toBe('');
    expect(btn.style.overflow).toBe('');
    expect((container.querySelector('.entry-container') as HTMLElement).getAttribute('style')).toBeNull();
    expect(container.querySelector('.subtitle')).not.toBeNull();
  });
});
