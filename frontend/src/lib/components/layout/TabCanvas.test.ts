import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import TabCanvas from './TabCanvas.svelte';
import { layoutStale } from '$lib/stores/config';
import { editMode } from '$lib/stores/editMode';
import type { LayoutDashboard, LayoutTab } from '$lib/types/layout';

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

function tile(id: string, name: string, x: number, y: number, w = 1, h = 1): any {
  return { kind: 'tile', id, name, url: 'http://x.test', icon: '', openMode: 'newtab', size: 'medium', order: 0, placement: { x, y, w, h } };
}
function folder(id: string, name: string, x: number, y: number, w: number, h: number, children: any[], extra: any = {}): any {
  return { kind: 'folder', id, name, display: 'expanded', placement: { x, y, w, h }, content: { columns: w, children }, ...extra };
}
function mk(children: any[]): { dash: LayoutDashboard; tab: LayoutTab } {
  const tab: LayoutTab = { id: 't1', name: 'Main', root: { columns: 12, children } };
  const dash: LayoutDashboard = { id: 'd1', name: 'Home', path: '/home', revision: 1, tabs: [tab] };
  return { dash, tab };
}

beforeEach(() => {
  width = 1440;
  vi.stubGlobal('ResizeObserver', FakeRO);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('TabCanvas', () => {
  it('renders the migrated v2_basic dashboard as folders and tiles at 1440px', async () => {
    const { dash, tab } = mk([
      folder('g1', 'Full', 0, 0, 12, 4, [tile('e1', 'Alpha', 0, 0), tile('e2', 'Bravo', 1, 0), tile('e3', 'Charlie', 2, 0)]),
      folder('g2', 'Half1', 0, 4, 6, 3, [tile('e4', 'Delta', 0, 0)])
    ]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    for (const n of ['Full', 'Alpha', 'Bravo', 'Charlie', 'Half1', 'Delta']) {
      expect(screen.getByText(n)).toBeInTheDocument();
    }
    const region = container.querySelector('[data-node-id="g1"]') as HTMLElement;
    expect(region.getAttribute('style')).toContain('grid-column: 1 / span 12');
  });

  it('places a root tile at its cell', async () => {
    const { dash, tab } = mk([tile('e1', 'Solo', 2, 1)]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const el = container.querySelector('[data-node-id="e1"]') as HTMLElement;
    expect(el.getAttribute('style')).toContain('grid-column: 3 / span 1');
    expect(el.getAttribute('style')).toContain('grid-row: 2 / span 1');
  });

  it('renders three levels of nested expanded folders', async () => {
    const { dash, tab } = mk([
      folder('f1', 'Level1', 0, 0, 12, 8, [
        folder('f2', 'Level2', 0, 0, 8, 6, [
          folder('f3', 'Level3', 0, 0, 4, 4, [tile('deep', 'DeepTile', 0, 0)])
        ])
      ])
    ]);
    render(TabCanvas, { dashboard: dash, tab });
    await tick();
    for (const n of ['Level1', 'Level2', 'Level3', 'DeepTile']) expect(screen.getByText(n)).toBeInTheDocument();
  });

  it('renders a placeholder for a node without placement', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad: any = { kind: 'tile', id: 'bad-1', name: 'Broken', url: '', icon: '', openMode: 'newtab', size: 'medium', order: 0 };
    const { dash, tab } = mk([bad, tile('ok', 'Fine', 0, 0)]);
    render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(screen.getByText(/can't display/i)).toBeInTheDocument();
    expect(screen.getByText(/bad-1/)).toBeInTheDocument();
    expect(screen.getByText('Fine')).toBeInTheDocument();
    expect(err).toHaveBeenCalled();
  });

  it('renders a placeholder for an unrenderable child nested inside a folder', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad: any = { kind: 'tile', id: 'nested-bad', name: 'x' };
    const { dash, tab } = mk([folder('f1', 'F', 0, 0, 6, 3, [bad])]);
    render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(screen.getByText(/nested-bad/)).toBeInTheDocument();
  });

  it('a placeholder keeps its node position when it has one, else stacks after positioned items (grid)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const posBad: any = { kind: 'tile', id: 'pos-bad', name: 'x', placement: { x: 4, y: 2, w: 'wide', h: 1 } };
    const noPos: any = { kind: 'tile', id: 'no-pos', name: 'y' };
    const noPos2: any = { kind: 'widget', id: 'no-pos2' };
    const { dash, tab } = mk([noPos, tile('a', 'A', 0, 0), posBad, tile('b', 'B', 1, 3), noPos2]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const pos = container.querySelector('.node-placeholder[data-node-id="pos-bad"]') as HTMLElement;
    expect(pos.getAttribute('style')).toContain('grid-column: 5 / span 1');
    expect(pos.getAttribute('style')).toContain('grid-row: 3 / span 1');
    // Unpositioned placeholders stack, in array order, after every positioned item.
    const grid = container.querySelector('.container-grid') as HTMLElement;
    const stack = container.querySelector('.placeholder-stack') as HTMLElement;
    expect(stack).not.toBeNull();
    expect(grid.contains(stack)).toBe(false);
    expect(grid.compareDocumentPosition(stack) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...stack.querySelectorAll('.node-placeholder')].map((e) => e.getAttribute('data-node-id'))).toEqual(['no-pos', 'no-pos2']);
    expect(grid.querySelector('[data-node-id="no-pos"]')).toBeNull();
  });

  it('a positioned placeholder in a free container sits at its position above its siblings', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const posBad: any = { kind: 'tile', id: 'pos-bad', name: 'x', placement: { x: 2, y: 3, h: 4 } };
    const noPos: any = { kind: 'tile', id: 'no-pos', name: 'y' };
    const tab: LayoutTab = { id: 't1', name: 'Free', layout: 'free', designWidth: 1280, root: { columns: 160, children: [
      { ...tile('a', 'A', 0, 0, 20, 20), placement: { x: 0, y: 0, w: 20, h: 20, z: 7 } }, posBad, noPos
    ] } } as any;
    width = 1280;
    const dash: LayoutDashboard = { id: 'd1', name: 'Home', path: '/home', revision: 1, tabs: [tab] };
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const st = (container.querySelector('.node-placeholder[data-node-id="pos-bad"]') as HTMLElement).style;
    expect(st.position).toBe('absolute');
    expect(st.left).toBe('16px');
    expect(st.top).toBe('24px');
    expect(st.zIndex).toBe('8');
    const stack = container.querySelector('.placeholder-stack') as HTMLElement;
    expect(stack.querySelector('[data-node-id="no-pos"]')).not.toBeNull();
    expect((container.querySelector('.container-free') as HTMLElement).querySelector('[data-node-id="no-pos"]')).toBeNull();
  });

  it('clamps an out-of-range placement instead of dropping it', async () => {
    const { dash, tab } = mk([tile('e1', 'Edge', 40, 0, 9)]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(screen.getByText('Edge')).toBeInTheDocument();
    const el = container.querySelector('[data-node-id="e1"]') as HTMLElement;
    expect(el.getAttribute('style')).toContain('grid-column: 12 / span 1');
  });

  it('renders a child below the folder height instead of clipping it', async () => {
    const { dash, tab } = mk([folder('f1', 'Short', 0, 0, 6, 2, [tile('low', 'LowTile', 0, 3)])]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(screen.getByText('LowTile')).toBeInTheDocument();
    const cell = container.querySelector('[data-node-id="low"]') as HTMLElement;
    expect(cell.getAttribute('style')).toContain('grid-row: 4 / span 1');
    const inner = cell.parentElement as HTMLElement;
    // 4 content rows must fit the folder body: (2*120 - 56) / 4 = 46px each
    const m = /grid-auto-rows:\s*([\d.]+)px/.exec(inner.getAttribute('style') ?? '');
    expect(Number(m![1])).toBeCloseTo(46, 1);
    let el: HTMLElement | null = cell;
    while (el && el !== container) {
      expect(getComputedStyle(el).overflow).not.toBe('hidden');
      el = el.parentElement;
    }
  });

  it("sizes a nested folder's rows from its parent's cell size", async () => {
    const { dash, tab } = mk([
      folder('f1', 'Outer', 0, 0, 12, 8, [folder('f2', 'Inner', 0, 0, 8, 6, [tile('t', 'T', 0, 0)])])
    ]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const outerRow = (8 * 120 - 56) / 7;
    const expected = (6 * outerRow - 56) / 5;
    const innerGrid = (container.querySelector('[data-node-id="t"]') as HTMLElement).parentElement as HTMLElement;
    const m = /grid-auto-rows:\s*([\d.]+)px/.exec(innerGrid.getAttribute('style') ?? '');
    expect(Number(m![1])).toBeCloseTo(expected, 1);
    expect(Math.abs(Number(m![1]) - (6 * 120 - 56) / 5)).toBeGreaterThan(5);
  });

  it('tiles are view-only even when edit mode is on', async () => {
    editMode.set(true);
    const { dash, tab } = mk([tile('e1', 'Solo', 0, 0)]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(container.querySelector('.edit-mode')).toBeNull();
    editMode.set(false);
  });

  it('shows a refreshing state instead of the old tree while the layout is stale', async () => {
    const { dash, tab } = mk([tile('e1', 'Solo', 0, 0)]);
    layoutStale.set(true);
    render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing layout');
    expect(screen.queryByText('Solo')).toBeNull();
    layoutStale.set(false);
    await tick();
    expect(screen.getByText('Solo')).toBeInTheDocument();
  });
});
