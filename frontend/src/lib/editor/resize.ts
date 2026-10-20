/**
 * Resizing (M3 §5.6, plan Task 9): the one resolver and commit shared by the resize handles
 * (a pointer drag through the drag engine) and the keyboard (Shift+Arrow on the selection).
 *
 * - Folders (expanded) and tiles in FREE containers resize; grid tiles are one cell (their v2
 *   `size` stays in the tile dialog); a collapsed folder renders as one cell, so it has no
 *   handles (Ruling 13) — it is expanded first.
 * - The phone (stacked) layout has no resizing.
 * - Grid: a resize that would overlap pushes the neighbours aside (Ruling 11); the push is part of
 *   the target and trial-run here, so what the preview shows is exactly what the commit stores.
 * - An expanded folder is never smaller than its content (treeOps.resizedPlacement clamps).
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
  /** Grid neighbours pushed aside (Ruling 11); empty in free containers. */
  push: Map<string, Placement>;
}
export type ResizeResult = ResizeTarget | { kind: 'invalid'; reason: string };

/** The phone hint (toolbar) and the reason a resize is refused there. */
export const NARROW_HINT = 'Resize and free placement need a wider screen';
export const COLLAPSED_HINT =
  'This folder is collapsed, so it shows as one cell — choose "Start expanded" in its menu to resize it.';
export const GRID_TILE_HINT = 'A tile in a grid is one cell — change its Size in the tile dialog instead.';

/** Why `id` can't be resized here, or null when it can. */
export function resizeBlocked(d: LayoutDashboard, id: string, stacked: boolean): string | null {
  const n = findIn(d, id);
  if (!n) return 'That item no longer exists.';
  if (!isRenderable(n)) return "That item can't be drawn, so it can't be resized.";
  if (stacked) return `${NARROW_HINT}.`;
  const ref = containerOfNode(d, id);
  if (!ref) return 'That item no longer exists.';
  let mode: 'grid' | 'free';
  try {
    mode = resolveContainer(d, ref).mode;
  } catch (e) {
    return e instanceof Error && e.message ? e.message : 'That item no longer exists.';
  }
  if (n.kind === 'tile' && mode === 'grid') return GRID_TILE_HINT;
  if (n.kind === 'folder' && n.display === 'collapsed') return COLLAPSED_HINT;
  return null;
}

/** THE resize resolver: `id` at w x h (cells / design units), with the push, trial-run. Pure. */
export function resizeTarget(d: LayoutDashboard, id: string, w: number, h: number): ResizeResult {
  try {
    const to = containerOfNode(d, id);
    if (!to) return { kind: 'invalid', reason: 'That item no longer exists.' };
    const r = resolveContainer(d, to);
    const at = resizedPlacement(d, id, w, h);
    const push = r.mode === 'grid' ? pushAside(r.container, new Set([id]), at) : new Map<string, Placement>();
    resizeNode(d, id, at.w, at.h, push); // the very op the commit runs: a shown target never throws
    return { kind: 'resize', id, to, at, push };
  } catch (e) {
    return { kind: 'invalid', reason: e instanceof Error && e.message ? e.message : "That size isn't possible here." };
  }
}

/** True when the target changes nothing (same size, nothing pushed). */
export function resizeUnchanged(d: LayoutDashboard, t: ResizeTarget): boolean {
  const n = findIn(d, t.id);
  return !!n && t.push.size === 0 && n.placement.w === t.at.w && n.placement.h === t.at.h;
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
 * Keyboard resize (Shift+Arrow): grow or shrink `id` by one cell (grid) or one 8 px unit (free).
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
  const t = resizeTarget(d, id, Math.max(1, n.placement.w + dw), Math.max(1, n.placement.h + dh));
  if (t.kind === 'invalid') {
    toast.error(t.reason);
    return false;
  }
  if (resizeUnchanged(d, t)) {
    const name = n.name || 'Untitled';
    toast.info(
      dw < 0 || dh < 0
        ? `"${name}" can't get any smaller${n.kind === 'folder' ? ' than its content' : ''}.`
        : `"${name}" can't get any bigger here.`
    );
    return false;
  }
  return commitResize(t) !== null;
}
