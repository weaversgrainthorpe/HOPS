import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn(),
  getConfig: vi.fn(async () => { throw new Error('offline in tests'); })
}));

import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { containerMetrics, type ContainerMetrics } from '$lib/layout/geometry';
import { toast } from '$lib/stores/toast';
import { editorDialog } from '../editorUi';
import type { FolderNode, LayoutNode } from '$lib/types/layout';
import type { ContainerRef } from '../treeOps';
import type { HitResult } from './hitTest';
import DragLayer from './DragLayer.svelte';
import DragBreadcrumb from './DragBreadcrumb.svelte';
import EditorDialogs from '$lib/components/editor/EditorDialogs.svelte';
import {
  drag, dragSource, setDragEnv, resetDragForTests, setActiveTab, setTabSwitcher, MERGE_DWELL_MS, OPEN_DWELL_MS
} from './dragController';
import { setLayout, resetEditor, startSession, draft, nodeIn, home, other, folder, tile, p } from '$lib/components/editor/editorTestKit';

// t1's root: 24 columns of 50 px (square rows): a Medium tile (2 x 2) is a 100 px box.
const GRID = containerMetrics({ columns: 24, children: [] }, 1200);
/** A folder's content (M5): Medium items of 2 x 50 px, flowing 2 to a row. */
const FLOW: ContainerMetrics = { columns: 4, unitPx: 50, rowPx: 50, innerWidthPx: 200, flow: { span: 2, perRow: 2 } };

type Box = { left: number; top: number; width: number; height: number };
type Where = { ref: ContainerRef; metrics: ContainerMetrics; layout: 'grid' | 'flow' | 'stacked' };

/** The stub DOM: a container (or none), rendered node boxes in it, and tab-bar / crumb targets. */
let where: Where | null;
let nodes: { id: string; box: Box }[] = [];
let tabUnder: string | null = null;
let crumbUnder: string | null = null;
let frames: FrameRequestCallback[] = [];
let sourceRect: Box = { left: 0, top: 0, width: 100, height: 100 };

function flush() {
  const f = frames;
  frames = [];
  f.forEach((cb) => cb(0));
}

