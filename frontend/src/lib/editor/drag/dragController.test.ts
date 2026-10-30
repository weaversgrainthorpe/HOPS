import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn(),
  getConfig: vi.fn(async () => { throw new Error('offline in tests'); })
}));

import { containerMetrics, type ContainerMetrics } from '$lib/layout/geometry';
import { toast } from '$lib/stores/toast';
import { session } from '$lib/stores/editSession';
import { toggleNode, selectedNodes } from '$lib/stores/nodeSelection';
import type { LayoutDashboard } from '$lib/types/layout';
import type { ContainerRef } from '../treeOps';
import type { HitResult } from './hitTest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import TabCanvas from '$lib/components/layout/TabCanvas.svelte';
import DragLayer from './DragLayer.svelte';
import {
  drag, dragSource, resizeSource, tabSource, resolveDrop, setDragEnv, resetDragForTests, setActiveTab, switchTabWithinDrag, railEdgeStep,
  type DragState
} from './dragController';
import * as api from '$lib/utils/api';
import { save } from '$lib/stores/editSession';
import { setLayout, resetEditor, startSession, draft, nodeIn, home, other, folder, p, FakeRO } from '$lib/components/editor/editorTestKit';

// t1's root: 24 columns of 50 px (square rows; a Medium tile is 100 px). A folder's content flows:
// Medium items (2 cells of 50 px), 3 to a row.
const GRID = containerMetrics({ columns: 24, children: [] }, 1200);
const FLOW: ContainerMetrics = { columns: 6, unitPx: 50, rowPx: 50, innerWidthPx: 300, flow: { span: 2, perRow: 3 } };

/** Where the stub says the pointer is: the t1 root unless a test redirects it. */
let where: { ref: ContainerRef; metrics: ContainerMetrics; layout: 'grid' | 'flow' | 'stacked' } | null;
let lastHit: HitResult | null = null;
/** A folder's page under the pointer (hitTest's flowPage), when the stub is on one. */
let flowPage: HitResult['flowPage'];
let frames: FrameRequestCallback[] = [];
let sourceRect = { left: 0, top: 0, width: 100, height: 100 };

function flush() {
  const f = frames;
  frames = [];
  f.forEach((cb) => cb(0));
}

function env() {
  setDragEnv({
    hitTest: (x, y) => {
      lastHit = where
        ? { container: { ...where, left: 0, top: 0 }, dx: x, dy: y, ...(flowPage ? { flowPage } : {}) }
        : { container: null, dx: 0, dy: 0 };
      return lastHit;
    },
    raf: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    cancelRaf: () => {
      frames = [];
    },
    measure: () => sourceRect,
    viewport: () => ({ width: 2000, height: 2000 }),
    scrollBy: () => {}
  });
}

