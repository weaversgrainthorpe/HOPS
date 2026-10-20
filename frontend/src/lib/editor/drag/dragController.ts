/**
 * The editor's one drag engine (M3 §5, plan Task 7).
 *
 * - Pointer events only. A mouse (or pen) drag starts after 4 px of movement. A touch press becomes
 *   drag-ready after 400 ms held within 8 px; moving then starts the drag, and releasing without
 *   moving opens the item menu (Ruling 18(1)) — the single long-press mechanism for the editor.
 * - pointermove only records the pointer and asks for a frame. Once per animation frame the
 *   controller hit-tests (the only layout reads) and calls resolveDrop — the ONE drop resolver — and
 *   the highlight shows that target. A drop commits exactly the last highlighted target
 *   (Review Focus 2); Escape, pointercancel, leaving the window or a draft change cancel it and leave
 *   the draft unchanged.
 * - Commits go through editSession.apply (undoable) and are announced in a toast with Undo.
 *
 * Task 7 resolves `place` (grid with pushAside, free with 8 px units) and `invalid`. Task 8 adds:
 * - `merge`: the pointer held in a tile's centre zone (the inner 50% of its RENDERED box) for
 *   MERGE_DWELL_MS; the drop makes a new folder of both and opens its dialog. The edge zone places.
 * - `into-folder`: the centre zone of a folder → its first free cells. Held over a collapsed folder
 *   for OPEN_DWELL_MS, its overlay opens and the drag continues inside it.
 * - `tab-append`: a drop on a tab button; held there for OPEN_DWELL_MS, the tab switches and the
 *   drag continues there. The DragBreadcrumb's crumbs (Tab › Folder › …) return to a level the same
 *   way, and holding over an open overlay's backdrop closes that overlay (top only).
 * - free alignment guides (edges and centres of siblings within SNAP_PX) and tab reorder
 *   (`tab-order`, from `tabSource`), both through this same engine.
 * Dwell timers live here (the frame computes the dwell key; the timer ripens it and performs the
 * navigation); resolveDrop stays pure and only reads `state.dwell`.
 * Task 9: resize drags (resizeSource on a handle → `resize`, resolved by resolveResize through
 * resize.ts) and the phone (stacked) layout, where a drop goes at a place in the reading order
 * (resolveStacked + stacked.ts) shown by an insertion marker; merge, into-folder and tabs as above.
 */
import { get, writable, type Readable } from 'svelte/store';
import type { Container, LayoutDashboard, LayoutNode, Placement } from '$lib/types/layout';
import type { ContainerMetrics } from '$lib/layout/geometry';
import { clampPlacement, isRenderable, nodeBox } from '$lib/layout/geometry';
import {
  TreeOpError, copyNodes, deleteNodes, firstFreeCell, freeSide, isDescendant, locate, mergeIntoNewFolder, moveNodes,
  originOf, pushAside, reorderTabs, resolveContainer, type ContainerRef
} from '../treeOps';
import {
  adaptedFor, containerOfNode, currentDraft, documentIds, findIn, placementsFor, sizeFor
} from '../editorActions';
import { canvasStacked, editorMenu, openDialog, ownsTarget } from '../editorUi';
import { commitResize, resizeBlocked, resizeTarget, type ResizeEdge, type ResizeTarget } from '../resize';
import { readingIds, stackPlans } from './stacked';
import { closeTo, closeTop, openFolder, overlayStack } from '$lib/stores/folderOverlay';
import { apply, session, undo } from '$lib/stores/editSession';
import { toast } from '$lib/stores/toast';
import { clearSelection, selectionInDraft, toggleNode } from '$lib/stores/nodeSelection';
import { hitTest as domHitTest, type HitResult } from './hitTest';

// ---------------------------------------------------------------- types

/** A free-mode alignment guide, in px from the target container's content origin. */
export interface Guide {
  axis: 'x' | 'y';
  /** The line's position: x for a vertical guide, y for a horizontal one. */
  at: number;
  /** Its extent along the other axis. */
  from: number;
  to: number;
}

/** An insertion marker (viewport px): a vertical bar, or a horizontal one when `width` is set. */
export interface Marker {
  left: number;
  top: number;
  height: number;
  width?: number;
}

export type DropTarget =
  | {
      kind: 'place'; to: ContainerRef; at: Placement[]; push: Map<string, Placement>; guides?: Guide[];
      /** Stacked (phone) layout: where in the reading order it goes. */
      marker?: Marker;
    }
  | ResizeTarget
  | { kind: 'merge'; targetTileId: string }
  | { kind: 'into-folder'; folderId: string; at: Placement[] }
  | { kind: 'tab-append'; tabId: string; at: Placement[] }
  | { kind: 'tab-order'; tabIds: string[] }
  | { kind: 'invalid'; reason: string };

type Box = { left: number; top: number; width: number; height: number };

export interface DragState {
  /** Dragged ids; the first is the item that was grabbed. */
  ids: string[];
  /** Ctrl/Cmd held: the drop copies (shown as "+" on the ghost). */
  copy: boolean;
  pointer: { x: number; y: number };
  /** The last resolved (= highlighted) target. */
  target: DropTarget | null;
  /** The hover being timed (merge, collapsed folder, tab, crumb, backdrop); ripe once held long enough. */
  dwell?: { key: string; since: number; ripe?: boolean };
  /** A tab drag (tab reorder): the dragged tab's id. `ids` is then empty. */
  tab?: string;
  /** The tab the drag started on, and the tab it is on now (the breadcrumb shows both). */
  origin?: string;
  tabId?: string;
  /** Viewport box of the item or tab under the pointer, for a merge / into / append cue. */
  over?: Box;
  /** Tab reorder or a stacked (phone) drop: where it would go (viewport px). */
  marker?: Marker;
  /**
   * A resize drag (a handle of `id`): the grabbed edge, the size it started from (cells / design
   * units), the pointer's start and the container's rendered metrics. `ids` is then empty.
   */
  resize?: {
    id: string; edge: ResizeEdge; startW: number; startH: number; storedH: number;
    x0: number; y0: number; metrics: ContainerMetrics;
    /** Page scroll at the press and now: scrolling counts as travel (the content moved under the pointer). */
    sx0: number; sy0: number; sx: number; sy: number;
    /** The container's content origin (viewport px) at the press; the preview origin follows the scroll. */
    view0?: { left: number; top: number };
  };
  /** Where the first item was grabbed, as a fraction of its rendered box (0..1). */
  grab?: { fx: number; fy: number };
  /** Ghost: the grabbed item's rendered size and a label. */
  ghost?: { widthPx: number; heightPx: number; label: string };
  /** The target container's content origin (viewport px) and rendered metrics, for the highlight. */
  view?: { left: number; top: number; metrics: ContainerMetrics };
}

/** What the controller needs from the browser; tests inject stubs (no real layout in jsdom). */
export interface DragEnv {
  hitTest(x: number, y: number, dragged: ReadonlySet<string>): HitResult;
  raf(cb: FrameRequestCallback): number;
  cancelRaf(id: number): void;
  measure(el: Element): { left: number; top: number; width: number; height: number };
  viewport(): { width: number; height: number };
  scrollBy(dx: number, dy: number): void;
  /** Scroll a panel (an overlay body) by dy px. */
  scrollElBy(el: Element, dy: number): void;
  /** The page's scroll offset (no layout read). */
  scroll(): { x: number; y: number };
}

const domEnv: DragEnv = {
  hitTest: (x, y, dragged) => domHitTest(x, y, dragged),
  raf: (cb) => requestAnimationFrame(cb),
  cancelRaf: (id) => cancelAnimationFrame(id),
  measure: (el) => el.getBoundingClientRect(),
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  scrollBy: (dx, dy) => window.scrollBy(dx, dy),
  scrollElBy: (el, dy) => {
    (el as HTMLElement).scrollTop += dy;
  },
  scroll: () => ({ x: window.scrollX || 0, y: window.scrollY || 0 })
};
let env: DragEnv = domEnv;

/** Tests: replace parts of the browser environment (null restores it). */
export function setDragEnv(partial: Partial<DragEnv> | null): void {
  env = partial ? { ...domEnv, ...partial } : domEnv;
}

