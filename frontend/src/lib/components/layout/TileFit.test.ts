import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import TabCanvas from './TabCanvas.svelte';
import Entry from '../Entry.svelte';
import { COMPACT_TILE_PX } from '$lib/layout/geometry';
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
function mk(children: any[]): { dash: LayoutDashboard; tab: LayoutTab } {
  const tab: LayoutTab = { id: 't1', name: 'Main', root: { columns: 12, children } };
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
      const { dash, tab } = mk([
        tile('r-s', 'small', 0, 0), tile('r-m', 'medium', 1, 0), tile('r-l', 'large', 2, 0), tile('r-big', 'large', 3, 0, 2, 2),
        { kind: 'folder', id: 'f', name: 'F', display: 'expanded', placement: { x: 0, y: 2, w: 6, h: 3 },
          content: { columns: 6, children: [tile('f-m', 'medium', 0, 0), tile('f-l', 'large', 1, 0), tile('f-s', 'small', 2, 1)] } }
      ]);
      const { container } = render(TabCanvas, { dashboard: dash, tab });
      await tick();
      const ids = ['r-s', 'r-m', 'r-l', 'r-big', 'f-m', 'f-l', 'f-s'];
      for (const id of ids) {
        const cell = container.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
        const grid = cell.parentElement as HTMLElement;
        const rowPx = px(grid.getAttribute('style') ?? '', 'grid-auto-rows');
        const span = Number(/grid-row:\s*\d+\s*\/\s*span\s*(\d+)/.exec(cell.getAttribute('style') ?? '')![1]);
        expect(rowPx).toBeGreaterThan(0);
        const cellH = rowPx * span;
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
        // Compact exactly when the cell is too small for the full tile.
        const colPx = id.startsWith('r-') ? w / 12 : (6 * (w / 12)) / 6;
        const cellW = colPx * (id === 'r-big' ? 2 : 1);
        const compact = Math.min(cellW, cellH) < COMPACT_TILE_PX;
        expect(btn.classList.contains('compact')).toBe(compact);
        expect(btn.classList.contains('fill')).toBe(true);
        if (compact) expect(cell.querySelector('.subtitle')).toBeNull();
      }
      if (w === 1440) {
        // 120px root cells: full tiles with their description.
        expect(container.querySelector('[data-node-id="r-m"] .subtitle')).not.toBeNull();
        expect(container.querySelector('[data-node-id="r-m"] button.entry')!.classList.contains('compact')).toBe(false);
      } else {
        // 85px / 67px root cells: compact.
        expect(container.querySelector('[data-node-id="r-m"] button.entry')!.classList.contains('compact')).toBe(true);
      }
    });
  }

  it('a free-layout tile fills its box too', async () => {
    width = 1280;
    const tab: LayoutTab = { id: 't1', name: 'Free', layout: 'free', designWidth: 1280, root: { columns: 160, children: [tile('fr', 'medium', 0, 0, 10, 10)] } } as any;
    const dash: LayoutDashboard = { id: 'd1', name: 'Home', path: '/home', revision: 1, tabs: [tab] };
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const cell = container.querySelector('[data-node-id="fr"]') as HTMLElement;
    expect(cell.style.height).toBe('80px');
    const btn = cell.querySelector('button.entry') as HTMLElement;
    expect(btn.style.height).toBe('100%');
    expect(btn.style.minHeight).toBe('0px');
    expect(btn.classList.contains('compact')).toBe(true);
  });
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
