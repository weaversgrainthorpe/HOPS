// M5 Task 4 (spec §3.4, §3a.3, §3a.4): dragging in the ordered, paged folder model.
// - a drop on an open folder's page goes in at the pointer's place in the order (before the item
//   under the pointer, or at the end of the page);
// - a drop on its title bar, a crumb of its breadcrumb or an empty open folder goes in at the end;
// - holding over the page bar's ‹ › flips the page; holding over a crumb goes back up to it;
// - a folder never goes into itself or a descendant (a visible reason);
// - a sub-folder dragged out to the tab forgets this browser's memory of it (drawn minimised).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn(),
  getConfig: vi.fn(async () => { throw new Error('offline in tests'); })
}));

import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { ContainerMetrics } from '$lib/layout/geometry';
import { containerMetrics } from '$lib/layout/geometry';
import type { FolderNode, LayoutDashboard } from '$lib/types/layout';
import { toast } from '$lib/stores/toast';
import {
  folderNavFor, folderViewFor, setFolderDrill, setFolderPage, setFolderView
} from '$lib/stores/folderView';
import type { HitResult } from './hitTest';
import DragLayer from './DragLayer.svelte';
import { drag, dragSource, setDragEnv, resetDragForTests, setActiveTab, OPEN_DWELL_MS } from './dragController';
import { flowIndex } from './targets';
import { moveOrCopyTo } from '../editorActions';
import { setLayout, resetEditor, startSession, draft, nodeIn, tile, folder, p } from '$lib/components/editor/editorTestKit';

const GRID = containerMetrics({ columns: 24, children: [] }, 1200);
/** F's page: Medium items (100 px), 4 to a page here (2 a row, 2 rows). */
const FLOW: ContainerMetrics = { columns: 4, unitPx: 50, rowPx: 50, innerWidthPx: 200, flow: { span: 2, perRow: 2 } };
type Box = { left: number; top: number; width: number; height: number };

const ks = (n: number) => Array.from({ length: n }, (_, i) => tile(`k${i + 1}`));

/** Tab t1: tile a, open folder F (k1..k10 and sub-folder S [z]) and open folder E (empty); tab t2. */
function dash(): LayoutDashboard {
  return {
    id: 'd1', name: 'Home', path: '/home', revision: 5,
    tabs: [
      { id: 't1', name: 'Main', root: { columns: 24, children: [
        tile('a', p(0, 0)),
        folder('F', p(0, 4, 8, 8), [...ks(10), folder('S', undefined, [tile('z')], { display: 'collapsed' })]),
        folder('E', p(10, 4, 6, 6), []),
        folder('G', p(18, 0, 6, 6), [folder('H', undefined, [tile('h1')], { display: 'collapsed' })])
      ] } },
      { id: 't2', name: 'Two', root: { columns: 24, children: [] } }
    ]
  };
}

let hit: (x: number, y: number) => HitResult;
let frames: FrameRequestCallback[] = [];
let sourceRect: Box = { left: 0, top: 0, width: 100, height: 100 };
const flush = () => {
  const f = frames;
  frames = [];
  f.forEach((cb) => cb(0));
};

/** A hit on F's page (page `page` of `perPage`), its items at 100 px squares, 2 a row, origin (0, 300). */
function onPage(ids: string[], page: number, perPage: number, dragged: string[] = []) {
  const boxes = ids
    .map((id, i) => ({ id, left: (i % 2) * 100, top: Math.floor(i / 2) * 100, width: 100, height: 100 }))
    .filter((b) => !dragged.includes(b.id));
  return (x: number, y: number): HitResult => {
    const dx = x, dy = y - 300;
    const under = boxes.find((b) => dx >= b.left && dx < b.left + b.width && dy >= b.top && dy < b.top + b.height);
    return {
      container: { ref: { tabId: 't1', folderId: 'F' }, metrics: FLOW, layout: 'flow', left: 0, top: 300 },
      dx, dy,
      ...(under ? { nodeId: under.id, node: { ...under } } : {}),
      flowPage: { folderId: 'F', page, perPage, count: ids.length, boxes }
    };
  };
}

const pe = (type: string, x: number, y: number) =>
  new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, pointerId: 1, isPrimary: true });