// ---------------------------------------------------------------- thresholds (plan: starting values)

export const MOUSE_THRESHOLD_PX = 4;
export const TOUCH_HOLD_MS = 400;
export const TOUCH_SLOP_PX = 8;
const EDGE_PX = 48;
const MAX_SCROLL_PX = 20;
/** Held in a tile's centre zone this long → merge (make a folder). */
export const MERGE_DWELL_MS = 500;
/** Held over a collapsed folder, a tab, a crumb or an overlay's backdrop this long → go there. */
export const OPEN_DWELL_MS = 600;
/** Free mode: an edge or centre within this many rendered px of a sibling's snaps to it. */
export const SNAP_PX = 4;

// ---------------------------------------------------------------- the one resolver

const invalid = (reason: string): DropTarget => ({ kind: 'invalid', reason });

const overlaps = (a: Placement, b: Placement): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const sameRef = (a: ContainerRef | undefined, b: ContainerRef | undefined): boolean =>
  !!a && !!b && a.tabId === b.tabId && (a.folderId ?? null) === (b.folderId ?? null);

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** One-entry memo of the validated result (inputs are immutable, so this is transparent). */
let memo: { key: string; draft: LayoutDashboard; target: DropTarget } | null = null;

function memoised(key: string, draft: LayoutDashboard, fn: () => DropTarget): DropTarget {
  if (memo && memo.draft === draft && memo.key === key) return memo.target;
  const target = fn();
  memo = { key, draft, target };
  return target;
}

/** The (non-dragged) item under the pointer and whether the pointer is in its centre zone (inner 50%). */
function zoneOf(state: DragState, hit: HitResult): { id: string; centre: boolean } | null {
  const n = hit.node;
  if (!n || state.ids.includes(n.id) || !(n.width > 0) || !(n.height > 0)) return null;
  const cx = n.left + n.width / 2;
  const cy = n.top + n.height / 2;
  return { id: n.id, centre: Math.abs(hit.dx - cx) <= n.width / 4 && Math.abs(hit.dy - cy) <= n.height / 4 };
}

const ripe = (state: DragState, key: string): boolean => state.dwell?.key === key && state.dwell.ripe === true;

const SELF = "A folder can't go inside itself.";

/** The checks every item drag shares (existence, drawability, folder-with-its-content, self-nesting). */
function checkIds(draft: LayoutDashboard, ids: string[], intoFolder?: string): DropTarget | null {
  if (ids.length === 0) return invalid('Nothing is being dragged.');
  const idSet = new Set(ids);
  for (const id of ids) {
    const loc = locate(draft, id);
    if (!loc) return invalid('That item no longer exists.');
    if (!isRenderable(findIn(draft, id))) return invalid("That item can't be drawn, so it can't be dragged.");
    if (loc.folderChain.some((f) => idSet.has(f))) {
      return invalid("An item can't be dragged together with the folder that contains it.");
    }
    if (intoFolder !== undefined && (intoFolder === id || isDescendant(draft, id, intoFolder))) return invalid(SELF);
  }
  return null;
}

/**
 * Merge `ids` onto tile `tileId` as one new folder (treeOps.mergeIntoNewFolder). Items coming from
 * a container of the other mode are first converted on the one path (moveNodes → convertNode) into
 * the tile's container, so the new folder's content is in its mode. Used by the trial run and the commit.
 */
function mergeDrop(
  d: LayoutDashboard, ids: string[], tileId: string, allIds: Set<string>
): { dashboard: LayoutDashboard; folderId: string } {
  const tc = containerOfNode(d, tileId);
  if (!tc) throw new TreeOpError('That tile no longer exists.');
  const mode = resolveContainer(d, tc).mode;
  let base = d;
  if (ids.some((id) => originOf(d, id).mode !== mode)) {
    const at = placementsFor(deleteNodes(d, ids), tc, adaptedFor(d, ids, tc));
    base = moveNodes(d, ids, tc, at);
  }
  return mergeIntoNewFolder(base, ids, tileId, allIds);
}

/** Into a container at its first free cells (a drop on a folder or a tab button). Trial-run like place. */
function resolveAppend(state: DragState, to: ContainerRef, draft: LayoutDashboard): DropTarget {
  return memoised(JSON.stringify(['append', state.ids, state.copy, to]), draft, () => {
    try {
      const nodes = adaptedFor(draft, state.ids, to);
      const at = placementsFor(state.copy ? draft : deleteNodes(draft, state.ids), to, nodes);
      if (state.copy) copyNodes(draft, state.ids, to, at, documentIds());
      else moveNodes(draft, state.ids, to, at);
      return to.folderId !== undefined
        ? { kind: 'into-folder', folderId: to.folderId, at }
        : { kind: 'tab-append', tabId: to.tabId, at };
    } catch (e) {
      return invalid(e instanceof TreeOpError ? e.message : message(e, "That can't go there."));
    }
  });
}

function resolveIntoFolder(state: DragState, folderId: string, draft: LayoutDashboard): DropTarget {
  const bad = checkIds(draft, state.ids, folderId);
  if (bad) return bad;
  const loc = locate(draft, folderId);
  if (!loc) return invalid('That folder no longer exists.');
  return resolveAppend(state, { tabId: loc.tabId, folderId }, draft);
}

function resolveTabAppend(state: DragState, tabId: string, draft: LayoutDashboard): DropTarget {
  const bad = checkIds(draft, state.ids);
  if (bad) return bad;
  if (!draft.tabs.some((t) => t.id === tabId)) return invalid('That tab no longer exists.');
  return resolveAppend(state, { tabId }, draft);
}

function resolveMerge(state: DragState, tileId: string, draft: LayoutDashboard): DropTarget {
  if (state.copy) return invalid("Release Ctrl/Cmd to make a folder — copying onto a tile isn't available.");
  return memoised(JSON.stringify(['merge', state.ids, tileId]), draft, () => {
    try {
      mergeDrop(draft, state.ids, tileId, documentIds());
      return { kind: 'merge', targetTileId: tileId };
    } catch (e) {
      return invalid(e instanceof TreeOpError ? e.message : message(e, "Those can't be made into a folder."));
    }
  });
}

/**
 * Where a dragged tab would go: the tab box (button + its controls) nearest the pointer, and which
 * side of it (by its x half). Gaps between tabs, the controls and the Add Tab button all resolve
 * to a real slot, so the marker always shows exactly where the drop will land.
 */
function tabSlot(state: DragState, hit: HitResult): { id: string; box: Box; after: boolean } | null {
  const { x, y } = state.pointer;
  const boxes = hit.tabBoxes?.filter((b) => b.id) ?? [];
  if (boxes.length === 0) {
    return hit.tabId !== undefined && hit.tabRect
      ? { id: hit.tabId, box: hit.tabRect, after: x >= hit.tabRect.left + hit.tabRect.width / 2 }
      : null;
  }
  const dist = (b: Box) => {
    const dx = x < b.left ? b.left - x : x > b.left + b.width ? x - (b.left + b.width) : 0;
    const dy = y < b.top ? b.top - y : y > b.top + b.height ? y - (b.top + b.height) : 0;
    return Math.hypot(dx, dy);
  };
  let best = boxes[0];
  for (const b of boxes) if (dist(b) < dist(best)) best = b;
  return { id: best.id, box: best, after: x >= best.left + best.width / 2 };
}

/** Tab reorder: the slot nearest the pointer in the tab bar (tabSlot). */
function resolveTabOrder(state: DragState, hit: HitResult, draft: LayoutDashboard): DropTarget {
  const me = state.tab!;
  const ids = draft.tabs.map((t) => t.id);
  if (!ids.includes(me)) return invalid('That tab no longer exists.');
  const slot = hit.tabId !== undefined || hit.tabBar ? tabSlot(state, hit) : null;
  if (!slot) return invalid('Drop the tab on the tab bar to move it.');
  if (slot.id === me) return { kind: 'tab-order', tabIds: ids };
  const rest = ids.filter((i) => i !== me);
  const j = rest.indexOf(slot.id);
  if (j === -1) return invalid('That tab no longer exists.');
  rest.splice(slot.after ? j + 1 : j, 0, me);
  return { kind: 'tab-order', tabIds: rest };
}

