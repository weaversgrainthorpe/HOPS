import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';

const pageStore = vi.hoisted(() => ({ set: null as null | ((p: any) => void) }));
vi.mock('$app/stores', async () => {
  const { writable } = await import('svelte/store');
  const page = writable({ url: new URL('http://localhost/'), params: {}, route: { id: '/' }, status: 200, error: null, data: {}, form: undefined });
  pageStore.set = page.set;
  return { page, navigating: writable(null), updated: writable(false) };
});

import Dashboard from './Dashboard.svelte';
import Navbar from './Navbar.svelte';
import { config, layoutStale } from '$lib/stores/config';
import { editMode } from '$lib/stores/editMode';
import { isAuthenticated } from '$lib/stores/auth';
import { closeAll, overlayStack, requestReveal, revealNavigation, revealRequest } from '$lib/stores/folderOverlay';
import { applyThemePreset } from '$lib/stores/theme';
import type { Config, Dashboard as DashboardT } from '$lib/types';
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

const entry = (id: string, name: string) => ({ id, name, url: 'http://x.test', icon: '', openMode: 'newtab' as const, size: 'medium' as const, order: 0 });
const tile = (id: string, name: string, x = 0, y = 0): any => ({ kind: 'tile', ...entry(id, name), placement: { x, y, w: 1, h: 1 } });
const folder = (id: string, name: string, children: any[], display = 'expanded'): any => ({
  kind: 'folder', id, name, display, placement: { x: 0, y: 1, w: 4, h: 3 }, content: { columns: 4, children }
});

const legacy: DashboardT = {
  id: 'd1', name: 'Home', path: '/home', order: 0, revision: 1,
  tabs: [
    { id: 't1', name: 'Main', order: 0, groups: [{ id: 'g1', name: 'G', order: 0, collapsed: false, entries: [entry('e1', 'LegacyTile')] }] },
    { id: 't2', name: 'Second', order: 1, groups: [] }
  ]
};
// Layout tabs deliberately in the opposite order: the active tab is matched by id.
const layoutD1: LayoutDashboard = {
  id: 'd1', name: 'Home', path: '/home', revision: 1,
  tabs: [
    { id: 't2', name: 'Second', root: { columns: 12, children: [tile('s1', 'SecondTile')] } },
    { id: 't1', name: 'Main', root: { columns: 12, children: [tile('m1', 'MainTile'), folder('box', 'Box', [tile('in1', 'Inside')], 'collapsed')] } }
  ]
};
const v3d: LayoutDashboard = {
  id: 'v3d', name: 'Fancy', path: '/fancy', revision: 4,
  header: { centerTitle: 'Fancy Header' },
  tabs: [{ id: 'vt', name: 'Only', root: { columns: 12, children: [tile('f1', 'FancyTile')] } }]
};

function cfg(layoutDashes: LayoutDashboard[] = [layoutD1, v3d]): Config {
  return {
    dashboards: [legacy],
    theme: { mode: 'auto' },
    settings: { searchHotkey: '/', defaultView: 'd1' },
    dashboardRevisions: { d1: 1 },
    layout: { schemaVersion: 3, dashboards: layoutDashes },
    v3OnlyDashboards: [{ id: 'v3d', name: 'Fancy', path: '/fancy', reason: 'free layout' }]
  } as Config;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeRO);
  closeAll();
  editMode.set(false);
  isAuthenticated.set(false);
  config.set(cfg());
});
afterEach(() => {
  vi.unstubAllGlobals();
  closeAll();
  editMode.set(false);
  isAuthenticated.set(false);
  config.set(null);
});