const pe = (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
  new PointerEvent(type, {
    clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, pointerId: 1, isPrimary: true,
    ...extra
  });

let sources: { el: HTMLElement; destroy: () => void }[] = [];
function source(id: string, onMenu = vi.fn()) {
  const el = document.createElement('div');
  el.setAttribute('data-node-id', id);
  document.body.appendChild(el);
  const a = dragSource(el, { id, enabled: true, onMenu });
  sources.push({ el, destroy: () => a.destroy?.() });
  return { el, onMenu };
}

/** Press on `el` at (x, y), then cross the mouse threshold with a 6 px move. */
function startMouseDrag(el: HTMLElement, x: number, y: number, extra: PointerEventInit = {}) {
  el.dispatchEvent(pe('pointerdown', x, y, extra));
  document.body.dispatchEvent(pe('pointermove', x + 6, y, extra));
}
function moveTo(x: number, y: number, extra: PointerEventInit = {}) {
  document.body.dispatchEvent(pe('pointermove', x, y, extra));
}
function drop(x: number, y: number, extra: PointerEventInit = {}) {
  document.body.dispatchEvent(pe('pointerup', x, y, extra));
}

beforeEach(() => {
  resetEditor();
  resetDragForTests();
  setLayout();
  startSession();
  where = { ref: { tabId: 't1' }, metrics: GRID, layout: 'grid' };
  flowPage = undefined;
  lastHit = null;
  frames = [];
  sourceRect = { left: 0, top: 0, width: 100, height: 100 };
  env();
});

afterEach(() => {
  sources.forEach((s) => s.destroy());
  sources = [];
  resetDragForTests();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('drag engine — starting', () => {
  it('a 3 px mouse move does not start a drag; 5 px does', () => {
    const { el } = source('a');
    el.dispatchEvent(pe('pointerdown', 50, 50));
    moveTo(53, 50);
    expect(get(drag)).toBeNull();
    moveTo(55, 50);
    expect(get(drag)?.ids).toEqual(['a']);
  });

  it('a touch long-press (400 ms, still) starts a drag on the next move; a quick swipe does not', () => {
    vi.useFakeTimers();
    const { el, onMenu } = source('a');
    // swipe: moves 20 px within 50 ms — that is a scroll, never a drag or a menu
    el.dispatchEvent(pe('pointerdown', 50, 50, { pointerType: 'touch' }));
    vi.advanceTimersByTime(50);
    moveTo(70, 50, { pointerType: 'touch' });
    vi.advanceTimersByTime(500);
    moveTo(90, 50, { pointerType: 'touch' });
    expect(get(drag)).toBeNull();
    drop(90, 50, { pointerType: 'touch' });
    expect(onMenu).not.toHaveBeenCalled();
    // long-press: still for 400 ms, then a move starts the drag
    el.dispatchEvent(pe('pointerdown', 50, 50, { pointerType: 'touch' }));
    vi.advanceTimersByTime(399);
    moveTo(70, 50, { pointerType: 'touch' }); // too early: this cancels, as a scroll would
    expect(get(drag)).toBeNull();
    drop(70, 50, { pointerType: 'touch' });
    el.dispatchEvent(pe('pointerdown', 50, 50, { pointerType: 'touch' }));
    vi.advanceTimersByTime(400);
    expect(get(drag)).toBeNull(); // drag-ready, not dragging yet
    moveTo(70, 50, { pointerType: 'touch' });
    expect(get(drag)?.ids).toEqual(['a']);
    expect(onMenu).not.toHaveBeenCalled();
  });

  it('a touch long-press released without moving opens the item menu', () => {
    vi.useFakeTimers();
    const { el, onMenu } = source('a');
    el.dispatchEvent(pe('pointerdown', 50, 50, { pointerType: 'touch' }));
    vi.advanceTimersByTime(400);
    drop(51, 50, { pointerType: 'touch' });
    expect(onMenu).toHaveBeenCalledWith(50, 50);
    expect(get(drag)).toBeNull();
  });
});

describe('drag engine — dropping', () => {
  it('commit uses the last highlighted target (Review Focus 2)', () => {
    const { el } = source('a');
    const before = draft();
    startMouseDrag(el, 50, 50);
    moveTo(350, 50);
    flush(); // target A: (6, 0)
    expect(get(drag)?.target).toMatchObject({ kind: 'place', at: [p(6, 0)] });
    moveTo(650, 250);
    flush(); // target B: (12, 4)
    const shown = get(drag)!;
    expect(shown.target).toMatchObject({ kind: 'place', to: { tabId: 't1' }, at: [p(12, 4)] });
    // highlight and commit come from the one pure resolver: the same inputs give the same target
    expect(resolveDrop(shown, lastHit!, before)).toEqual(shown.target);
    // the pointer moves on but no frame has highlighted it yet: the drop is where the highlight was
    moveTo(950, 50);
    drop(950, 50);
    expect(nodeIn(draft(), 'a')!.placement).toEqual(p(12, 4));
    expect(get(drag)).toBeNull();
  });

  it('Escape, pointercancel and leaving the window cancel; the draft is unchanged', () => {
    const { el } = source('a');
    const before = draft();
    for (const cancel of [
      () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })),
      () => document.body.dispatchEvent(pe('pointercancel', 350, 50)),
      () => document.documentElement.dispatchEvent(pe('pointerout', -5, 50, { relatedTarget: null }))
    ]) {
      startMouseDrag(el, 50, 50);
      moveTo(350, 50);
      flush();
      expect(get(drag)?.target?.kind).toBe('place');
      cancel();
      expect(get(drag)).toBeNull();
      drop(350, 50); // a late pointerup after the cancel does nothing
      expect(draft()).toBe(before);
    }
    expect(get(toast).some((t) => /nothing changed/i.test(t.message))).toBe(true);
  });

  it('Ctrl held at drop copies (new ids); without Ctrl it moves', () => {
    const { el } = source('a');
    startMouseDrag(el, 50, 50);
    moveTo(350, 50, { ctrlKey: true });
    flush();
    expect(get(drag)?.copy).toBe(true);
    drop(350, 50, { ctrlKey: true });
    const d = draft();
    expect(nodeIn(d, 'a')!.placement).toEqual(p(0, 0)); // original stays
    const copies = d.tabs[0].root.children.filter((n) => n.kind === 'tile' && n.name === 'A' && n.id !== 'a');
    expect(copies).toHaveLength(1);
    expect(copies[0].placement).toEqual(p(6, 0));
    expect(get(selectedNodes).has(copies[0].id)).toBe(true);

    startMouseDrag(el, 50, 50);
    moveTo(450, 150);
    flush();
    expect(get(drag)?.copy).toBe(false);
    drop(450, 150);
    expect(nodeIn(draft(), 'a')!.placement).toEqual(p(8, 2));
    expect(draft().tabs[0].root.children.filter((n) => n.name === 'A')).toHaveLength(2);
  });

  it('multi-select moves all, keeping their relative offsets', () => {
    toggleNode('a', false);
    toggleNode('b', true);
    const { el } = source('a');
    startMouseDrag(el, 50, 50);
    moveTo(850, 550);
    flush();
    expect(get(drag)?.ids).toEqual(['a', 'b']);
    drop(850, 550);
    expect(nodeIn(draft(), 'a')!.placement).toEqual(p(16, 10));
    expect(nodeIn(draft(), 'b')!.placement).toEqual(p(18, 10));
    expect(get(toast).at(-1)?.message).toBe('Moved 2 items to Main');
  });

  it('grid push preview equals the committed placements', () => {
    const { el } = source('a');
    startMouseDrag(el, 50, 50);
    moveTo(150, 50); // onto b at (2, 0)
    flush();
    const t = get(drag)!.target!;
    expect(t.kind).toBe('place');
    if (t.kind !== 'place') return;
    expect(t.at).toEqual([p(2, 0)]);
    expect(t.push.has('b')).toBe(true);
    const pushedTo = t.push.get('b');
    drop(150, 50);
    expect(nodeIn(draft(), 'a')!.placement).toEqual(p(2, 0));
    expect(nodeIn(draft(), 'b')!.placement).toEqual(pushedTo);
  });

  it('a collapsed folder\'s stored footprint is occupied: a drop there pushes it rather than overlapping', () => {
    const { el } = source('a');
    startMouseDrag(el, 50, 50);
    moveTo(650, 250); // (12, 4): inside c1's stored 4 x 4 at (10, 2), though c1 renders as one Medium tile
    flush();
    const t = get(drag)!.target!;
    expect(t.kind).toBe('place');
    if (t.kind === 'place') expect(t.push.has('c1')).toBe(true);
  });

  it('the toast Undo restores the draft from before the drop', () => {
    const { el } = source('a');
    const before = draft();
    startMouseDrag(el, 50, 50);
    moveTo(350, 50);
    flush();
    drop(350, 50);
    expect(draft()).not.toBe(before);
    const t = get(toast).at(-1)!;
    expect(t.message).toBe('Moved "A" to Main');
    expect(t.action?.label).toBe('Undo');
    t.action!.onClick();
    expect(draft()).toBe(before);
  });

  it('across containers on the same tab: a tile dragged into a folder joins its order (at the pointer), unplaced', () => {
    where = { ref: { tabId: 't1', folderId: 'f1' }, metrics: FLOW, layout: 'flow' };
    // The folder's page as hitTest reports it: x drawn at its top-left.
    flowPage = { folderId: 'f1', page: 0, perPage: 4, count: 1, boxes: [{ id: 'x', left: 0, top: 0, width: 100, height: 100 }] };
    const { el } = source('a');
    startMouseDrag(el, 50, 50);
    moveTo(250, 150);
    flush();
    expect(get(drag)!.target).toMatchObject({ kind: 'place', to: { tabId: 't1', folderId: 'f1' }, index: 1 }); // past x: after it
    drop(250, 150);
    const f1 = nodeIn(draft(), 'f1');
    const kids = f1?.kind === 'folder' ? f1.content.children : [];
    expect(kids.map((n) => n.id)).toEqual(['x', 'a']);
    expect('placement' in kids[1]).toBe(false);
    expect(draft().tabs[0].root.children.some((n) => n.id === 'a')).toBe(false);
    expect(get(toast).at(-1)?.message).toBe('Moved "A" to F1');
  });

  it('out of a folder onto the tab: placed at the pointer cell at its Size\'s span', () => {
    sourceRect = { left: 0, top: 0, width: 100, height: 100 };
    const { el } = source('x');
    startMouseDrag(el, 50, 50);
    moveTo(950, 50);
    flush();
    drop(950, 50);
    expect(nodeIn(draft(), 'x')!.placement).toEqual(p(18, 0));
    expect((nodeIn(draft(), 'f1') as { content: { children: unknown[] } }).content.children).toHaveLength(0);
  });

  it('dropped back where it was: no change and no undo step', () => {
    const { el } = source('a');
    const before = draft();
    startMouseDrag(el, 50, 50);
    moveTo(52, 50);
    flush();
    drop(52, 50);
    expect(draft()).toBe(before);
    expect(get(session)!.undo).toHaveLength(0);
  });

  it('an invalid drop changes nothing and says why', () => {
    const { el } = source('a');
    const before = draft();
    startMouseDrag(el, 50, 50);
    where = null;
    moveTo(350, 50);
    flush();
    const t = get(drag)!.target!;
    expect(t.kind).toBe('invalid');
    drop(350, 50);
    expect(draft()).toBe(before);
    const last = get(toast).at(-1)!;
    expect(last.type).toBe('error');
    expect(t.kind === 'invalid' && last.message).toBe(t.kind === 'invalid' ? t.reason : '');
  });

  it('a folder dropped into its own content is refused', () => {
    const state: DragState = { ids: ['f1'], copy: false, pointer: { x: 0, y: 0 }, target: null, grab: { fx: 0, fy: 0 } };
    const hit: HitResult = { container: { ref: { tabId: 't1', folderId: 'f1' }, metrics: FLOW, layout: 'flow', left: 0, top: 0 }, dx: 0, dy: 0 };
    expect(resolveDrop(state, hit, draft())).toEqual({ kind: 'invalid', reason: "A folder can't go inside itself." });
  });

  it('a change to the draft during a drag cancels it (the highlight would be stale)', async () => {
    const { el } = source('a');
    startMouseDrag(el, 50, 50);
    moveTo(350, 50);
    flush();
    const { apply } = await import('$lib/stores/editSession');
    apply('Other', (d: LayoutDashboard) => ({ ...d, name: 'Renamed' }));
    expect(get(drag)).toBeNull();
    drop(350, 50);
    expect(nodeIn(draft(), 'a')!.placement).toEqual(p(0, 0));
    expect(get(session)?.draft.name).toBe('Renamed');
  });
});