/**
 * The integer position within the snap distance of a sibling line for any of this item's
 * edges/centre: max(SNAP_PX rendered px, one design unit) (Ruling 23), so snapping matters at
 * every scale (at 8 px per unit plain rounding already lands within 4 px).
 */
function snapAxis(raw: number, size: number, lines: number[], unitPx: number): number {
  const within = Math.max(SNAP_PX, unitPx);
  let best: { pos: number; d: number } | null = null;
  for (const off of [0, size / 2, size]) {
    for (const line of lines) {
      const pos = line - off;
      if (!Number.isInteger(pos)) continue;
      const d = Math.abs(raw - pos) * unitPx;
      if (d <= within + 1e-9 && (!best || d < best.d)) best = { pos, d };
    }
  }
  return best ? best.pos : Math.round(raw);
}

/** Guides for every edge/centre of `p` that lines up exactly with a sibling's (px, container origin). */
function guidesFor(p: Placement, sibs: Placement[], m: ContainerMetrics): Guide[] {
  const out: Guide[] = [];
  const seen = new Set<string>();
  const feats = (a: number, w: number) => [a, a + w / 2, a + w];
  for (const q of sibs) {
    for (const f of feats(p.x, p.w)) {
      if (!feats(q.x, q.w).includes(f)) continue;
      const g: Guide = {
        axis: 'x', at: f * m.unitPx,
        from: Math.min(p.y, q.y) * m.rowPx, to: Math.max(p.y + p.h, q.y + q.h) * m.rowPx
      };
      const k = `x${g.at}:${g.from}:${g.to}`;
      if (!seen.has(k)) out.push(g), seen.add(k);
    }
    for (const f of feats(p.y, p.h)) {
      if (!feats(q.y, q.h).includes(f)) continue;
      const g: Guide = {
        axis: 'y', at: f * m.rowPx,
        from: Math.min(p.x, q.x) * m.unitPx, to: Math.max(p.x + p.w, q.x + q.w) * m.unitPx
      };
      const k = `y${g.at}:${g.from}:${g.to}`;
      if (!seen.has(k)) out.push(g), seen.add(k);
    }
  }
  return out;
}

/**
 * THE drop resolver: pure, used for the highlight every frame and (through state.target) for the
 * commit. Grid: the cells under the ghost, neighbours pushed aside (Ruling 11: the push map is part
 * of the target and the op is trial-run here, so a highlighted target never throws on commit);
 * stored footprints count, so a collapsed folder's reserved cells are occupied (Ruling 13). Free:
 * the 8 px design unit under the ghost, overlap allowed, snapped to sibling edges/centres within
 * SNAP_PX. Selections keep their relative offsets when they come from one container; otherwise the
 * others take the first free cells. Zones and hit boxes are RENDERED geometry (Ruling 13); a tile's
 * centre zone becomes a merge only once state.dwell has ripened on it; a folder's centre zone is
 * into-folder; tab buttons are tab-append; crumbs and an overlay's backdrop are navigation only.
 */
export function resolveDrop(state: DragState, hit: HitResult, draft: LayoutDashboard): DropTarget {
  if (state.tab !== undefined) return resolveTabOrder(state, hit, draft);
  if (hit.crumb !== undefined) return invalid('Dropping on the path changes nothing — hold over a crumb to go back to that level.');
  if (hit.outside) return invalid('Keep holding here to close this folder — dropping here changes nothing.');
  if (hit.tabId !== undefined) return resolveTabAppend(state, hit.tabId, draft);
  const c = hit.container;
  if (!c) return invalid(hit.tabBar ? 'Drop it on a tab, the dashboard, or inside a folder.' : 'Drop it on the dashboard or inside a folder.');
  const ids = state.ids;
  const to = c.ref;
  const bad = checkIds(draft, ids, to.folderId);
  if (bad) return bad;
  const idSet = new Set(ids);

  const zone = zoneOf(state, hit);
  if (zone?.centre) {
    const n = findIn(draft, zone.id);
    if (n?.kind === 'folder') return resolveIntoFolder(state, n.id, draft);
    if (n?.kind === 'tile' && ripe(state, `merge:${n.id}`)) return resolveMerge(state, n.id, draft);
  }
  if (c.layout === 'stacked') return resolveStacked(state, hit, draft, to);

  let r: ReturnType<typeof resolveContainer>;
  let nodes: LayoutNode[];
  try {
    r = resolveContainer(draft, to);
    nodes = adaptedFor(draft, ids, to);
  } catch (e) {
    return invalid(message(e, "That can't go there."));
  }
  const m = c.metrics;
  if (!(m.unitPx > 0) || !(m.rowPx > 0)) return invalid("That area can't be measured right now; try again.");
  const cols = r.columns;
  const sizes = nodes.map((n) => {
    const s = sizeFor(n, r.mode);
    return { w: Math.min(s.w, cols), h: s.h };
  });
  const moving = state.copy ? new Set<string>() : idSet;
  const siblings = r.container.children
    .filter((n) => n && !moving.has(n.id) && isRenderable(n))
    .map((n) => clampPlacement(n.placement, cols));

  // The grabbed item's top-left cell: the ghost's top-left, rounded to the nearest cell / unit
  // (free: or snapped to a sibling's edge / centre within SNAP_PX).
  const grab = state.grab ?? { fx: 0, fy: 0 };
  const rawX = (hit.dx - grab.fx * sizes[0].w * m.unitPx) / m.unitPx;
  const rawY = (hit.dy - grab.fy * sizes[0].h * m.rowPx) / m.rowPx;
  let x0 = Math.round(rawX);
  let y0 = Math.round(rawY);
  if (r.mode === 'free') {
    x0 = snapAxis(rawX, sizes[0].w, siblings.flatMap((q) => [q.x, q.x + q.w / 2, q.x + q.w]), m.unitPx);
    y0 = snapAxis(rawY, sizes[0].h, siblings.flatMap((q) => [q.y, q.y + q.h / 2, q.y + q.h]), m.rowPx);
  }

  // Offsets from the grabbed item, in the target's units (scaled across modes as convertNode does).
  const origins = ids.map((id) => containerOfNode(draft, id));
  const together = origins.every((o) => sameRef(o, origins[0]));
  const from = originOf(draft, ids[0]);
  const tab = draft.tabs.find((t) => t.id === to.tabId);
  const scale = from.mode === r.mode ? 1 : r.mode === 'free' ? freeSide(tab) : 1 / Math.max(1, from.side);
  const p0 = findIn(draft, ids[0])!.placement;
  const wanted: (Placement | null)[] = ids.map((id, i) => {
    if (i > 0 && !together) return null;
    const pi = findIn(draft, id)!.placement;
    return {
      x: x0 + Math.round((pi.x - p0.x) * scale),
      y: y0 + Math.round((pi.y - p0.y) * scale),
      w: sizes[i].w,
      h: sizes[i].h
    };
  });
  // Shift the group (as one) inside the columns and below the top edge.
  const placed = wanted.filter((w): w is Placement => !!w);
  const minX = Math.min(...placed.map((w) => w.x));
  const maxR = Math.max(...placed.map((w) => w.x + w.w));
  const minY = Math.min(...placed.map((w) => w.y));
  let sx = minX < 0 ? -minX : maxR > cols ? cols - maxR : 0;
  if (minX + sx < 0) {
    if (r.mode === 'grid') return invalid(`Those items don't fit across ${cols} columns here.`);
    sx = -minX;
  }
  const sy = minY < 0 ? -minY : 0;
  for (const w of placed) {
    w.x += sx;
    w.y += sy;
  }

  const key = JSON.stringify([ids, state.copy, to, r.mode, wanted, m.unitPx, m.rowPx]);
  return memoised(key, draft, () => {
    const at: Placement[] = [];
    const push = new Map<string, Placement>();
    const work: Container = {
      columns: cols,
      children: r.container.children.filter((n) => !(n && moving.has(n.id)))
    };
    const slot = (i: number, p: Placement) =>
      work.children.push({ kind: 'tile', id: `\u0000drop-${i}`, placement: p } as unknown as LayoutNode);
    nodes.forEach((n, i) => {
      let t = wanted[i];
      if (r.mode === 'grid') {
        if (t && at.some((a) => overlaps(a, t!))) t = null; // a converted group can collide with itself
        if (!t) {
          t = firstFreeCell(work, sizes[i].w, sizes[i].h, 'grid');
          t.h = sizes[i].h;
        } else {
          for (const [pid, pp] of pushAside(work, new Set(), t)) {
            push.set(pid, pp);
            work.children = work.children.map((k) => (k.id === pid ? ({ ...k, placement: pp } as LayoutNode) : k));
          }
        }
      } else {
        t = t ? clampPlacement(t, cols) : firstFreeCell(work, sizes[i].w, sizes[i].h, 'free');
      }
      const z = n.placement?.z;
      if (typeof z === 'number' && Number.isFinite(z)) t = { ...t, z };
      at.push(t);
      slot(i, t);
    });

    // Trial-run the very op the commit will run (Ruling 11): a highlighted target never throws.
    const target: DropTarget = { kind: 'place', to, at, push };
    if (r.mode === 'free') {
      const guides = guidesFor(at[0], siblings, m);
      if (guides.length) target.guides = guides;
    }
    try {
      if (state.copy) copyNodes(draft, ids, to, at, documentIds(), push); // the same id set as the commit
      else moveNodes(draft, ids, to, at, push);
    } catch (e) {
      return invalid(e instanceof TreeOpError ? e.message : message(e, "That can't go there."));
    }
    return target;
  });
}

