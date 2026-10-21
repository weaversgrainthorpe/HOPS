import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn(),
  getConfig: vi.fn(async () => { throw new Error('offline in tests'); })
}));

import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { containerMetrics, readingOrder, type ContainerMetrics } from '$lib/layout/geometry';
import type { LayoutDashboard, LayoutNode } from '$lib/types/layout';
import type { ContainerRef } from '../treeOps';
import { hitTest, registerContainer, unregisterContainer, type HitResult } from './hitTest';
import {
  drag, dragSource, setDragEnv, resetDragForTests, setActiveTab, switchTabWithinDrag, MERGE_DWELL_MS
} from './dragController';
import TabCanvas from '$lib/components/layout/TabCanvas.svelte';
import EditToolbar from '$lib/components/editor/EditToolbar.svelte';
import { session } from '$lib/stores/editSession';
import { setLayout, resetEditor, startSession, draft, nodeIn, folder, tile, p } from '$lib/components/editor/editorTestKit';

// A phone: 3 stacked columns of 120 px. Stacked metrics are not used for positions.
const STACK = containerMetrics({ columns: 24, children: [] }, 'grid', 0);
type Box = { left: number; top: number; width: number; height: number };
type Where = { ref: ContainerRef; metrics: ContainerMetrics; layout: 'grid' | 'free' | 'stacked' };

/**
 * t1 (grid, 8 columns, Medium 2 x 2 tiles): a b c d on row 0, then the collapsed folder fc (y inside) and the expanded
 * folder fe (e1 inside) below them. t2 (grid): z.
 */
function phoneDash(): LayoutDashboard {
  return {
    id: 'd1', name: 'Home', path: '/home', revision: 5,
    tabs: [
      { id: 't1', name: 'Main', root: { columns: 8, children: [
        tile('a', p(0, 0)), tile('b', p(2, 0)), tile('c', p(4, 0)), tile('d', p(6, 0)),
        folder('fc', p(0, 2, 2, 2), [tile('y', p(0, 0))], { display: 'collapsed' }),
        folder('fe', p(2, 2, 6, 4), [tile('e1', p(0, 0))])
      ] } },
      { id: 't2', name: 'Other', root: { columns: 24, children: [tile('z', p(0, 0))] } }
    ]
  };
}

// Rendered (stacked) boxes in t1's root, container-relative px: three per row; fe spans the row.
const T1: { id: string; box: Box }[] = [
  { id: 'a', box: { left: 0, top: 0, width: 120, height: 120 } },
  { id: 'b', box: { left: 120, top: 0, width: 120, height: 120 } },
  { id: 'c', box: { left: 240, top: 0, width: 120, height: 120 } },
  { id: 'd', box: { left: 0, top: 120, width: 120, height: 120 } },
  { id: 'fc', box: { left: 120, top: 120, width: 120, height: 120 } },
  { id: 'fe', box: { left: 0, top: 240, width: 360, height: 160 } }
];

let where: Where | null;
let boxes: { id: string; box: Box }[] = [];
let tabUnder: string | null = null;
let frames: FrameRequestCallback[] = [];

function flush() {
  const f = frames;
  frames = [];
  f.forEach((cb) => cb(0));
}
const inBox = (b: Box, x: number, y: number) => x >= b.left && x < b.left + b.width && y >= b.top && y < b.top + b.height;

