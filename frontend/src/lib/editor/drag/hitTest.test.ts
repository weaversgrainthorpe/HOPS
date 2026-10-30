import { describe, it, expect, afterEach } from 'vitest';
import { containerMetrics } from '$lib/layout/geometry';
import { hitTest, registerContainer, unregisterContainer, type HitEnv, type ContainerInfo } from './hitTest';

const gridMetrics = containerMetrics({ columns: 24, children: [] }, 1200);

function el(attrs: Record<string, string>, ...kids: HTMLElement[]): HTMLElement {
  const e = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  kids.forEach((k) => e.appendChild(k));
  return e;
}

/** A stub env: elementFromPoint returns `under`; every rect comes from `rects` (default 0,0). */
function env(under: Element | null, rects: Map<Element, { left: number; top: number }> = new Map()): HitEnv {
  return {
    elementFromPoint: () => under,
    rectOf: (e) => rects.get(e) ?? { left: 0, top: 0 }
  };
}

const registered: Element[] = [];
function reg(e: Element, info: ContainerInfo) {
  registerContainer(e, info);
  registered.push(e);
}

afterEach(() => {
  registered.splice(0).forEach(unregisterContainer);
  document.body.innerHTML = '';
});

describe('hitTest', () => {
  it('returns the registered container under the pointer and the offset from its content origin', () => {
    const inner = el({ 'data-node-id': 'a' }, el({ class: 'face' }));
    const root = el({ 'data-container-id': 't1' }, inner);
    document.body.appendChild(root);
    reg(root, { ref: { tabId: 't1' }, metrics: gridMetrics, layout: 'grid' });
    const h = hitTest(250, 140, new Set(['zzz']), env(inner.firstElementChild, new Map([[root, { left: 20, top: 40 }]])));
    expect(h.container?.ref).toEqual({ tabId: 't1' });
    expect(h.container?.metrics).toBe(gridMetrics);
    expect(h.container?.layout).toBe('grid');
    expect(h.dx).toBe(230);
    expect(h.dy).toBe(100);
    expect(h.nodeId).toBe('a');
  });

  it('climbs out of a dragged node, so a dragged folder never targets its own content', () => {
    const tileInFolder = el({ 'data-node-id': 'x' });
    const folderContent = el({ 'data-container-id': 'f1' }, tileInFolder);
    const folder = el({ 'data-node-id': 'f1' }, folderContent);
    const root = el({ 'data-container-id': 't1' }, folder);
    document.body.appendChild(root);
    reg(root, { ref: { tabId: 't1' }, metrics: gridMetrics, layout: 'grid' });
    reg(folderContent, { ref: { tabId: 't1', folderId: 'f1' }, metrics: gridMetrics, layout: 'grid' });
    const h = hitTest(10, 10, new Set(['f1']), env(tileInFolder));
    expect(h.container?.ref).toEqual({ tabId: 't1' });
    expect(h.nodeId).toBeUndefined();
    // not dragged: the folder's content is the target, and the tile under the pointer is reported
    const h2 = hitTest(10, 10, new Set(['other']), env(tileInFolder));
    expect(h2.container?.ref).toEqual({ tabId: 't1', folderId: 'f1' });
    expect(h2.nodeId).toBe('x');
  });

  it('a drop area is its container: the canvas below the last row, and a folder body below its items (dragout-debug)', () => {
    // canvas panel [area] > root grid > folder [node] > body [area] > folder grid > tile
    const tile = el({ 'data-node-id': 'e1' });
    const folderGrid = el({ 'data-container-id': 'f1' }, tile);
    const body = el({ 'data-drop-area': '' }, folderGrid);
    const header = el({ class: 'folder-header' });
    const folder = el({ 'data-node-id': 'f1' }, header, body);
    const root = el({ 'data-container-id': 't1' }, folder);
    const panel = el({ 'data-drop-area': '' }, root);
    document.body.appendChild(panel);
    reg(root, { ref: { tabId: 't1' }, metrics: gridMetrics, layout: 'grid' });
    reg(folderGrid, { ref: { tabId: 't1', folderId: 'f1' }, metrics: gridMetrics, layout: 'grid' });
    const rects = new Map([[root, { left: 20, top: 40 }], [folderGrid, { left: 30, top: 300 }]]);
    // The panel below the root grid's last row: the root, offset from the root grid's origin.
    const below = hitTest(500, 900, new Set(), env(panel, rects));
    expect(below.container?.ref).toEqual({ tabId: 't1' });
    expect(below.dx).toBe(480);
    expect(below.dy).toBe(860);
    expect(below.nodeId).toBeUndefined();
    // A folder's body below its items: that folder, not the canvas (and no node: not a merge target).
    const inBody = hitTest(100, 600, new Set(), env(body, rects));
    expect(inBody.container?.ref).toEqual({ tabId: 't1', folderId: 'f1' });
    expect(inBody.dy).toBe(300);
    expect(inBody.nodeId).toBeUndefined();
    // The folder's header is still the canvas, over the folder (the merge / into-folder zones).
    const onHeader = hitTest(100, 320, new Set(), env(header, rects));
    expect(onHeader.container?.ref).toEqual({ tabId: 't1' });
    expect(onHeader.nodeId).toBe('f1');
    // A tile inside the folder: the folder's grid, as before.
    expect(hitTest(40, 310, new Set(), env(tile, rects)).container?.ref).toEqual({ tabId: 't1', folderId: 'f1' });
    // The folder itself dragged: its own body is never a target (the canvas is).
    expect(hitTest(100, 600, new Set(['f1']), env(body, rects)).container?.ref).toEqual({ tabId: 't1' });
  });

  it('nothing under the pointer, or an unregistered container, is no container', () => {
    expect(hitTest(0, 0, new Set(), env(null)).container).toBeNull();
    const stray = el({ 'data-container-id': 'zz' });
    document.body.appendChild(stray);
    expect(hitTest(0, 0, new Set(), env(stray)).container).toBeNull();
  });

  it('reports the rendered box of the node under the pointer, relative to the container (zones)', () => {
    const cell = el({ 'data-node-id': 'b' });
    const root = el({ 'data-container-id': 't1' }, cell);
    document.body.appendChild(root);
    reg(root, { ref: { tabId: 't1' }, metrics: gridMetrics, layout: 'grid' });
    const rects = new Map<Element, { left: number; top: number; width?: number; height?: number }>([
      [root, { left: 20, top: 40 }],
      [cell, { left: 120, top: 40, width: 100, height: 100 }]
    ]);
    const h = hitTest(170, 90, new Set(), { elementFromPoint: () => cell, rectOf: (e) => rects.get(e) ?? { left: 0, top: 0 } });
    expect(h.node).toEqual({ id: 'b', left: 100, top: 0, width: 100, height: 100 });
  });

  it('a tab\'s edit handle and padding count as the tab: it is resolved through its [data-drag-tabbox]', () => {
    // Real-browser bug: controls beside the tab button were hit by elementFromPoint (not inside
    // [data-drag-tab]) and no tab was hit. The tab's edit handle sits in the same box.
    const icon = el({ class: 'svg' });
    const dup = el({ class: 'edit-handle inline', 'data-edit-handle': '' }, icon);
    const controls = el({ class: 'tab-handle-slot' }, dup);
    const tab = el({ 'data-drag-tab': 't2' }, el({ class: 'tab-name' }));
    const tabbox = el({ 'data-drag-tabbox': 't2' }, tab, controls);
    const bar = el({ 'data-drag-tabbar': '' }, tabbox);
    document.body.append(bar);
    const rects = new Map<Element, { left: number; top: number; width: number; height: number }>([
      [tab, { left: 118, top: 117, width: 83, height: 48 }],
      [tabbox, { left: 118, top: 117, width: 99, height: 48 }]
    ]);
    const envAt = (under: Element): HitEnv => ({ elementFromPoint: () => under, rectOf: (e) => rects.get(e) ?? { left: 0, top: 0 } });
    for (const under of [icon, dup, controls, tabbox]) {
      const h = hitTest(160, 141, new Set(), envAt(under));
      expect(h.tabId).toBe('t2');
      expect(h.tabRect).toEqual({ left: 118, top: 117, width: 83, height: 48 });
      expect(h.tabBar).toBeUndefined();
    }
  });

  it('a crumb, a tab button and the tab bar are navigation hits', () => {
    const crumb = el({ 'data-drag-crumb': 'tab:t1' }, el({}));
    const tab = el({ 'data-drag-tab': 't2' }, el({}));
    const bar = el({ 'data-drag-tabbar': '' }, tab);
    document.body.append(crumb, bar);
    expect(hitTest(0, 0, new Set(), env(crumb.firstElementChild)).crumb).toBe('tab:t1');
    const rects = new Map([[tab, { left: 100, top: 0, width: 80, height: 40 }]]);
    const h = hitTest(0, 0, new Set(), { elementFromPoint: () => tab.firstElementChild, rectOf: (e) => rects.get(e as HTMLElement) ?? { left: 0, top: 0 } });
    expect(h.tabId).toBe('t2');
    expect(h.tabRect).toEqual({ left: 100, top: 0, width: 80, height: 40 });
    expect(hitTest(0, 0, new Set(), env(bar)).tabBar).toBe(true);
  });

  it('a hit inside the tab rail reports the rail', () => {
    const arrow = document.createElement('button');
    arrow.setAttribute('data-rail-arrow', 'prev');
    const tab = el({ 'data-drag-tab': 't2' }, el({}));
    const tabbox = el({ 'data-drag-tabbox': 't2' }, tab);
    const bar = el({ 'data-drag-tabbar': '' }, tabbox);
    const rail = el({ 'data-drag-tabrail': '' }, arrow, bar);
    document.body.append(rail);
    const onArrow = hitTest(0, 0, new Set(), env(arrow));
    expect(onArrow.tabRail).toBe(rail);
    expect(onArrow.tabBar).toBe(true);
    const onTab = hitTest(0, 0, new Set(), env(tab.firstElementChild));
    expect(onTab.tabRail).toBe(rail);
    expect(onTab.tabId).toBe('t2');
    expect(hitTest(0, 0, new Set(), env(bar)).tabRail).toBe(rail);
    // A tab bar outside any rail has none.
    const lone = el({ 'data-drag-tabbar': '' });
    document.body.append(lone);
    expect(hitTest(0, 0, new Set(), env(lone)).tabRail).toBeUndefined();
  });

  it('on a rail arrow, only the visible part of the row is a tab target', () => {
    const next = document.createElement('button');
    next.setAttribute('data-rail-arrow', 'next');
    const box = (id: string) => el({ 'data-drag-tabbox': id }, el({ 'data-drag-tab': id }));
    const [a, b, c] = [box('a'), box('b'), box('c')];
    const bar = el({ 'data-drag-tabbar': '' }, a, b, c);
    const rail = el({ 'data-drag-tabrail': '' }, bar, next);
    document.body.append(rail);
    // The strip shows x 0–250: a fully, b in part, c not at all (scrolled out of view, under the arrow).
    const rects = new Map<Element, { left: number; top: number; width: number; height: number }>([
      [bar, { left: 0, top: 0, width: 250, height: 40 }],
      [a, { left: 0, top: 0, width: 150, height: 40 }],
      [b, { left: 150, top: 0, width: 150, height: 40 }],
      [c, { left: 300, top: 0, width: 150, height: 40 }]
    ]);
    const envAt = (under: Element): HitEnv => ({ elementFromPoint: () => under, rectOf: (e) => rects.get(e) ?? { left: 0, top: 0 } });
    const h = hitTest(320, 20, new Set(), envAt(next));
    expect(h.tabBoxes).toEqual([
      { id: 'a', left: 0, top: 0, width: 150, height: 40 },
      { id: 'b', left: 150, top: 0, width: 100, height: 40 }
    ]);
    // Inside the strip itself every box counts, as before.
    expect(hitTest(100, 20, new Set(), envAt(bar)).tabBoxes?.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('reports the scrollable panel holding the container', () => {
    const root = el({ 'data-container-id': 'c1' });
    const body = el({ 'data-drag-scroll': '' }, root);
    document.body.appendChild(body);
    reg(root, { ref: { tabId: 't1', folderId: 'c1' }, metrics: gridMetrics, layout: 'grid' });
    expect(hitTest(0, 0, new Set(), env(root)).scroller).toBe(body);
  });

  it('inside the tab bar, reports every tab box in bar order', () => {
    const b1 = el({ 'data-drag-tabbox': 't1' }, el({ 'data-drag-tab': 't1' }));
    const ctl = el({ class: 'edit-handle inline', 'data-edit-handle': '' });
    const b2 = el({ 'data-drag-tabbox': 't2' }, el({ 'data-drag-tab': 't2' }), ctl);
    const bar = el({ 'data-drag-tabbar': '' }, b1, b2);
    document.body.append(bar);
    const rects = new Map<Element, { left: number; top: number; width: number; height: number }>([
      [b1, { left: 0, top: 0, width: 150, height: 40 }],
      [b2, { left: 160, top: 0, width: 150, height: 40 }]
    ]);
    // A tab's edit handle counts as that tab (through its tabbox), and the boxes are still reported.
    const h = hitTest(300, 10, new Set(), { elementFromPoint: () => ctl, rectOf: (e) => rects.get(e) ?? { left: 0, top: 0 } });
    expect(h.tabId).toBe('t2');
    // Between the tabs (the bar itself), it is the tab bar.
    expect(hitTest(155, 10, new Set(), { elementFromPoint: () => bar, rectOf: (e) => rects.get(e) ?? { left: 0, top: 0 } }).tabBar).toBe(true);
    expect(h.tabBoxes?.map((b) => [b.id, b.left])).toEqual([['t1', 0], ['t2', 160]]);
  });

  // An open folder (Folder.svelte) exposes its title bar, its breadcrumb's crumbs, its page
  // bar and the page it shows; the drag reads them here (the only layout reads).
  describe('an open folder', () => {
    const flowMetrics = { columns: 8, unitPx: 50, rowPx: 50, innerWidthPx: 400, flow: { span: 2, perRow: 4 } };
    function openFolder(opts: { empty?: boolean; prevDisabled?: boolean } = {}) {
      const items = ['k5', 'k6', 'k7'].map((id) => el({ 'data-node-id': id }, el({ class: 'face' })));
      const flow = el({ 'data-container-id': 'f1' }, ...items);
      const page = el({ class: 'page' }, flow);
      const prev = el({ 'data-page-bar': 'prev' });
      if (opts.prevDisabled) prev.setAttribute('disabled', '');
      const next = el({ 'data-page-bar': 'next', disabled: '' });
      const pageBar = el({ class: 'page-bar' }, prev, next);
      const body = el(
        { class: 'folder-body', 'data-drop-area': '', 'data-folder-id': 's1', 'data-folder-page': '1', 'data-folder-per-page': '4' },
        ...(opts.empty ? [] : [page]), pageBar
      );
      const crumbTop = el({ 'data-crumb': 'f1' });
      const header = el({ class: 'folder-header', 'data-folder-bar': 's1' }, el({ class: 'crumbs' }, crumbTop));
      const folder = el({ 'data-node-id': 'f1' }, header, body);
      const root = el({ 'data-container-id': 't1' }, folder);
      document.body.appendChild(root);
      reg(root, { ref: { tabId: 't1' }, metrics: gridMetrics, layout: 'grid' });
      if (!opts.empty) reg(flow, { ref: { tabId: 't1', folderId: 's1' }, metrics: flowMetrics, layout: 'flow' });
      const rects = new Map<Element, { left: number; top: number; width?: number; height?: number }>([
        [root, { left: 0, top: 0 }],
        [flow, { left: 20, top: 100 }],
        [header, { left: 10, top: 50, width: 400, height: 40 }],
        [body, { left: 15, top: 95, width: 390, height: 300 }],
        [crumbTop, { left: 20, top: 55, width: 60, height: 30 }],
        [items[0], { left: 20, top: 100, width: 100, height: 100 }],
        [items[1], { left: 120, top: 100, width: 100, height: 100 }],
        [items[2], { left: 220, top: 100, width: 100, height: 100 }]
      ]);
      const at = (under: Element, dragged: string[] = []) =>
        hitTest(150, 150, new Set(dragged), { elementFromPoint: () => under, rectOf: (e) => rects.get(e) ?? { left: 0, top: 0 } });
      return { items, flow, header, crumbTop, prev, next, body, at };
    }

    it('its title bar: a drop target for the folder it shows (data-folder-bar), over the canvas', () => {
      const f = openFolder();
      const h = f.at(f.header);
      expect(h.folderBar).toEqual({ folderId: 's1', rect: { left: 10, top: 50, width: 400, height: 40 } });
      expect(h.container?.ref).toEqual({ tabId: 't1' });
      expect(h.nodeId).toBe('f1');
    });

    it('a crumb of its breadcrumb: the open folder and the level it goes back to', () => {
      const f = openFolder();
      const h = f.at(f.crumbTop);
      expect(h.folderCrumb).toEqual({ folderId: 'f1', to: 'f1', rect: { left: 20, top: 55, width: 60, height: 30 } });
    });

    // Drilled in, every level is an inset box (Folder.svelte's DOM): the outer bars are go-up
    // targets of the TOP folder (inset boxes carry no data-node-id); each box's minimise is
    // part of its bar, never a target of its own; the page, and the outer body's padding, are the
    // innermost box's.
    it('nested boxes: outer bars go up (for the top folder); a drop anywhere in the body is the innermost', () => {
      const items = ['k1', 'k2'].map((id) => el({ 'data-node-id': id }, el({ class: 'face' })));
      const flow = el({ 'data-container-id': 's2' }, ...items);
      const min2 = el({ class: 'folder-controls' }, el({ 'aria-label': 'Minimise s2' }));
      const head2 = el({ class: 'nested-header', 'data-folder-bar': 's2' }, min2);
      const body2 = el({ class: 'nested-body', 'data-folder-id': 's2', 'data-folder-page': '0', 'data-folder-per-page': '6' }, el({ class: 'page' }, flow));
      const box2 = el({ class: 'nested-box', 'data-nested-folder': 's2' }, head2, body2);
      const min1 = el({ class: 'folder-controls' }, el({ 'aria-label': 'Minimise s1' }));
      const head1 = el({ class: 'nested-header', 'data-crumb': 's1' }, min1);
      const box1 = el({ class: 'nested-box', 'data-nested-folder': 's1' }, head1, el({ class: 'nested-body' }, box2));
      const top = el({ class: 'folder-header', 'data-crumb': 'f1' });
      const body = el({ class: 'folder-body', 'data-drop-area': '', 'data-folder-id': 's2' }, box1);
      const folder = el({ 'data-node-id': 'f1' }, top, body);
      const root = el({ 'data-container-id': 't1' }, folder);
      document.body.appendChild(root);
      reg(root, { ref: { tabId: 't1' }, metrics: gridMetrics, layout: 'grid' });
      reg(flow, { ref: { tabId: 't1', folderId: 's2' }, metrics: flowMetrics, layout: 'flow' });
      const at = (under: Element) => hitTest(150, 150, new Set(), { elementFromPoint: () => under, rectOf: () => ({ left: 0, top: 0, width: 10, height: 10 }) });
      expect(at(top).folderCrumb).toMatchObject({ folderId: 'f1', to: 'f1' });
      expect(at(head1).folderCrumb).toMatchObject({ folderId: 'f1', to: 's1' });
      expect(at(min1.firstElementChild!).folderCrumb).toMatchObject({ folderId: 'f1', to: 's1' });
      expect(at(min2.firstElementChild!).folderBar).toMatchObject({ folderId: 's2' });
      expect(at(min2.firstElementChild!).folderCrumb).toBeUndefined();
      expect(at(head2).folderBar).toMatchObject({ folderId: 's2' });
      expect(at(head2).folderCrumb).toBeUndefined();
      expect(at(items[1].firstElementChild!).flowPage).toMatchObject({ folderId: 's2', page: 0, perPage: 6 });
      // The outer body's padding and an outer inset box's padding: the innermost page, never the canvas.
      expect(at(body).container?.ref).toEqual({ tabId: 't1', folderId: 's2' });
      expect(at(box1).container?.ref).toEqual({ tabId: 't1', folderId: 's2' });
      root.remove();
    });

    it('its page bar\'s ‹ ›: the folder shown, its page, the direction and whether it can go that way', () => {
      const f = openFolder();
      expect(f.at(f.prev).pageBar).toEqual({ folderId: 's1', dir: 'prev', page: 1, disabled: false });
      expect(f.at(f.next).pageBar).toEqual({ folderId: 's1', dir: 'next', page: 1, disabled: true });
      // ...and it is inside the folder's body, so a drop there is a drop on that page.
      expect(f.at(f.next).container?.ref).toEqual({ tabId: 't1', folderId: 's1' });
    });

    it('its page: the page shown, its size, how many it draws, and the boxes of the items not dragged', () => {
      const f = openFolder();
      const h = f.at(f.items[1].firstElementChild!, ['k6']);
      expect(h.container?.layout).toBe('flow');
      expect(h.flowPage).toEqual({
        folderId: 's1', page: 1, perPage: 4, count: 3,
        boxes: [
          { id: 'k5', left: 0, top: 0, width: 100, height: 100 },
          { id: 'k7', left: 200, top: 0, width: 100, height: 100 }
        ]
      });
    });

    it('an empty open folder\'s body is that folder (never the canvas under it)', () => {
      const f = openFolder({ empty: true });
      const h = f.at(f.body);
      // With its rect: the "Into" cue is drawn on the body (never a cue-less target).
      expect(h.emptyFolder).toEqual({ folderId: 's1', rect: { left: 15, top: 95, width: 390, height: 300 } });
      expect(h.container).toBeNull();
    });

    it('the folder itself dragged: none of its own bar, crumbs or page is a target', () => {
      const f = openFolder();
      for (const under of [f.header, f.crumbTop, f.next, f.items[0]]) {
        const h = f.at(under, ['f1']);
        expect(h.folderBar).toBeUndefined();
        expect(h.folderCrumb).toBeUndefined();
        expect(h.pageBar).toBeUndefined();
        expect(h.flowPage).toBeUndefined();
        expect(h.container?.ref).toEqual({ tabId: 't1' });
      }
    });
  });
});