/**
 * The stacked (phone) slot: the item box nearest the pointer, and which side of it — its left /
 * right half, or top / bottom half for a wide item (an expanded folder spans the row).
 */
function stackSlot(hit: HitResult, known: ReadonlySet<string>): { id: string; box: Box; after: boolean } | null {
  // Only items the order knows (a placeholder for an unreadable item is not a slot).
  const boxes = (hit.stackBoxes ?? []).filter((b) => known.has(b.id));
  if (boxes.length === 0) return null;
  const { dx: x, dy: y } = hit;
  const dist = (b: Box) => {
    const ddx = x < b.left ? b.left - x : x > b.left + b.width ? x - (b.left + b.width) : 0;
    const ddy = y < b.top ? b.top - y : y > b.top + b.height ? y - (b.top + b.height) : 0;
    return Math.hypot(ddx, ddy);
  };
  let best = boxes[0];
  for (const b of boxes) if (dist(b) < dist(best)) best = b;
  const wide = best.width > 2 * best.height;
  return {
    id: best.id,
    box: best,
    after: wide ? y >= best.top + best.height / 2 : x >= best.left + best.width / 2
  };
}

/** The marker for a stacked slot, in viewport px (the container's top-left when it is empty). */
function stackMarker(slot: ReturnType<typeof stackSlot>, origin: { left: number; top: number }): Marker {
  if (!slot) return { left: origin.left, top: origin.top, width: 120, height: 0 };
  const b = slot.box;
  if (b.width > 2 * b.height) {
    return { left: origin.left + b.left, top: origin.top + (slot.after ? b.top + b.height : b.top), width: b.width, height: 0 };
  }
  return { left: origin.left + (slot.after ? b.left + b.width : b.left), top: origin.top + b.top, height: b.height };
}

/**
 * Stacked (phone) layout: the drop goes at a place in the container's READING ORDER — before or
 * after the nearest item (stackSlot). stacked.stackPlans proposes stored placements; each is
 * trial-run through the very op the commit runs, and only one whose result shows exactly the
 * wanted order is taken (so the drop lands where the marker is, or the target is invalid).
 */
function resolveStacked(state: DragState, hit: HitResult, draft: LayoutDashboard, to: ContainerRef): DropTarget {
  const ids = state.ids;
  let r: ReturnType<typeof resolveContainer>;
  let nodes: LayoutNode[];
  try {
    r = resolveContainer(draft, to);
    nodes = adaptedFor(draft, ids, to);
  } catch (e) {
    return invalid(message(e, "That can't go there."));
  }
  const cols = r.columns;
  const moving: ReadonlySet<string> = state.copy ? new Set<string>() : new Set(ids);
  const others = readingIds(r.container).filter((id) => !moving.has(id));
  const slot = stackSlot(hit, new Set(others));
  const index = slot ? others.indexOf(slot.id) + (slot.after ? 1 : 0) : others.length;
  const marker = stackMarker(slot, hit.container ?? { left: 0, top: 0 });
  const target = memoised(JSON.stringify(['stack', ids, state.copy, to, index]), draft, () => {
    const sizes = nodes.map((n) => sizeFor(n, r.mode));
    const zs = nodes.map((n) => (typeof n.placement?.z === 'number' && Number.isFinite(n.placement.z) ? n.placement.z : undefined));
    let lastError = '';
    for (const plan of stackPlans(r.container, cols, moving, sizes, index, zs)) {
      try {
        let result: LayoutDashboard;
        let placedIds = ids;
        if (state.copy) {
          const c = copyNodes(draft, ids, to, plan.at, documentIds(), plan.push); // the same id set as the commit
          result = c.dashboard;
          placedIds = c.newIds;
        } else {
          result = moveNodes(draft, ids, to, plan.at, plan.push);
        }
        const want = [...others.slice(0, index), ...placedIds, ...others.slice(index)];
        const got = readingIds(resolveContainer(result, to).container);
        if (got.join('\u0000') === want.join('\u0000')) {
          return { kind: 'place', to, at: plan.at, push: plan.push } as DropTarget;
        }
      } catch (e) {
        lastError = e instanceof TreeOpError ? e.message : message(e, '');
      }
    }
    return invalid(lastError || "There's no room to put it there in this order — try a wider screen, or Cut and Paste.");
  });
  return target.kind === 'place' ? { ...target, marker } : target;
}

/** A resize drag: the pointer's travel since the press, snapped to whole cells / 8 px units. */
export function resolveResize(state: DragState, draft: LayoutDashboard): DropTarget {
  const r = state.resize;
  if (!r) return invalid('Nothing is being resized.');
  const m = r.metrics;
  if (!(m.unitPx > 0) || !(m.rowPx > 0)) return invalid("That area can't be measured right now; try again.");
  const dw = Math.round((state.pointer.x - r.x0 + (r.sx - r.sx0)) / m.unitPx);
  const dh = Math.round((state.pointer.y - r.y0 + (r.sy - r.sy0)) / m.rowPx);
  const w = r.edge === 'bottom' ? r.startW : Math.max(1, r.startW + dw);
  const h = r.edge === 'right' ? r.storedH : Math.max(1, r.startH + dh);
  return memoised(JSON.stringify(['resize', r.id, w, h]), draft, () => resizeTarget(draft, r.id, w, h));
}

// ---------------------------------------------------------------- commit

function describe(d: LayoutDashboard, ids: string[]): string {
  if (ids.length === 1) {
    const n = findIn(d, ids[0]);
    return n ? `"${n.name || 'Untitled'}"` : 'the item';
  }
  return `${ids.length} items`;
}

function destName(d: LayoutDashboard, to: ContainerRef): string {
  if (to.folderId !== undefined) return findIn(d, to.folderId)?.name || 'the folder';
  return d.tabs.find((t) => t.id === to.tabId)?.name || 'the tab';
}

/** A move that would put every item back exactly where it is (and push nothing). */
function unchanged(d: LayoutDashboard, ids: string[], t: Extract<DropTarget, { kind: 'place' }>): boolean {
  if (t.push.size > 0) return false;
  return ids.every((id, i) => {
    const n = findIn(d, id);
    if (!n || !sameRef(containerOfNode(d, id), t.to)) return false;
    const a = n.placement, b = t.at[i];
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  });
}

/** The success toast with Undo: Undo steps back only while this drop is still the latest change. */
function announce(label: string, before: LayoutDashboard): void {
  toast.add({
    type: 'success',
    message: label,
    duration: 8000,
    action: {
      label: 'Undo',
      onClick: () => {
        const st = get(session);
        // The draft this drop replaced: while it is still on top of the undo stack, the drop is the
        // latest change (a save replaces the draft reference but keeps the stack, so Undo still works).
        if (st && st.undo[st.undo.length - 1] === before) undo();
        else toast.info('Other changes were made after that drop. Use Undo in the toolbar (Ctrl+Z) to step back through them.');
      }
    }
  });
}