function env() {
  setDragEnv({
    hitTest: (x, y, dragged): HitResult => {
      if (tabUnder) return { container: null, dx: 0, dy: 0, tabId: tabUnder, tabRect: { left: 0, top: -40, width: 100, height: 40 } };
      if (!where) return { container: null, dx: 0, dy: 0 };
      const live = boxes.filter((b) => !dragged.has(b.id));
      const out: HitResult = {
        container: { ...where, left: 0, top: 0 }, dx: x, dy: y,
        stackBoxes: live.map((b) => ({ id: b.id, ...b.box }))
      };
      const n = live.find((b) => inBox(b.box, x, y));
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
    measure: () => ({ left: 0, top: 0, width: 120, height: 120 }),
    viewport: () => ({ width: 2000, height: 2000 }),
    scrollBy: () => {}
  });
}

const pe = (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
  new PointerEvent(type, {
    clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, pointerId: 1, ...extra
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
function dragTo(id: string, from: [number, number], to: [number, number]) {
  source(id).dispatchEvent(pe('pointerdown', from[0], from[1]));
  document.body.dispatchEvent(pe('pointermove', from[0] + 6, from[1]));
  document.body.dispatchEvent(pe('pointermove', to[0], to[1]));
  flush();
}
const drop = (x: number, y: number) => document.body.dispatchEvent(pe('pointerup', x, y));
const drop2 = (x: number, y: number) => document.body.dispatchEvent(pe('pointerup', x, y, { ctrlKey: true }));

/** Ids in a container's reading order (what the stacked layout shows). */
function orderOf(d: LayoutDashboard, tabId: string, folderId?: string): string[] {
  const tab = d.tabs.find((t) => t.id === tabId)!;
  const kids = folderId ? (nodeIn(d, folderId) as { content: { children: LayoutNode[] } }).content.children : tab.root.children;
  return readingOrder(kids).map((n) => n.id);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetEditor();
  resetDragForTests();
  setLayout([phoneDash()]);
  startSession('d1');
  where = { ref: { tabId: 't1' }, metrics: STACK, layout: 'stacked' };
  boxes = T1;
  tabUnder = null;
  frames = [];
  setActiveTab('t1');
  env();
});

afterEach(() => {
  sources.forEach((s) => s.destroy());
  sources = [];
  resetDragForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('stacked (phone) drag: reorder in reading order', () => {
  it('dropping a on the right half of c puts it after c, with a marker at c\'s right edge', () => {
    dragTo('a', [60, 60], [330, 60]);
    const s = get(drag)!;
    expect(s.target?.kind).toBe('place');
    expect(s.marker).toMatchObject({ left: 360, top: 0, height: 120 });
    drop(330, 60);
    expect(orderOf(draft(), 't1')).toEqual(['b', 'c', 'a', 'd', 'fc', 'fe']);
    expect(get(session)!.undo.length).toBe(1);
  });

  it('the first phone reorder in a session says it also moves items in the wide layout; once per session', async () => {
    const { toast } = await import('$lib/stores/toast');
    const { resetEditSessionForTests } = await import('$lib/stores/editSession');
    const NOTICE = 'Reordering on a narrow screen also moves these items in the wide layout';
    const spy = vi.spyOn(toast, 'info');
    dragTo('a', [60, 60], [330, 60]);
    drop(330, 60);
    expect(spy.mock.calls.filter((c) => c[0] === NOTICE).length).toBe(1);
    dragTo('b', [180, 60], [20, 60]);
    drop(20, 60);
    expect(spy.mock.calls.filter((c) => c[0] === NOTICE).length).toBe(1);
    resetEditSessionForTests();
    setLayout([phoneDash()]);
    startSession('d1');
    dragTo('a', [60, 60], [330, 60]);
    drop(330, 60);
    expect(spy.mock.calls.filter((c) => c[0] === NOTICE).length).toBe(2);
  });

  it('dropping d on the left half of a puts it first', () => {
    dragTo('d', [60, 180], [20, 60]);
    drop(20, 60);
    expect(orderOf(draft(), 't1')).toEqual(['d', 'a', 'b', 'c', 'fc', 'fe']);
  });

  it('a pointer in the gap between items goes to the nearest one', () => {
    dragTo('a', [60, 60], [365, 30]); // just right of c
    drop(365, 30);
    expect(orderOf(draft(), 't1')).toEqual(['b', 'c', 'a', 'd', 'fc', 'fe']);
  });

  it('a wide item (an expanded folder) splits by its top / bottom half', () => {
    dragTo('a', [60, 60], [300, 380]); // bottom half of fe → after it
    drop(300, 380);
    expect(orderOf(draft(), 't1')).toEqual(['b', 'c', 'd', 'fc', 'fe', 'a']);
  });

  it('a big item moved before small ones pushes them aside and still lands in reading order', () => {
    dragTo('fe', [100, 260], [20, 60]); // before a
    drop(20, 60);
    expect(orderOf(draft(), 't1')).toEqual(['fe', 'a', 'b', 'c', 'd', 'fc']);
  });

  it('Ctrl held: a copy goes after c and the original stays', () => {
    source('a').dispatchEvent(pe('pointerdown', 60, 60, { ctrlKey: true }));
    document.body.dispatchEvent(pe('pointermove', 66, 60, { ctrlKey: true }));
    document.body.dispatchEvent(pe('pointermove', 330, 60, { ctrlKey: true }));
    flush();
    expect(get(drag)!.copy).toBe(true);
    drop2(330, 60);
    const ids = orderOf(draft(), 't1');
    expect(ids.length).toBe(7);
    expect(ids.slice(0, 3)).toEqual(['a', 'b', 'c']);
    expect(ids[3]).not.toBe('a');
    expect(ids.slice(4)).toEqual(['d', 'fc', 'fe']);
  });

  it('a press with no movement over its own slot changes nothing', () => {
    dragTo('b', [180, 60], [130, 60]);
    drop(130, 60);
    expect(orderOf(draft(), 't1')).toEqual(['a', 'b', 'c', 'd', 'fc', 'fe']);
  });
});

describe('stacked (phone) drag: folders, merge and other tabs', () => {
  it('into a collapsed folder (its centre) and out of a folder to the root', () => {
    dragTo('a', [60, 60], [180, 180]); // centre of fc
    expect(get(drag)!.target?.kind).toBe('into-folder');
    drop(180, 180);
    expect(orderOf(draft(), 't1', 'fc')).toEqual(['y', 'a']);

    // out of the expanded folder fe (its stacked content) to the root, before b
    dragTo('e1', [10, 260], [125, 60]);
    drop(125, 60);
    expect(orderOf(draft(), 't1')).toEqual(['e1', 'b', 'c', 'd', 'fc', 'fe']);
    expect(orderOf(draft(), 't1', 'fe')).toEqual([]);
  });

  it('into an expanded folder\'s stacked content at a position', () => {
    where = { ref: { tabId: 't1', folderId: 'fe' }, metrics: STACK, layout: 'stacked' };
    boxes = [{ id: 'e1', box: { left: 0, top: 0, width: 120, height: 120 } }];
    dragTo('a', [60, 60], [10, 60]); // before e1
    drop(10, 60);
    expect(orderOf(draft(), 't1', 'fe')).toEqual(['a', 'e1']);
  });

  it('holding over a tile\'s centre merges into a new folder', () => {
    dragTo('a', [60, 60], [180, 60]);
    expect(get(drag)!.target?.kind).toBe('place');
    vi.advanceTimersByTime(MERGE_DWELL_MS);
    flush();
    expect(get(drag)!.target?.kind).toBe('merge');
    drop(180, 60);
    const merged = draft().tabs[0].root.children.find((n) => n.kind === 'folder' && n.id !== 'fc' && n.id !== 'fe');
    expect(merged && merged.kind === 'folder' ? merged.content.children.map((n) => n.id).sort() : []).toEqual(['a', 'b']);
  });

  it('a drop on another tab\'s button appends it there; a drag that switches tab drops in reading order there', () => {
    dragTo('a', [60, 60], [50, -20]);
    tabUnder = 't2';
    document.body.dispatchEvent(pe('pointermove', 50, -20));
    flush();
    expect(get(drag)!.target?.kind).toBe('tab-append');
    drop(50, -20);
    expect(orderOf(draft(), 't2')).toEqual(['z', 'a']);

    // Now drag b, switch to t2 by the drag, and drop before z there.
    tabUnder = null;
    dragTo('b', [180, 60], [180, 60]);
    where = { ref: { tabId: 't2' }, metrics: STACK, layout: 'stacked' };
    boxes = [
      { id: 'z', box: { left: 0, top: 0, width: 120, height: 120 } },
      { id: 'a', box: { left: 120, top: 0, width: 120, height: 120 } }
    ];
    switchTabWithinDrag(() => setActiveTab('t2')); // as the drag's tab dwell does
    expect(get(drag)).not.toBeNull();
    document.body.dispatchEvent(pe('pointermove', 5, 60));
    flush();
    drop(5, 60);
    expect(orderOf(draft(), 't2')).toEqual(['b', 'z', 'a']);
  });
});

describe('hitTest in a stacked container', () => {
  afterEach(() => document.body.replaceChildren());
  it('reports the stacked boxes of the container\'s own items, minus dragged ones', () => {
    const mk = (id: string) => {
      const e = document.createElement('div');
      e.setAttribute('data-node-id', id);
      return e;
    };
    const root = document.createElement('div');
    root.setAttribute('data-container-id', 't1');
    const a = mk('a'), b = mk('b'), c = mk('c');
    root.append(a, b, c);
    document.body.appendChild(root);
    registerContainer(root, { ref: { tabId: 't1' }, metrics: STACK, layout: 'stacked' });
    const rects = new Map<Element, Box>([
      [root, { left: 10, top: 20, width: 360, height: 240 }],
      [a, { left: 10, top: 20, width: 120, height: 120 }],
      [b, { left: 130, top: 20, width: 120, height: 120 }],
      [c, { left: 250, top: 20, width: 120, height: 120 }]
    ]);
    const h = hitTest(140, 30, new Set(['a']), { elementFromPoint: () => b, rectOf: (e) => rects.get(e)! });
    expect(h.stackBoxes).toEqual([
      { id: 'b', left: 120, top: 0, width: 120, height: 120 },
      { id: 'c', left: 240, top: 0, width: 120, height: 120 }
    ]);
    unregisterContainer(root);
  });
});

describe('phone editing rules', () => {
  it('no resize handles in the stacked layout, and the toolbar says why', async () => {
    vi.useRealTimers();
    class RO {
      cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) { this.cb = cb; }
      observe(el: Element) {
        this.cb([{ target: el, contentRect: { width: 600 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', RO);
    const tb = render(EditToolbar, { tabId: 't1', onAddTab: () => {} });
    expect(tb.queryByText('Resize and free placement need a wider screen')).toBeNull();
    const d = draft();
    const { container } = render(TabCanvas, { dashboard: d, tab: d.tabs[0], editing: true });
    await tick();
    expect(container.querySelector('.container-stacked')).not.toBeNull();
    expect(container.querySelector('[data-resize]')).toBeNull();
    expect(tb.getByText('Resize and free placement need a wider screen')).toBeInTheDocument();
  });
});
