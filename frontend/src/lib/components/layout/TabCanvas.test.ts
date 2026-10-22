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
/** A folder's child (M5: no placement). */
function kid(id: string, name: string, extra: any = {}): any {
  return { kind: 'tile', id, name, url: 'http://x.test', icon: '', openMode: 'newtab', size: 'medium', order: 0, ...extra };
}
function folder(id: string, name: string, x: number, y: number, w: number, h: number, children: any[], extra: any = {}): any {
  return {
    kind: 'folder', id, name, display: 'expanded', size: 'medium', contentSize: 'medium',
    placement: { x, y, w, h }, content: { children }, ...extra
  };
}
/** A sub-folder (no placement). */
function sub(id: string, name: string, children: any[]): any {
  return { kind: 'folder', id, name, display: 'expanded', size: 'medium', contentSize: 'medium', content: { children } };
}
function mk(children: any[]): { dash: LayoutDashboard; tab: LayoutTab } {
  const tab: LayoutTab = { id: 't1', name: 'Main', root: { columns: 24, children } };
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
      folder('g1', 'Full', 0, 0, 24, 8, [kid('e1', 'Alpha'), kid('e2', 'Bravo'), kid('e3', 'Charlie')]),
      folder('g2', 'Half1', 0, 8, 12, 6, [kid('e4', 'Delta')])
    ]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    for (const n of ['Full', 'Alpha', 'Bravo', 'Charlie', 'Half1', 'Delta']) {
      expect(screen.getByText(n)).toBeInTheDocument();
    }
    const region = container.querySelector('[data-node-id="g1"]') as HTMLElement;
    expect(region.getAttribute('style')).toContain('grid-column: 1 / span 24');
  });

  it('places a root tile at its cell', async () => {
    const { dash, tab } = mk([tile('e1', 'Solo', 4, 2, 2, 2)]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const el = container.querySelector('[data-node-id="e1"]') as HTMLElement;
    expect(el.getAttribute('style')).toContain('grid-column: 5 / span 2');
    expect(el.getAttribute('style')).toContain('grid-row: 3 / span 2');
  });

  it('a sub-folder shows in its parent as its minimised tile (M5 §2), whatever its saved display', async () => {
    const { dash, tab } = mk([
      folder('f1', 'Level1', 0, 0, 24, 16, [
        sub('f2', 'Level2', [sub('f3', 'Level3', [kid('deep', 'DeepTile')])])
      ])
    ]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(screen.getByText('Level1')).toBeInTheDocument();
    expect(screen.getByText('Level2')).toBeInTheDocument();
    expect(container.querySelector('[data-node-id="f2"]')!.classList.contains('collapsed')).toBe(true);
    expect(screen.queryByText('DeepTile')).toBeNull();
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
    const bad: any = { kind: 'widget', id: 'nested-bad', name: 'x' };
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

  it('clamps an out-of-range placement instead of dropping it', async () => {
    const { dash, tab } = mk([tile('e1', 'Edge', 80, 0, 18)]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(screen.getByText('Edge')).toBeInTheDocument();
    const el = container.querySelector('[data-node-id="e1"]') as HTMLElement;
    expect(el.getAttribute('style')).toContain('grid-column: 24 / span 1');
  });

  it("a folder's contents flow in order at its contents size, in the tab's cell, one page at a time", async () => {
    const kids = Array.from({ length: 9 }, (_, i) => kid('k' + i, 'K' + i));
    const { dash, tab } = mk([folder('f1', 'Short', 0, 0, 12, 4, kids)]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const flow = container.querySelector('.container-flow') as HTMLElement;
    // (12 x 60 - 18) px wide / 120 px Medium items = 5 per row; each item is 2 x 60 px square.
    expect(flow.getAttribute('style')).toContain('grid-template-columns: repeat(5, 120px)');
    expect(flow.getAttribute('style')).toContain('grid-auto-rows: 120px');
    // 4 x 60 - 40 - 18 = 182 px high: one row a page (the page bar fits under it). Only that page is drawn.
    expect([...flow.querySelectorAll(':scope > [data-node-id]')].map((e) => e.getAttribute('data-node-id')))
      .toEqual(kids.slice(0, 5).map((k) => k.id));
    expect(screen.queryByText('K5')).toBeNull();
    expect(container.querySelector('[data-page-bar="next"]')).not.toBeNull();
  });

  it('a tile inside a folder is drawn at the contents size; its own size is kept (M5 §2)', async () => {
    const { dash, tab } = mk([
      tile('top', 'Top', 0, 0, 4, 4),
      folder('f1', 'F', 0, 4, 12, 6, [kid('big', 'Big', { size: 'large' })], { contentSize: 'small' })
    ]);
    (tab.root.children[0] as any).size = 'large';
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(container.querySelector('[data-node-id="top"] button.entry')!.classList.contains('large')).toBe(true);
    const inFolder = container.querySelector('[data-node-id="big"] button.entry')!;
    expect(inFolder.classList.contains('small')).toBe(true);
    expect(inFolder.classList.contains('large')).toBe(false);
    expect((tab.root.children[1] as any).content.children[0].size).toBe('large');
  });

  it('a Medium item in a folder is the same size as a Medium tile on the tab (M5 consistent sizes)', async () => {
    const { dash, tab } = mk([tile('top', 'Top', 0, 0, 2, 2), folder('f1', 'F', 0, 2, 24, 8, [kid('in', 'In')])]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const grid = container.querySelector('.container-grid') as HTMLElement;
    const row = Number(/grid-auto-rows:\s*([\d.]+)px/.exec(grid.getAttribute('style') ?? '')![1]);
    const flow = container.querySelector('.container-flow') as HTMLElement;
    const item = Number(/grid-auto-rows:\s*([\d.]+)px/.exec(flow.getAttribute('style') ?? '')![1]);
    expect(item).toBeCloseTo(2 * row, 1); // both are rounded to 0.01 px
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
