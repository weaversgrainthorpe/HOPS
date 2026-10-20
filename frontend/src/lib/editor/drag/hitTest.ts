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
  /** How it is drawn right now: phone stacking ignores the container's own mode. */
  layout: 'grid' | 'free' | 'stacked';
}

export interface HitResult {
  /** The container under the pointer, with its content-box origin in viewport px; null = none. */
  container: (ContainerInfo & { left: number; top: number }) | null;
  /** Pointer offset in px from the container's content-box origin. */
  dx: number;
  dy: number;
  /** The (non-dragged) node directly under the pointer inside that container, if any (Task 8: merge). */
  nodeId?: string;
}

export interface HitEnv {
  elementFromPoint(x: number, y: number): Element | null;
  rectOf(el: Element): { left: number; top: number };
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
  // Climb out of the outermost dragged node: a dragged folder never targets its own content.
  for (let e: Element | null = start; e; e = e.parentElement) {
    const id = e.getAttribute('data-node-id');
    if (id !== null && dragged.has(id)) start = e.parentElement;
  }
  if (!start) return NO_HIT;
  const cEl = start.closest('[data-container-id]');
  const info = cEl ? registry.get(cEl) : undefined;
  if (!cEl || !info) return NO_HIT;
  let nodeId: string | undefined;
  const nEl = start.closest('[data-node-id]');
  if (nEl && cEl.contains(nEl) && nEl !== cEl) nodeId = nEl.getAttribute('data-node-id') ?? undefined;
  const r = env.rectOf(cEl);
  const out: HitResult = { container: { ...info, left: r.left, top: r.top }, dx: x - r.left, dy: y - r.top };
  if (nodeId !== undefined) out.nodeId = nodeId;
  return out;
}