describe('drag engine — through the real renderer', () => {
  const realEFP = document.elementFromPoint;
  afterEach(() => {
    document.elementFromPoint = realEFP;
    vi.unstubAllGlobals();
  });

  it('a tile in the editing canvas drags with the DOM hit test; the layer shows the target and the push', async () => {
    vi.stubGlobal('ResizeObserver', FakeRO); // 1440 px wide: 24 columns of 60 px (a Medium is 120 px)
    setDragEnv({ raf: (cb) => { frames.push(cb); return frames.length; }, cancelRaf: () => { frames = []; },
      measure: () => ({ left: 0, top: 0, width: 120, height: 120 }) });
    const d = draft();
    const { container } = render(TabCanvas, { dashboard: d, tab: d.tabs[0], editing: true });
    render(DragLayer);
    await tick();
    const cell = container.querySelector('[data-node-id="a"]') as HTMLElement;
    const root = container.querySelector('[data-container-id="t1"]') as HTMLElement;
    expect(cell && root).toBeTruthy();
    document.elementFromPoint = () => root;
    cell.dispatchEvent(pe('pointerdown', 60, 60));
    moveTo(66, 60);
    moveTo(180, 60); // onto b at (2, 0)
    flush();
    await tick();
    expect(get(drag)?.target).toMatchObject({ kind: 'place', at: [p(2, 0)] });
    expect(document.querySelectorAll('.drag-layer .target')).toHaveLength(1);
    expect(document.querySelectorAll('.drag-layer .push')).toHaveLength(1);
    expect(document.querySelector('.drag-layer .ghost')?.textContent).toContain('A');
    drop(180, 60);
    await tick();
    expect(nodeIn(draft(), 'a')!.placement).toEqual(p(2, 0));
    expect(document.querySelector('.drag-layer')).toBeNull();
  });

  it('pressing a tile inside an expanded folder drags the tile, not the folder', async () => {
    vi.stubGlobal('ResizeObserver', FakeRO);
    setDragEnv({ raf: (cb) => { frames.push(cb); return frames.length; }, cancelRaf: () => { frames = []; },
      measure: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    const d = draft();
    const { container } = render(TabCanvas, { dashboard: d, tab: d.tabs[0], editing: true });
    await tick();
    const x = container.querySelector('[data-node-id="x"]') as HTMLElement;
    x.dispatchEvent(pe('pointerdown', 10, 10));
    moveTo(20, 10);
    expect(get(drag)?.ids).toEqual(['x']);
  });
});

describe('touch handling', () => {
  it('each enabled item has a non-passive touchmove listener that blocks scrolling only when drag-ready or dragging', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    el.setAttribute('data-node-id', 'a');
    document.body.appendChild(el);
    const spy = vi.spyOn(el, 'addEventListener');
    const a = dragSource(el, { id: 'a', enabled: true });
    sources.push({ el, destroy: () => a.destroy?.() });
    const call = spy.mock.calls.find((c) => c[0] === 'touchmove');
    expect(call).toBeTruthy();
    expect((call![2] as AddEventListenerOptions).passive).toBe(false);
    const tm = () => {
      const ev = new Event('touchmove', { bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(tm()).toBe(false); // no press: ordinary scrolling over a tile
    el.dispatchEvent(pe('pointerdown', 50, 50, { pointerType: 'touch' }));
    vi.advanceTimersByTime(200);
    expect(tm()).toBe(false); // held, not yet ready: the page may still scroll
    vi.advanceTimersByTime(200);
    expect(tm()).toBe(true); // drag-ready
    moveTo(70, 50, { pointerType: 'touch' });
    expect(get(drag)).not.toBeNull();
    expect(tm()).toBe(true); // dragging
    drop(70, 50, { pointerType: 'touch' });
    expect(tm()).toBe(false);
  });

  it('a change of the active tab during a drag cancels it, visibly; a switch the drag asks for does not', () => {
    setActiveTab('t1');
    const { el } = source('a');
    startMouseDrag(el, 50, 50);
    flush();
    setActiveTab('t2');
    expect(get(drag)).toBeNull();
    expect(get(toast).at(-1)?.message).toMatch(/tab changed/i);
    setActiveTab('t1');
    startMouseDrag(el, 50, 50);
    flush();
    switchTabWithinDrag(() => setActiveTab('t2'));
    expect(get(drag)).not.toBeNull();
  });

  it('Escape during a bare press (no drag yet) is left alone; during a drag it is consumed', () => {
    const { el } = source('a');
    el.dispatchEvent(pe('pointerdown', 50, 50));
    const esc1 = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(esc1);
    expect(esc1.defaultPrevented).toBe(false);
    moveTo(60, 50);
    expect(get(drag)).not.toBeNull();
    const esc2 = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(esc2);
    expect(esc2.defaultPrevented).toBe(true);
    expect(get(drag)).toBeNull();
  });

  it('the toast Undo still undoes the drop after a save replaced the draft', async () => {
    const { el } = source('a');
    startMouseDrag(el, 50, 50);
    moveTo(350, 50);
    flush();
    drop(350, 50);
    const undoToast = get(toast).find((t) => t.action?.label === 'Undo')!;
    const savedDraft = draft();
    // The server's stored copy differs (normalised), so the draft is replaced.
    vi.mocked(api.saveDashboardV3).mockResolvedValue({
      revision: 6,
      layout: { schemaVersion: 3, dashboards: [{ ...JSON.parse(JSON.stringify(savedDraft)), revision: 6, normalisedByServer: true }] }
    } as never);
    expect(await save()).toBe('saved');
    expect(draft()).not.toBe(savedDraft); // the save swapped the draft reference
    undoToast.action!.onClick();
    expect(nodeIn(draft(), 'a')!.placement).toEqual(p(0, 0));
  });

  it('a save landing mid-drag (nothing edited meanwhile) does not cancel the drag', async () => {
    const { apply } = await import('$lib/stores/editSession');
    apply('Rename', (d: LayoutDashboard) => ({ ...d, name: 'Renamed' }));
    const sent = draft();
    let land!: (v: unknown) => void;
    vi.mocked(api.saveDashboardV3).mockReturnValue(new Promise((r) => { land = r; }) as never);
    const saving = save();
    const { el } = source('a');
    startMouseDrag(el, 50, 50);
    moveTo(350, 50);
    flush();
    expect(get(drag)).not.toBeNull();
    land({ revision: 6, layout: { schemaVersion: 3, dashboards: [{ ...JSON.parse(JSON.stringify(sent)), revision: 6 }] } });
    expect(await saving).toBe('saved');
    expect(draft()).toBe(sent);
    expect(get(drag)).not.toBeNull(); // still dragging
    drop(350, 50);
    expect(nodeIn(draft(), 'a')!.placement).toEqual(p(6, 0));
    expect(get(toast).map((t) => t.message).join('|')).not.toMatch(/changed during the drag/);
  });

  it('the toast Undo refuses (visibly) when another change came after the drop', async () => {
    const { el } = source('a');
    startMouseDrag(el, 50, 50);
    moveTo(350, 50);
    flush();
    drop(350, 50);
    const undoToast = get(toast).find((t) => t.action?.label === 'Undo')!;
    const { apply } = await import('$lib/stores/editSession');
    apply('Other', (d: LayoutDashboard) => ({ ...d, name: 'Renamed' }));
    undoToast.action!.onClick();
    expect(draft().name).toBe('Renamed');
    expect(nodeIn(draft(), 'a')!.placement).toEqual(p(6, 0));
    expect(get(toast).at(-1)?.message).toMatch(/Ctrl\+Z/);
  });
});

describe('the non-passive touchmove guard exists only while editing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** Live non-passive touchmove listeners per element, tracked through add/remove. */
  function trackTouchmove() {
    const live = new Map<EventTarget, number>();
    const add = HTMLElement.prototype.addEventListener;
    const rem = HTMLElement.prototype.removeEventListener;
    vi.spyOn(HTMLElement.prototype, 'addEventListener').mockImplementation(function (
      this: HTMLElement, type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions
    ) {
      if (type === 'touchmove' && typeof opts === 'object' && opts.passive === false) live.set(this, (live.get(this) ?? 0) + 1);
      return add.call(this, type, fn, opts);
    });
    vi.spyOn(HTMLElement.prototype, 'removeEventListener').mockImplementation(function (
      this: HTMLElement, type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | EventListenerOptions
    ) {
      if (type === 'touchmove' && live.has(this)) live.set(this, live.get(this)! - 1);
      return rem.call(this, type, fn, opts);
    });
    return () => [...live.values()].reduce((n, v) => n + v, 0);
  }

  it('dragSource, resizeSource and tabSource add it on enable and remove it on disable/destroy', () => {
    const count = trackTouchmove();
    const el = () => document.body.appendChild(document.createElement('div'));
    const d = dragSource(el(), { id: 'a', enabled: false });
    const r = resizeSource(el(), { id: 'a', edge: 'corner', metrics: GRID, enabled: false });
    const t = tabSource(el(), { tabId: 't1', enabled: false });
    expect(count()).toBe(0); // view mode: none at all
    d.update!({ id: 'a', enabled: true });
    r.update!({ id: 'a', edge: 'corner', metrics: GRID, enabled: true });
    t.update!({ tabId: 't1', enabled: true });
    expect(count()).toBe(3);
    d.update!({ id: 'a', enabled: true }); // re-enabling adds no duplicate
    expect(count()).toBe(3);
    d.update!({ id: 'a', enabled: false });
    expect(count()).toBe(2);
    r.destroy!();
    t.destroy!();
    d.destroy!();
    expect(count()).toBe(0);
  });

  it('a view-mode canvas registers no non-passive touchmove listener; entering edit mode adds them', async () => {
    vi.stubGlobal('ResizeObserver', FakeRO);
    const count = trackTouchmove();
    const d = draft();
    const view = render(TabCanvas, { dashboard: d, tab: d.tabs[0], editing: false });
    await tick();
    expect(view.container.querySelector('[data-node-id="a"]')).toBeTruthy();
    expect(count()).toBe(0);
    await view.rerender({ dashboard: d, tab: d.tabs[0], editing: true });
    await tick();
    expect(count()).toBeGreaterThan(0);
  });
});

describe('the drag refusal reason is announced', () => {
  it('a polite live region outside the aria-hidden layer carries "not allowed: <reason>" while it applies', async () => {
    render(DragLayer);
    await tick();
    const live = () => document.querySelector('[data-testid="drag-announce"]') as HTMLElement | null;
    expect(live()).toBeTruthy(); // mounted before any drag, so changes are announced
    expect(live()!.getAttribute('aria-live')).toBe('polite');
    expect(live()!.closest('[aria-hidden="true"]')).toBeNull();
    expect(live()!.textContent!.trim()).toBe('');
    const { el } = source('a');
    startMouseDrag(el, 50, 50);
    where = null;
    moveTo(350, 50);
    flush();
    await tick();
    const t = get(drag)!.target!;
    expect(t.kind).toBe('invalid');
    expect(live()!.textContent).toContain(`Not allowed: ${t.kind === 'invalid' ? t.reason : ''}`);
    where = { ref: { tabId: 't1' }, metrics: GRID, layout: 'grid' };
    moveTo(350, 60);
    flush();
    await tick();
    expect(live()!.textContent!.trim()).toBe('');
    drop(350, 60);
  });
});

describe('the tab rail scrolls sideways during a drag', () => {
  const RAIL = { left: 0, top: 0, width: 500, height: 40 };
  /** A rail whose strip shows 500 of 3000 px, and a stub that puts the pointer over a tab in it. */
  function railEnv(scrollLeft: number) {
    const strip = document.createElement('div');
    strip.setAttribute('data-drag-tabbar', '');
    const rail = document.createElement('div');
    rail.setAttribute('data-drag-tabrail', '');
    rail.appendChild(strip);
    document.body.appendChild(rail);
    const scrollElByX = vi.fn();
    setDragEnv({
      hitTest: (x) => ({
        container: null, dx: 0, dy: 0, tabId: 't2', tabRect: { left: x - 20, top: 0, width: 80, height: 40 }, tabRail: rail
      }),
      raf: (cb) => {
        frames.push(cb);
        return frames.length;
      },
      cancelRaf: () => {
        frames = [];
      },
      measure: (e) => (e === rail ? RAIL : sourceRect),
      viewport: () => ({ width: 2000, height: 2000 }),
      scrollBy: () => {},
      scrollElByX,
      scrollMetrics: () => ({ scrollLeft, clientWidth: 500, scrollWidth: 3000 })
    });
    return { strip, scrollElByX };
  }

  it('railEdgeStep', () => {
    const m = (scrollLeft: number) => ({ scrollLeft, clientWidth: 500, scrollWidth: 3000 });
    const left = railEdgeStep(10, RAIL, m(500));
    expect(left).toBeLessThan(0);
    expect(left).toBeGreaterThanOrEqual(-20);
    expect(railEdgeStep(10, RAIL, m(0))).toBe(0); // already at the start
    expect(railEdgeStep(250, RAIL, m(500))).toBe(0); // mid-rail
    expect(railEdgeStep(495, RAIL, m(500))).toBeGreaterThan(0);
    expect(railEdgeStep(495, RAIL, m(2500))).toBe(0); // already at the end
    expect(railEdgeStep(495, RAIL, { scrollLeft: 0, clientWidth: 500, scrollWidth: 500 })).toBe(0); // no overflow
  });

  it('the rail edge-scrolls during a drag', () => {
    const { strip, scrollElByX } = railEnv(500);
    setActiveTab('t1');
    const el = document.createElement('button');
    document.body.appendChild(el);
    const t = tabSource(el, { tabId: 't1', enabled: true });
    startMouseDrag(el, 100, 20);
    moveTo(490, 20);
    flush();
    expect(get(drag)?.tab).toBe('t1');
    expect(scrollElByX).toHaveBeenCalled();
    const [onEl, dx] = scrollElByX.mock.calls.at(-1)!;
    expect(onEl).toBe(strip);
    expect(dx).toBeGreaterThan(0);
    // Held still, it keeps scrolling (the next frame is already asked for).
    const n = scrollElByX.mock.calls.length;
    flush();
    expect(scrollElByX.mock.calls.length).toBeGreaterThan(n);
    t.destroy();
  });

  it('no tab dwell while the rail edge-scrolls; the dwell works there once it is at its end', () => {
    setActiveTab('t1');
    const { scrollElByX } = railEnv(500);
    const { el } = source('a');
    startMouseDrag(el, 100, 20);
    moveTo(490, 20);
    flush();
    expect(scrollElByX).toHaveBeenCalled();
    expect(get(drag)?.dwell).toBeUndefined();
    drop(490, 20);
    // At the end the strip can't scroll right: holding over the tab there opens it.
    resetDragForTests();
    env();
    setActiveTab('t1');
    const { scrollElByX: still } = railEnv(2500);
    const { el: el2 } = source('b');
    startMouseDrag(el2, 100, 20);
    moveTo(490, 20);
    flush();
    expect(still).not.toHaveBeenCalled();
    expect(get(drag)?.dwell?.key).toBe('tab:t2');
  });
});
