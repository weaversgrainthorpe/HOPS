import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

// A dashboard page while the store holds the other dashboards only as index entries: opening one
// of them fetches it on its own and renders it (never a blank or partial page); an unknown path is
// "not found" exactly as before.

const pageStore = vi.hoisted(() => ({ set: null as null | ((p: unknown) => void) }));
vi.mock('$app/stores', async () => {
  const { writable } = await import('svelte/store');
  const page = writable({ url: new URL('http://localhost/a'), params: { dashboard: 'a' }, route: { id: '/[dashboard]' } });
  pageStore.set = page.set as (p: unknown) => void;
  return { page, navigating: writable(null), updated: writable(false) };
});
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$lib/utils/api', async (orig) => ({
  ...(await orig<typeof import('$lib/utils/api')>()),
  getConfig: vi.fn(),
  getConfigFor: vi.fn(),
  getDashboard: vi.fn()
}));

import * as api from '$lib/utils/api';
import { config, configLoading, configError, loadConfig, otherDashboards, resetPartialLoadingForTests } from '$lib/stores/config';
import { editEntry } from '$lib/stores/editMode';
import Page from './+page.svelte';
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

const tileNode = (id: string, name: string) => ({
  kind: 'tile', id, name, url: 'http://x.test/' + id, icon: '', openMode: 'newtab', size: 'medium', order: 0,
  placement: { x: 0, y: 0, w: 2, h: 2 }
});
const full = (id: string, name: string, revision: number, tile: string): LayoutDashboard => ({
  id, name, path: `/${id}`, order: id.charCodeAt(0), revision,
  tabs: [{ id: `t-${id}`, name: 'Main', root: { columns: 24, children: [tileNode(`n-${id}`, tile)] } }]
}) as unknown as LayoutDashboard;
const index = (id: string, name: string, revision: number) =>
  ({ id, name, path: `/${id}`, order: id.charCodeAt(0), revision, partial: true }) as unknown as LayoutDashboard;
