import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/svelte';
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
import type { Config } from '$lib/types';
import type { LayoutDashboard } from '$lib/types/layout';
import { begin, session, resetEditSessionForTests, apply } from '$lib/stores/editSession';
import { selectedNodes, clearSelection } from '$lib/stores/nodeSelection';
import { editorMenu, editorDialog } from '$lib/editor/editorUi';
import { updateNode } from '$lib/editor/treeOps';
import type { LayoutNode } from '$lib/types/layout';
import { noRequestsButSettingsRead } from './editor/editorTestKit';


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

const layoutD1: LayoutDashboard = {
  id: 'd1', name: 'Home', path: '/home', revision: 1,
  tabs: [
    { id: 't1', name: 'Main', root: { columns: 12, children: [tile('m1', 'MainTile'), folder('box', 'Box', [tile('in1', 'Inside')], 'collapsed')] } },
    { id: 't2', name: 'Second', root: { columns: 12, children: [tile('s1', 'SecondTile')] } }
  ]
};
const legacy = layoutD1; // the dashboard the route hands Dashboard (v3, like every dashboard)
// The Showcase: a free-layout dashboard, once "view-only (v3)", now editable like any other.
const v3d: LayoutDashboard = {
  id: 'v3d', name: 'Fancy', path: '/fancy', revision: 4,
  header: { centerTitle: 'Fancy Header' },
  tabs: [{ id: 'vt', name: 'Only', layout: 'free', designWidth: 1280, root: { columns: 160, children: [
    { ...tile('f1', 'FancyTile'), placement: { x: 0, y: 0, w: 16, h: 16 } }
  ] } }]
};