function tabName(d: LayoutDashboard, tabId: string): string {
  return d.tabs.find((t) => t.id === tabId)?.name || 'the tab';
}

/** Apply exactly state.target via apply(); 'invalid' → nothing changes and the reason is toasted. */
export function commitDrop(state: DragState): void {
  const t = state.target;
  if (!t) {
    toast.info('The drop happened before a target was shown, so nothing changed.');
    return;
  }
  if (t.kind === 'invalid') {
    toast.error(t.reason);
    return;
  }
  const d = currentDraft();
  if (!d) {
    toast.error('Not editing: click Edit first.');
    return;
  }
  const before = d;

  if (t.kind === 'resize') {
    const label = commitResize(t); // '' = the same size: no change, no undo step
    if (label) announce(label, before);
    return;
  }

  if (t.kind === 'tab-order') {
    if (t.tabIds.join('\u0000') === d.tabs.map((x) => x.id).join('\u0000')) return; // same order: no change
    const label = `Moved the "${tabName(d, state.tab ?? '')}" tab`;
    if (apply('Reorder tabs', (dd) => reorderTabs(dd, t.tabIds))) announce(label, before);
    return;
  }

  if (t.kind === 'merge') {
    let folderId = '';
    const label = `Made a folder from ${describe(d, [t.targetTileId, ...state.ids])}`;
    const ok = apply('Make folder', (dd) => {
      const r = mergeDrop(dd, state.ids, t.targetTileId, documentIds());
      folderId = r.folderId;
      return r.dashboard;
    });
    if (!ok) return; // apply has already said why
    clearSelection();
    announce(label, before);
    // Name it straight away: the dialog opens with "New folder" selected; Cancel keeps that name.
    openDialog({ kind: 'folder', id: folderId });
    return;
  }

  let to: ContainerRef;
  let at: Placement[];
  let push: Map<string, Placement> | undefined;
  if (t.kind === 'place') {
    if (!state.copy && unchanged(d, state.ids, t)) return; // put back where it was: no change, no undo step
    to = t.to;
    at = t.at;
    push = t.push;
  } else if (t.kind === 'into-folder') {
    const loc = locate(d, t.folderId);
    if (!loc) {
      toast.error('That folder no longer exists, so nothing changed.');
      return;
    }
    to = { tabId: loc.tabId, folderId: t.folderId };
    at = t.at;
  } else {
    to = { tabId: t.tabId };
    at = t.at;
  }
  const label = `${state.copy ? 'Copied' : 'Moved'} ${describe(d, state.ids)} to ${destName(d, to)}`;
  let newIds: string[] = [];
  const ok = apply(label, (dd) => {
    if (!state.copy) return moveNodes(dd, state.ids, to, at, push);
    const r = copyNodes(dd, state.ids, to, at, documentIds(), push);
    newIds = r.newIds;
    return r.dashboard;
  });
  if (!ok) return; // apply has already said why
  if (state.copy) {
    clearSelection();
    newIds.forEach((id) => toggleNode(id, true));
  }
  announce(label, before);
  // Ruling 24: the first phone (stacked) reorder of a session says what else it changes.
  if (t.kind === 'place' && t.marker && !phoneNoticeShown) {
    phoneNoticeShown = true;
    toast.info(PHONE_REORDER_NOTICE);
  }
}

/** Shown once per edit session, on its first stacked (phone) reorder (Ruling 24). */
export const PHONE_REORDER_NOTICE = 'Reordering on a narrow screen also moves these items in the wide layout';
let phoneNoticeShown = false;
let phoneNoticeSession: string | null = null;

// ---------------------------------------------------------------- the store

const dragState = writable<DragState | null>(null);
export const drag: Readable<DragState | null> = { subscribe: dragState.subscribe };

// ---------------------------------------------------------------- pointer handling

