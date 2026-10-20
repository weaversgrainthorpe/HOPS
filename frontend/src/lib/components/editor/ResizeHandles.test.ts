import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn(),
  getConfig: vi.fn(async () => { throw new Error('offline in tests'); })
}));

import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import TabCanvas from '$lib/components/layout/TabCanvas.svelte';
import EditToolbar from './EditToolbar.svelte';
import DragLayer from '$lib/editor/drag/DragLayer.svelte';
import { drag, setDragEnv, resetDragForTests, setActiveTab } from '$lib/editor/drag/dragController';
import { session, undo } from '$lib/stores/editSession';
import { toast } from '$lib/stores/toast';
import { toggleNode, clearSelection } from '$lib/stores/nodeSelection';
import { zOrder } from '$lib/editor/editorActions';
import { setLayout, resetEditor, startSession, draft, nodeIn } from './editorTestKit';
import type { LayoutDashboard } from '$lib/types/layout';

let width = 1440;
class RO {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    this.cb([{ target: el, contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

let frames: FrameRequestCallback[] = [];
let rects: Record<string, { left: number; top: number; width: number; height: number }> = {};
function flush() {
  const f = frames;
  frames = [];
  f.forEach((cb) => cb(0));
}
function env() {
  setDragEnv({
    hitTest: () => ({ container: null, dx: 0, dy: 0 }),
    raf: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    cancelRaf: () => {
      frames = [];
    },
    measure: (el) => rects[el.closest('[data-node-id]')?.getAttribute('data-node-id') ?? ''] ?? { left: 0, top: 0, width: 0, height: 0 },
    viewport: () => ({ width: 3000, height: 3000 }),
    scrollBy: () => {}
  });
}
const pe = (type: string, x: number, y: number) =>
  new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, pointerId: 1 });

function canvas(tabId = 't1') {
  const props = () => {
    const d = draft();
    return { dashboard: d, tab: d.tabs.find((t) => t.id === tabId)!, editing: true };
  };
  const r = render(TabCanvas, props());
  /** Re-render from the current draft (Dashboard passes the session draft the same way). */
  return { ...r, refresh: () => r.rerender(props()) };
}
const handle = (root: HTMLElement, id: string, edge: 'corner' | 'right' | 'bottom') =>
  root.querySelector(`[data-node-id="${id}"] > [data-resize="${edge}"]`) as HTMLElement | null;

/** Press a handle at (x, y), move by (dx, dy) and run the frame. */
function resizeDrag(h: HTMLElement, x: number, y: number, dx: number, dy: number) {
  h.dispatchEvent(pe('pointerdown', x, y));
  document.body.dispatchEvent(pe('pointermove', x + dx, y + dy));
  flush();
}

beforeEach(() => {
  width = 1440;
  vi.stubGlobal('ResizeObserver', RO);
  resetEditor();
  resetDragForTests();
  setLayout();
  startSession();
  setActiveTab('t1');
  frames = [];
  // t1 at 1440 px: 120 px cells. f1 sits at (0, 1) 4 × 3.
  rects = { f1: { left: 0, top: 120, width: 480, height: 360 }, fa: { left: 0, top: 0, width: 128, height: 128 } };
  env();
});

afterEach(() => {
  resetDragForTests();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('resize handles', () => {
  it('an expanded folder has corner, right and bottom handles with labels; a grid tile has none', async () => {
    const { container } = canvas();
    await tick();
    for (const edge of ['corner', 'right', 'bottom'] as const) {
      const h = handle(container, 'f1', edge);
      expect(h).not.toBeNull();
      expect(h!.getAttribute('aria-label')).toMatch(/^Resize F1/);
    }
    expect(container.querySelector('[data-node-id="a"] [data-resize]')).toBeNull();
  });

  it('a collapsed folder has no handles, and its tooltip says how to resize it', async () => {
    const { container } = canvas();
    await tick();
    const c1 = container.querySelector('[data-node-id="c1"]') as HTMLElement;
    expect(c1.querySelector('[data-resize]')).toBeNull();
    expect(c1.getAttribute('title')).toMatch(/collapsed.*expand/i);
  });

  it('a corner drag of +2 cells on a grid folder → w+2, h+2, pushing the neighbour as previewed; one undo step', async () => {
    const { container } = canvas();
    render(DragLayer, { tabId: 't1' });
    await tick();
    const undoBefore = get(session)!.undo.length;
    resizeDrag(handle(container, 'f1', 'corner')!, 478, 478, 240, 240);
    const t = get(drag)?.target;
    expect(t?.kind).toBe('resize');
    if (t?.kind !== 'resize') throw new Error('not a resize');
    expect(t.at).toMatchObject({ x: 0, y: 1, w: 6, h: 5 });
    expect([...t.push.keys()]).toEqual(['c1']); // the collapsed folder's reserved cells are pushed aside
    await tick();
    expect(document.querySelectorAll('.drag-layer .push').length).toBe(1);
    expect(document.querySelectorAll('.drag-layer .target').length).toBe(1);
    document.body.dispatchEvent(pe('pointerup', 718, 718));
    expect(nodeIn(draft(), 'f1')!.placement).toMatchObject({ x: 0, y: 1, w: 6, h: 5 });
    expect(nodeIn(draft(), 'c1')!.placement).toEqual(t.push.get('c1'));
    expect(get(session)!.undo.length).toBe(undoBefore + 1);
    undo();
    expect(nodeIn(draft(), 'f1')!.placement).toMatchObject({ w: 4, h: 3 });
    expect(nodeIn(draft(), 'c1')!.placement).toMatchObject({ x: 5, y: 1 });
  });

  it("a folder can't shrink below its content", async () => {
    const { container } = canvas();
    await tick();
    resizeDrag(handle(container, 'f1', 'bottom')!, 240, 478, 0, -600);
    const t = get(drag)?.target;
    expect(t?.kind).toBe('resize');
    if (t?.kind !== 'resize') throw new Error('not a resize');
    expect(t.at.h).toBe(2); // one content row + the title row
    document.body.dispatchEvent(pe('pointerup', 240, -122));
    expect(nodeIn(draft(), 'f1')!.placement).toMatchObject({ w: 4, h: 2 });
  });

  it('Escape cancels a resize and leaves the draft unchanged', async () => {
    const { container } = canvas();
    await tick();
    const before = draft();
    resizeDrag(handle(container, 'f1', 'right')!, 478, 300, 240, 0);
    expect(get(drag)?.target?.kind).toBe('resize');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(get(drag)).toBeNull();
    document.body.dispatchEvent(pe('pointerup', 718, 300));
    expect(draft()).toBe(before);
  });

  it('a free tile resize snaps to 8 px units', async () => {
    width = 1280; // scale 1: one design unit = 8 px
    setActiveTab('t2');
    const { container, refresh } = canvas('t2');
    await tick();
    const h = handle(container, 'fa', 'right');
    expect(h).not.toBeNull();
    resizeDrag(h!, 127, 64, 21, 5); // 21 px → 2.6 units → 3; the right edge keeps the height
    const t = get(drag)?.target;
    if (t?.kind !== 'resize') throw new Error('not a resize');
    expect(t.at).toMatchObject({ w: 19, h: 16 });
    document.body.dispatchEvent(pe('pointerup', 148, 69));
    expect(nodeIn(draft(), 'fa')!.placement).toMatchObject({ x: 0, y: 0, w: 19, h: 16 });
    await refresh();
    expect((container.querySelector('[data-node-id="fa"]') as HTMLElement).style.width).toBe('152px');
  });
});

describe('keyboard resize and z-order', () => {
  it('Shift+Arrow grows / shrinks the selected folder by one cell (one undo step each)', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: () => {} });
    toggleNode('f1', false);
    await fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
    expect(nodeIn(draft(), 'f1')!.placement).toMatchObject({ w: 5, h: 3 });
    await fireEvent.keyDown(window, { key: 'ArrowDown', shiftKey: true });
    expect(nodeIn(draft(), 'f1')!.placement).toMatchObject({ w: 5, h: 4 });
    await fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true });
    expect(nodeIn(draft(), 'f1')!.placement).toMatchObject({ w: 4, h: 4 });
    undo();
    expect(nodeIn(draft(), 'f1')!.placement).toMatchObject({ w: 5, h: 4 });
  });