function cfg(dashes: LayoutDashboard[] = [layoutD1, v3d]): Config {
  return { schemaVersion: 3, dashboards: dashes };
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
  // Unmount first, so nothing re-renders after the stubs (ResizeObserver) are removed.
  cleanup();
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
    // The session's draft is what is rendered, editable.
    expect(container.querySelector('.tab-canvas.editing[data-tab-id="t1"]')).not.toBeNull();
    expect(get(session)?.draft.tabs.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(screen.getByText('MainTile')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Editing' })).toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('switching tabs shows that tab\'s canvas', async () => {
    const { container } = render(Dashboard, { dashboard: legacy });
    await tick();
    await fireEvent.click(screen.getByRole('tab', { name: 'Switch to Second tab' }));
    await tick();
    expect(container.querySelector('.tab-canvas[data-tab-id="t2"]')).not.toBeNull();
    expect(screen.getByText('SecondTile')).toBeInTheDocument();
  });

  it('a tab whose layout data is missing shows the error banner, not a blank canvas', async () => {
    const broken = { ...layoutD1, tabs: [{ id: 't1', name: 'Main' } as unknown as LayoutDashboard['tabs'][number]] };
    config.set(cfg([broken]));
    const { container } = render(Dashboard, { dashboard: broken });
    await tick();
    const banner = screen.getByText('Layout data missing for this tab — reload').closest('[role="alert"]');
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

const atRoute = (path: string, seg?: string) =>
  pageStore.set!({ url: new URL('http://localhost' + path), params: seg ? { dashboard: seg } : {}, route: { id: seg ? '/[dashboard]' : '/' }, status: 200, error: null, data: {}, form: undefined });

describe('the Showcase (free layout) is editable like every dashboard', () => {
  afterEach(() => atRoute('/'));

  it('the edit toggle is enabled with no view-only tooltip; it starts an edit session and the editor', async () => {
    isAuthenticated.set(true);
    atRoute('/fancy', 'fancy');
    const nav = render(Navbar);
    const { container } = render(Dashboard, { dashboard: v3d });
    await tick();
    expect(container.querySelector('.tab-canvas[data-tab-id="vt"]')).not.toBeNull();
    expect(screen.getByText('FancyTile')).toBeInTheDocument();
    expect(screen.queryByText(/view-only/i)).toBeNull();
    expect(nav.getByText('Fancy Header')).toBeInTheDocument();

    const toggle = nav.container.querySelector('.edit-toggle') as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('title') ?? '').not.toMatch(/view-only/i);
    expect(toggle.hasAttribute('aria-describedby')).toBe(false);
    await fireEvent.click(toggle);
    await tick();
    expect(get(editMode)).toBe(true);
    expect(get(session)?.dashboardId).toBe('v3d');
    expect(container.querySelector('.tab-canvas.editing[data-tab-id="vt"]')).not.toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Editing' })).toBeInTheDocument();
    // §7.2: every editing control is in the one floating toolbar; the tab row and the page above the
    // canvas are as in view mode (no Dashboard row, no Add Tab in the tab row, no failed-background row).
    const bar = screen.getByRole('toolbar', { name: 'Editing' });
    expect(within(bar).getByRole('button', { name: /^Add tab/ })).toBeInTheDocument();
    expect(screen.queryByText('Add Tab')).toBeNull();
    expect(container.querySelector('[data-dashboard-tabs] button:not([data-edit-handle])')).toBeNull();
    expect(container.querySelector('.header-actions, .bg-failed-row, .add-tab-btn, .editor-shell')).toBeNull();
    // One labelled "Dashboard" pencil (walkthrough §4C) replaces Background, Header and Settings.
    expect(within(bar).getByRole('button', { name: 'Edit Dashboard' })).toHaveTextContent('Dashboard');
    for (const t of ['Configure Background', 'Configure Header', 'Dashboard settings']) expect(screen.queryByTitle(t)).toBeNull();
  });

  it('anonymous viewers get the dashboard and no editor chrome', async () => {
    render(Dashboard, { dashboard: v3d });
    await tick();
    expect(screen.getByText('FancyTile')).toBeInTheDocument();
    expect(screen.queryByText(/view-only/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Dashboard' })).toBeNull();
  });
});

describe('route resolution and reveal lifetime', () => {
  it('a dashboard at a path that needs encoding is found for the edit toggle', async () => {
    const spaced: LayoutDashboard = { ...v3d, id: 'sp', name: 'Spaced', path: '/my dash' };
    config.set(cfg([layoutD1, spaced]));
    isAuthenticated.set(true);
    atRoute('/my%20dash', 'my dash');
    const nav = render(Navbar);
    await tick();
    const toggle = nav.container.querySelector('.edit-toggle') as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    await fireEvent.click(toggle);
    await tick();
    expect(get(session)?.dashboardId).toBe('sp');
    editMode.set(false);
    atRoute('/');
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
    // Fresh objects throughout, as a real reload delivers.
    const reordered: LayoutDashboard = structuredClone({ ...legacy, revision: 2, tabs: [legacy.tabs[1], legacy.tabs[0]] });
    config.set(cfg([reordered, v3d]));
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
    // The tab's shared edit handle (§4B) opens the tab dialog.
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Main tab' }));
    await tick();
    const name = screen.getByLabelText(/Tab Name/) as HTMLInputElement;
    await fireEvent.input(name, { target: { value: 'Front' } });
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Save/ }));
    expect(draft().tabs.find((t) => t.id === 't1')!.name).toBe('Front');
    await tick();
    expect(screen.getByRole('tab', { name: 'Switch to Front tab' })).toBeInTheDocument();
    noRequestsButSettingsRead(fetchSpy);
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
    noRequestsButSettingsRead(fetchSpy);
  });

  it('duplicating and deleting a tab from its menu edit the draft (delete asks first)', async () => {
    render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    await fireEvent.contextMenu(screen.getByRole('tab', { name: 'Switch to Main tab' }), { clientX: 10, clientY: 10 });
    await tick();
    await fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Duplicate' }));
    await tick();
    await tick();
    expect(draft().tabs.map((t) => t.name)).toEqual(['Main', 'Second', 'Main (Copy)']);
    // The copy is shown, as the old duplicate button did.
    expect(screen.getByRole('tab', { name: 'Switch to Main (Copy) tab' }).getAttribute('aria-selected')).toBe('true');
    await fireEvent.contextMenu(screen.getByRole('tab', { name: 'Switch to Second tab' }), { clientX: 10, clientY: 10 });
    await tick();
    await fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }));
    await tick();
    const { closeConfirmModal } = await import('$lib/stores/confirmModal');
    closeConfirmModal(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(draft().tabs.map((t) => t.name)).toEqual(['Main', 'Main (Copy)']);
    noRequestsButSettingsRead(fetchSpy);
  });

  // Tab reorder by drag (the editor's drag engine, Task 8) is covered in editor/TabReorder.test.ts.

  it('the Dashboard dialog does not come back by itself after edit mode ends with it open (idle timeout)', async () => {
    render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Dashboard' }));
    expect(screen.getByRole('dialog', { name: 'Edit Dashboard' })).toBeInTheDocument();
    editMode.set(false);
    resetEditSessionForTests();
    await tick();
    expect(screen.queryByRole('dialog', { name: 'Edit Dashboard' })).toBeNull();
    enterEdit();
    await tick();
    await tick();
    expect(screen.queryByRole('dialog', { name: 'Edit Dashboard' })).toBeNull();
  });

  it('the Dashboard dialog edits the draft only (header and background); its settings read is the only request', async () => {
    render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Dashboard' }));
    const dlg = screen.getByRole('dialog', { name: 'Edit Dashboard' });
    await fireEvent.input(within(dlg).getByLabelText(/Custom Title/), { target: { value: 'Draft title' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect((draft().header as { centerTitle?: string }).centerTitle).toBe('Draft title'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Dashboard' })).toBeNull());
    noRequestsButSettingsRead(fetchSpy);
  });
});

describe('one editing flow (walkthrough §4B): handle, double-click and menu for every item', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error('no network in tests')));
    vi.stubGlobal('fetch', fetchSpy);
    editorMenu.set(null);
    editorDialog.set(null);
  });
  const cellOf = (c: HTMLElement, id: string) => c.querySelector(`.tab-canvas [data-node-id="${id}"]`) as HTMLElement;
  const expandedD: LayoutDashboard = {
    id: 'd1', name: 'Home', path: '/home', revision: 1,
    tabs: [{ id: 't1', name: 'Main', root: { columns: 12, children: [tile('m1', 'MainTile'), folder('grp', 'Group', [tile('g1', 'InGroup')])] } }]
  };

  it('the old per-tab pencil / duplicate / delete buttons are gone', async () => {
    const { container } = render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    expect(container.querySelector('.tab-control-btn')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duplicate Main tab' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Main tab' })).toBeNull();
  });

  it('no handles outside edit mode', async () => {
    const { container } = render(Dashboard, { dashboard: legacy });
    await tick();
    expect(container.querySelector('[data-edit-handle]')).toBeNull();
  });

  it('tile: the handle and a double-click open its dialog; the handle click does not select it', async () => {
    const { container } = render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    await fireEvent.click(within(cellOf(container, 'm1')).getByRole('button', { name: 'Edit MainTile' }));
    expect(get(editorDialog)).toEqual({ kind: 'tile', id: 'm1' });
    expect(get(selectedNodes).has('m1')).toBe(false);
    editorDialog.set(null);
    await fireEvent.dblClick(cellOf(container, 'm1'));
    expect(get(editorDialog)).toEqual({ kind: 'tile', id: 'm1' });
  });

  it('expanded folder: the handle and a double-click open the folder dialog', async () => {
    config.set(cfg([expandedD])); // the edit session drafts the stored dashboard
    const { container } = render(Dashboard, { dashboard: expandedD });
    enterEdit();
    await tick();
    const f = cellOf(container, 'grp');
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Group' }));
    expect(get(editorDialog)).toEqual({ kind: 'folder', id: 'grp' });
    expect(get(selectedNodes).has('grp')).toBe(false);
    editorDialog.set(null);
    await fireEvent.dblClick(f);
    expect(get(editorDialog)).toEqual({ kind: 'folder', id: 'grp' });
    // The inner tile's own handle edits the tile, not the folder.
    editorDialog.set(null);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit InGroup' }));
    expect(get(editorDialog)).toEqual({ kind: 'tile', id: 'g1' });
  });

  it('collapsed folder in edit mode: double-click EDITS (no overlay); the handle edits; "Open" stays in its menu', async () => {
    const { container } = render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    const face = cellOf(container, 'box').querySelector('[role="button"][aria-haspopup]') as HTMLElement;
    await fireEvent.dblClick(face);
    await tick();
    expect(get(editorDialog)).toEqual({ kind: 'folder', id: 'box' });
    expect(get(overlayStack)).toEqual([]);
    editorDialog.set(null);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Box' }));
    expect(get(editorDialog)).toEqual({ kind: 'folder', id: 'box' });
    expect(get(overlayStack)).toEqual([]);
    editorDialog.set(null);
    await fireEvent.contextMenu(cellOf(container, 'box'), { clientX: 5, clientY: 5 });
    await tick();
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open' }));
    await tick();
    expect(get(overlayStack)).toEqual(['box']);
  });

  it('collapsed folder outside edit mode: a click still opens it, and there is no handle', async () => {
    const { container } = render(Dashboard, { dashboard: legacy });
    await tick();
    const face = cellOf(container, 'box').querySelector('[role="button"][aria-haspopup]') as HTMLElement;
    await fireEvent.click(face);
    await tick();
    expect(get(overlayStack)).toEqual(['box']);
    expect(get(editorDialog)).toBeNull();
  });

  it('tab: the handle, a double-click and the menu\'s Edit all open the tab dialog', async () => {
    render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    const tabEl = screen.getByRole('tab', { name: 'Switch to Second tab' });
    // Handle.
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Second tab' }));
    await tick();
    expect(get(editorDialog)).toEqual({ kind: 'tab', id: 't2' });
    expect((screen.getByLabelText(/Tab Name/) as HTMLInputElement).value).toBe('Second');
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Cancel/ }));
    await tick();
    expect(get(editorDialog)).toBeNull();
    expect(screen.queryByLabelText(/Tab Name/)).toBeNull();
    // Double-click.
    await fireEvent.dblClick(tabEl);
    await tick();
    expect(get(editorDialog)).toEqual({ kind: 'tab', id: 't2' });
    expect((screen.getByLabelText(/Tab Name/) as HTMLInputElement).value).toBe('Second');
    editorDialog.set(null);
    await tick();
    // Right-click: the shared menu with Edit, Duplicate, Delete.
    await fireEvent.contextMenu(tabEl, { clientX: 40, clientY: 12 });
    expect(get(editorMenu)).toEqual({ x: 40, y: 12, target: { kind: 'tab', id: 't2' } });
    await tick();
    const menu = screen.getByRole('menu', { name: 'Tab actions: Second' });
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent?.trim())).toEqual(['Edit', 'Duplicate', 'Delete']);
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));
    await tick();
    expect(get(editorDialog)).toEqual({ kind: 'tab', id: 't2' });
    expect((screen.getByLabelText(/Tab Name/) as HTMLInputElement).value).toBe('Second');
    noRequestsButSettingsRead(fetchSpy);
  });

  it('a tab dialog whose tab has gone (undo) closes, saying so', async () => {
    const { toast } = await import('$lib/stores/toast');
    const err = vi.spyOn(toast, 'error');
    render(Dashboard, { dashboard: legacy });
    enterEdit();
    await tick();
    editorDialog.set({ kind: 'tab', id: 'nope' });
    await tick();
    await tick();
    expect(get(editorDialog)).toBeNull();
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/no longer exists/));
  });
});