interface Press {
  pointerId: number;
  touch: boolean;
  x: number;
  y: number;
  target: EventTarget | null;
  /** The node pressed (absent for a container press, which only opens a menu). */
  id?: string;
  /** The tab pressed (tab reorder). */
  tab?: string;
  /** A resize handle pressed: its node, edge and the container's rendered metrics. */
  resize?: { id: string; edge: ResizeEdge; metrics: ContainerMetrics; scroll: { x: number; y: number } };
  rect?: { left: number; top: number; width: number; height: number };
  onMenu?: (x: number, y: number, target: EventTarget | null) => void;
  ready: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

let press: Press | null = null;
let current: DragState | null = null;
let draftAtStart: LayoutDashboard | null = null;
let pending: { x: number; y: number } | null = null;
let frameId = 0;
let lastHit: HitResult | null = null;
let dwellTimer: ReturnType<typeof setTimeout> | null = null;
/** Overlays (folder ids) whose panel the pointer has been over during this drag. */
const enteredPanels = new Set<string>();

function setState(s: DragState | null) {
  current = s;
  dragState.set(s);
}

function label(d: LayoutDashboard, ids: string[]): string {
  if (ids.length === 1) return findIn(d, ids[0])?.name || 'Untitled';
  return `${ids.length} items`;
}

/** The ids a press on `id` drags: the selection when it holds `id` (minus items inside a selected folder). */
function dragIds(d: LayoutDashboard, id: string): string[] {
  const sel = selectionInDraft();
  if (sel.length > 1 && sel.includes(id)) {
    const all = [id, ...sel.filter((x) => x !== id)];
    const set = new Set(all);
    const top = all.filter((x) => !(locate(d, x)?.folderChain ?? []).some((f) => set.has(f)));
    if (top.includes(id)) return top;
  }
  if (!sel.includes(id) || sel.length !== 1) toggleNode(id, false);
  return [id];
}

function grabOf(p: Press, rect: { left: number; top: number; width: number; height: number }) {
  const frac = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  return {
    fx: rect.width > 0 ? frac((p.x - rect.left) / rect.width) : 0,
    fy: rect.height > 0 ? frac((p.y - rect.top) / rect.height) : 0
  };
}

function beginDragging(d: LayoutDashboard, s: DragState) {
  draftAtStart = d;
  editorMenu.set(null);
  if (typeof document !== 'undefined') {
    // A resize shows its edge's resize cursor; an item or tab drag shows "grabbing".
    if (s.resize) document.body.classList.add('hops-resizing', `hops-resize-${s.resize.edge}`);
    else document.body.classList.add('hops-dragging');
  }
  setState(s);
  pending = { ...s.pointer };
  schedule();
}

/** A tab reorder drag: the same engine, its own resolver case (tab-order). */
function startTabDrag(p: Press, x: number, y: number) {
  const d = currentDraft();
  const tab = d?.tabs.find((t) => t.id === p.tab);
  if (!d || !tab) {
    endPress();
    return;
  }
  const rect = p.rect ?? { left: p.x, top: p.y, width: 1, height: 1 };
  beginDragging(d, {
    ids: [],
    tab: tab.id,
    copy: false,
    pointer: { x, y },
    target: null,
    grab: grabOf(p, rect),
    ghost: { widthPx: Math.max(24, rect.width), heightPx: Math.max(24, rect.height), label: tab.name || 'Tab' }
  });
}

/**
 * A resize drag: the same press, frame loop, cancel and commit as an item drag. The preview is
 * drawn in the node's container from the box measured on press (rendered geometry, Ruling 13).
 */
function startResize(p: Press, x: number, y: number) {
  const spec = p.resize!;
  const d = currentDraft();
  const n = d ? findIn(d, spec.id) : undefined;
  const blocked = d ? resizeBlocked(d, spec.id, get(canvasStacked)) : 'Not editing: click Edit first.';
  const m = spec.metrics;
  if (!d || !n || blocked || !(m.unitPx > 0) || !(m.rowPx > 0)) {
    endPress();
    toast.info(blocked ?? "That area can't be measured right now, so it can't be resized; try again.");
    return;
  }
  const stored = clampPlacement(n.placement, m.columns);
  const rect = p.rect;
  // A free folder can render taller than its stored height (content never clips): start from what is shown.
  const shownH = rect && rect.height > 0 ? Math.round(rect.height / m.rowPx) : 0;
  const b = nodeBox(stored, m);
  const view0 = rect ? { left: rect.left - b.leftPx, top: rect.top - b.topPx } : undefined;
  beginDragging(d, {
    ids: [],
    copy: false,
    pointer: { x, y },
    target: null,
    resize: {
      id: spec.id, edge: spec.edge, startW: stored.w, startH: Math.max(stored.h, shownH), storedH: stored.h,
      x0: p.x, y0: p.y, metrics: m,
      sx0: spec.scroll.x, sy0: spec.scroll.y, sx: spec.scroll.x, sy: spec.scroll.y, view0
    },
    view: view0 ? { ...view0, metrics: m } : undefined
  });
}

function startDrag(p: Press, x: number, y: number, copy: boolean) {
  if (p.resize) {
    startResize(p, x, y);
    return;
  }
  if (p.tab !== undefined) {
    startTabDrag(p, x, y);
    return;
  }
  const d = currentDraft();
  if (!d || !p.id || !locate(d, p.id)) {
    endPress();
    return;
  }
  const ids = dragIds(d, p.id);
  const rect = p.rect ?? { left: p.x, top: p.y, width: 1, height: 1 };
  beginDragging(d, {
    ids,
    copy,
    pointer: { x, y },
    target: null,
    origin: activeTab ?? undefined,
    tabId: activeTab ?? undefined,
    grab: grabOf(p, rect),
    ghost: { widthPx: Math.max(24, rect.width), heightPx: Math.max(24, rect.height), label: label(d, ids) }
  });
}

function schedule() {
  if (!frameId) frameId = env.raf(frame);
}

/** One per animation frame: the only layout reads (hit test), then the one resolver. */
function frame() {
  frameId = 0;
  const s = current;
  const d = currentDraft();
  if (!s || !d) return;
  const at = pending ?? s.pointer;
  pending = null;
  if (s.resize) {
    // A resize reads no layout: the size follows the pointer's travel plus any page scroll
    // (resolveResize), and the preview's origin moves with the scrolled content.
    const sc = env.scroll();
    const r = { ...s.resize, sx: sc.x, sy: sc.y };
    const next: DragState = { ...s, pointer: { x: at.x, y: at.y }, resize: r };
    if (r.view0) next.view = { left: r.view0.left - (r.sx - r.sx0), top: r.view0.top - (r.sy - r.sy0), metrics: r.metrics };
    next.target = resolveResize(next, d);
    setState(next);
    return;
  }
  const hit = env.hitTest(at.x, at.y, new Set(s.ids));
  lastHit = hit;
  const next: DragState = { ...s, pointer: { x: at.x, y: at.y } };
  next.dwell = dwellFor(next, hit, d, s.dwell);
  next.target = resolveDrop(next, hit, d);
  // Stacked containers have no cell geometry to highlight: their drop shows as a marker instead.
  next.view = hit.container && hit.container.layout !== 'stacked'
    ? { left: hit.container.left, top: hit.container.top, metrics: hit.container.metrics }
    : undefined;
  next.over = overFor(next.target, hit);
  const slot = next.target.kind === 'tab-order' ? tabSlot(next, hit) : null;
  next.marker = slot
    ? { left: slot.after ? slot.box.left + slot.box.width : slot.box.left, top: slot.box.top, height: slot.box.height }
    : next.target.kind === 'place' ? next.target.marker : undefined;
  if (hit.panel !== undefined) enteredPanels.add(hit.panel);
  setState(next);
  autoScroll(at.x, at.y, hit.scroller);
}

/** The viewport box the merge / into-folder / tab-append cue is drawn on. */
function overFor(t: DropTarget, hit: HitResult): Box | undefined {
  if ((t.kind === 'merge' || t.kind === 'into-folder') && hit.node && hit.container) {
    const n = hit.node;
    return { left: hit.container.left + n.left, top: hit.container.top + n.top, width: n.width, height: n.height };
  }
  if (t.kind === 'tab-append' && hit.tabRect) return { ...hit.tabRect };
  return undefined;
}

/** Near an edge, scroll (and keep scrolling while held there): the panel under the pointer first, else the page. */
function autoScroll(x: number, y: number, scroller?: Element) {
  const step = (pos: number, top: number, bottom: number): number => {
    if (pos < top + EDGE_PX) return -Math.ceil(((top + EDGE_PX - pos) / EDGE_PX) * MAX_SCROLL_PX);
    if (pos > bottom - EDGE_PX) return Math.ceil(((pos - (bottom - EDGE_PX)) / EDGE_PX) * MAX_SCROLL_PX);
    return 0;
  };
  const clamp = (v: number) => Math.max(-MAX_SCROLL_PX, Math.min(MAX_SCROLL_PX, v));
  if (scroller) {
    const r = env.measure(scroller);
    const dy = r.height > 2 * EDGE_PX ? step(y, r.top, r.top + r.height) : 0;
    if (dy !== 0) {
      env.scrollElBy(scroller, clamp(dy));
      pending = { x, y };
      schedule();
      return;
    }
  }
  const vp = env.viewport();
  const dy = step(y, 0, vp.height);
  if (dy === 0) return;
  env.scrollBy(0, clamp(dy));
  pending = { x, y };
  schedule();
}

// ---- dwell: hold over a target to merge, open a folder, switch tab, return via a crumb, close an overlay

/** What holding still over `hit` would do, as a key and a duration; null = nothing to wait for. */
function dwellKey(s: DragState, hit: HitResult, d: LayoutDashboard): { key: string; ms: number } | null {
  if (s.tab !== undefined) return null;
  const stack = get(overlayStack);
  if (hit.crumb !== undefined) return crumbAction(hit.crumb) ? { key: `crumb:${hit.crumb}`, ms: OPEN_DWELL_MS } : null;
  if (hit.outside) {
    // Only once the pointer has been inside that overlay's panel during this drag: an overlay the
    // dwell just opened under a pointer that is over its backdrop must not close (and reopen) itself.
    const top = stack[stack.length - 1];
    return top !== undefined && enteredPanels.has(top) ? { key: `out:${top}`, ms: OPEN_DWELL_MS } : null;
  }
  if (hit.tabId !== undefined) return hit.tabId !== activeTab ? { key: `tab:${hit.tabId}`, ms: OPEN_DWELL_MS } : null;
  if (!hit.container) return null;
  const zone = zoneOf(s, hit);
  if (!zone?.centre) return null;
  const n = findIn(d, zone.id);
  if (n?.kind === 'tile') return { key: `merge:${n.id}`, ms: MERGE_DWELL_MS };
  if (n?.kind === 'folder' && n.display === 'collapsed' && !s.ids.some((id) => id === n.id || isDescendant(d, id, n.id))) {
    return { key: `open:${n.id}`, ms: OPEN_DWELL_MS };
  }
  return null;
}

function clearDwell() {
  if (dwellTimer) clearTimeout(dwellTimer);
  dwellTimer = null;
}

/** Keep the running dwell while its key holds; start a new timer when it changes; none when nothing to wait for. */
function dwellFor(s: DragState, hit: HitResult, d: LayoutDashboard, prev: DragState['dwell']): DragState['dwell'] {
  const k = dwellKey(s, hit, d);
  if (!k) {
    clearDwell();
    return undefined;
  }
  if (prev && prev.key === k.key) return prev;
  clearDwell();
  dwellTimer = setTimeout(() => ripen(k.key), k.ms);
  return { key: k.key, since: Date.now(), ripe: false };
}

/**
 * The dwell's time is up: mark it ripe, do its navigation, and re-resolve on the next frame. The
 * pointer may have moved since the last frame (up to one frame ago): re-check the key against the
 * latest pointer first, so a hover the user has already left never acts.
 */
function ripen(key: string) {
  dwellTimer = null;
  const s = current;
  const d = currentDraft();
  if (!s || !d || s.dwell?.key !== key) return;
  if (pending) {
    const at = { ...pending };
    const latest = dwellKey({ ...s, pointer: at }, env.hitTest(at.x, at.y, new Set(s.ids)), d);
    if (latest?.key !== key) {
      schedule(); // the next frame starts the dwell for wherever the pointer is now
      return;
    }
  }
  setState({ ...s, dwell: { ...s.dwell, ripe: true } });
  const [kind, ...rest] = key.split(':');
  const arg = rest.join(':');
  if (kind === 'open') {
    enteredPanels.delete(arg); // a freshly opened overlay: it closes on drag-out only after being entered
    openFolder(arg);
  }
  else if (kind === 'tab') switchDragTab(arg);
  else if (kind === 'crumb') crumbAction(arg)?.();
  else if (kind === 'out') {
    const stack = get(overlayStack);
    if (stack[stack.length - 1] === arg) closeTop();
  }
  if (current) {
    pending = { ...current.pointer };
    schedule();
  }
}

/**
 * What a breadcrumb crumb returns to: "tab:<id>" → that tab (another tab: switch to it; this
 * tab: close every overlay); "folder:<depth>" → close the overlays above that depth. Null when
 * the crumb is the level the drag is already on.
 */
export function crumbAction(crumb: string): (() => void) | null {
  const stack = get(overlayStack);
  if (crumb.startsWith('tab:')) {
    const id = crumb.slice(4);
    if (id !== activeTab) return () => switchDragTab(id);
    return stack.length ? () => closeTo(0) : null;
  }
  if (crumb.startsWith('folder:')) {
    const depth = Number(crumb.slice(7));
    return Number.isInteger(depth) && depth >= 1 && depth < stack.length ? () => closeTo(depth) : null;
  }
  return null;
}

/** Re-resolve against the last hit (no layout read) after the copy flag changes. */
function reresolve(copy: boolean) {
  const s = current;
  const d = currentDraft();
  if (!s || !d || s.copy === copy || s.tab !== undefined || s.resize) return;
  const next: DragState = { ...s, copy };
  if (lastHit) next.target = resolveDrop(next, lastHit, d);
  setState(next);
}

function endPress() {
  if (press?.timer) clearTimeout(press.timer);
  press = null;
  detach();
}

function stopDrag() {
  if (frameId) env.cancelRaf(frameId);
  frameId = 0;
  clearDwell();
  allowedTab = null;
  enteredPanels.clear();
  pending = null;
  lastHit = null;
  draftAtStart = null;
  setState(null);
  if (typeof document !== 'undefined') {
    document.body.classList.remove('hops-dragging', 'hops-resizing', 'hops-resize-corner', 'hops-resize-right', 'hops-resize-bottom');
  }
}

/** Cancel a drag in progress: nothing changes, and the user is told so. */
export function cancelDrag(reason = 'Drag cancelled — nothing changed.'): void {
  const was = current !== null;
  stopDrag();
  endPress();
  if (was) toast.info(reason);
}

function swallowNextClick() {
  if (typeof window === 'undefined') return;
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}

// ---- window listeners, attached only while a press or drag is live

function onMove(e: PointerEvent) {
  const p = press;
  if (!p || e.pointerId !== p.pointerId) return;
  const copy = e.ctrlKey || e.metaKey;
  if (current) {
    pending = { x: e.clientX, y: e.clientY };
    if (copy !== current.copy) reresolve(copy);
    schedule();
    return;
  }
  const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
  if (p.touch) {
    if (!p.ready) {
      if (dist > TOUCH_SLOP_PX) endPress(); // a scroll or swipe, not a press
      return;
    }
    if (dist <= MOUSE_THRESHOLD_PX) return;
    if (!p.id && p.tab === undefined && !p.resize) {
      endPress(); // a container press has nothing to drag
      return;
    }
    startDrag(p, e.clientX, e.clientY, copy);
    return;
  }
  if (dist > MOUSE_THRESHOLD_PX) startDrag(p, e.clientX, e.clientY, copy);
}

function onUp(e: PointerEvent) {
  const p = press;
  if (!p || e.pointerId !== p.pointerId) return;
  if (current) {
    const copy = e.ctrlKey || e.metaKey;
    // Ctrl/Cmd changed without a key event we saw: re-resolve against the last hit (same resolver,
    // no layout read). The cells are the same, but the push and any overflow can differ from the
    // highlight, since a copy leaves the originals in place (Ruling 21).
    if (copy !== current.copy) reresolve(copy);
    const s = current;
    stopDrag();
    endPress();
    if (!p.touch) swallowNextClick();
    commitDrop(s);
    return;
  }
  const menu = p.touch && p.ready ? p.onMenu : undefined;
  endPress();
  menu?.(p.x, p.y, p.target);
}

function onCancel(e: PointerEvent) {
  if (!press || e.pointerId !== press.pointerId) return;
  cancelDrag('The drag was interrupted, so nothing changed.');
}

function onOut(e: PointerEvent) {
  if (current && e.relatedTarget === null) cancelDrag('The pointer left the window, so the drag was cancelled — nothing changed.');
}

function onBlur() {
  if (current) cancelDrag('The window lost focus, so the drag was cancelled — nothing changed.');
  else endPress();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (!current) return; // a bare press leaves Escape to everyone else
    // Consumed: Escape ends the drag only (no overlay closes, no selection clears).
    e.preventDefault();
    e.stopImmediatePropagation();
    cancelDrag(current.resize ? 'Resize cancelled — nothing changed.' : undefined);
    return;
  }
  if (current && (e.key === 'Control' || e.key === 'Meta')) reresolve(true);
}

