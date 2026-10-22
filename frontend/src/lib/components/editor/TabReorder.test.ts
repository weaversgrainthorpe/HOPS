import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
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
import { begin, session, resetEditSessionForTests } from '$lib/stores/editSession';
import { clearSelection } from '$lib/stores/nodeSelection';
import { drag, setDragEnv, resetDragForTests } from '$lib/editor/drag/dragController';
import type { Config } from '$lib/types';
import type { LayoutDashboard } from '$lib/types/layout';
import { FakeRO } from './editorTestKit';
import { toast } from '$lib/stores/toast';

const entry = (id: string, name: string) => ({ id, name, url: 'http://x.test', icon: '', openMode: 'newtab' as const, size: 'medium' as const, order: 0 });
const tile = (id: string, name: string): any => ({ kind: 'tile', ...entry(id, name), placement: { x: 0, y: 0, w: 2, h: 2 } });

const layoutD1: LayoutDashboard = {
  id: 'd1', name: 'Home', path: '/home', revision: 1,
  tabs: [
    { id: 't1', name: 'Main', root: { columns: 24, children: [tile('m1', 'MainTile')] } },
    { id: 't2', name: 'Second', root: { columns: 24, children: [] } },
    { id: 't3', name: 'Third', root: { columns: 24, children: [] } }
  ]
};
const legacy = layoutD1; // the route's dashboard
const cfg = (): Config => ({ schemaVersion: 3, dashboards: [layoutD1] });

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
  config.set(cfg());
  isAuthenticated.set(true);
  begin('d1');
  editMode.set(true);
  frames = [];
  setDragEnv({ raf: (cb) => { frames.push(cb); return frames.length; }, cancelRaf: () => { frames = []; } });
});
afterEach(async () => {
  // Unmount first, so nothing re-renders after the stubs (ResizeObserver) are removed.
  cleanup();
  // A mouse drag swallows the click that follows it until a 0 ms timer clears that: let it expire.
  await new Promise((r) => setTimeout(r, 0));
  resetDragForTests();
  document.elementFromPoint = realEFP;
  vi.unstubAllGlobals();
  editMode.set(false);
  isAuthenticated.set(false);
  config.set(null);
});

const rect = (left: number, width: number) =>
  (() => ({ left, top: 0, width, height: 40, right: left + width, bottom: 40, x: left, y: 0, toJSON() {} }) as DOMRect);
/**
 * Lay the three tabs out for the DOM hit test: tab box i (button + controls) at 160 * i, 150 px
 * wide (the button its first 100 px, the controls the rest), 10 px gaps between boxes.
 */
function layoutTabs() {
  ['Main', 'Second', 'Third'].forEach((n, i) => {
    const el = tabEl(n);
    el.getBoundingClientRect = rect(i * 160, 100);
    (el.closest('[data-drag-tabbox]') as HTMLElement).getBoundingClientRect = rect(i * 160, 150);
  });
}
const bar = () => document.querySelector('[data-dashboard-tabs]') as HTMLElement;
/** Drag the `from` tab to x (with `under` as what the DOM reports under the pointer); returns the shown state. */
function dragTab(from: string, x: number, under: Element) {
  document.elementFromPoint = () => under;
  const start = tabEl(from).getBoundingClientRect().left + 50;
  tabEl(from).dispatchEvent(pe('pointerdown', start, 20));
  document.body.dispatchEvent(pe('pointermove', start + 6, 20));
  document.body.dispatchEvent(pe('pointermove', x, 20));
  flush();
  return get(drag)!;
}

