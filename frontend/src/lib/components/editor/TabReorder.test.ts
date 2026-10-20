import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';

vi.mock('$app/stores', async () => {
  const { writable } = await import('svelte/store');
  const page = writable({ url: new URL('http://localhost/'), params: {}, route: { id: '/' }, status: 200, error: null, data: {}, form: undefined });
  return { page, navigating: writable(null), updated: writable(false) };
});

import Dashboard from '../Dashboard.svelte';
import { config } from '$lib/stores/config';
import { editMode } from '$lib/stores/editMode';
import { isAuthenticated } from '$lib/stores/auth';
import { closeAll } from '$lib/stores/folderOverlay';
import { begin, session, resetEditSessionForTests } from '$lib/stores/editSession';
import { clearSelection } from '$lib/stores/nodeSelection';
import { drag, setDragEnv, resetDragForTests } from '$lib/editor/drag/dragController';
import type { Config, Dashboard as DashboardT } from '$lib/types';
import type { LayoutDashboard } from '$lib/types/layout';
import { FakeRO } from './editorTestKit';

const entry = (id: string, name: string) => ({ id, name, url: 'http://x.test', icon: '', openMode: 'newtab' as const, size: 'medium' as const, order: 0 });
const tile = (id: string, name: string): any => ({ kind: 'tile', ...entry(id, name), placement: { x: 0, y: 0, w: 1, h: 1 } });

const legacy: DashboardT = {
  id: 'd1', name: 'Home', path: '/home', order: 0, revision: 1,
  tabs: [
    { id: 't1', name: 'Main', order: 0, groups: [] },
    { id: 't2', name: 'Second', order: 1, groups: [] },
    { id: 't3', name: 'Third', order: 2, groups: [] }
  ]
};
const layoutD1: LayoutDashboard = {
  id: 'd1', name: 'Home', path: '/home', revision: 1,
  tabs: [
    { id: 't1', name: 'Main', root: { columns: 12, children: [tile('m1', 'MainTile')] } },
    { id: 't2', name: 'Second', root: { columns: 12, children: [] } },
    { id: 't3', name: 'Third', root: { columns: 12, children: [] } }
  ]
};
const cfg = (): Config => ({
  dashboards: [legacy], theme: { mode: 'auto' }, settings: {}, dashboardRevisions: { d1: 1 },
  layout: { schemaVersion: 3, dashboards: [layoutD1] }, v3OnlyDashboards: []
}) as unknown as Config;

let frames: FrameRequestCallback[] = [];
const flush = () => {
  const f = frames;
  frames = [];
  f.forEach((cb) => cb(0));
};
const pe = (type: string, x: number, y: number) =>
  new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, pointerId: 1, isPrimary: true });
const draftIds = () => get(session)!.draft.tabs.map((t) => t.id);
const tabEl = (name: string) => screen.getByRole('tab', { name: `Switch to ${name} tab` });

const realEFP = document.elementFromPoint;
beforeEach(() => {
  resetEditSessionForTests();
  resetDragForTests();
  clearSelection();
  vi.stubGlobal('ResizeObserver', FakeRO);
  closeAll();
  config.set(cfg());
  isAuthenticated.set(true);
  begin('d1');
  editMode.set(true);
  frames = [];
  setDragEnv({ raf: (cb) => { frames.push(cb); return frames.length; }, cancelRaf: () => { frames = []; } });
});
afterEach(async () => {
  // A mouse drag swallows the click that follows it until a 0 ms timer clears that: let it expire.
  await new Promise((r) => setTimeout(r, 0));
  resetDragForTests();
  document.elementFromPoint = realEFP;
  vi.unstubAllGlobals();
  closeAll();
  editMode.set(false);
  isAuthenticated.set(false);
  config.set(null);
});

/** Lay the three tabs out side by side, 100 px each, for the DOM hit test. */
function layoutTabs() {
  ['Main', 'Second', 'Third'].forEach((n, i) => {
    const el = tabEl(n);
    el.getBoundingClientRect = () => ({ left: i * 100, top: 0, width: 100, height: 40, right: i * 100 + 100, bottom: 40, x: i * 100, y: 0, toJSON() {} }) as DOMRect;
  });
}

describe('tab reorder with the drag engine', () => {
  it('dragging a tab past another reorders the draft (one undo step) and keeps the active tab', async () => {
    render(Dashboard, { dashboard: legacy });
    await tick();
    layoutTabs();
    expect(tabEl('Main').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-dashboard-tabs]')?.hasAttribute('aria-dropeffect')).toBe(false);
    document.elementFromPoint = () => tabEl('Third');
    tabEl('Main').dispatchEvent(pe('pointerdown', 50, 20));
    document.body.dispatchEvent(pe('pointermove', 60, 20));
    document.body.dispatchEvent(pe('pointermove', 280, 20)); // the right half of Third
    flush();
    expect(get(drag)?.target).toEqual(expect.objectContaining({ kind: 'tab-order', tabIds: ['t2', 't3', 't1'] }));
    document.body.dispatchEvent(pe('pointerup', 280, 20));
    await tick();
    expect(draftIds()).toEqual(['t2', 't3', 't1']);
    expect(get(session)!.undo).toHaveLength(1);
    expect(tabEl('Main').getAttribute('aria-selected')).toBe('true');
  });

  it('the left half of a tab inserts before it', async () => {
    render(Dashboard, { dashboard: legacy });
    await tick();
    layoutTabs();
    document.elementFromPoint = () => tabEl('Main');
    tabEl('Third').dispatchEvent(pe('pointerdown', 250, 20));
    document.body.dispatchEvent(pe('pointermove', 240, 20));
    document.body.dispatchEvent(pe('pointermove', 20, 20));
    flush();
    document.body.dispatchEvent(pe('pointerup', 20, 20));
    await tick();
    expect(draftIds()).toEqual(['t3', 't1', 't2']);
  });

  it('tabs stay keyboard-operable: Enter switches; Alt+Arrow moves the focused tab', async () => {
    render(Dashboard, { dashboard: legacy });
    await tick();
    await fireEvent.keyDown(tabEl('Second'), { key: 'Enter' });
    await tick();
    expect(tabEl('Second').getAttribute('aria-selected')).toBe('true');
    await fireEvent.keyDown(tabEl('Second'), { key: 'ArrowLeft', altKey: true });
    await tick();
    expect(draftIds()).toEqual(['t2', 't1', 't3']);
    expect(tabEl('Second').getAttribute('aria-selected')).toBe('true');
  });

  it('a click on a tab (no drag) still switches to it', async () => {
    render(Dashboard, { dashboard: legacy });
    await tick();
    const el = tabEl('Third');
    el.dispatchEvent(pe('pointerdown', 250, 20));
    document.body.dispatchEvent(pe('pointerup', 250, 20));
    await fireEvent.click(el);
    await tick();
    expect(tabEl('Third').getAttribute('aria-selected')).toBe('true');
    expect(draftIds()).toEqual(['t1', 't2', 't3']);
  });
});
