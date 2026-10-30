/**
 * Resizing : the one resolver and commit shared by the resize handles
 * (a pointer drag through the drag engine) and the keyboard (Shift+Arrow on the selection).
 *
 * - Only open folders on a tab resize. A tile's span is set by its Size in the tile dialog
 *   (Small 1 x 1, Medium 2 x 2, Large 4 x 4); a minimised folder renders as a tile of its size,
 *   so it has no handles — it is opened first; items inside a folder take its contents
 *   size and order.
 * - The phone (stacked) layout has no resizing.
 * - A resize that would overlap pushes the neighbours aside; the push is part of the
 *   target and trial-run here, so what the preview shows is exactly what the commit stores.
 * - Handles snap to whole cells (free resize is gone with free layout). An open folder is never
 *   smaller than its bar, padding, one item and the page bar (treeOps.resizedPlacement clamps to
 *   geometry.minOpenFolderCells); it pages its contents instead of growing to fit them.
 */
import { get } from 'svelte/store';
import type { Placement } from '$lib/types/layout';
import { isRenderable } from '$lib/layout/geometry';
import { pushAside, resizeNode, resizedPlacement, resolveContainer, type ContainerRef } from './treeOps';
import { containerOfNode, currentDraft, findIn } from './editorActions';
import { canvasStacked } from './editorUi';
import type { LayoutDashboard } from '$lib/types/layout';
import { apply } from '$lib/stores/editSession';
import { toast } from '$lib/stores/toast';

export type ResizeEdge = 'corner' | 'right' | 'bottom';

export interface ResizeTarget {
  kind: 'resize';
  id: string;
  to: ContainerRef;
  /** The node's placement after the resize (clamped exactly as the commit will). */
  at: Placement;
  /** Neighbours pushed aside. */
  push: Map<string, Placement>;
  /** Set when the asked-for size was clamped (the folder's minimum, the tab's width): shown, never silent. */
  limit?: string;
}
export type ResizeResult = ResizeTarget | { kind: 'invalid'; reason: string };

/** The phone hint (toolbar) and the reason a resize is refused there. */
export const NARROW_HINT = 'Resizing needs a wider screen';
export const COLLAPSED_HINT =
  'This folder is minimised, so it has no resize handles — click it (or choose "Open" in its menu) to open it in place and resize it.';
export const GRID_TILE_HINT = 'A tile takes the space of its Size — change its Size in the tile dialog instead.';
export const IN_FOLDER_HINT = "Items inside a folder take the folder's contents size — set it in the folder's dialog.";

/** Why `id` can't be resized here, or null when it can. */
export function resizeBlocked(d: LayoutDashboard, id: string, stacked: boolean): string | null {
  const n = findIn(d, id);
  if (!n) return 'That item no longer exists.';
  if (!isRenderable(n)) return "That item can't be drawn, so it can't be resized.";
  if (stacked) return `${NARROW_HINT}.`;
  const ref = containerOfNode(d, id);
  if (!ref) return 'That item no longer exists.';
  if (ref.folderId !== undefined) return IN_FOLDER_HINT;
  if (n.kind === 'tile') return GRID_TILE_HINT;
  if (n.display === 'collapsed') return COLLAPSED_HINT;
  return null;
}

/** THE resize resolver: `id` at w x h (cells / design units), with the push, trial-run. Pure. */
export function resizeTarget(d: LayoutDashboard, id: string, w: number, h: number): ResizeResult {
  try {
    const to = containerOfNode(d, id);
    if (!to) return { kind: 'invalid', reason: 'That item no longer exists.' };
    const r = resolveContainer(d, to);
    const at = resizedPlacement(d, id, w, h);
    const push = pushAside(r.container, new Set([id]), at);
    resizeNode(d, id, at.w, at.h, push); // the very op the commit runs: a shown target never throws
    const limit = limitNote(at, w, h);
    return limit ? { kind: 'resize', id, to, at, push, limit } : { kind: 'resize', id, to, at, push };
  } catch (e) {
    return { kind: 'invalid', reason: e instanceof Error && e.message ? e.message : "That size isn't possible here." };
  }
}

/** Why the size `at` differs from the asked-for w x h, or undefined when it doesn't. */
function limitNote(at: Placement, w: number, h: number): string | undefined {
  const notes: string[] = [];
  if (at.h > h) notes.push("can't be any shorter: it needs room for its title, one item and the page bar");
  if (at.w > w) notes.push("can't be any narrower: it needs room for one item");
  if (at.w < w) notes.push("can't be any wider here: it reaches the edge of the tab");
  if (!notes.length) return undefined;
  const text = notes.join('; and ');
  return text[0].toUpperCase() + text.slice(1);
}

/** True when the target changes nothing (same size, nothing pushed). */
export function resizeUnchanged(d: LayoutDashboard, t: ResizeTarget): boolean {
  const n = findIn(d, t.id);
  return !!n && t.push.size === 0 && n.placement?.w === t.at.w && n.placement?.h === t.at.h;
}

/**
 * Store exactly `t` as one undo step ('Resize …'). Returns the label when it changed the draft,
 * '' when there was nothing to change, and null when it was refused (apply has said why).
 */
export function commitResize(t: ResizeTarget): string | null {
  const d = currentDraft();
  if (!d) {
    toast.error('Not editing: click Edit first.');
    return null;
  }
  if (!findIn(d, t.id)) {
    toast.error('That item no longer exists, so nothing changed.');
    return null;
  }
  if (resizeUnchanged(d, t)) return '';
  const label = `Resize "${findIn(d, t.id)?.name || 'Untitled'}"`;
  return apply(label, (dd) => resizeNode(dd, t.id, t.at.w, t.at.h, t.push)) ? label : null;
}

/**
 * Keyboard resize (Shift+Arrow): grow or shrink `id` by one cell.
 * Never a silent no-op: a refusal or a size that can't change is told in a toast.
 */
export function resizeBy(id: string, dw: number, dh: number): boolean {
  const d = currentDraft();
  if (!d) return false;
  const blocked = resizeBlocked(d, id, get(canvasStacked));
  if (blocked) {
    toast.info(blocked);
    return false;
  }
  const n = findIn(d, id)!;
  const cur = n.placement!; // resizeBlocked refused anything without a placement
  const t = resizeTarget(d, id, Math.max(1, cur.w + dw), Math.max(1, cur.h + dh));
  if (t.kind === 'invalid') {
    toast.error(t.reason);
    return false;
  }
  if (resizeUnchanged(d, t)) {
    const name = n.name || 'Untitled';
    toast.info(
      dw < 0 || dh < 0
        ? `"${name}" can't get any smaller: it needs room for its title, one item and the page bar.`
        : `"${name}" can't get any bigger here.`
    );
    return false;
  }
  return commitResize(t) !== null;
}
