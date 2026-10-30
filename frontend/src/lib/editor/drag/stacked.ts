/**
 * Phone (stacked) drops: the stacked layout shows a container's items in READING ORDER (top-left
 * by row, then column), so a drop there means "put it at this place in the order". The stored
 * layout (what desktops show) still needs positions, so this module turns "insert at index k"
 * into placements, changing as little of the desktop layout as it can.
 *
 * Plans, tried in order (the caller trial-runs each through the real op and keeps the first whose
 * result has exactly the wanted reading order, so a drop never lands anywhere but the marker):
 *  1. gap: a free spot strictly between the neighbours in reading order — nothing else moves;
 *  2. rotate: the affected items swap positions along the order (same sizes: a compact reorder);
 *  3. reflow: from the insertion point on, each item takes the first free spot after the one
 *     before it (always possible: rows grow downward).
 * Only spots that overlap nothing are taken. Pure; no layout reads.
 */
import type { Container, Placement } from '$lib/types/layout';
import { clampPlacement, isPlaced, isRenderable, readingOrder } from '$lib/layout/geometry';

export interface StackPlan {
  /** Placements for the incoming items, in their order. */
  at: Placement[];
  /** Existing items in the container that move (the push map). */
  push: Map<string, Placement>;
}

type Size = { w: number; h: number };
type Pos = { x: number; y: number };
type Item = { id: string; p: Placement };

const overlaps = (a: Placement, b: Placement): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Reading-order comparison of two top-left corners. */
const cmp = (a: Pos, b: Pos): number => a.y - b.y || a.x - b.x;
const next = (p: Pos): Pos => ({ x: p.x + 1, y: p.y });

/**
 * The first spot (in reading order, at or after `from`, strictly before `before` when given) where
 * a w x h item fits inside `cols` without overlapping `occ`. Null when none before `before`.
 * Overlaps are jumped over, so a row costs O(occupants) rather than O(columns).
 */
function firstFree(occ: Placement[], size: Size, from: Pos, before: Pos | null, cols: number): Pos | null {
  const w = Math.min(Math.max(1, size.w), cols);
  const h = Math.max(1, size.h);
  const bottom = occ.reduce((m, o) => Math.max(m, o.y + o.h), 0);
  const lastRow = Math.max(from.y, bottom) + 1; // a row below everything is always free
  for (let y = Math.max(0, from.y); y <= lastRow; y++) {
    let x = y === from.y ? Math.max(0, from.x) : 0;
    while (x + w <= cols) {
      if (before && cmp({ x, y }, before) >= 0) return null;
      const cand = { x, y, w, h };
      const hit = occ.find((o) => overlaps(cand, o));
      if (!hit) return { x, y };
      x = Math.max(x + 1, hit.x + hit.w);
    }
    if (before && cmp({ x: 0, y: y + 1 }, before) >= 0) return null;
  }
  return null;
}

const keepZ = (p: Placement, base: Placement): Placement => (base.z !== undefined ? { ...p, z: base.z } : p);

/**
 * Plans for inserting `sizes.length` items at `index` of the container's reading order (the
 * order of its items minus `moving`). `moving` are the dragged ids (empty for a copy); those in
 * this container vacate their spots. `z[i]` carries an incoming item's z.
 */