let sources: (() => void)[] = [];
function source(id: string) {
  const el = document.createElement('div');
  el.setAttribute('data-node-id', id);
  document.body.appendChild(el);
  const a = dragSource(el, { id, enabled: true });
  sources.push(() => a.destroy?.());
  return el;
}
function start(id: string, x = 50, y = 50) {
  source(id).dispatchEvent(pe('pointerdown', x, y));
  document.body.dispatchEvent(pe('pointermove', x + 6, y));
}
const moveTo = (x: number, y: number) => {
  document.body.dispatchEvent(pe('pointermove', x, y));
  flush();
};
const drop = (x: number, y: number) => document.body.dispatchEvent(pe('pointerup', x, y));
const order = (id: string) => (nodeIn(draft(), id) as FolderNode).content.children.map((n) => n.id);

beforeEach(() => {
  vi.useFakeTimers();
  resetEditor();
  resetDragForTests();
  setLayout([dash()]);
  startSession();
  frames = [];
  sourceRect = { left: 0, top: 0, width: 100, height: 100 };
  hit = () => ({ container: { ref: { tabId: 't1' }, metrics: GRID, layout: 'grid', left: 0, top: 0 }, dx: 0, dy: 0 });
  setActiveTab('t1');
  setDragEnv({
    hitTest: (x, y) => hit(x, y),
    raf: (cb) => { frames.push(cb); return frames.length; },
    cancelRaf: () => { frames = []; },
    measure: () => sourceRect,
    viewport: () => ({ width: 2000, height: 2000 }),
    scrollBy: () => {}
  });
});