  it('Shift+Arrow on a grid tile or a collapsed folder changes nothing and says why', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: () => {} });
    const before = draft();
    const spy = vi.spyOn(toast, 'info');
    toggleNode('a', false);
    await fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
    expect(spy).toHaveBeenLastCalledWith(expect.stringMatching(/one cell.*tile dialog/i));
    clearSelection();
    toggleNode('c1', false);
    await fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
    expect(spy).toHaveBeenLastCalledWith(expect.stringMatching(/collapsed/i));
    expect(draft()).toBe(before);
  });

  it('setZ forward / back changes z and the canvas renders it', async () => {
    width = 1280;
    const { container, refresh } = canvas('t2');
    await tick();
    const z = (id: string) => Number((container.querySelector(`[data-node-id="${id}"]`) as HTMLElement).style.zIndex);
    expect(z('fa')).toBeLessThan(z('fb'));
    expect(zOrder('fa', 'forward')).toBe(true);
    await refresh();
    expect(nodeIn(draft(), 'fa')!.placement.z).toBe(2);
    expect(z('fa')).toBeGreaterThan(z('fb'));
    expect(zOrder('fa', 'back')).toBe(true);
    await refresh();
    expect(z('fa')).toBeLessThan(z('fb'));
  });

  it('Ctrl+] / Ctrl+[ bring the selected free item forward / send it back; ignored while typing', async () => {
    render(EditToolbar, { tabId: 't2', onAddTab: () => {} });
    toggleNode('fa', false);
    await fireEvent.keyDown(window, { key: ']', ctrlKey: true });
    expect(nodeIn(draft(), 'fa')!.placement.z).toBe(2);
    await fireEvent.keyDown(window, { key: '[', ctrlKey: true });
    expect(nodeIn(draft(), 'fa')!.placement.z).toBe(0);
    const input = document.createElement('input');
    document.body.appendChild(input);
    const before = draft();
    await fireEvent.keyDown(input, { key: ']', ctrlKey: true });
    expect(draft()).toBe(before);
  });

  it('Ctrl+] in a grid container changes nothing and says z-order is for free layouts', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: () => {} });
    const spy = vi.spyOn(toast, 'info');
    toggleNode('a', false);
    const before: LayoutDashboard = draft();
    await fireEvent.keyDown(window, { key: ']', ctrlKey: true });
    expect(draft()).toBe(before);
    expect(spy).toHaveBeenLastCalledWith(expect.stringMatching(/free/i));
  });
});