const goTo = (seg: string) =>
  pageStore.set!({ url: new URL(`http://localhost/${seg}`), params: { dashboard: seg }, route: { id: '/[dashboard]' } });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeRO);
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {}); // the failures below are expected
  resetPartialLoadingForTests();
  config.set(null);
  configError.set(null);
  configLoading.set(true);
  editEntry.set(null);
  goTo('a');
  // The other dashboards never arrive in these tests (they are still loading).
  vi.mocked(api.getConfig).mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('dashboard page with partial loading', () => {
  it('switching to another dashboard before the background load arrives fetches it and renders it', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValueOnce({
      config: { schemaVersion: 3, layoutVersion: 2, dashboards: [full('a', 'Alpha', 1, 'Alpha Tile'), index('b', 'Beta', 5)] },
      configRevision: 'r1'
    });
    let answer!: (v: Awaited<ReturnType<typeof api.getDashboard>>) => void;
    vi.mocked(api.getDashboard).mockImplementationOnce(() => new Promise((res) => (answer = res)));
    await loadConfig({ dashboard: 'a' });
    const { container } = render(Page);
    await tick();
    expect(container.querySelector('[data-node-id="n-a"]')).not.toBeNull();

    goTo('b');
    await tick();
    // Fetched on its own; meanwhile the skeleton, never an empty or partial dashboard.
    expect(api.getDashboard).toHaveBeenCalledWith('b');
    expect(container.querySelector('[data-node-id="n-a"]')).toBeNull();
    expect(screen.queryByText(/Not Found/)).toBeNull();
    expect(container.querySelector('.tab-canvas')).toBeNull();

    answer({ dashboard: full('b', 'Beta', 5, 'Beta Tile'), revision: 5, configRevision: 'r1' });
    await vi.waitFor(() => expect(container.querySelector('[data-node-id="n-b"]')).not.toBeNull());
    expect(api.getConfig).toHaveBeenCalledTimes(1); // only the background load, still in flight
  });

  it('a failed fetch of the dashboard being opened says so, with Retry that recovers', async () => {
    vi.mocked(api.getConfigFor)
      .mockResolvedValueOnce({
        config: { schemaVersion: 3, layoutVersion: 2, dashboards: [full('a', 'Alpha', 1, 'Alpha Tile'), index('b', 'Beta', 5)] },
        configRevision: 'r1'
      })
      .mockResolvedValueOnce({
        config: { schemaVersion: 3, layoutVersion: 2, dashboards: [index('a', 'Alpha', 1), full('b', 'Beta', 5, 'Beta Tile')] },
        configRevision: 'r1'
      });
    vi.mocked(api.getDashboard).mockRejectedValueOnce(new Error('HOPS hit an error'));
    goTo('b');
    await loadConfig({ dashboard: 'a' });
    const { container } = render(Page);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load Beta");
    expect(alert).toHaveTextContent('HOPS hit an error');
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(container.querySelector('[data-node-id="n-b"]')).not.toBeNull());
    expect(api.getConfigFor).toHaveBeenLastCalledWith('b');
  });

  it('an unknown dashboard path shows "not found" as before, not a blank page', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValueOnce({
      config: { schemaVersion: 3, layoutVersion: 2, dashboards: [index('a', 'Alpha', 1), index('b', 'Beta', 5)] },
      configRevision: 'r1',
      missing: 'nope'
    });
    goTo('nope');
    await loadConfig({ dashboard: 'nope' });
    render(Page);
    await tick();
    expect(screen.getByText('Dashboard Not Found')).toBeInTheDocument();
    expect(api.getDashboard).not.toHaveBeenCalled();
  });

  it('a one-dashboard read that keeps disagreeing with the index ends in the error with Retry, after a bounded number of reads', async () => {
    vi.mocked(api.getConfigFor).mockImplementation(async () => ({
      config: { schemaVersion: 3, layoutVersion: 2, dashboards: [full('a', 'Alpha', 1, 'Alpha Tile'), index('b', 'Beta', 5)] },
      configRevision: 'r2'
    }));
    vi.mocked(api.getDashboard).mockResolvedValue({ dashboard: full('b', 'Beta', 4, 'Old Beta'), revision: 4, configRevision: 'r1' });
    goTo('b');
    await loadConfig({ dashboard: 'b' });
    const { container } = render(Page);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load Beta");
    for (let i = 0; i < 50; i++) await tick();
    expect(api.getDashboard).toHaveBeenCalledTimes(2);
    expect(api.getConfigFor).toHaveBeenCalledTimes(2);

    // Retry starts fresh, and recovers once the copies agree.
    vi.mocked(api.getDashboard).mockResolvedValue({ dashboard: full('b', 'Beta', 5, 'Beta Tile'), revision: 5, configRevision: 'r2' });
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(container.querySelector('[data-node-id="n-b"]')).not.toBeNull());
  });

  it('a failed background load shows a small bar with Retry; the open dashboard stays usable', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValueOnce({
      config: { schemaVersion: 3, layoutVersion: 2, dashboards: [full('a', 'Alpha', 1, 'Alpha Tile'), index('b', 'Beta', 5)] },
      configRevision: 'r1'
    });
    vi.mocked(api.getConfig).mockRejectedValueOnce(new Error('HOPS hit an error'));
    await loadConfig({ dashboard: 'a' });
    const { container } = render(Page);
    const bar = await screen.findByRole('alert');
    expect(bar).toHaveTextContent("Couldn't load the other dashboards");
    expect(container.querySelector('[data-node-id="n-a"]')).not.toBeNull();

    vi.mocked(api.getConfig).mockResolvedValueOnce({
      schemaVersion: 3, layoutVersion: 2, dashboards: [full('a', 'Alpha', 1, 'Alpha Tile'), full('b', 'Beta', 5, 'Beta Tile')]
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(container.querySelector('[data-node-id="n-a"]')).not.toBeNull();
  });

  it('no bar while the other dashboards are loading, or on a single-dashboard setup', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValueOnce({
      config: { schemaVersion: 3, layoutVersion: 2, dashboards: [full('a', 'Alpha', 1, 'Alpha Tile'), index('b', 'Beta', 5)] },
      configRevision: 'r1'
    });
    await loadConfig({ dashboard: 'a' });
    render(Page);
    await tick();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/other dashboards/)).toBeNull();
    cleanup();

    config.set({ schemaVersion: 3, layoutVersion: 2, dashboards: [full('a', 'Alpha', 1, 'Alpha Tile')] });
    otherDashboards.set({ error: 'left over' });
    render(Page);
    await tick();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('one bar at a time: the pencil is already showing this failure, or the page shows a config error', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValueOnce({
      config: { schemaVersion: 3, layoutVersion: 2, dashboards: [full('a', 'Alpha', 1, 'Alpha Tile'), index('b', 'Beta', 5)] },
      configRevision: 'r1'
    });
    await loadConfig({ dashboard: 'a' });
    otherDashboards.set({ error: 'HOPS hit an error' });
    editEntry.set({ dashboardId: 'a', busy: false });
    render(Page);
    await tick();
    expect(screen.queryByRole('alert')).toBeNull();
    editEntry.set(null);
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the other dashboards");
    configError.set('offline');
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('offline');
  });

  it('a failed first load is the config error with Retry, never an empty page', async () => {
    vi.mocked(api.getConfigFor)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        config: { schemaVersion: 3, layoutVersion: 2, dashboards: [full('a', 'Alpha', 1, 'Alpha Tile')] },
        configRevision: 'r1'
      });
    await loadConfig({ dashboard: 'a' });
    const { container } = render(Page);
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('offline');
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(container.querySelector('[data-node-id="n-a"]')).not.toBeNull());
    expect(api.getConfigFor).toHaveBeenLastCalledWith('a');
  });
});
