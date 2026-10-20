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
 * Task 7 resolves `place` (grid with pushAside, free with 8 px units) and `invalid`. Task 8 adds
 * `merge`, `into-folder` (dwell into collapsed folders), `tab-append`, the breadcrumb and guides:
 * they extend resolveDrop's cases and commitDrop's switch; `dwell` is reserved for their timers.
 */
import { writable, type Readable } from 'svelte/store';
import type { Container, LayoutDashboard, LayoutNode, Placement } from '$lib/types/layout';
import type { ContainerMetrics } from '$lib/layout/geometry';
import { clampPlacement, isRenderable } from '$lib/layout/geometry';
import {
  TreeOpError, copyNodes, firstFreeCell, freeSide, isDescendant, locate, moveNodes, originOf, pushAside,
  resolveContainer, type ContainerRef
} from '../treeOps';
import { adaptedFor, containerOfNode, currentDraft, documentIds, findIn, sizeFor } from '../editorActions';
import { editorMenu, ownsTarget } from '../editorUi';
import { apply, session, undo } from '$lib/stores/editSession';
import { toast } from '$lib/stores/toast';
import { clearSelection, selectionInDraft, toggleNode } from '$lib/stores/nodeSelection';
import { hitTest as domHitTest, type HitResult } from './hitTest';

// ---------------------------------------------------------------- types

export type DropTarget =
  | { kind: 'place'; to: ContainerRef; at: Placement[]; push: Map<string, Placement> }
  | { kind: 'merge'; targetTileId: string }
  | { kind: 'into-folder'; folderId: string; at: Placement[] }
  | { kind: 'tab-append'; tabId: string }
  | { kind: 'invalid'; reason: string };

export interface DragState {
  /** Dragged ids; the first is the item that was grabbed. */
  ids: string[];
  /** Ctrl/Cmd held: the drop copies (shown as "+" on the ghost). */
  copy: boolean;
  pointer: { x: number; y: number };
  /** The last resolved (= highlighted) target. */
  target: DropTarget | null;
  /** Reserved for Task 8's dwell timers (merge, collapsed folder, tab, crumb). */
  dwell?: { key: string; since: number };
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
}

