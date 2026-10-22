/**
 * Drag hit-testing. Every container the editing renderer draws registers the geometry it was
 * drawn with (the ContainerMetrics from geometry.ts — the one sizing source), keyed by its
 * `data-container-id` element. A hit test asks the DOM which element is under the pointer
 * (elementFromPoint), climbs to the nearest registered container that is not inside a dragged
 * node, and reports the pointer's offset from that container's content-box origin. Converting
 * that offset to cells is resolveDrop's job (pointToCell / the metrics), so there is no second
 * sizing path. Layout is read here only — the drag controller calls this once per animation frame.
 */
import type { ContainerMetrics } from '$lib/layout/geometry';
import type { ContainerRef } from '../treeOps';

export interface ContainerInfo {
  ref: ContainerRef;
  /** The metrics the container was RENDERED with (Ruling 13: hit-testing uses rendered geometry). */
  metrics: ContainerMetrics;
  /** How it is drawn right now: a tab's grid, a folder's ordered flow, or phone stacking. */
  layout: 'grid' | 'flow' | 'stacked';
}

export interface HitResult {
  /** The container under the pointer, with its content-box origin in viewport px; null = none. */
  container: (ContainerInfo & { left: number; top: number }) | null;
  /** Pointer offset in px from the container's content-box origin. */
  dx: number;
  dy: number;
  /** The (non-dragged) node directly under the pointer inside that container, if any (Task 8: merge). */
  nodeId?: string;
  /** That node's RENDERED box in px from the container's content origin (Ruling 13: a collapsed folder = one Medium tile). */
  node?: { id: string; left: number; top: number; width: number; height: number };
  /**
   * Item drags only (set by the drag controller's frame, not by hitTest): the item under the dragged
   * item's VISUAL centre (the ghost's centre), viewport px; null = none there. Absent = the centre is
   * the pointer, so `node` is that item. The merge / into-folder zone is judged by this (Ruling 29).
   */
  centreNode?: { id: string; left: number; top: number; width: number; height: number } | null;
  /** A tab under the pointer (its `data-drag-tab` button, or anything in its `data-drag-tabbox`), with the button's viewport box. */
  tabId?: string;
  tabRect?: { left: number; top: number; width: number; height: number };
  /** The tab bar itself (`data-drag-tabbar`) is under the pointer, between or after the tabs. */
  tabBar?: boolean;
  /**
   * Inside the tab bar: every tab's box (`data-drag-tabbox`: the tab button plus its controls), in
   * bar order, viewport px. Tab reorder resolves to the nearest gap from these.
   */
  tabBoxes?: { id: string; left: number; top: number; width: number; height: number }[];
  /** The open folder overlay whose panel is under the pointer (`data-drag-panel`). */
  panel?: string;
  /** A drag-breadcrumb crumb under the pointer (`data-drag-crumb`: "tab:<id>" or "folder:<depth>"). */
  crumb?: string;
  /** An open folder overlay's backdrop (outside its panel) is under the pointer (`data-drag-outside`). */
  outside?: boolean;
  /**
   * A STACKED container (phones): the rendered boxes of its own items (its direct `data-node-id`
   * children, minus dragged ones) in px from its content origin, in DOM (= reading) order. A drop
   * goes before / after the nearest one.
   */
  stackBoxes?: { id: string; left: number; top: number; width: number; height: number }[];
  /** The scrollable panel (`data-drag-scroll`) holding the container, for auto-scroll. */
  scroller?: Element;
}

export interface HitEnv {
  elementFromPoint(x: number, y: number): Element | null;
  rectOf(el: Element): { left: number; top: number; width?: number; height?: number };
}

export const domHitEnv: HitEnv = {
  elementFromPoint: (x, y) => (typeof document !== 'undefined' ? document.elementFromPoint(x, y) : null),
  rectOf: (el) => el.getBoundingClientRect()
};

const registry = new WeakMap<Element, ContainerInfo>();

export function registerContainer(el: Element, info: ContainerInfo): void {
  registry.set(el, info);
}

export function unregisterContainer(el: Element): void {
  registry.delete(el);
}

/** Svelte action for a container element: keeps its rendered geometry registered. */
export function dropContainer(el: HTMLElement, info: ContainerInfo) {
  registerContainer(el, info);
  return {
    update(next: ContainerInfo) {
      registerContainer(el, next);
    },
    destroy() {
      unregisterContainer(el);
    }
  };
}

const NO_HIT: HitResult = { container: null, dx: 0, dy: 0 };