export function* stackPlans(
  c: Container, cols: number, moving: ReadonlySet<string>, sizes: Size[], index: number,
  z: (number | undefined)[] = []
): Generator<StackPlan> {
  const all: Item[] = readingOrder((Array.isArray(c.children) ? c.children : []).filter(isPlaced)).map((n) => ({
    id: n.id, p: clampPlacement(n.placement, cols)
  }));
  const others = all.filter((i) => !moving.has(i.id));
  const k = Math.min(Math.max(0, index), others.length);
  const prev = k > 0 ? others[k - 1].p : null;
  const nxt = k < others.length ? others[k].p : null;
  const fit = (s: Size): Size => ({ w: Math.min(Math.max(1, s.w), cols), h: Math.max(1, s.h) });
  const withZ = (p: Placement, i: number): Placement => (z[i] !== undefined ? { ...p, z: z[i] } : p);

  // 1. gap: free spots strictly between the neighbours; nothing else moves.
  {
    const occ = others.map((o) => o.p);
    const at: Placement[] = [];
    let from: Pos = prev ? next(prev) : { x: 0, y: 0 };
    for (let i = 0; i < sizes.length; i++) {
      const s = fit(sizes[i]);
      const pos = firstFree([...occ, ...at], s, from, nxt, cols);
      if (!pos) break;
      at.push(withZ({ ...pos, ...s }, i));
      from = next(pos);
    }
    if (at.length === sizes.length) yield { at, push: new Map() };
  }

  // The order after the drop: others with the incoming items at k (a number i = incoming item i).
  const order: (Item | number)[] = [...others.slice(0, k), ...sizes.map((_, i) => i), ...others.slice(k)];
  const sizeOf = (e: Item | number): Size => (typeof e === 'number' ? fit(sizes[e]) : { w: e.p.w, h: e.p.h });
  const result = (placed: Placement[]): StackPlan => {
    const at: Placement[] = [];
    const push = new Map<string, Placement>();
    order.forEach((e, t) => {
      if (typeof e === 'number') at[e] = withZ(placed[t], e);
      else if (placed[t].x !== e.p.x || placed[t].y !== e.p.y) push.set(e.id, keepZ(placed[t], e.p));
    });
    return { at, push };
  };
  /** No two changed items overlap each other or anything else (unchanged pairs may, as before). */
  const clean = (placed: Placement[]): boolean => {
    for (let a = 0; a < placed.length; a++) {
      const ea = order[a];
      const movedA = typeof ea === 'number' || placed[a].x !== ea.p.x || placed[a].y !== ea.p.y;
      if (!movedA) continue;
      for (let b = 0; b < placed.length; b++) if (a !== b && overlaps(placed[a], placed[b])) return false;
    }
    return placed.every((p) => p.x >= 0 && p.y >= 0 && p.x + p.w <= cols);
  };

  // 2. rotate: the order takes the existing spots in reading order (vacated ones included);
  // incoming items from elsewhere add spots after the last one.
  {
    const spots: Pos[] = all.map((i) => ({ x: i.p.x, y: i.p.y }));
    const placed: Placement[] = [];
    let ok = true;
    for (let t = 0; t < order.length && ok; t++) {
      const s = sizeOf(order[t]);
      if (t < spots.length) {
        placed.push({ ...spots[t], ...s });
      } else {
        const from = placed.length ? next(placed[placed.length - 1]) : { x: 0, y: 0 };
        const pos = firstFree(placed, s, from, null, cols);
        if (!pos) ok = false;
        else placed.push({ ...pos, ...s });
      }
    }
    if (ok && clean(placed)) yield result(placed);
  }

  // 3. reflow: items before k stay; from k on, each takes the first free spot after the previous.
  {
    const placed: Placement[] = others.slice(0, k).map((o) => ({ ...o.p }));
    const occ = [...placed];
    let from: Pos = prev ? next(prev) : { x: 0, y: 0 };
    let ok = true;
    for (let t = k; t < order.length && ok; t++) {
      const s = sizeOf(order[t]);
      const pos = firstFree(occ, s, from, null, cols);
      if (!pos) ok = false;
      else {
        const p = { ...pos, ...s };
        placed.push(p);
        occ.push(p);
        from = next(pos);
      }
    }
    if (ok) yield result(placed);
  }
}

/** The ids of a container in reading order (renderable items only): what the stacked layout shows. */
export function readingIds(c: Container | undefined): string[] {
  return readingOrder((Array.isArray(c?.children) ? c!.children : []).filter(isRenderable)).map((n) => n.id);
}