const domEnv: DragEnv = {
  hitTest: (x, y, dragged) => domHitTest(x, y, dragged),
  raf: (cb) => requestAnimationFrame(cb),
  cancelRaf: (id) => cancelAnimationFrame(id),
  measure: (el) => el.getBoundingClientRect(),
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  scrollBy: (dx, dy) => window.scrollBy(dx, dy)
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

// ---------------------------------------------------------------- the one resolver

const invalid = (reason: string): DropTarget => ({ kind: 'invalid', reason });

const overlaps = (a: Placement, b: Placement): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const sameRef = (a: ContainerRef | undefined, b: ContainerRef | undefined): boolean =>
  !!a && !!b && a.tabId === b.tabId && (a.folderId ?? null) === (b.folderId ?? null);

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function draftIds(d: LayoutDashboard): Set<string> {
  const out = new Set<string>();
  const walk = (c: Container | undefined) => {
    for (const n of Array.isArray(c?.children) ? c!.children : []) {
      if (!n || typeof n.id !== 'string') continue;
      out.add(n.id);
      if (n.kind === 'folder') walk(n.content);
    }
  };
  for (const t of d.tabs) {
    out.add(t.id);
    walk(t.root);
  }
  return out;
}

/** One-entry memo of the validated result (inputs are immutable, so this is transparent). */
let memo: { key: string; draft: LayoutDashboard; target: DropTarget } | null = null;

/**
 * THE drop resolver: pure, used for the highlight every frame and (through state.target) for the
 * commit. Grid: the cells under the ghost, neighbours pushed aside (Ruling 11: the push map is part
 * of the target and the op is trial-run here, so a highlighted target never throws on commit);
 * stored footprints count, so a collapsed folder's reserved cells are occupied (Ruling 13). Free:
 * the 8 px design unit under the ghost, overlap allowed. Selections keep their relative offsets
 * when they come from one container; otherwise the others take the first free cells.
 */
export function resolveDrop(state: DragState, hit: HitResult, draft: LayoutDashboard): DropTarget {
  const c = hit.container;
  if (!c) return invalid('Drop it on the dashboard or inside a folder.');
  if (c.layout === 'stacked') {
    return invalid("Dragging to a position isn't available in the narrow (stacked) layout yet — use Cut and Paste.");
  }
  const ids = state.ids;
  if (ids.length === 0) return invalid('Nothing is being dragged.');
  const to = c.ref;
  const idSet = new Set(ids);
  for (const id of ids) {
    const loc = locate(draft, id);
    if (!loc) return invalid('That item no longer exists.');
    if (!isRenderable(findIn(draft, id))) return invalid("That item can't be drawn, so it can't be dragged.");
    if (loc.folderChain.some((f) => idSet.has(f))) {
      return invalid("An item can't be dragged together with the folder that contains it.");
    }
    if (to.folderId !== undefined && (to.folderId === id || isDescendant(draft, id, to.folderId))) {
      return invalid("A folder can't go inside itself.");
    }
  }
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

  // The grabbed item's top-left cell: the ghost's top-left, rounded to the nearest cell / unit.
  const grab = state.grab ?? { fx: 0, fy: 0 };
  const x0 = Math.round((hit.dx - grab.fx * sizes[0].w * m.unitPx) / m.unitPx);
  const y0 = Math.round((hit.dy - grab.fy * sizes[0].h * m.rowPx) / m.rowPx);

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

  const key = JSON.stringify([ids, state.copy, to, r.mode, wanted]);
  if (memo && memo.draft === draft && memo.key === key) return memo.target;

  const at: Placement[] = [];
  const push = new Map<string, Placement>();
  const moving = state.copy ? new Set<string>() : idSet;
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
  let target: DropTarget = { kind: 'place', to, at, push };
  try {
    if (state.copy) copyNodes(draft, ids, to, at, draftIds(draft), push);
    else moveNodes(draft, ids, to, at, push);
  } catch (e) {
    target = invalid(e instanceof TreeOpError ? e.message : message(e, "That can't go there."));
  }
  memo = { key, draft, target };
  return target;
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
  if (t.kind !== 'place') {
    toast.error("That kind of drop isn't available yet, so nothing changed.");
    return;
  }
  const d = currentDraft();
  if (!d) {
    toast.error('Not editing: click Edit first.');
    return;
  }
  if (!state.copy && unchanged(d, state.ids, t)) return; // put back where it was: no change, no undo step
  const label = `${state.copy ? 'Copied' : 'Moved'} ${describe(d, state.ids)} to ${destName(d, t.to)}`;
  let newIds: string[] = [];
  const ok = apply(label, (dd) => {
    if (!state.copy) return moveNodes(dd, state.ids, t.to, t.at, t.push);
    const r = copyNodes(dd, state.ids, t.to, t.at, documentIds(), t.push);
    newIds = r.newIds;
    return r.dashboard;
  });
  if (!ok) return; // apply has already said why
  if (state.copy) {
    clearSelection();
    newIds.forEach((id) => toggleNode(id, true));
  }
  const after = currentDraft();
  toast.add({
    type: 'success',
    message: label,
    duration: 8000,
    action: {
      label: 'Undo',
      onClick: () => {
        if (currentDraft() === after) undo();
        else toast.info('Other changes were made after that drop. Use Undo in the toolbar (Ctrl+Z) to step back through them.');
      }
    }
  });
}

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

function startDrag(p: Press, x: number, y: number, copy: boolean) {
  const d = currentDraft();
  if (!d || !p.id || !locate(d, p.id)) {
    endPress();
    return;
  }
  const ids = dragIds(d, p.id);
  const rect = p.rect ?? { left: p.x, top: p.y, width: 1, height: 1 };
  const frac = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  draftAtStart = d;
  editorMenu.set(null);
  if (typeof document !== 'undefined') document.body.classList.add('hops-dragging');
  setState({
    ids,
    copy,
    pointer: { x, y },
    target: null,
    grab: {
      fx: rect.width > 0 ? frac((p.x - rect.left) / rect.width) : 0,
      fy: rect.height > 0 ? frac((p.y - rect.top) / rect.height) : 0
    },
    ghost: { widthPx: Math.max(24, rect.width), heightPx: Math.max(24, rect.height), label: label(d, ids) }
  });
  pending = { x, y };
  schedule();
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
  const hit = env.hitTest(at.x, at.y, new Set(s.ids));
  lastHit = hit;
  const next: DragState = { ...s, pointer: { x: at.x, y: at.y } };
  next.target = resolveDrop(next, hit, d);
  next.view = hit.container ? { left: hit.container.left, top: hit.container.top, metrics: hit.container.metrics } : undefined;
  setState(next);
  autoScroll(at.x, at.y);
}

/** Near the top or bottom edge of the viewport, scroll (and keep scrolling while held there). */
function autoScroll(x: number, y: number) {
  const vp = env.viewport();
  let dy = 0;
  if (y < EDGE_PX) dy = -Math.ceil(((EDGE_PX - y) / EDGE_PX) * MAX_SCROLL_PX);
  else if (y > vp.height - EDGE_PX) dy = Math.ceil(((y - (vp.height - EDGE_PX)) / EDGE_PX) * MAX_SCROLL_PX);
  if (dy === 0) return;
  env.scrollBy(0, Math.max(-MAX_SCROLL_PX, Math.min(MAX_SCROLL_PX, dy)));
  pending = { x, y };
  schedule();
}

/** Re-resolve against the last hit (no layout read) after the copy flag changes. */
function reresolve(copy: boolean) {
  const s = current;
  const d = currentDraft();
  if (!s || !d || s.copy === copy) return;
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
  pending = null;
  lastHit = null;
  draftAtStart = null;
  setState(null);
  if (typeof document !== 'undefined') document.body.classList.remove('hops-dragging');
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
    if (!p.id) {
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
    if (!current && !press) return;
    // Consumed: Escape ends the drag only (no overlay closes, no selection clears).
    e.preventDefault();
    e.stopImmediatePropagation();
    cancelDrag();
    return;
  }
  if (current && (e.key === 'Control' || e.key === 'Meta')) reresolve(true);
}

function onKeyUp(e: KeyboardEvent) {
  if (current && (e.key === 'Control' || e.key === 'Meta')) reresolve(e.ctrlKey || e.metaKey);
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
}

function begin(e: PointerEvent, el: HTMLElement, id: string | undefined, onMenu: Press['onMenu']) {
  const touch = e.pointerType === 'touch';
  press = {
    pointerId: e.pointerId,
    touch,
    x: e.clientX,
    y: e.clientY,
    target: e.target,
    id,
    // Measured on press (never in pointermove): the grab point and the ghost's size.
    rect: id ? env.measure(el) : undefined,
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
  return {
    update(next: DragSourceParams) {
      prm = next;
    },
    destroy() {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('dragstart', nativeDrag);
      if (press && !current && press.id === prm.id) endPress();
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

// A drag never survives a change to the draft it was resolved against (an undo, a save
// rebase, the session ending): its highlight would be stale, so it is cancelled.
session.subscribe((s) => {
  if (current && s?.draft !== draftAtStart) {
    cancelDrag('The dashboard changed during the drag, so nothing was dropped.');
  }
});

export function resetDragForTests(): void {
  stopDrag();
  endPress();
  memo = null;
  env = domEnv;
}