function env() {
  setDragEnv({
    hitTest: (x, y): HitResult => {
      if (crumbUnder) return { container: null, dx: 0, dy: 0, crumb: crumbUnder };
      if (tabUnder) return { container: null, dx: 0, dy: 0, tabId: tabUnder, tabRect: { left: 0, top: 0, width: 100, height: 40 } };
      if (!where) return { container: null, dx: 0, dy: 0 };
      const out: HitResult = { container: { ...where, left: 0, top: 0 }, dx: x, dy: y };
      const n = nodes.find((b) => x >= b.box.left && x < b.box.left + b.box.width && y >= b.box.top && y < b.box.top + b.box.height);
      if (n) {
        out.nodeId = n.id;
        out.node = { id: n.id, ...n.box };
      }
      return out;
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

let sources: { destroy: () => void }[] = [];
function source(id: string) {
  const el = document.createElement('div');
  el.setAttribute('data-node-id', id);
  document.body.appendChild(el);
  const a = dragSource(el, { id, enabled: true });
  sources.push({ destroy: () => a.destroy?.() });
  return el;
}
function startMouseDrag(el: HTMLElement, x: number, y: number) {
  el.dispatchEvent(pe('pointerdown', x, y));
  document.body.dispatchEvent(pe('pointermove', x + 6, y));
}
const moveTo = (x: number, y: number) => document.body.dispatchEvent(pe('pointermove', x, y));
const drop = (x: number, y: number) => document.body.dispatchEvent(pe('pointerup', x, y));

/** t1's rendered boxes: a, b, and c1 collapsed (one cell at (5, 1)). */
const T1_BOXES = [
  { id: 'a', box: { left: 0, top: 0, width: 100, height: 100 } },
  { id: 'b', box: { left: 100, top: 0, width: 100, height: 100 } },
  { id: 'c1', box: { left: 500, top: 100, width: 100, height: 100 } }
];

beforeEach(() => {
  vi.useFakeTimers();
  resetEditor();
  resetDragForTests();
  setLayout();
  startSession();
  where = { ref: { tabId: 't1' }, metrics: GRID, layout: 'grid' };
  nodes = T1_BOXES;
  tabUnder = null;
  crumbUnder = null;
  frames = [];
  sourceRect = { left: 0, top: 0, width: 100, height: 100 };
  setActiveTab('t1');
  env();
});

afterEach(() => {
  sources.forEach((s) => s.destroy());
  sources = [];
  resetDragForTests();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('merge', () => {
  it('499 ms in a tile\'s centre is still a place; at 500 ms it is a merge with a "make folder" cue', async () => {
    expect(MERGE_DWELL_MS).toBe(500);
    render(DragLayer);
    startMouseDrag(source('a'), 50, 50);
    moveTo(150, 50); // the centre of b
    flush();
    expect(get(drag)?.target?.kind).toBe('place');
    vi.advanceTimersByTime(499);
    flush();
    expect(get(drag)?.target?.kind).toBe('place');
    vi.advanceTimersByTime(1);
    flush();
    expect(get(drag)?.target).toEqual({ kind: 'merge', targetTileId: 'b' });
    await tick();
    expect(document.querySelector('.drag-layer .cue')?.textContent).toMatch(/make a folder/i);
  });

  it('the drop makes a collapsed "New folder" holding both, and opens its dialog with the name selected', async () => {
    render(EditorDialogs, { tabId: 't1' });
    startMouseDrag(source('a'), 50, 50);
    moveTo(150, 50);
    flush();
    vi.advanceTimersByTime(MERGE_DWELL_MS);
    flush();
    drop(150, 50);
    vi.advanceTimersByTime(1); // the post-drag click swallower expires (it is cleared on a 0 ms timer)
    const d = draft();
    const made = d.tabs[0].root.children.find((n) => n.kind === 'folder' && n.name === 'New folder') as FolderNode;
    expect(made).toBeTruthy();
    expect(made.display).toBe('collapsed');
    expect(made.content.children.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(get(editorDialog)).toEqual({ kind: 'folder', id: made.id });
    await tick();
    await tick();
    const input = document.getElementById('folder-name') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('New folder'.length);
    // Cancel keeps "New folder"; the merge stays (and is one undo step)
    await fireEvent.click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel')!);
    expect(get(editorDialog)).toBeNull();
    expect((nodeIn(draft(), made.id) as FolderNode).name).toBe('New folder');
    expect(get(toast).some((t) => t.action?.label === 'Undo')).toBe(true);
  });

  it('a tile\'s edge zone is a place, however long the pointer stays', () => {
    startMouseDrag(source('a'), 50, 50);
    moveTo(105, 50); // inside b, in its left quarter
    flush();
    vi.advanceTimersByTime(2000);
    flush();
    expect(get(drag)?.target?.kind).toBe('place');
    drop(105, 50);
    expect(nodeIn(draft(), 'a')!.placement).toEqual(p(1, 0)); // snapped to the finer cell
    expect(nodeIn(draft(), 'b')!.kind).toBe('tile');
  });
});

// Real-browser bug (Ruling 29): users aim with the dragged tile (the ghost), not the cursor. The
// merge zone is tested at the ghost's VISUAL centre (pointer − grab offset + half the ghost).
describe('merge by the dragged tile\'s visual centre', () => {
  it('grabbed off-centre: the ghost centred on b merges although the pointer is in b\'s edge zone', () => {
    startMouseDrag(source('a'), 10, 90); // grabbed near its bottom-left (fx 0.1, fy 0.9)
    moveTo(110, 90); // ghost centre = (110 − 10 + 50, 90 − 90 + 50) = (150, 50): b's centre
    flush();
    expect(get(drag)?.target?.kind).toBe('place');
    vi.advanceTimersByTime(MERGE_DWELL_MS);
    flush();
    expect(get(drag)?.target).toEqual({ kind: 'merge', targetTileId: 'b' });
  });

  it('the pointer on b\'s centre with the ghost mostly off it does not merge', () => {
    startMouseDrag(source('a'), 10, 90);
    moveTo(150, 50); // ghost centre = (190, 10): inside b, outside its inner 50%
    flush();
    vi.advanceTimersByTime(2000);
    flush();
    expect(get(drag)?.target?.kind).toBe('place');
  });

  it('the pointer past b\'s edge (over empty cells) still merges when the ghost\'s centre is in b\'s centre zone', () => {
    startMouseDrag(source('a'), 95, 50); // grabbed at its right edge (fx 0.95)
    moveTo(215, 50); // pointer beyond b (b spans 100..200); ghost centre = (170, 50): in b's inner 50%
    flush();
    vi.advanceTimersByTime(MERGE_DWELL_MS);
    flush();
    expect(get(drag)?.target).toEqual({ kind: 'merge', targetTileId: 'b' });
  });

  it('shows a "hold to make a folder" cue with progress as soon as the centre enters the zone', async () => {
    render(DragLayer);
    startMouseDrag(source('a'), 10, 90);
    moveTo(110, 90);
    flush();
    await tick();
    const cue = document.querySelector('.drag-layer .cue');
    expect(cue?.textContent).toMatch(/hold to make a folder/i);
    expect(cue?.querySelector('.cue-progress')).toBeTruthy();
    expect(get(drag)?.over).toEqual({ left: 100, top: 0, width: 100, height: 100 });
    // ripe: the cue becomes the commit cue
    vi.advanceTimersByTime(MERGE_DWELL_MS);
    flush();
    await tick();
    expect(document.querySelector('.drag-layer .cue')?.textContent).toMatch(/^\s*make a folder\s*$/i);
    // leaving the zone drops the cue
    moveTo(30, 90); // ghost centre (70, 50): over empty space left of b (a is the dragged item)
    flush();
    await tick();
    expect(document.querySelector('.drag-layer .cue')).toBeNull();
  });
});

describe('into folders', () => {
  it('a drop on a collapsed folder goes inside it, at the end of its order (unplaced)', () => {
    startMouseDrag(source('a'), 50, 50);
    moveTo(550, 150); // the centre of c1's one rendered Medium tile
    flush();
    const t = get(drag)!.target!;
    expect(t.kind).toBe('into-folder');
    drop(550, 150);
    const c1 = nodeIn(draft(), 'c1') as FolderNode;
    expect(c1.content.children.map((n) => n.id)).toEqual(['y', 'a']);
    expect('placement' in c1.content.children[1]).toBe(false);
    expect(get(toast).at(-1)?.message).toBe('Moved "A" to C1');
  });

  it('holding over a minimised folder opens nothing (no pop-over, M5 §3a.4); the drop lands inside, at the end', () => {
    startMouseDrag(source('a'), 50, 50);
    moveTo(550, 150);
    flush();
    vi.advanceTimersByTime(OPEN_DWELL_MS * 3);
    flush();
    expect(get(drag)?.dwell).toBeUndefined();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(get(drag)?.target).toMatchObject({ kind: 'into-folder', folderId: 'c1' });
    drop(550, 150);
    const c1 = nodeIn(draft(), 'c1') as FolderNode;
    expect(c1.content.children.map((n) => n.id)).toEqual(['y', 'a']);
  });

  it('a folder over its own descendant is invalid while hovering, and the drop changes nothing', async () => {
    resetEditor();
    const d = home();
    const f1 = d.tabs[0].root.children.find((n) => n.id === 'f1') as FolderNode;
    f1.content.children.push(folder('g', undefined, [tile('z')], { display: 'collapsed' }));
    setLayout([d, other()]);
    startSession();
    render(DragLayer);
    nodes = [{ id: 'g', box: { left: 200, top: 100, width: 100, height: 100 } }];
    sourceRect = { left: 0, top: 100, width: 400, height: 300 };
    const before = draft();
    startMouseDrag(source('f1'), 10, 110); // grabbed at its top-left: the ghost (400×300) hangs right/down
    moveTo(60, 10); // the ghost's visual centre = (60 + 190, 10 + 140) = (250, 150): g's centre
    flush();
    expect(get(drag)?.target).toEqual({ kind: 'invalid', reason: "A folder can't go inside itself." });
    await tick();
    expect(document.querySelector('.drag-layer .reason')?.textContent).toBe("A folder can't go inside itself.");
    drop(60, 10);
    expect(draft()).toBe(before);
    expect(get(toast).at(-1)?.type).toBe('error');
  });
});

describe('across tabs', () => {
  it('600 ms over a tab switches to it and the drag continues; the drop lands in the new tab', () => {
    const switched: string[] = [];
    setTabSwitcher((id) => { switched.push(id); });
    startMouseDrag(source('a'), 50, 50);
    flush();
    tabUnder = 't2';
    moveTo(60, 10);
    flush();
    vi.advanceTimersByTime(599);
    expect(switched).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(switched).toEqual(['t2']);
    setActiveTab('t2'); // what Dashboard → DragLayer report once the switch renders
    expect(get(drag)).not.toBeNull();
    tabUnder = null;
    where = { ref: { tabId: 't2' }, metrics: GRID, layout: 'grid' };
    nodes = [];
    moveTo(400, 400);
    flush();
    expect(get(drag)?.target).toMatchObject({ kind: 'place', to: { tabId: 't2' } });
    drop(400, 400);
    const d = draft();
    expect(d.tabs[1].root.children.some((n) => n.id === 'a')).toBe(true);
    expect(d.tabs[0].root.children.some((n) => n.id === 'a')).toBe(false);
  });

  it('a drop on a tab button appends to that tab at its first free cell', () => {
    startMouseDrag(source('a'), 50, 50);
    tabUnder = 't2';
    moveTo(60, 10);
    flush();
    expect(get(drag)?.target).toMatchObject({ kind: 'tab-append', tabId: 't2' });
    drop(60, 10);
    const t2 = draft().tabs[1].root.children;
    const a = t2.find((n) => n.id === 'a') as LayoutNode;
    expect(a).toBeTruthy();
    for (const o of t2.filter((n) => n.id !== 'a')) {
      const q = o.placement!, r = a.placement!;
      expect(r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h).toBe(false);
    }
    expect(get(toast).at(-1)?.message).toBe('Moved "A" to Two');
  });

  it('the breadcrumb shows the original tab; 600 ms over its crumb returns there', async () => {
    const switched: string[] = [];
    setTabSwitcher((id) => {
      switched.push(id);
      setActiveTab(id);
    });
    render(DragBreadcrumb);
    startMouseDrag(source('a'), 50, 50);
    flush();
    tabUnder = 't2';
    moveTo(60, 10);
    flush();
    vi.advanceTimersByTime(OPEN_DWELL_MS);
    expect(switched).toEqual(['t2']);
    tabUnder = null;
    flush();
    await tick();
    const crumb = document.querySelector('[data-drag-crumb="tab:t1"]') as HTMLElement;
    expect(crumb).toBeTruthy();
    expect(crumb.getAttribute('aria-label')).toMatch(/Main/);
    crumbUnder = 'tab:t1';
    moveTo(70, 900);
    flush();
    vi.advanceTimersByTime(OPEN_DWELL_MS);
    expect(switched).toEqual(['t2', 't1']);
    expect(get(drag)).not.toBeNull();
  });

  it('a crumb for the tab the drag is already on does nothing (no dwell)', () => {
    startMouseDrag(source('a'), 50, 50);
    crumbUnder = 'tab:t1';
    moveTo(70, 900);
    flush();
    expect(get(drag)?.dwell).toBeUndefined();
    expect(get(drag)?.target?.kind).toBe('invalid');
  });
});

describe('dwell edge cases', () => {
  it('300 ms in the centre, out, 300 ms back is not a merge (the dwell restarts)', () => {
    startMouseDrag(source('a'), 50, 50);
    moveTo(150, 50);
    flush();
    vi.advanceTimersByTime(300);
    moveTo(105, 50); // edge zone
    flush();
    moveTo(150, 50);
    flush();
    vi.advanceTimersByTime(300);
    flush();
    expect(get(drag)?.target?.kind).toBe('place');
    vi.advanceTimersByTime(MERGE_DWELL_MS - 300);
    flush();
    expect(get(drag)?.target?.kind).toBe('merge');
  });

  it('Escape during a pending dwell: the timer never fires', () => {
    startMouseDrag(source('a'), 50, 50);
    moveTo(150, 50); // b's centre zone: a merge dwell
    flush();
    vi.advanceTimersByTime(300);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(get(drag)).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a hover left within the last frame never acts (ripen re-checks the latest pointer)', () => {
    const switched: string[] = [];
    setTabSwitcher((id) => { switched.push(id); });
    startMouseDrag(source('a'), 50, 50);
    tabUnder = 't2';
    moveTo(60, 10);
    flush();
    vi.advanceTimersByTime(OPEN_DWELL_MS - 1);
    tabUnder = null;
    moveTo(50, 350); // away from the tab; no frame has run yet
    vi.advanceTimersByTime(1);
    expect(switched).toEqual([]);
    expect(get(drag)).not.toBeNull();
  });

  it('merge then an immediate Undo restores the exact pre-merge draft', () => {
    const before = draft();
    startMouseDrag(source('a'), 50, 50);
    moveTo(150, 50);
    flush();
    vi.advanceTimersByTime(MERGE_DWELL_MS);
    flush();
    drop(150, 50);
    expect(draft()).not.toBe(before);
    get(toast).find((t) => t.action?.label === 'Undo')!.action!.onClick();
    expect(draft()).toBe(before);
  });

  it('a tab switch the drag asked for that did not happen pre-approves nothing', () => {
    setTabSwitcher(() => false);
    startMouseDrag(source('a'), 50, 50);
    tabUnder = 't2';
    moveTo(60, 10);
    flush();
    vi.advanceTimersByTime(OPEN_DWELL_MS);
    expect(get(drag)).not.toBeNull();
    setActiveTab('t2'); // an unrelated change later: cancels as any other tab change does
    expect(get(drag)).toBeNull();
  });
});

describe('panel auto-scroll', () => {
  it('near the bottom edge of a scrollable panel (data-drag-scroll), that panel scrolls (not only the page)', () => {
    const body = document.createElement('div');
    const scrolled: number[] = [];
    const pageScrolled: number[] = [];
    setDragEnv({
      hitTest: (x, y) => ({ container: { ref: { tabId: 't1' }, metrics: GRID, layout: 'grid', left: 0, top: 0 }, dx: x, dy: y, scroller: body }),
      raf: (cb) => { frames.push(cb); return frames.length; },
      cancelRaf: () => { frames = []; },
      measure: (e) => (e === body ? { left: 0, top: 100, width: 600, height: 400 } : sourceRect),
      viewport: () => ({ width: 2000, height: 2000 }),
      scrollBy: (_dx, dy) => pageScrolled.push(dy),
      scrollElBy: (_el, dy) => scrolled.push(dy)
    });
    startMouseDrag(source('a'), 50, 50);
    moveTo(300, 490); // 10 px above the body's bottom edge (500)
    flush();
    expect(scrolled.length).toBe(1);
    expect(scrolled[0]).toBeGreaterThan(0);
    expect(pageScrolled).toEqual([]);
  });
});

