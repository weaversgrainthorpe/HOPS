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
});
