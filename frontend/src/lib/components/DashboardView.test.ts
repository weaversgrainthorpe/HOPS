import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
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
import { begin, session, resetEditSessionForTests, apply } from '$lib/stores/editSession';
import { selectedNodes, clearSelection } from '$lib/stores/nodeSelection';
import { editorMenu, editorDialog } from '$lib/editor/editorUi';
import { updateNode } from '$lib/editor/treeOps';
import type { LayoutNode } from '$lib/types/layout';


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

function enterEdit(id = 'd1') {
  isAuthenticated.set(true);
  begin(id);
  editMode.set(true);
}

beforeEach(() => {
  resetEditSessionForTests();
  clearSelection();
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
  it('view mode renders TabCanvas; entering edit mode renders the editing canvas (no TabPanel) with the toolbar', async () => {
    const { container } = render(Dashboard, { dashboard: legacy });
    await tick();
    expect(container.querySelector('.tab-canvas[data-tab-id="t1"]')).not.toBeNull();
    expect(screen.getByText('MainTile')).toBeInTheDocument();
    expect(container.querySelector('.tab-panel')).toBeNull();

    enterEdit();
    await tick();
    expect(container.querySelector('.tab-panel')).toBeNull();
    // The draft (v3 tree) is what is rendered, editable: the legacy-only tile is not there.
    expect(container.querySelector('.tab-canvas.editing[data-tab-id="t1"]')).not.toBeNull();
    expect(screen.getByText('MainTile')).toBeInTheDocument();
    expect(screen.queryByText('LegacyTile')).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Editing' })).toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).toBeNull();
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

  it('a v3-only dashboard never renders the editor even if edit mode is switched on', async () => {
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
    // Fresh objects throughout, as a real reload delivers.
    const next = structuredClone(cfg());
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

describe('Dashboard edit mode (M3 Task 6: the v3 editor shell)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error('no network in tests')));
    vi.stubGlobal('fetch', fetchSpy);
    editorMenu.set(null);
    editorDialog.set(null);
  });
  const draft = () => get(session)!.draft;
  const cellOf = (c: HTMLElement, id: string) => c.querySelector(`.tab-canvas [data-node-id="${id}"]`) as HTMLElement;

  it('a change shows "Unsaved changes"', async () => {
    render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    apply('Rename', (d) => updateNode(d, 'm1', { name: 'Renamed' } as Partial<LayoutNode>));
    await tick();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByText('Renamed')).toBeInTheDocument(); // the canvas shows the draft
  });

  it('a click selects one tile (and does not open it); Ctrl-click adds; Escape clears', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'MainTile' }));
    expect([...get(selectedNodes)]).toEqual(['m1']);
    expect(open).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: /^Box, folder/ }), { ctrlKey: true });
    expect([...get(selectedNodes)].sort()).toEqual(['box', 'm1']);
    await tick();
    expect(cellOf(container, 'm1').classList.contains('selected')).toBe(true);
    expect(cellOf(container, 'box').classList.contains('selected')).toBe(true);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(get(selectedNodes).size).toBe(0);
    await tick();
    expect(cellOf(container, 'm1').classList.contains('selected')).toBe(false);
    open.mockRestore();
  });

  it('right-click on a tile opens its menu; on empty grid space, the container menu at that cell', async () => {
    const { container } = render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    await fireEvent.contextMenu(cellOf(container, 'm1'), { clientX: 30, clientY: 40 });
    expect(get(editorMenu)).toEqual({ x: 30, y: 40, target: { kind: 'node', id: 'm1' } });
    await tick();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    editorMenu.set(null);
    const grid = container.querySelector('.tab-canvas [data-container-id="t1"]') as HTMLElement;
    grid.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1440, bottom: 600, width: 1440, height: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
    await fireEvent.contextMenu(grid, { clientX: 5 * 120 + 10, clientY: 10 });
    const req = get(editorMenu)!;
    expect(req.target).toEqual({ kind: 'container', ref: { tabId: 't1' }, cell: { x: 5, y: 0 } });
  });

  it('the tab dialog edits the draft only (no request), and the tab bar shows the draft', async () => {
    render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Main tab' }));
    const name = screen.getByLabelText(/Tab Name/) as HTMLInputElement;
    await fireEvent.input(name, { target: { value: 'Front' } });
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Save/ }));
    expect(draft().tabs.find((t) => t.id === 't1')!.name).toBe('Front');
    await tick();
    expect(screen.getByRole('tab', { name: 'Switch to Front tab' })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Add tab creates the tab in the draft and switches to it', async () => {
    const { container } = render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: /^Add tab/ }));
    await fireEvent.input(screen.getByLabelText(/Tab Name/), { target: { value: 'Media' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Create/ }));
    await tick();
    await tick();
    const added = draft().tabs[draft().tabs.length - 1];
    expect(added.name).toBe('Media');
    expect(screen.getByRole('tab', { name: 'Switch to Media tab' }).getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector(`.tab-canvas[data-tab-id="${added.id}"]`)).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('duplicating and deleting a tab edit the draft (delete asks first)', async () => {
    render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Duplicate Main tab' }));
    await tick();
    expect(draft().tabs.map((t) => t.name)).toEqual(['Second', 'Main', 'Main (Copy)']);
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Second tab' }));
    await tick();
    const { closeConfirmModal } = await import('$lib/stores/confirmModal');
    closeConfirmModal(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(draft().tabs.map((t) => t.name)).toEqual(['Main', 'Main (Copy)']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('tab reorder by drag (the tab bar finalize) reorders the draft and keeps the active tab', async () => {
    render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    expect(screen.getByRole('tab', { name: 'Switch to Main tab' }).getAttribute('aria-selected')).toBe('true');
    const bar = document.querySelector('[data-dashboard-tabs]') as HTMLElement;
    const items = draft().tabs.map((t) => ({ id: t.id, name: t.name })).reverse();
    bar.dispatchEvent(new CustomEvent('finalize', { detail: { items, info: { id: 't1', source: 'pointer', trigger: 'droppedIntoZone' } } }));
    await tick();
    expect(draft().tabs.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(screen.getByRole('tab', { name: 'Switch to Main tab' }).getAttribute('aria-selected')).toBe('true');
  });

  it('the Header dialog edits the draft only; the Settings cog stays', async () => {
    render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    expect(screen.getByTitle('Dashboard settings')).toBeInTheDocument();
    await fireEvent.click(screen.getByTitle('Configure Header'));
    await fireEvent.input(screen.getByLabelText(/Custom Title/), { target: { value: 'Draft title' } });
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Save/ }));
    expect((draft().header as { centerTitle?: string }).centerTitle).toBe('Draft title');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