describe('Dashboard view/edit rendering', () => {
  it('view mode renders TabCanvas; toggling edit mode renders TabPanel', async () => {
    const { container } = render(Dashboard, { dashboard: legacy });
    await tick();
    expect(container.querySelector('.tab-canvas[data-tab-id="t1"]')).not.toBeNull();
    expect(screen.getByText('MainTile')).toBeInTheDocument();
    expect(container.querySelector('.tab-panel')).toBeNull();

    editMode.set(true);
    await tick();
    expect(container.querySelector('.tab-panel')).not.toBeNull();
    expect(screen.getByText('LegacyTile')).toBeInTheDocument();
    expect(container.querySelector('.tab-canvas')).toBeNull();
  });

  it('matches the active tab between legacy and layout by id, not index', async () => {
    const { container } = render(Dashboard, { dashboard: legacy });
    await tick();
    await fireEvent.click(screen.getByRole('tab', { name: 'Switch to Second tab' }));
    await tick();
    expect(container.querySelector('.tab-canvas[data-tab-id="t2"]')).not.toBeNull();
    expect(screen.getByText('SecondTile')).toBeInTheDocument();
  });

  it('missing layout dashboard shows the error banner, not TabPanel', async () => {
    config.set(cfg([v3d]));
    const { container } = render(Dashboard, { dashboard: legacy });
    await tick();
    const banner = screen.getByText('Layout data missing for this dashboard — reload').closest('[role="alert"]');
    expect(banner).not.toBeNull();
    expect(container.querySelector('.tab-panel')).toBeNull();
    expect(container.querySelector('.tab-canvas')).toBeNull();
  });

  it('theme tokens set on :root reach the body-portalled folder overlay', async () => {
    applyThemePreset('default', 'dark');
    render(Dashboard, { dashboard: legacy });
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Box, folder with 1 item' }));
    await tick();
    expect(get(overlayStack)).toEqual(['box']);
    const panel = document.body.querySelector('.overlay-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    const rootVal = getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim();
    expect(rootVal).toBe('#1e293b');
    expect(getComputedStyle(panel).getPropertyValue('--bg-secondary').trim()).toBe(rootVal);
  });
});

describe('v3-only dashboards', () => {
  it('v3-only dashboard: renders in view mode, edit toggle disabled with the tooltip text', async () => {
    isAuthenticated.set(true);
    editMode.set(true); // left on from a legacy dashboard
    pageStore.set!({ url: new URL('http://localhost/fancy'), params: { dashboard: 'fancy' }, route: { id: '/[dashboard]' }, status: 200, error: null, data: {}, form: undefined });
    const nav = render(Navbar);
    const { container } = render(Dashboard, { dashboard: v3d as unknown as DashboardT, v3Only: true });
    await tick();
    expect(get(editMode)).toBe(false);
    expect(container.querySelector('.tab-canvas[data-tab-id="vt"]')).not.toBeNull();
    expect(screen.getByText('FancyTile')).toBeInTheDocument();
    expect(container.querySelector('.tab-panel')).toBeNull();
    expect(screen.queryByText('Add Tab')).toBeNull();
    // Settings cog still available (its modal uses its own endpoint).
    expect(screen.getByTitle('Dashboard settings')).toBeInTheDocument();

    const toggle = nav.container.querySelector('.edit-toggle') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('title')).toBe('This dashboard uses v3 layout features and is view-only until the new editor arrives');
    // Header comes from the v3 dashboard.
    expect(nav.getByText('Fancy Header')).toBeInTheDocument();
    pageStore.set!({ url: new URL('http://localhost/'), params: {}, route: { id: '/' }, status: 200, error: null, data: {}, form: undefined });
  });

  it('a v3-only dashboard shows why it is view-only as visible text, tied to the disabled toggle', async () => {
    isAuthenticated.set(true);
    pageStore.set!({ url: new URL('http://localhost/fancy'), params: { dashboard: 'fancy' }, route: { id: '/[dashboard]' }, status: 200, error: null, data: {}, form: undefined });
    const nav = render(Navbar);
    render(Dashboard, { dashboard: v3d as unknown as DashboardT, v3Only: true });
    await tick();
    const note = screen.getByText(/View-only until the new editor arrives/);
    expect(note).toBeVisible();
    expect(note.closest('[id]')!.textContent).toContain('free layout'); // the server's reason
    const toggle = nav.container.querySelector('.edit-toggle') as HTMLButtonElement;
    const describedBy = toggle.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)!.textContent).toMatch(/View-only until the new editor arrives/);
    pageStore.set!({ url: new URL('http://localhost/'), params: {}, route: { id: '/' }, status: 200, error: null, data: {}, form: undefined });
  });

  it('anonymous viewers of a v3-only dashboard get no editor notice', async () => {
    render(Dashboard, { dashboard: v3d as unknown as DashboardT, v3Only: true });
    await tick();
    expect(screen.queryByText(/View-only until the new editor arrives/)).toBeNull();
  });

  it('a v3-only dashboard never renders TabPanel even if edit mode is switched on', async () => {
    const { container } = render(Dashboard, { dashboard: v3d as unknown as DashboardT, v3Only: true });
    await tick();
    editMode.set(true);
    await tick();
    expect(container.querySelector('.tab-panel')).toBeNull();
    expect(container.querySelector('.tab-canvas')).not.toBeNull();
  });
});