afterEach(() => {
  sources.forEach((d) => d());
  sources = [];
  resetDragForTests();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('flowIndex: the place in a folder\'s order under the pointer', () => {
  const kids = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'];
  const b = (id: string, left: number, top: number): Box & { id: string } => ({ id, left, top, width: 100, height: 100 });
  const page0 = { folderId: 'F', page: 0, perPage: 4, count: 4, boxes: [b('k1', 0, 0), b('k2', 100, 0), b('k3', 0, 100), b('k4', 100, 100)] };
  it('before the item under the pointer', () => {
    expect(flowIndex(kids, new Set(), page0, 150, 150)).toMatchObject({ index: 3, before: 'k4' });
    expect(flowIndex(kids, new Set(), page0, 5, 5)).toMatchObject({ index: 0, before: 'k1' });
  });
  it('the index counts the items that stay (a moved item is taken out first)', () => {
    const boxes = page0.boxes.filter((x) => x.id !== 'k1');
    expect(flowIndex(kids, new Set(['k1']), { ...page0, boxes }, 150, 150)).toMatchObject({ index: 2, before: 'k4' });
  });
  it('past the last item of a row: after it', () => {
    expect(flowIndex(kids, new Set(), page0, 250, 50)).toMatchObject({ index: 2, after: 'k2' });
  });
  it('below every row (empty space): the end of the page, not the end of the folder', () => {
    expect(flowIndex(kids, new Set(), page0, 50, 260)).toMatchObject({ index: 4, after: 'k4' });
    const page1 = { folderId: 'F', page: 1, perPage: 4, count: 2, boxes: [b('k5', 0, 0), b('k6', 100, 0)] };
    expect(flowIndex(kids, new Set(), page1, 50, 160)).toMatchObject({ index: 6, after: 'k6' });
  });
  it('a page showing only the dragged item: where that item is now', () => {
    expect(flowIndex(kids, new Set(['k5']), { folderId: 'F', page: 2, perPage: 2, count: 2, boxes: [b('k6', 100, 0)] }, 10, 10))
      .toMatchObject({ index: 4 });
    expect(flowIndex(['k1', 'k2', 'k3'], new Set(['k3']), { folderId: 'F', page: 1, perPage: 2, count: 1, boxes: [] }, 10, 10))
      .toEqual({ index: 2 });
  });
});

describe('a drop on an open folder\'s page', () => {
  it('goes in before the item under the pointer (a tile from the tab), with a marker; saved in that order', async () => {
    render(DragLayer, { tabId: 't1' });
    start('a');
    hit = onPage(['k1', 'k2', 'k3', 'k4'], 0, 4);
    moveTo(110, 320); // k2's left quarter: not its centre (no merge)
    const t = get(drag)!.target!;
    expect(t).toMatchObject({ kind: 'place', to: { tabId: 't1', folderId: 'F' }, index: 1, at: [] });
    expect(get(drag)!.marker).toEqual({ left: 100, top: 300, height: 100 });
    await tick();
    expect(document.querySelector('.drag-layer .marker')).toBeTruthy();
    drop(110, 320);
    expect(order('F').slice(0, 4)).toEqual(['k1', 'a', 'k2', 'k3']);
    expect('placement' in nodeIn(draft(), 'a')!).toBe(false);
    expect(get(toast).at(-1)?.message).toBe('Moved "A" to F');
  });

  it('empty space below the items of page 2 is the end of THAT page', () => {
    setFolderPage('d1', 'F', 1);
    start('a');
    hit = onPage(['k5', 'k6', 'k7', 'k8'], 1, 4);
    moveTo(50, 300 + 250); // below both rows
    expect(get(drag)!.target).toMatchObject({ kind: 'place', index: 8 });
    drop(50, 550);
    expect(order('F').slice(6, 10)).toEqual(['k7', 'k8', 'a', 'k9']);
  });

  it('reorders within the folder (the index counts the items that stay); one undo step', () => {
    start('k1');
    hit = onPage(['k1', 'k2', 'k3', 'k4'], 0, 4, ['k1']);
    moveTo(105, 405); // k4's top-left
    expect(get(drag)!.target).toMatchObject({ kind: 'place', index: 2 });
    drop(105, 405);
    expect(order('F').slice(0, 4)).toEqual(['k2', 'k3', 'k1', 'k4']);
  });

  it('dropped back in its own place: no change, no undo step', () => {
    const before = draft();
    start('k2');
    hit = onPage(['k1', 'k2', 'k3', 'k4'], 0, 4, ['k2']);
    moveTo(5, 405); // k3: before k3 = where k2 already is
    expect(get(drag)!.target).toMatchObject({ kind: 'place', index: 1 });
    drop(5, 405);
    expect(draft()).toBe(before);
  });

  it('a page-bar hit is on the page: the drop goes at the end of the page shown', () => {
    start('a');
    const page = onPage(['k1', 'k2', 'k3', 'k4'], 0, 4);
    hit = (x, y) => ({ ...page(x, y), pageBar: { folderId: 'F', dir: 'next', page: 0, disabled: false } });
    moveTo(150, 300 + 230);
    expect(get(drag)!.target).toMatchObject({ kind: 'place', index: 4 });
  });

  it('a tile\'s centre held there is still a merge (unchanged)', () => {
    start('a');
    hit = onPage(['k1', 'k2', 'k3', 'k4'], 0, 4);
    moveTo(150, 350); // k2's centre
    expect(get(drag)!.target?.kind).toBe('place');
    vi.advanceTimersByTime(500);
    flush();
    expect(get(drag)!.target).toEqual({ kind: 'merge', targetTileId: 'k2' });
  });
});

describe('a drop on a folder\'s bar, a crumb, a sub-folder tile or an empty open folder: at the end', () => {
  const bar = (folderId: string): HitResult => ({
    container: { ref: { tabId: 't1' }, metrics: GRID, layout: 'grid', left: 0, top: 0 }, dx: 20, dy: 210,
    folderBar: { folderId, rect: { left: 0, top: 200, width: 400, height: 40 } }
  });

  it('its title bar: the end of the folder it shows, with an "Into" cue on the bar', async () => {
    render(DragLayer, { tabId: 't1' });
    start('a');
    hit = () => bar('F');
    moveTo(20, 210);
    expect(get(drag)!.target).toMatchObject({ kind: 'into-folder', folderId: 'F' });
    expect(get(drag)!.over).toEqual({ left: 0, top: 200, width: 400, height: 40 });
    await tick();
    expect(document.querySelector('.drag-layer .cue')?.textContent).toMatch(/Into "F"/);
    drop(20, 210);
    expect(order('F').at(-1)).toBe('a');
  });

  it('a crumb of its breadcrumb: the end of that level\'s folder', () => {
    setFolderDrill('d1', 'F', ['S']);
    start('a');
    hit = () => ({ container: null, dx: 0, dy: 0, folderCrumb: { folderId: 'F', to: 'F', rect: { left: 0, top: 200, width: 60, height: 30 } } });
    moveTo(20, 210);
    expect(get(drag)!.target).toMatchObject({ kind: 'into-folder', folderId: 'F' });
    drop(20, 210);
    expect(order('F').at(-1)).toBe('a');
  });

  it('a sub-folder\'s tile on the page (its centre): the end of the sub-folder', () => {
    start('a');
    const page = onPage(['k9', 'k10', 'S'], 2, 4);
    hit = page;
    moveTo(50, 450); // S's centre (third box: left 0, top 100)
    expect(get(drag)!.target).toMatchObject({ kind: 'into-folder', folderId: 'S' });
    drop(50, 450);
    expect(order('S')).toEqual(['z', 'a']);
  });

  it('an empty open folder: that folder', () => {
    start('a');
    hit = () => ({ container: null, dx: 0, dy: 0, emptyFolder: 'E' });
    moveTo(700, 400);
    expect(get(drag)!.target).toMatchObject({ kind: 'into-folder', folderId: 'E' });
    drop(700, 400);
    expect(order('E')).toEqual(['a']);
  });
});

describe('refusals: a folder never goes into itself or a descendant', () => {
  it.each([
    ['its own bar', (): HitResult => ({ container: null, dx: 0, dy: 0, folderBar: { folderId: 'G', rect: { left: 0, top: 0, width: 10, height: 10 } } })],
    ['a descendant\'s bar', (): HitResult => ({ container: null, dx: 0, dy: 0, folderBar: { folderId: 'H', rect: { left: 0, top: 0, width: 10, height: 10 } } })],
    ['a crumb of a descendant', (): HitResult => ({ container: null, dx: 0, dy: 0, folderCrumb: { folderId: 'G', to: 'H', rect: { left: 0, top: 0, width: 10, height: 10 } } })],
    ['a descendant\'s page', (): HitResult => ({
      container: { ref: { tabId: 't1', folderId: 'H' }, metrics: FLOW, layout: 'flow', left: 0, top: 0 }, dx: 5, dy: 5,
      flowPage: { folderId: 'H', page: 0, perPage: 4, count: 1, boxes: [{ id: 'h1', left: 0, top: 0, width: 100, height: 100 }] }
    })],
    ['an empty descendant', (): HitResult => ({ container: null, dx: 0, dy: 0, emptyFolder: 'H' })]
  ])('%s: refused with a visible reason; the drop changes nothing', async (_what, h) => {
    render(DragLayer, { tabId: 't1' });
    const before = draft();
    start('G');
    hit = h;
    moveTo(30, 30);
    expect(get(drag)!.target).toEqual({ kind: 'invalid', reason: "A folder can't go inside itself." });
    await tick();
    expect(document.querySelector('.drag-layer .reason')?.textContent).toBe("A folder can't go inside itself.");
    drop(30, 30);
    expect(draft()).toBe(before);
    expect(get(toast).at(-1)).toMatchObject({ type: 'error', message: "A folder can't go inside itself." });
  });
});

describe('dwell: the page bar and the breadcrumb', () => {
  const pageBarHit = (page: number, dir: 'prev' | 'next', disabled = false) => {
    const pg = onPage(['k1', 'k2', 'k3', 'k4'], page, 4);
    return (x: number, y: number): HitResult => ({ ...pg(x, y), pageBar: { folderId: 'F', dir, page, disabled } });
  };

  it('600 ms over › flips to the next page (599 does not); the drag goes on and drops on that page', () => {
    start('a');
    hit = pageBarHit(0, 'next');
    moveTo(150, 530);
    vi.advanceTimersByTime(OPEN_DWELL_MS - 1);
    expect(get(folderNavFor('d1')).page).toEqual({});
    vi.advanceTimersByTime(1);
    expect(get(folderNavFor('d1')).page).toEqual({ F: 1 });
    expect(get(drag)).not.toBeNull();
    // Page 2 is now drawn: holding on goes on to page 3; the drop lands on the page shown.
    hit = pageBarHit(1, 'next');
    flush();
    vi.advanceTimersByTime(OPEN_DWELL_MS);
    expect(get(folderNavFor('d1')).page).toEqual({ F: 2 });
    hit = onPage(['k9', 'k10', 'S'], 2, 4);
    moveTo(105, 305); // k10's top-left (not its centre): before k10
    drop(105, 305);
    expect(order('F').slice(8)).toEqual(['k9', 'a', 'k10', 'S']);
  });

  it('‹ goes back a page; a disabled end (first / last page) has no dwell', () => {
    setFolderPage('d1', 'F', 1);
    start('a');
    hit = pageBarHit(1, 'prev');
    moveTo(10, 530);
    vi.advanceTimersByTime(OPEN_DWELL_MS);
    expect(get(folderNavFor('d1')).page).toEqual({});
    hit = pageBarHit(0, 'prev', true);
    moveTo(12, 530);
    expect(get(drag)!.dwell).toBeUndefined();
  });

  it('600 ms over a crumb goes back up to that level (this browser\'s memory); the drag goes on', async () => {
    setFolderDrill('d1', 'F', ['S']);
    start('a');
    hit = () => ({ container: null, dx: 0, dy: 0, folderCrumb: { folderId: 'F', to: 'F', rect: { left: 0, top: 200, width: 60, height: 30 } } });
    moveTo(20, 210);
    expect(get(drag)!.dwell?.key).toMatch(/^fcrumb:/);
    vi.advanceTimersByTime(OPEN_DWELL_MS - 1);
    expect(get(folderNavFor('d1')).drill).toEqual({ F: ['S'] });
    vi.advanceTimersByTime(1);
    expect(get(folderNavFor('d1')).drill).toEqual({});
    expect(get(drag)).not.toBeNull();
  });

  it('holding a minimised folder\'s tile opens nothing (no pop-over, §3a.4)', () => {
    start('a');
    hit = onPage(['k9', 'k10', 'S'], 2, 4);
    moveTo(50, 450);
    vi.advanceTimersByTime(OPEN_DWELL_MS * 3);
    flush();
    expect(get(drag)!.dwell).toBeUndefined();
    expect(get(folderNavFor('d1')).drill).toEqual({});
  });
});

describe('a sub-folder dragged out to the tab (§3a.3)', () => {
  it('is minimised there, and this browser forgets that it was open, its page and its drill path', () => {
    setFolderView('d1', 'S', 'expanded');
    setFolderPage('d1', 'S', 1);
    setFolderDrill('d1', 'S', ['x']);
    setFolderView('d1', 'F', 'expanded');
    start('S');
    hit = (x, y) => ({ container: { ref: { tabId: 't1' }, metrics: GRID, layout: 'grid', left: 0, top: 0 }, dx: x, dy: y });
    sourceRect = { left: 0, top: 0, width: 100, height: 100 };
    moveTo(1000, 1000);
    expect(get(drag)!.target?.kind).toBe('place');
    drop(1000, 1000);
    const s = nodeIn(draft(), 'S') as FolderNode;
    expect(s.placement).toBeTruthy();
    expect(s.display).toBe('collapsed');
    expect(get(folderViewFor('d1'))).toEqual({ F: 'expanded' });
    expect(get(folderNavFor('d1'))).toEqual({ page: {}, drill: {} });
  });

  it('the same through the menu\'s Move (not only a drag)', () => {
    setFolderView('d1', 'S', 'expanded');
    setFolderPage('d1', 'S', 1);
    expect(moveOrCopyTo(['S'], { tabId: 't1' }, 'move')).toBe(true);
    expect((nodeIn(draft(), 'S') as FolderNode).display).toBe('collapsed');
    expect(get(folderViewFor('d1'))).toEqual({});
    expect(get(folderNavFor('d1')).page).toEqual({});
  });

  it('a sub-folder moved into another folder keeps its memory (it is still a sub-folder)', () => {
    setFolderPage('d1', 'S', 1);
    expect(moveOrCopyTo(['S'], { tabId: 't1', folderId: 'E' }, 'move')).toBe(true);
    expect(get(folderNavFor('d1')).page).toEqual({ S: 1 });
  });
});