/** What is under viewport point (x, y), ignoring the dragged nodes and everything inside them. */
export function hitTest(x: number, y: number, dragged: ReadonlySet<string>, env: HitEnv = domHitEnv): HitResult {
  let start: Element | null = env.elementFromPoint(x, y);
  if (!start) return NO_HIT;
  // Navigation targets outside any container: a breadcrumb crumb, a tab button, the tab bar.
  const crumbEl = start.closest('[data-drag-crumb]');
  if (crumbEl) return { ...NO_HIT, crumb: crumbEl.getAttribute('data-drag-crumb') ?? '' };
  const bar = start.closest('[data-drag-tabbar]');
  // A tab is its whole box (`data-drag-tabbox`: the button plus its controls and padding), so a
  // control drawn over the button never hides the tab from a drop (real-browser bug, Ruling 29).
  const tabBox = start.closest('[data-drag-tabbox]');
  const tabEl =
    start.closest('[data-drag-tab]') ?? (tabBox?.getAttribute('data-drag-tabbox') ? tabBox.querySelector('[data-drag-tab]') : null);
  const boxes = (): Pick<HitResult, 'tabBoxes'> => {
    if (!bar) return {};
    return {
      tabBoxes: Array.from(bar.querySelectorAll('[data-drag-tabbox]')).map((b) => {
        const r = env.rectOf(b);
        return { id: b.getAttribute('data-drag-tabbox') ?? '', left: r.left, top: r.top, width: r.width ?? 0, height: r.height ?? 0 };
      })
    };
  };
  if (tabEl) {
    const r = env.rectOf(tabEl);
    return {
      ...NO_HIT,
      tabId: tabEl.getAttribute('data-drag-tab') ?? '',
      tabRect: { left: r.left, top: r.top, width: r.width ?? 0, height: r.height ?? 0 },
      ...boxes()
    };
  }
  if (bar) return { ...NO_HIT, tabBar: true, ...boxes() };
  const panelId = start.closest('[data-drag-panel]')?.getAttribute('data-drag-panel') ?? undefined;
  const withPanel = (h: HitResult): HitResult => (panelId !== undefined ? { ...h, panel: panelId } : h);
  // Climb out of the outermost dragged node: a dragged folder never targets its own content.
  for (let e: Element | null = start; e; e = e.parentElement) {
    const id = e.getAttribute('data-node-id');
    if (id !== null && dragged.has(id)) start = e.parentElement;
  }
  if (!start) return NO_HIT;
  let cEl = start.closest('[data-container-id]');
  // A container element is only as tall as the rows its items fill, but it is DRAWN in a larger
  // space (`data-drop-area`: the canvas panel, an expanded folder's body, an overlay's body). That
  // whole space is the container's: the canvas below the last row is the canvas, and a folder's
  // empty space below its items is that folder — never "not allowed", never the folder's parent.
  // An area nested deeper than the container found (a folder body inside the canvas) wins.
  const area = start.closest('[data-drop-area]');
  if (area && (!cEl || !area.contains(cEl))) {
    const own = area.querySelector('[data-container-id]');
    if (own && registry.has(own)) cEl = own;
  }
  const info = cEl ? registry.get(cEl) : undefined;
  if (!cEl || !info) {
    // Over an open overlay's backdrop (not its panel): "dragging out" of that folder.
    const back = start.closest('[data-drag-outside]');
    return back && back === start ? { ...NO_HIT, outside: true } : withPanel(NO_HIT);
  }
  let nodeId: string | undefined;
  const nEl = start.closest('[data-node-id]');
  if (nEl && cEl.contains(nEl) && nEl !== cEl) nodeId = nEl.getAttribute('data-node-id') ?? undefined;
  const r = env.rectOf(cEl);
  const out: HitResult = { container: { ...info, left: r.left, top: r.top }, dx: x - r.left, dy: y - r.top };
  if (nodeId !== undefined && nEl) {
    out.nodeId = nodeId;
    const nr = env.rectOf(nEl);
    out.node = { id: nodeId, left: nr.left - r.left, top: nr.top - r.top, width: nr.width ?? 0, height: nr.height ?? 0 };
  }
  if (info.layout === 'stacked') {
    out.stackBoxes = [];
    for (const k of Array.from(cEl.children)) {
      const id = k.getAttribute('data-node-id');
      if (id === null || dragged.has(id)) continue;
      const kr = env.rectOf(k);
      out.stackBoxes.push({ id, left: kr.left - r.left, top: kr.top - r.top, width: kr.width ?? 0, height: kr.height ?? 0 });
    }
  }
  const scroller = cEl.closest('[data-drag-scroll]');
  if (scroller) out.scroller = scroller;
  return withPanel(out);
}
