import { describe, it, expect, afterEach } from 'vitest';
import { containerMetrics } from '$lib/layout/geometry';
import { hitTest, registerContainer, unregisterContainer, type HitEnv, type ContainerInfo } from './hitTest';

const gridMetrics = containerMetrics({ columns: 12, children: [] }, 'grid', 1200);

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

  it('nothing under the pointer, or an unregistered container, is no container', () => {
    expect(hitTest(0, 0, new Set(), env(null)).container).toBeNull();
    const stray = el({ 'data-container-id': 'zz' });
    document.body.appendChild(stray);
    expect(hitTest(0, 0, new Set(), env(stray)).container).toBeNull();
  });

  it('reports the rendered box of the node under the pointer, relative to the container (Task 8 zones)', () => {
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
    // Real-browser bug (M3): controls beside the tab button were hit by elementFromPoint (not inside
    // [data-drag-tab]) and no tab was hit. The tab's edit handle (§4B) sits in the same box.
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

  it('a crumb, a tab button, the tab bar and an overlay backdrop are navigation hits', () => {
    const crumb = el({ 'data-drag-crumb': 'tab:t1' }, el({}));
    const tab = el({ 'data-drag-tab': 't2' }, el({}));
    const bar = el({ 'data-drag-tabbar': '' }, tab);
    const back = el({ 'data-drag-outside': 'c1' }, el({ 'data-container-id': 'c1' }));
    document.body.append(crumb, bar, back);
    expect(hitTest(0, 0, new Set(), env(crumb.firstElementChild)).crumb).toBe('tab:t1');
    const rects = new Map([[tab, { left: 100, top: 0, width: 80, height: 40 }]]);
    const h = hitTest(0, 0, new Set(), { elementFromPoint: () => tab.firstElementChild, rectOf: (e) => rects.get(e as HTMLElement) ?? { left: 0, top: 0 } });
    expect(h.tabId).toBe('t2');
    expect(h.tabRect).toEqual({ left: 100, top: 0, width: 80, height: 40 });
    expect(hitTest(0, 0, new Set(), env(bar)).tabBar).toBe(true);
    expect(hitTest(0, 0, new Set(), env(back)).outside).toBe(true);
    // inside the panel (not the backdrop itself) is not "outside"
    expect(hitTest(0, 0, new Set(), env(back.firstElementChild)).outside).toBeUndefined();
  });

  it('reports the scrollable panel holding the container', () => {
    const root = el({ 'data-container-id': 'c1' });
    const body = el({ 'data-drag-scroll': '' }, root);
    document.body.appendChild(body);
    reg(root, { ref: { tabId: 't1', folderId: 'c1' }, metrics: gridMetrics, layout: 'grid' });
    expect(hitTest(0, 0, new Set(), env(root)).scroller).toBe(body);
  });

  it('inside the tab bar, reports every tab box in bar order; inside an overlay panel, its folder id', () => {
    const b1 = el({ 'data-drag-tabbox': 't1' }, el({ 'data-drag-tab': 't1' }));
    const ctl = el({ class: 'edit-handle inline', 'data-edit-handle': '' });
    const b2 = el({ 'data-drag-tabbox': 't2' }, el({ 'data-drag-tab': 't2' }), ctl);
    const bar = el({ 'data-drag-tabbar': '' }, b1, b2);
    const root = el({ 'data-container-id': 'c1' });
    const panel = el({ 'data-drag-panel': 'c1' }, el({ class: 'header' }), root);
    document.body.append(bar, panel);
    reg(root, { ref: { tabId: 't1', folderId: 'c1' }, metrics: gridMetrics, layout: 'grid' });
    const rects = new Map<Element, { left: number; top: number; width: number; height: number }>([
      [b1, { left: 0, top: 0, width: 150, height: 40 }],
      [b2, { left: 160, top: 0, width: 150, height: 40 }]
    ]);
    // Ruling 29: a tab's edit handle counts as that tab (through its tabbox), and the boxes are still reported.
    const h = hitTest(300, 10, new Set(), { elementFromPoint: () => ctl, rectOf: (e) => rects.get(e) ?? { left: 0, top: 0 } });
    expect(h.tabId).toBe('t2');
    // Between the tabs (the bar itself), it is the tab bar.
    expect(hitTest(155, 10, new Set(), { elementFromPoint: () => bar, rectOf: (e) => rects.get(e) ?? { left: 0, top: 0 } }).tabBar).toBe(true);
    expect(h.tabBoxes?.map((b) => [b.id, b.left])).toEqual([['t1', 0], ['t2', 160]]);
    expect(hitTest(0, 0, new Set(), env(root)).panel).toBe('c1');
    expect(hitTest(0, 0, new Set(), env(panel.firstElementChild)).panel).toBe('c1'); // the header: no container, still the panel
  });
});
