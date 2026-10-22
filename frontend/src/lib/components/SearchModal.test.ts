import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
const pageStore = vi.hoisted(() => ({ set: null as null | ((p: any) => void) }));
vi.mock('$app/stores', async () => {
  const { writable } = await import('svelte/store');
  const page = writable({ url: new URL('http://localhost/'), params: {}, route: { id: '/' }, status: 200, error: null, data: {}, form: undefined });
  pageStore.set = page.set;
  return { page, navigating: writable(null), updated: writable(false) };
});
const setPage = (params: Record<string, string>) =>
  pageStore.set!({ url: new URL('http://localhost/'), params, route: { id: '/' }, status: 200, error: null, data: {}, form: undefined });

import { goto } from '$app/navigation';
import SearchModal from './SearchModal.svelte';
import Dashboard from './Dashboard.svelte';
import { config } from '$lib/stores/config';
import { editMode } from '$lib/stores/editMode';
import { closeAll, overlayStack, revealRequest } from '$lib/stores/folderOverlay';
import type { Config } from '$lib/types';
import type { LayoutDashboard } from '$lib/types/layout';

class FakeRO {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    this.cb([{ target: el, contentRect: { width: 1440 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

const tile = (id: string, name: string, extra: any = {}): any => ({
  kind: 'tile', id, name, url: 'http://deep.test/' + id, icon: '', openMode: 'newtab', size: 'medium', order: 0,
  placement: { x: 0, y: 0, w: 2, h: 2 }, ...extra
});
const folder = (id: string, name: string, display: string, children: any[]): any => ({
  kind: 'folder', id, name, display, size: 'medium', contentSize: 'medium', placement: { x: 0, y: 2, w: 8, h: 6 },
  content: { children: children.map(({ placement: _p, ...c }) => c) } // M5: folder contents have no placements
});

// Tab "Second" > Outer (collapsed) > Mid (expanded) > Inner (collapsed) > "Deep Thing"
const layoutD1: LayoutDashboard = {
  id: 'd1', name: 'Home', path: '/home', revision: 1,
  tabs: [
    { id: 't1', name: 'Main', root: { columns: 24, children: [tile('top', 'Top Tile')] } },
    {
      id: 't2', name: 'Second',
      root: { columns: 24, children: [
        folder('outer', 'Outer', 'collapsed', [
          folder('mid', 'Mid', 'expanded', [
            folder('inner', 'Inner', 'collapsed', [tile('deep', 'Deep Thing')])
          ])
        ])
      ] }
    }
  ]
};
const legacy = layoutD1; // the route's dashboard

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeRO);
  vi.clearAllMocks();
  setPage({});
  closeAll();
  revealRequest.set(null);
  editMode.set(false);
  config.set({ schemaVersion: 3, dashboards: [layoutD1] } as Config);
});
afterEach(() => {
  // Unmount first, so nothing re-renders after the stubs (ResizeObserver) are removed.
  cleanup();
  vi.unstubAllGlobals();
  closeAll();
  revealRequest.set(null);
  config.set(null);
});

describe('SearchModal recursive search', () => {
  it('SearchModal: finds a tile 3 levels deep, shows its path, opens the collapsed folders on select', async () => {
    const { container } = render(Dashboard, { dashboard: legacy });
    await tick();
    expect(container.querySelector('.tab-canvas[data-tab-id="t1"]')).not.toBeNull();

    const onClose = vi.fn();
    render(SearchModal, { onClose });
    await tick();
    const input = screen.getByRole('textbox', { name: /search tiles/i });
    await fireEvent.input(input, { target: { value: 'deep' } });
    await tick();

    const result = screen.getByRole('button', { name: /Deep Thing/ });
    expect(result).toHaveTextContent('Second › Outer › Mid › Inner');

    await fireEvent.click(result);
    expect(onClose).toHaveBeenCalled();
    // Switched to the tile's tab, opened the collapsed folders outermost first.
    await vi.waitFor(() => expect(container.querySelector('.tab-canvas[data-tab-id="t2"]')).not.toBeNull());
    await vi.waitFor(() => expect(get(overlayStack)).toEqual(['outer', 'inner']));
    // ...and focused the tile (inside the top overlay).
    await vi.waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.closest('[data-node-id="deep"]')).not.toBeNull();
    });
    // Navigation only when the tile is on another dashboard (the page here is "/").
    expect(goto).toHaveBeenCalledWith('/home');
  });

  it('result names and paths are text, never markup', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    config.update((c) => ({
      ...c!,
      dashboards: [{ ...layoutD1, tabs: [{ id: 't1', name: evil, root: { columns: 24, children: [tile('x', 'Evil ' + evil)] } }] }]
    }));
    render(SearchModal, { onClose: () => {} });
    await tick();
    await fireEvent.input(screen.getByRole('textbox', { name: /search tiles/i }), { target: { value: 'evil' } });
    await tick();
    expect(document.querySelector('.search-results img')).toBeNull();
    expect(screen.getByRole('button', { name: /Evil/ })).toHaveTextContent(evil);
  });
});

describe('SearchModal scope', () => {
  const layoutD2: LayoutDashboard = {
    id: 'd2', name: 'Lab', path: '/lab', revision: 1,
    tabs: [{ id: 'u1', name: 'Bench', root: { columns: 24, children: [tile('other', 'Other Dash Tile')] } }]
  };
  const twoDashboards = () =>
    config.update((c) => ({ ...c!, dashboards: [layoutD1, layoutD2] }));
  const type = async (v: string) => {
    await fireEvent.input(screen.getByRole('textbox', { name: /search/i }), { target: { value: v } });
    await tick();
  };

  it('on a dashboard page: only that dashboard is searched, at any depth', async () => {
    twoDashboards();
    setPage({ dashboard: 'home' });
    render(SearchModal, { onClose: () => {} });
    await tick();
    expect(screen.getByPlaceholderText(/search this dashboard/i)).toBeInTheDocument();
    await type('other dash');
    expect(screen.queryByRole('button', { name: /Other Dash Tile/ })).toBeNull();
    await type('deep');
    expect(screen.getByRole('button', { name: /Deep Thing/ })).toHaveTextContent('Second › Outer › Mid › Inner');
  });

  it('on a decoded multi-word dashboard path the scope still resolves', async () => {
    config.update((c) => ({
      ...c!, dashboards: [{ ...layoutD1, path: '/my dash' }, layoutD2]
    }));
    setPage({ dashboard: 'my dash' });
    render(SearchModal, { onClose: () => {} });
    await tick();
    await type('other dash');
    expect(screen.queryByRole('button', { name: /Other Dash Tile/ })).toBeNull();
    await type('top');
    expect(screen.getByRole('button', { name: /Top Tile/ })).toBeInTheDocument();
  });

  it('elsewhere: searches all dashboards and shows dashboard names', async () => {
    twoDashboards();
    render(SearchModal, { onClose: () => {} });
    await tick();
    expect(screen.getByPlaceholderText(/search all dashboards/i)).toBeInTheDocument();
    await type('t');
    expect(screen.getByRole('button', { name: /Other Dash Tile/ })).toHaveTextContent('Lab');
    expect(screen.getByRole('button', { name: /Top Tile/ })).toHaveTextContent('Home');
  });

  it('with no document loaded (failed load) the visible alert shows, not "no matches"', async () => {
    config.set(null);
    setPage({ dashboard: 'home' });
    render(SearchModal, { onClose: () => {} });
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent(/unavailable/i);
  });
});
