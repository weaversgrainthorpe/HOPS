import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import TabCanvas from './TabCanvas.svelte';
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

  it('clamps an out-of-range placement instead of dropping it', async () => {
    const { dash, tab } = mk([tile('e1', 'Edge', 40, 0, 9)]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(screen.getByText('Edge')).toBeInTheDocument();
    const el = container.querySelector('[data-node-id="e1"]') as HTMLElement;
    expect(el.getAttribute('style')).toContain('grid-column: 12 / span 1');
  });
});
