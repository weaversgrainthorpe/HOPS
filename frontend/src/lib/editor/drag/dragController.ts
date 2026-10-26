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
 * Task 7 resolves `place` (the tab's grid, with pushAside) and `invalid`. Task 8 adds:
 * - `merge`: the dragged item's VISUAL centre (the ghost's centre: pointer − grab offset + half the
 *   ghost) held in a tile's centre zone (the inner 50% of its RENDERED box) for MERGE_DWELL_MS; the
 *   drop makes a new folder of both and opens its dialog. The edge zone places. Users aim with the
 *   ghost, not the cursor (Ruling 29), and a "hold to make a folder" cue with progress shows from the
 *   moment the centre enters the zone until the dwell ripens.
 * - `into-folder`: the centre zone of a folder → the end of its order. (M5: folders open in place;
 *   holding over a minimised folder no longer opens a pop-over, §3a.4.)
 * M5 Task 4 (ordered, paged folders; targets.ts): a drop on an open folder's page goes in at the
 * pointer's place in its order (`place` with an index and an insertion marker); its title bar, a
 * go-up target (an outer box's title bar, M5 §7) or an empty open folder → `into-folder` (the end). Holding over the page
 * bar's ‹ › flips the page, and over a crumb goes back up to it (this browser's memory); the drag
 * goes on there. A sub-folder dropped on the tab is minimised there and this browser forgets its
 * open / page / drill memory (§3a.3).
 * - `tab-append`: a drop on a tab button; held there for OPEN_DWELL_MS, the tab switches and the
 *   drag continues there. The DragBreadcrumb's tab crumbs return to the tab the drag started on the
 *   same way.
 * - tab reorder (`tab-order`, from `tabSource`) through this same engine.
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
  TreeOpError, copyNodes, deleteNodes, firstFreeCell, isDescendant, locate, mergeIntoNewFolder, moveBetween, moveNodes,
  pushAside, reorderTabs, resolveContainer, type ContainerRef
} from '../treeOps';
import {
  containerOfNode, currentDraft, documentIds, findIn, forgetMovedOutFolders, nodesOf, placementsFor, sizeFor
} from '../editorActions';
import { canvasStacked, editorDialog, editorMenu, openDialog, ownsTarget } from '../editorUi';
import { commitResize, resizeBlocked, resizeTarget, type ResizeEdge, type ResizeTarget } from '../resize';
import { readingIds, stackPlans } from './stacked';
import { apply, session, undo } from '$lib/stores/editSession';
import { toast } from '$lib/stores/toast';
import { clearSelection, selectionInDraft, toggleNode } from '$lib/stores/nodeSelection';
import { hitTest as domHitTest, type HitResult } from './hitTest';
import { crumbDwellKey, dwellArgs, flowIndex, flowMarker, pageDwellKey } from './targets';
import { drillUpTo, setFolderPage } from '$lib/stores/folderView';
import {
  cancelDropAnimations, claimFlourish, outStarts, playDropAnimation, playOutOfFolders, sayAnimationFailure,
  type Box as AnimBox, type OutStart
} from './dropAnimation';

// ---------------------------------------------------------------- types

/** An insertion marker (viewport px): a vertical bar, or a horizontal one when `width` is set. */
export interface Marker {
  left: number;
  top: number;
  height: number;
  width?: number;
}