function onKeyUp(e: KeyboardEvent) {
  if (current && (e.key === 'Control' || e.key === 'Meta')) reresolve(e.ctrlKey || e.metaKey);
}

/** The page scrolled during a resize: re-resolve (the content moved under the pointer). */
function onScroll() {
  if (current?.resize) schedule();
}

/** A touch press owns the long-press: no native context menu (Android) while it is live. */
function onContextMenu(e: Event) {
  if (press?.touch || current) {
    e.preventDefault();
    e.stopPropagation();
  }
}

/** Once drag-ready (or dragging) on touch, the page must not scroll under the finger. */
function onTouchMove(e: TouchEvent) {
  if ((press?.touch && press.ready) || current) e.preventDefault();
}

let attached = false;
function attach() {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  document.addEventListener('pointerout', onOut);
  window.addEventListener('blur', onBlur);
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });
  window.addEventListener('contextmenu', onContextMenu, { capture: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('scroll', onScroll, { passive: true });
}
function detach() {
  if (!attached || current) return;
  attached = false;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  document.removeEventListener('pointerout', onOut);
  window.removeEventListener('blur', onBlur);
  window.removeEventListener('keydown', onKeyDown, { capture: true });
  window.removeEventListener('keyup', onKeyUp, { capture: true });
  window.removeEventListener('contextmenu', onContextMenu, { capture: true });
  window.removeEventListener('touchmove', onTouchMove);
  window.removeEventListener('scroll', onScroll);
}

function begin(e: PointerEvent, el: HTMLElement, id: string | undefined, onMenu: Press['onMenu'], tab?: string) {
  const touch = e.pointerType === 'touch';
  press = {
    pointerId: e.pointerId,
    touch,
    x: e.clientX,
    y: e.clientY,
    target: e.target,
    id,
    tab,
    // Measured on press (never in pointermove): the grab point and the ghost's size.
    rect: id || tab !== undefined ? env.measure(el) : undefined,
    onMenu,
    ready: false,
    timer: null
  };
  if (touch) {
    const mine = press;
    mine.timer = setTimeout(() => {
      if (press === mine) {
        mine.ready = true;
        mine.timer = null;
      }
    }, TOUCH_HOLD_MS);
  }
  attach();
}

/** Pointer events already claimed by an inner item (the innermost item wins; outer ones ignore it). */
const claimed = new WeakSet<Event>();

/** A primary-button press that no inner item has claimed, and no drag in progress. */
function claimable(e: PointerEvent): boolean {
  if (current || claimed.has(e)) return false;
  if (press) {
    const second = press.pointerId !== e.pointerId;
    endPress(); // a press left over from a lost pointerup, or a second finger (pinch): start afresh
    if (second) return false;
  }
  return e.pointerType === 'touch' || e.button === 0;
}

/**
 * The non-passive `touchmove` guard a drag source needs, present ONLY while editing is enabled.
 * Browsers only honour preventDefault on a touchmove whose listener was registered non-passive
 * BEFORE the touch began, so it is added as soon as the source is enabled (entering edit mode
 * re-runs the action's update, well before any edit-mode touch). In view mode there is none: a
 * non-passive touch listener makes the browser wait on the main thread before scrolling, which
 * is jank on the low-end wall tablets (Tenet 4).
 */
function touchGuard(el: HTMLElement, enabled: boolean) {
  let on = false;
  const set = (want: boolean) => {
    if (want === on) return;
    on = want;
    if (want) el.addEventListener('touchmove', onTouchMove, { passive: false });
    else el.removeEventListener('touchmove', onTouchMove);
  };
  set(enabled);
  return set;
}

export interface DragSourceParams {
  id: string;
  enabled: boolean;
  /** Touch long-press released without moving: open this item's menu. */
  onMenu?: (x: number, y: number) => void;
}

/** Svelte action for an item in the editing renderer: drag it (and the selection), or long-press for its menu. */
export function dragSource(el: HTMLElement, params: DragSourceParams) {
  let prm = params;
  const down = (e: PointerEvent) => {
    if (!prm.enabled || !ownsTarget(el, e.target) || !claimable(e)) return;
    claimed.add(e);
    begin(e, el, prm.id, prm.onMenu ? (x, y) => prm.onMenu!(x, y) : undefined);
  };
  // A link or image inside a tile must not start the browser's own drag (it would cancel ours).
  const nativeDrag = (e: DragEvent) => {
    if (prm.enabled) e.preventDefault();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('dragstart', nativeDrag);
  const guard = touchGuard(el, prm.enabled);
  return {
    update(next: DragSourceParams) {
      prm = next;
      guard(prm.enabled);
    },
    destroy() {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('dragstart', nativeDrag);
      guard(false);
      if (press && !current && press.id === prm.id) endPress();
    }
  };
}

export interface ResizeSourceParams {
  id: string;
  edge: ResizeEdge;
  /** The RENDERED metrics of the container the node sits in (one geometry source). */
  metrics: ContainerMetrics;
  enabled: boolean;
}

/**
 * Svelte action for a resize handle: a drag of the handle resizes its node (the closest
 * `data-node-id` element) through this same engine. The handle's press wins over the node's own
 * dragSource (the innermost claim wins).
 */
export function resizeSource(el: HTMLElement, params: ResizeSourceParams) {
  let prm = params;
  const down = (e: PointerEvent) => {
    if (!prm.enabled || !claimable(e)) return;
    claimed.add(e);
    const nodeEl = (el.closest('[data-node-id]') as HTMLElement | null) ?? el;
    begin(e, nodeEl, undefined, undefined);
    if (press) {
      press.resize = { id: prm.id, edge: prm.edge, metrics: prm.metrics, scroll: env.scroll() };
      press.rect = env.measure(nodeEl); // measured on press, never in pointermove
    }
  };
  el.addEventListener('pointerdown', down);
  const guard = touchGuard(el, prm.enabled);
  return {
    update(next: ResizeSourceParams) {
      prm = next;
      guard(prm.enabled);
    },
    destroy() {
      el.removeEventListener('pointerdown', down);
      guard(false);
      if (press && !current && press.resize?.id === prm.id) endPress();
    }
  };
}

export interface PressMenuParams {
  enabled: boolean;
  onMenu: (x: number, y: number, target: EventTarget | null) => void;
}

/**
 * Svelte action for a container's empty space: a touch long-press (400 ms, held still) released
 * without moving opens the container menu. The same press mechanism as dragSource (Ruling 18(1)).
 */
export function pressMenu(el: HTMLElement, params: PressMenuParams) {
  let prm = params;
  const down = (e: PointerEvent) => {
    if (!prm.enabled || e.pointerType !== 'touch' || !claimable(e)) return;
    claimed.add(e);
    begin(e, el, undefined, (x, y, t) => prm.onMenu(x, y, t));
  };
  el.addEventListener('pointerdown', down);
  return {
    update(next: PressMenuParams) {
      prm = next;
    },
    destroy() {
      el.removeEventListener('pointerdown', down);
    }
  };
}

export interface TabSourceParams {
  tabId: string;
  enabled: boolean;
}

/**
 * Svelte action for a tab button: drag it along the tab bar to reorder the tabs (the same press,
 * thresholds, frame loop, cancel and commit as item drags). A press without movement is an
 * ordinary click (switch tab); after a mouse drag the click is swallowed.
 */
export function tabSource(el: HTMLElement, params: TabSourceParams) {
  let prm = params;
  const down = (e: PointerEvent) => {
    if (!prm.enabled || !claimable(e)) return;
    claimed.add(e);
    begin(e, el, undefined, undefined, prm.tabId);
  };
  el.addEventListener('pointerdown', down);
  const guard = touchGuard(el, prm.enabled);
  return {
    update(next: TabSourceParams) {
      prm = next;
      guard(prm.enabled);
    },
    destroy() {
      el.removeEventListener('pointerdown', down);
      guard(false);
      if (press && !current && press.tab === prm.tabId) endPress();
    }
  };
}

// ---- the active tab: a drag is resolved against the tab it is shown on

let activeTab: string | null = null;
let deliberateSwitch = false;
/** The tab the drag itself asked to switch to (the switch reaches setActiveTab after a render). */
let allowedTab: string | null = null;
let tabSwitcher: ((tabId: string) => boolean | void) | null = null;

/** The editor's active tab (DragLayer reports it). A change during a drag cancels the drag, unless the drag asked for it. */
export function setActiveTab(tabId: string | null): void {
  const prev = activeTab;
  activeTab = tabId;
  if (!current || prev === tabId) return;
  if (deliberateSwitch || (allowedTab !== null && tabId === allowedTab)) {
    allowedTab = null;
    setState({ ...current, tabId: tabId ?? undefined });
    pending = { ...current.pointer };
    schedule();
    return;
  }
  cancelDrag('The tab changed during the drag, so nothing was dropped.');
}

/** Dashboard (through DragLayer) registers how to show a tab; the drag uses it for tab dwell and crumbs. */
export function setTabSwitcher(fn: ((tabId: string) => boolean | void) | null): void {
  tabSwitcher = fn;
}

/** The drag's own tab switch: it continues on the new tab. */
function switchDragTab(tabId: string): void {
  if (!tabSwitcher) {
    toast.error("Couldn't switch tab during the drag — drop on the tab button instead.");
    return;
  }
  allowedTab = tabId;
  let ok: boolean | void = false;
  try {
    ok = tabSwitcher(tabId);
  } catch (e) {
    ok = false;
    toast.error(`Couldn't switch tab during the drag: ${message(e, 'unknown error')}`);
  }
  // A switch that did not happen must not leave a later, unrelated tab change pre-approved.
  if (ok === false && activeTab !== tabId) allowedTab = null;
}

/** For a tab switch the drag itself asks for (Task 8's tab dwell): the drag continues. */
export function switchTabWithinDrag(fn: () => void): void {
  deliberateSwitch = true;
  try {
    fn();
  } finally {
    deliberateSwitch = false;
  }
}

// A drag never survives a change to the draft it was resolved against (an undo, a save
// rebase, the session ending): its highlight would be stale, so it is cancelled.
session.subscribe((s) => {
  // A new session (none, or another dashboard) shows the phone reorder notice again.
  const sid = s?.dashboardId ?? null;
  if (sid !== phoneNoticeSession) {
    phoneNoticeSession = sid;
    phoneNoticeShown = false;
  }
  if (current && s?.draft !== draftAtStart) {
    cancelDrag('The dashboard changed during the drag, so nothing was dropped.');
  }
});

export function resetDragForTests(): void {
  stopDrag();
  endPress();
  memo = null;
  env = domEnv;
  activeTab = null;
  deliberateSwitch = false;
  allowedTab = null;
  tabSwitcher = null;
}