describe('tab reorder with the drag engine', () => {
  it('dragging a tab past another reorders the draft (one undo step) and keeps the active tab', async () => {
    render(Dashboard, { dashboard: legacy });
    await tick();
    layoutTabs();
    expect(tabEl('Main').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-dashboard-tabs]')?.hasAttribute('aria-dropeffect')).toBe(false);
    const shown = dragTab('Main', 400, tabEl('Third')); // the right half of Third's box
    expect(shown.target).toEqual(expect.objectContaining({ kind: 'tab-order', tabIds: ['t2', 't3', 't1'] }));
    document.body.dispatchEvent(pe('pointerup', 400, 20));
    await tick();
    expect(draftIds()).toEqual(['t2', 't3', 't1']);
    expect(get(session)!.undo).toHaveLength(1);
    expect(tabEl('Main').getAttribute('aria-selected')).toBe('true');
  });

  it('the left half of a tab inserts before it', async () => {
    render(Dashboard, { dashboard: legacy });
    await tick();
    layoutTabs();
    const shown = dragTab('Third', 20, tabEl('Main'));
    expect(shown.marker).toEqual({ left: 0, top: 0, height: 40 });
    document.body.dispatchEvent(pe('pointerup', 20, 20));
    await tick();
    expect(draftIds()).toEqual(['t3', 't1', 't2']);
  });

  it('a drop in the gap between two tabs lands between them, with the marker at that gap', async () => {
    render(Dashboard, { dashboard: legacy });
    await tick();
    layoutTabs();
    const shown = dragTab('Third', 152, bar()); // the gap after Main's box (150..160)
    expect(shown.target).toEqual({ kind: 'tab-order', tabIds: ['t1', 't3', 't2'] });
    expect(shown.marker).toEqual({ left: 150, top: 0, height: 40 });
    await tick();
    expect(document.querySelector('.drag-layer .marker')).not.toBeNull();
    document.body.dispatchEvent(pe('pointerup', 152, 20));
    await tick();
    expect(draftIds()).toEqual(['t1', 't3', 't2']);
  });

  it("a drop on a tab's edit handle counts as that tab's half", async () => {
    render(Dashboard, { dashboard: legacy });
    await tick();
    layoutTabs();
    const pencil = screen.getByRole('button', { name: 'Edit Third tab' });
    const shown = dragTab('Main', 450, pencil); // Third's box is 320..470: right half
    expect(shown.target).toEqual({ kind: 'tab-order', tabIds: ['t2', 't3', 't1'] });
    expect(shown.marker).toEqual({ left: 470, top: 0, height: 40 });
    document.body.dispatchEvent(pe('pointerup', 450, 20));
    await tick();
    expect(draftIds()).toEqual(['t2', 't3', 't1']);
  });

  it('a drop on the empty tab bar past the last tab goes to the end, with the marker after it', async () => {
    render(Dashboard, { dashboard: legacy });
    await tick();
    layoutTabs();
    // §7.2: the tab row has no Add Tab button in edit mode (new tabs come from the toolbar).
    expect(screen.queryByRole('button', { name: 'Add new tab to dashboard' })).toBeNull();
    const shown = dragTab('Main', 560, bar());
    expect(shown.target).toEqual({ kind: 'tab-order', tabIds: ['t2', 't3', 't1'] });
    expect(shown.marker).toEqual({ left: 470, top: 0, height: 40 });
    document.body.dispatchEvent(pe('pointerup', 560, 20));
    await tick();
    expect(draftIds()).toEqual(['t2', 't3', 't1']);
  });

  it('Alt+Right moves the tab and announces its new position; the ends say so instead', async () => {
    toast.clear();
    render(Dashboard, { dashboard: legacy });
    await tick();
    await fireEvent.keyDown(tabEl('Main'), { key: 'ArrowLeft', altKey: true });
    expect(draftIds()).toEqual(['t1', 't2', 't3']);
    expect(get(toast).at(-1)?.message).toBe('"Main" is already first (position 1 of 3).');
    await fireEvent.keyDown(tabEl('Third'), { key: 'ArrowRight', altKey: true });
    expect(draftIds()).toEqual(['t1', 't2', 't3']);
    expect(get(toast).at(-1)?.message).toBe('"Third" is already last (position 3 of 3).');
    await fireEvent.keyDown(tabEl('Main'), { key: 'ArrowRight', altKey: true });
    await tick();
    expect(draftIds()).toEqual(['t2', 't1', 't3']);
    expect(get(toast).at(-1)?.message).toBe('Moved "Main" to position 2 of 3.');
    expect(document.activeElement).toBe(tabEl('Main'));
  });

  it('the real Dashboard: holding an item over another tab for 600 ms switches to it; the drop lands there', async () => {
    render(Dashboard, { dashboard: legacy });
    await tick();
    layoutTabs();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const cell = document.querySelector('[data-node-id="m1"]') as HTMLElement;
      document.elementFromPoint = () => tabEl('Second');
      cell.dispatchEvent(pe('pointerdown', 10, 10));
      document.body.dispatchEvent(pe('pointermove', 20, 10));
      document.body.dispatchEvent(pe('pointermove', 210, 20));
      flush();
      expect(get(drag)?.target).toMatchObject({ kind: 'tab-append', tabId: 't2' });
      vi.advanceTimersByTime(600);
      await tick();
      await tick();
      expect(tabEl('Second').getAttribute('aria-selected')).toBe('true');
      expect(get(drag)).not.toBeNull(); // the drag survived its own tab switch
      const root = document.querySelector('[data-container-id="t2"]') as HTMLElement;
      expect(root).toBeTruthy();
      document.elementFromPoint = () => root;
      document.body.dispatchEvent(pe('pointermove', 250, 130));
      flush();
      expect(get(drag)?.target).toMatchObject({ kind: 'place', to: { tabId: 't2' } });
      document.body.dispatchEvent(pe('pointerup', 250, 130));
      const t2 = get(session)!.draft.tabs.find((t) => t.id === 't2')!;
      expect(t2.root.children.map((n) => n.id)).toEqual(['m1']);
      vi.advanceTimersByTime(1); // let the post-drag click swallower expire
    } finally {
      vi.useRealTimers();
    }
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