export type DropTarget =
  | {
      kind: 'place'; to: ContainerRef; at: Placement[]; push: Map<string, Placement>;
      /** Stacked (phone) layout: where in the reading order it goes. */
      marker?: Marker;
      /** Into a folder (ordered, M5): the index in its order; `at` is then empty. */
      index?: number;
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
  /** The hover being timed (merge, tab, crumb); ripe once held long enough. */
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
  /**
   * The ghost's size as drawn now, when it differs from `ghost`: over an open folder's page it is
   * that folder's item size — what the item would be there (walkthrough 1, Ruling 11) — still held
   * at the same fraction (`grab`). The visual centre (merge zone) follows it. Absent = `ghost`'s size.
   */
  ghostShown?: { widthPx: number; heightPx: number };
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
/** Held over a tab or a crumb this long → go there. */
export const OPEN_DWELL_MS = 600;

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

/**
 * The dragged item's visual centre in viewport px: the ghost is drawn at pointer − grab × size, so
 * its centre is pointer − grab offset + half the ghost. Without a ghost (or grab) it is the pointer.
 */
export function visualCentre(state: Pick<DragState, 'pointer' | 'grab' | 'ghost' | 'ghostShown'>): { x: number; y: number } {
  const g = state.ghost ? (state.ghostShown ?? state.ghost) : undefined;
  const grab = state.grab;
  if (!g || !grab) return { ...state.pointer };
  return {
    x: state.pointer.x + (0.5 - grab.fx) * g.widthPx,
    y: state.pointer.y + (0.5 - grab.fy) * g.heightPx
  };
}

/**
 * The (non-dragged) item the dragged item's visual centre is over, its viewport box, and whether
 * that centre is in the item's centre zone (inner 50%). The item is `hit.centreNode` (hit-tested at
 * the visual centre by the frame) when present, else the item under the pointer.
 */
function zoneOf(state: DragState, hit: HitResult): { id: string; centre: boolean; box: Box } | null {
  let box: Box & { id: string };
  if (hit.centreNode !== undefined) {
    if (hit.centreNode === null) return null;
    box = hit.centreNode;
  } else {
    const n = hit.node;
    if (!n || !hit.container) return null;
    box = { id: n.id, left: hit.container.left + n.left, top: hit.container.top + n.top, width: n.width, height: n.height };
  }
  if (state.ids.includes(box.id) || !(box.width > 0) || !(box.height > 0)) return null;
  const c = visualCentre(state);
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  return {
    id: box.id,
    box: { left: box.left, top: box.top, width: box.width, height: box.height },
    centre: Math.abs(c.x - cx) <= box.width / 4 && Math.abs(c.y - cy) <= box.height / 4
  };
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
 * Merge `ids` onto tile `tileId` as one new folder (treeOps.mergeIntoNewFolder). Used by the trial
 * run and the commit.
 */
function mergeDrop(
  d: LayoutDashboard, ids: string[], tileId: string, allIds: Set<string>
): { dashboard: LayoutDashboard; folderId: string } {
  return mergeIntoNewFolder(d, ids, tileId, allIds);
}

/**
 * Into a container: a tab at its first free cells, a folder at the end of its order (a drop on a
 * folder or a tab button). Trial-run like place.
 */
function resolveAppend(state: DragState, to: ContainerRef, draft: LayoutDashboard): DropTarget {
  return memoised(JSON.stringify(['append', state.ids, state.copy, to]), draft, () => {
    try {
      const nodes = nodesOf(draft, state.ids);
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
 * side of it (by its x half). Gaps between tabs, the edit handles and the bar past the last tab resolve
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
 * THE drop resolver: pure, used for the highlight every frame and (through state.target) for the
 * commit. On a tab: the cells under the ghost, neighbours pushed aside (Ruling 11: the push map is
 * part of the target and the op is trial-run here, so a highlighted target never throws on commit);
 * stored footprints count, so a minimised folder's reserved cells are occupied (Ruling 13). Items
 * keep their relative offsets when they come from one tab; otherwise the others take the first free
 * cells. On a folder's page (ordered, M5): the pointer's place in its order (resolveFlow); on its
 * title bar, a crumb or an empty open folder: the end of its order. Zones and hit boxes are RENDERED
 * geometry (Ruling 13); a tile's centre zone becomes a merge only once state.dwell has ripened on it;
 * a folder's centre zone is into-folder; tab buttons are tab-append; the drag breadcrumb is
 * navigation only.
 */
export function resolveDrop(state: DragState, hit: HitResult, draft: LayoutDashboard): DropTarget {
  if (state.tab !== undefined) return resolveTabOrder(state, hit, draft);
  if (hit.crumb !== undefined) return invalid('Dropping on the path changes nothing — hold over a crumb to go back to that level.');
  if (hit.tabId !== undefined) return resolveTabAppend(state, hit.tabId, draft);
  // An open folder's own targets (M5 §3.4, §3a.4, §7): a go-up target (outer box title), its innermost title bar, its empty body.
  if (hit.folderCrumb) return resolveIntoFolder(state, hit.folderCrumb.to, draft);
  if (hit.folderBar) return resolveIntoFolder(state, hit.folderBar.folderId, draft);
  if (hit.emptyFolder !== undefined) return resolveIntoFolder(state, hit.emptyFolder.folderId, draft);
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
  if (to.folderId !== undefined) return resolveFlow(state, hit, draft, to);

  let r: ReturnType<typeof resolveContainer>;
  let nodes: LayoutNode[];
  try {
    r = resolveContainer(draft, to);
    nodes = nodesOf(draft, ids);
  } catch (e) {
    return invalid(message(e, "That can't go there."));
  }
  const m = c.metrics;
  if (!(m.unitPx > 0) || !(m.rowPx > 0)) return invalid("That area can't be measured right now; try again.");
  const cols = r.columns;
  const sizes = nodes.map((n) => {
    const s = sizeFor(n);
    return { w: Math.min(s.w, cols), h: s.h };
  });
  const moving = state.copy ? new Set<string>() : idSet;

  // The grabbed item's top-left cell: the ghost's top-left, rounded to the nearest cell. The ghost is
  // the grabbed item's size, or over a tab for items from a folder the group's (ownTabCells).
  const grab = state.grab ?? { fx: 0, fy: 0 };
  const ghostCells = (to.folderId === undefined ? ownTabCells(state, draft) : undefined) ?? sizes[0];
  const gw = Math.min(ghostCells.w, cols), gh = ghostCells.h;
  const x0 = Math.round((hit.dx - grab.fx * gw * m.unitPx) / m.unitPx);
  const y0 = Math.round((hit.dy - grab.fy * gh * m.rowPx) / m.rowPx);

  // Offsets from the grabbed item, when every item comes from one tab (items from a folder have no
  // placement: they take the first free cells).
  const origins = ids.map((id) => containerOfNode(draft, id));
  const together = origins.every((o) => sameRef(o, origins[0])) && nodes.every((n) => !!n.placement);
  const p0 = nodes[0].placement;
  const wanted: (Placement | null)[] = nodes.map((n, i) => {
    if (i > 0 && !together) return null;
    const pi = n.placement;
    return {
      x: x0 + (i > 0 && pi && p0 ? Math.round(pi.x - p0.x) : 0),
      y: y0 + (i > 0 && pi && p0 ? Math.round(pi.y - p0.y) : 0),
      w: sizes[i].w,
      h: sizes[i].h
    };
  });
  // Shift the group (as one) inside the columns and below the top edge.
  const placed = wanted.filter((w): w is Placement => !!w);
  const minX = Math.min(...placed.map((w) => w.x));
  const maxR = Math.max(...placed.map((w) => w.x + w.w));
  const minY = Math.min(...placed.map((w) => w.y));
  const sx = minX < 0 ? -minX : maxR > cols ? cols - maxR : 0;
  if (minX + sx < 0) return invalid(`Those items don't fit across ${cols} columns here.`);
  const sy = minY < 0 ? -minY : 0;
  for (const w of placed) {
    w.x += sx;
    w.y += sy;
  }

  const key = JSON.stringify([ids, state.copy, to, wanted, m.unitPx, m.rowPx]);
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
      if (t && at.some((a) => overlaps(a, t!))) t = null; // a group can collide with itself
      if (!t) {
        t = firstFreeCell(work, sizes[i].w, sizes[i].h);
        t.h = sizes[i].h;
      } else {
        for (const [pid, pp] of pushAside(work, new Set(), t)) {
          push.set(pid, pp);
          work.children = work.children.map((k) => (k.id === pid ? ({ ...k, placement: pp } as LayoutNode) : k));
        }
      }
      const z = n.placement?.z;
      if (typeof z === 'number' && Number.isFinite(z)) t = { ...t, z };
      at.push(t);
      slot(i, t);
    });

    // Trial-run the very op the commit will run (Ruling 11): a highlighted target never throws.
    const target: DropTarget = { kind: 'place', to, at, push };
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
 * A drop on an open folder's page (M5 §3.4): at the pointer's place in the folder's order
 * (targets.flowIndex: before the item under the pointer, or at the end of the page shown), shown by
 * an insertion marker. Trial-run through the very op the commit runs (Ruling 11). A page whose
 * position can't be read is refused with a reason, never guessed.
 */
function resolveFlow(state: DragState, hit: HitResult, draft: LayoutDashboard, to: ContainerRef): DropTarget {
  const fp = hit.flowPage;
  if (
    !fp || fp.folderId !== to.folderId || !Number.isInteger(fp.page) || fp.page < 0 ||
    !Number.isInteger(fp.perPage) || fp.perPage < 1
  ) {
    return invalid("That folder's page can't be read right now, so the drop can't be placed; try again.");
  }
  let order: string[];
  try {
    order = resolveContainer(draft, to).container.children.map((n) => n.id);
  } catch (e) {
    return invalid(message(e, "That can't go there."));
  }
  const ids = state.ids;
  const moving: ReadonlySet<string> = state.copy ? new Set<string>() : new Set(ids);
  const slot = flowIndex(order, moving, fp, hit.dx, hit.dy);
  const m = hit.container?.metrics;
  const marker = flowMarker(slot, fp, hit.container ?? { left: 0, top: 0 }, m?.flow ? m.flow.span * m.unitPx : 40);
  const t = memoised(JSON.stringify(['flow', ids, state.copy, to, slot.index]), draft, () => {
    try {
      if (state.copy) copyNodes(draft, ids, to, slot.index, documentIds());
      else moveBetween(draft, ids, to, slot.index);
      return { kind: 'place', to, at: [], push: new Map(), index: slot.index } as DropTarget;
    } catch (e) {
      return invalid(e instanceof TreeOpError ? e.message : message(e, "That can't go there."));
    }
  });
  return t.kind === 'place' ? { ...t, marker } : t;
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
    nodes = nodesOf(draft, ids);
  } catch (e) {
    return invalid(message(e, "That can't go there."));
  }
  const cols = r.columns;
  const moving: ReadonlySet<string> = state.copy ? new Set<string>() : new Set(ids);
  const others = readingIds(r.container).filter((id) => !moving.has(id));
  const slot = stackSlot(hit, new Set(others));
  const index = slot ? others.indexOf(slot.id) + (slot.after ? 1 : 0) : others.length;
  const marker = stackMarker(slot, hit.container ?? { left: 0, top: 0 });
  if (r.kind === 'folder') {
    // A folder is ordered (M5): the index is the drop, nothing is placed.
    const t = memoised(JSON.stringify(['stack-folder', ids, state.copy, to, index]), draft, () => {
      try {
        if (state.copy) copyNodes(draft, ids, to, index, documentIds());
        else moveBetween(draft, ids, to, index);
        return { kind: 'place', to, at: [], push: new Map(), index } as DropTarget;
      } catch (e) {
        return invalid(e instanceof TreeOpError ? e.message : message(e, "That can't go there."));
      }
    });
    return t.kind === 'place' ? { ...t, marker } : t;
  }
  const target = memoised(JSON.stringify(['stack', ids, state.copy, to, index]), draft, () => {
    const sizes = nodes.map((n) => sizeFor(n));
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
  if (t.index !== undefined) {
    // In a folder's order: one item dropped at its own place (the index counts the others).
    return ids.length === 1 && sameRef(containerOfNode(d, ids[0]), t.to) && locate(d, ids[0])?.index === t.index;
  }
  return ids.every((id, i) => {
    const n = findIn(d, id);
    if (!n || !sameRef(containerOfNode(d, id), t.to)) return false;
    const a = n.placement, b = t.at[i];
    return !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
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
  // §9: the dropped (or resized, or merged) items keep their own landing; the edit glide moves only
  // the neighbours the drop pushed or reflowed.
  claimFlourish(t.kind === 'resize' ? [t.id] : t.kind === 'merge' ? [...state.ids, t.targetTileId] : state.ids);

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
    claimFlourish([folderId]); // it pops with the merge, never also with the pop-in
    clearSelection();
    announce(label, before);
    // Name it straight away: the dialog opens with "New folder" selected; Cancel keeps that name.
    // Ruling 3: when the merge animates, the dialog opens as the animation ends (~500 ms; its onEnd,
    // which always runs: finished, interrupted, failed, or at its safety net, MERGE_DIALOG_CAP_MS after
    // it starts when the browser never reports the end), so the pop is not hidden behind it; at once
    // otherwise. Only the dialog waits, never the edit. Undone meanwhile (the folder is gone), or
    // another dialog opened: nothing to name here.
    let opened = false;
    const nameIt = () => {
      if (opened) return;
      opened = true;
      const now = currentDraft();
      // Not over a new drag that interrupted the animation (cancelDropAnimations ends it early).
      if (!now || !locate(now, folderId) || get(editorDialog) !== null || current !== null) return;
      openDialog({ kind: 'folder', id: folderId });
    };
    let animating = false;
    decorate(() => {
      const from = ghostBox(state);
      if (from && state.over) {
        animating = playDropAnimation(d.id, {
          kind: 'merge', from, to: state.over, label: state.ghost?.label ?? '',
          targetLabel: findIn(d, t.targetTileId)?.name ?? '', folderId, onEnd: nameIt
        });
      }
    });
    // A cap timed from the drop would open the dialog over a merge still playing whenever its first
    // frame comes late (a busy device): the animation's own safety net is the cap (see safetyNet).
    if (!animating) nameIt();
    return;
  }

  let to: ContainerRef;
  let at: Placement[] | number;
  let push: Map<string, Placement> | undefined;
  if (t.kind === 'place') {
    if (!state.copy && unchanged(d, state.ids, t)) return; // put back where it was: no change, no undo step
    to = t.to;
    at = t.index ?? t.at;
    push = t.index === undefined ? t.push : undefined;
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
  // §8.1: the items leaving a folder (for the tab, another folder or an outer box) — where each was
  // is measured now, before the change is drawn, so each can pop out of there.
  const leaving = leavingFolders(d, state.ids, to);
  let starts: OutStart[] = [];
  if (leaving.length) decorate(() => { starts = outStarts(d.id, leaving); });
  let newIds: string[] = [];
  const ok = apply(label, (dd) => {
    if (!state.copy) return moveBetween(dd, state.ids, to, at, push);
    const r = copyNodes(dd, state.ids, to, at, documentIds(), push);
    newIds = r.newIds;
    return r.dashboard;
  });
  if (!ok) return; // apply has already said why
  claimFlourish(newIds); // the copies land where they were dropped: no pop-in as well
  if (state.copy) {
    clearSelection();
    newIds.forEach((id) => toggleNode(id, true));
  } else {
    forgetMovedOutFolders(before, state.ids, to); // §3a.3: drawn minimised on the tab
  }
  announce(label, before);
  if (leaving.length) {
    decorate(() => playOutOfFolders(d.id, starts, {
      landed: (id) => (state.copy ? newIds[state.ids.indexOf(id)] : id),
      label: (id) => findIn(d, id)?.name ?? '',
      intoId: to.folderId,
      // The grabbed item, if neither it, its folder nor its tab's button is drawn: it drops in onto
      // its spot from where its ghost was at the drop (or from above it, when that is the same place).
      fallbackFrom: (id) => (id === state.ids[0] ? ghostBox(state) : null)
    }));
  }
  // M6 §7.13 / Ruling 5: into a folder (a minimised one, an open one's bar or page, a sub-folder tile,
  // a drilled-in inner box) the dropped item flies into it and the folder gulps. A reorder inside the same folder is not a drop "into", so it is not animated.
  else if (to.folderId !== undefined && (state.copy || !state.ids.every((id) => sameRef(containerOfNode(before, id), to)))) {
    const folderId = to.folderId;
    const landed = state.copy ? newIds[0] : state.ids[0];
    decorate(() => {
      const from = ghostBox(state);
      if (!from) return;
      const over = t.kind === 'into-folder' ? state.over : undefined;
      playDropAnimation(d.id, {
        kind: 'into', from, label: state.ghost?.label ?? '', folderId,
        // The cue's box when there was one; otherwise where the item is now drawn (an open folder's
        // page), else the folder itself. Measured once, on the next frame, after the draft has rendered.
        to: over ?? (() => boxOfNode(landed) ?? boxOfNode(folderId))
      });
    });
  }
  // Ruling 24: the first phone (stacked) reorder of a session says what else it changes. A folder's
  // order (an index) is the same at every width, so it changes nothing else.
  if (t.kind === 'place' && t.marker && t.index === undefined && !phoneNoticeShown) {
    phoneNoticeShown = true;
    toast.info(PHONE_REORDER_NOTICE);
  }
}

/**
 * Run a drop's decoration (M6 §7.13) after its change is already in the draft. Nothing it does can
 * undo or delay that change: a throw here is caught (playDropAnimation itself never throws and says
 * a failure once; this guard covers building its arguments).
 */
function decorate(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    sayAnimationFailure(e); // said once per page with a toast, not only logged (review M1)
  }
}

/** §8.1: the moved items that leave a folder for somewhere else, each with the folder it leaves. */
function leavingFolders(d: LayoutDashboard, ids: string[], to: ContainerRef): { id: string; sourceId: string; tabId: string }[] {
  const out: { id: string; sourceId: string; tabId: string }[] = [];
  for (const id of ids) {
    const src = containerOfNode(d, id);
    if (src?.folderId !== undefined && !sameRef(src, to)) out.push({ id, sourceId: src.folderId, tabId: src.tabId });
  }
  return out;
}

/** Where the ghost was drawn at the drop (viewport px), as DragLayer draws it. */
function ghostBox(s: DragState): AnimBox | null {
  if (!s.ghost) return null;
  const g = s.grab ?? { fx: 0, fy: 0 };
  const size = s.ghostShown ?? s.ghost;
  return { left: s.pointer.x - g.fx * size.widthPx, top: s.pointer.y - g.fy * size.heightPx, width: size.widthPx, height: size.heightPx };
}

/** A node's rendered box now (one layout read, on the frame after a drop), or null when it isn't drawn. */
function boxOfNode(id: string | undefined): AnimBox | null {
  if (!id || typeof document === 'undefined') return null;
  const el = Array.from(document.querySelectorAll<HTMLElement>('[data-node-id]')).find(
    (n) => n.getAttribute('data-node-id') === id && !n.closest('[inert], [role="dialog"]')
  );
  if (!el) return null;
  const r = env.measure(el);
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
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
  // A new drag stops any drop animation still running: the item just landed is drawn as it is
  // (never left hidden under a ghost) and can be dragged again at once.
  cancelDropAnimations();
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
  const stored = clampPlacement(n.placement!, m.columns); // resizeBlocked refused anything not on a tab
  const rect = p.rect;
  const b = nodeBox(stored, m);
  const view0 = rect ? { left: rect.left - b.leftPx, top: rect.top - b.topPx } : undefined;
  beginDragging(d, {
    ids: [],
    copy: false,
    pointer: { x, y },
    target: null,
    resize: {
      id: spec.id, edge: spec.edge, startW: stored.w, startH: stored.h, storedH: stored.h,
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
  const next: DragState = { ...s, pointer: { x: at.x, y: at.y } };
  const hit = hitFor(next);
  lastHit = hit;
  next.dwell = dwellFor(next, hit, d, s.dwell);
  next.target = resolveDrop(next, hit, d);
  // Stacked containers have no cell geometry to highlight: their drop shows as a marker instead.
  next.view = hit.container && hit.container.layout !== 'stacked'
    ? { left: hit.container.left, top: hit.container.top, metrics: hit.container.metrics }
    : undefined;
  next.over = overFor(next, next.target, hit);
  const slot = next.target.kind === 'tab-order' ? tabSlot(next, hit) : null;
  next.marker = slot
    ? { left: slot.after ? slot.box.left + slot.box.width : slot.box.left, top: slot.box.top, height: slot.box.height }
    : next.target.kind === 'place' ? next.target.marker : undefined;
  setState(next);
  autoScroll(at.x, at.y, hit.scroller);
}

/**
 * The ghost's size over `hit`: what the dragged item would be there (Ruling 11, both ways).
 * - On an open folder's page: the size its items are drawn at (the rendered box of one, else its
 *   contents size in cells).
 * - On a tab's grid, for an item that comes from a folder (`ownCells`: its own span on a tab, as the
 *   drop places it): its OWN size, those cells at the tab's cell size — at once, not on the drop.
 * - Otherwise undefined: the item's own rendered size (a tab item over its tab, the tab bar, a phone).
 */
export function ghostOver(
  hit: HitResult, ownCells?: { w: number; h: number }
): { widthPx: number; heightPx: number } | undefined {
  const c = hit.container;
  if (c && c.layout === 'grid' && c.ref.folderId === undefined && ownCells) {
    const m = c.metrics;
    const w = Math.min(ownCells.w, m.columns) * m.unitPx;
    const h = ownCells.h * m.rowPx;
    return w > 0 && h > 0 ? { widthPx: Math.max(24, w), heightPx: Math.max(24, h) } : undefined;
  }
  if (!c || c.layout !== 'flow') return undefined;
  const b = hit.flowPage?.boxes[0];
  if (b && b.width > 0 && b.height > 0) return { widthPx: b.width, heightPx: b.height };
  const f = c.metrics.flow;
  if (!f) return undefined;
  const side = f.phone ? f.phone.colPx : f.span * c.metrics.unitPx;
  return side > 0 ? { widthPx: Math.max(24, side), heightPx: Math.max(24, side) } : undefined;
}

/**
 * The dragged items' own span on a tab (what the drop there places, resolveDrop's sizes), when any
 * of them comes from inside a folder — there they are drawn at the folder's item size, not their own.
 * For a group (multi-select) it is the GROUP's: its largest item's span (review round, walkthrough 1
 * D), never just the first item's; the grabbed item lands at the ghost's top-left. Undefined when
 * every item is already on a tab (the rendered box is the grabbed item's own size).
 */
function ownTabCells(s: DragState, d: LayoutDashboard | null = currentDraft()): { w: number; h: number } | undefined {
  if (!d || s.ids.length === 0) return undefined;
  if (s.ids.every((id) => containerOfNode(d, id)?.folderId === undefined)) return undefined;
  let w = 0, h = 0;
  for (const id of s.ids) {
    const n = findIn(d, id);
    if (!n) continue;
    const c = sizeFor(n);
    w = Math.max(w, c.w);
    h = Math.max(h, c.h);
  }
  return w > 0 && h > 0 ? { w, h } : undefined;
}

/**
 * The hit test for an item drag's frame: what is under the pointer, plus (when the ghost's visual
 * centre is elsewhere) the item under that centre, which the merge / into-folder zone is judged by.
 * Layout reads happen only here, once per frame (Tenet 4).
 */
function hitFor(s: DragState): HitResult {
  const dragged = new Set(s.ids);
  const hit = env.hitTest(s.pointer.x, s.pointer.y, dragged);
  s.ghostShown = s.tab === undefined && s.ghost ? ghostOver(hit, ownTabCells(s)) : undefined;
  if (s.tab !== undefined || s.ids.length === 0 || !s.ghost || !s.grab) return hit;
  const c = visualCentre(s);
  if (Math.abs(c.x - s.pointer.x) < 0.5 && Math.abs(c.y - s.pointer.y) < 0.5) return hit;
  const ch = env.hitTest(c.x, c.y, dragged);
  const n = ch.node;
  return {
    ...hit,
    centreNode: n && ch.container
      ? { id: n.id, left: ch.container.left + n.left, top: ch.container.top + n.top, width: n.width, height: n.height }
      : null
  };
}

/**
 * The viewport box the merge / into-folder / tab-append cue is drawn on. While a merge dwell is
 * still running (target = place) it is the tile being held over: the "hold to make a folder" cue.
 */
function overFor(s: DragState, t: DropTarget, hit: HitResult): Box | undefined {
  // Into an open folder through a go-up target, its title bar or empty body: the cue is on that target / bar / body.
  const bar = hit.folderCrumb?.rect ?? hit.folderBar?.rect ?? hit.emptyFolder?.rect;
  if (t.kind === 'into-folder' && bar) return { ...bar };
  if (t.kind === 'merge' || t.kind === 'into-folder' || (s.dwell?.key.startsWith('merge:') && !s.dwell.ripe)) {
    const z = zoneOf(s, hit);
    if (z?.centre) return z.box;
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

// ---- dwell: hold over a target to merge, switch tab, return via a crumb, flip a folder's page or go up its path

/** What holding still over `hit` would do, as a key and a duration; null = nothing to wait for. */
function dwellKey(s: DragState, hit: HitResult, d: LayoutDashboard): { key: string; ms: number } | null {
  if (s.tab !== undefined) return null;
  if (hit.crumb !== undefined) return crumbAction(hit.crumb) ? { key: `crumb:${hit.crumb}`, ms: OPEN_DWELL_MS } : null;
  if (hit.tabId !== undefined) return hit.tabId !== activeTab ? { key: `tab:${hit.tabId}`, ms: OPEN_DWELL_MS } : null;
  // An open folder's page bar: ‹ / › flips the page (none at that end); an outer box's title goes back up.
  if (hit.pageBar) {
    const b = hit.pageBar;
    const to = b.page + (b.dir === 'next' ? 1 : -1);
    return !b.disabled && Number.isInteger(to) && to >= 0 ? { key: pageDwellKey(b.folderId, to), ms: OPEN_DWELL_MS } : null;
  }
  if (hit.folderCrumb) return { key: crumbDwellKey(hit.folderCrumb.folderId, hit.folderCrumb.to), ms: OPEN_DWELL_MS };
  // A title bar or an empty open folder is "into that folder" whatever is under the ghost: no merge hold.
  if (hit.folderBar || hit.emptyFolder !== undefined) return null;
  if (!hit.container) return null;
  const zone = zoneOf(s, hit);
  if (!zone?.centre) return null;
  const n = findIn(d, zone.id);
  if (n?.kind === 'tile') return { key: `merge:${n.id}`, ms: MERGE_DWELL_MS };
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
    const moved = { ...s, pointer: at };
    const latest = dwellKey(moved, hitFor(moved), d);
    if (latest?.key !== key) {
      schedule(); // the next frame starts the dwell for wherever the pointer is now
      return;
    }
  }
  setState({ ...s, dwell: { ...s.dwell, ripe: true } });
  const [kind, ...rest] = key.split(':');
  const arg = rest.join(':');
  if (kind === 'tab') switchDragTab(arg);
  else if (kind === 'crumb') crumbAction(arg)?.();
  else if (kind === 'page') flipPage(d, arg);
  else if (kind === 'fcrumb') goUpCrumb(d, arg);
  if (current) {
    pending = { ...current.pointer };
    schedule();
  }
}

/** A page-bar dwell ripened: the folder shows that page (this browser's memory); the drag goes on. */
function flipPage(d: LayoutDashboard, arg: string): void {
  const a = dwellArgs<number>(arg);
  try {
    if (!a) throw new Error('unreadable page');
    setFolderPage(d.id, a[0], a[1]);
  } catch (e) {
    toast.error(`Couldn't turn the folder's page during the drag: ${message(e, 'unknown error')}`);
  }
}

/** A crumb dwell ripened: the open folder goes back up to that level (this browser's memory). */
function goUpCrumb(d: LayoutDashboard, arg: string): void {
  const a = dwellArgs<string>(arg);
  if (!a || !drillUpTo(d.id, a[0], a[1])) {
    toast.error("Couldn't go back up to that folder: it is no longer on the folder's path.");
  }
}

/**
 * What a drag-breadcrumb crumb returns to: "tab:<id>" → that tab (switch to it). Null when it is
 * the tab the drag is already on. (A folder's go-up targets — outer box titles — are `fcrumb` dwells.)
 */
export function crumbAction(crumb: string): (() => void) | null {
  if (crumb.startsWith('tab:')) {
    const id = crumb.slice(4);
    return id !== activeTab ? () => switchDragTab(id) : null;
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

function begin(
  e: PointerEvent, el: HTMLElement, id: string | undefined, onMenu: Press['onMenu'], tab?: string,
  measure?: DragSourceParams['measure']
) {
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
    rect: id || tab !== undefined ? (measure ? measure(e.clientX, e.clientY) : env.measure(el)) : undefined,
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
  /**
   * The grabbed item's box at a press at (x, y), when the element pressed is not the item's own box
   * (an inset box's title bar is its sub-folder, Ruling 14: it is grabbed as that sub-folder's tile).
   * Default: the element's rendered box.
   */
  measure?: (x: number, y: number) => { left: number; top: number; width: number; height: number };
}

/** Svelte action for an item in the editing renderer: drag it (and the selection), or long-press for its menu. */
export function dragSource(el: HTMLElement, params: DragSourceParams) {
  let prm = params;
  const down = (e: PointerEvent) => {
    if (!prm.enabled || !ownsTarget(el, e.target) || !claimable(e)) return;
    claimed.add(e);
    begin(e, el, prm.id, prm.onMenu ? (x, y) => prm.onMenu!(x, y) : undefined, undefined, prm.measure);
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