describe('route resolution and reveal lifetime', () => {
  it('a v3-only dashboard at a path that needs encoding still disables the edit toggle', async () => {
    const spaced: LayoutDashboard = { ...v3d, id: 'sp', name: 'Spaced', path: '/my dash' };
    config.set({ ...cfg([layoutD1, spaced]), v3OnlyDashboards: [{ id: 'sp', name: 'Spaced', path: '/my dash', reason: 'x' }] } as Config);
    isAuthenticated.set(true);
    pageStore.set!({ url: new URL('http://localhost/my%20dash'), params: { dashboard: 'my dash' }, route: { id: '/[dashboard]' }, status: 200, error: null, data: {}, form: undefined });
    const nav = render(Navbar);
    await tick();
    const toggle = nav.container.querySelector('.edit-toggle') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('title')).toBe('This dashboard uses v3 layout features and is view-only until the new editor arrives');
    pageStore.set!({ url: new URL('http://localhost/'), params: {}, route: { id: '/' }, status: 200, error: null, data: {}, form: undefined });
  });

  it('a reveal request cleared by navigating elsewhere does not fire on a later visit', async () => {
    requestReveal({ dashboardId: 'd1', tabId: 't2', folderIds: [], tileId: 's1' });
    revealNavigation('somewhere-else');
    expect(get(revealRequest)).toBeNull();
    const { container } = render(Dashboard, { dashboard: legacy });
    await tick();
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('.tab-canvas[data-tab-id="t1"]')).not.toBeNull();
  });

  it('a stale reload keeps the active tab id and the open overlay stack (M3 Task 1)', async () => {
    const { container, rerender } = render(Dashboard, { dashboard: legacy });
    await tick();
    expect(container.querySelector('.tab-canvas[data-tab-id="t1"]')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /^Box, folder/ }));
    expect(get(overlayStack)).toEqual(['box']);
    // A write response came back without a layout: stale, reload in flight.
    layoutStale.set(true);
    await tick();
    // The reload lands with the tabs reordered (the active tab moved index).
    const reordered: DashboardT = { ...legacy, revision: 2, tabs: [legacy.tabs[1], legacy.tabs[0]] };
    const next = cfg();
    next.dashboards = [reordered];
    next.dashboardRevisions = { d1: 2 };
    config.set(next);
    layoutStale.set(false);
    await rerender({ dashboard: reordered });
    await tick();
    expect(container.querySelector('.tab-canvas[data-tab-id="t1"]')).not.toBeNull();
    expect(screen.getByRole('tab', { name: 'Switch to Main tab' }).getAttribute('aria-selected')).toBe('true');
    expect(get(overlayStack)).toEqual(['box']);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
