/**
 * Which editor menu or dialog is open. The editing renderer (ContainerView,
 * FolderView), the toolbar and the keyboard ask for one here; EditorDialogs
 * (mounted once by Dashboard in edit mode) renders it. Display state only:
 * the edits themselves go through editorActions → editSession.apply.
 */
import { writable, get } from 'svelte/store';
import type { ContainerRef } from './treeOps';
import { locate } from './treeOps';
import type { Cell } from './editorActions';
import { overlayStack } from '$lib/stores/folderOverlay';
import { session } from '$lib/stores/editSession';

export type EditorDialog =
  /** id set: edit that tile; otherwise a new tile going into `to` (at `cell` if free). */
  | { kind: 'tile'; id?: string; to?: ContainerRef; cell?: Cell }
  | { kind: 'folder'; id?: string; to?: ContainerRef; cell?: Cell }
  | { kind: 'movecopy'; ids: string[] };

export const editorDialog = writable<EditorDialog | null>(null);

export type MenuTarget =
  | { kind: 'node'; id: string }
  | { kind: 'container'; ref: ContainerRef; cell?: Cell };

export interface MenuRequest {
  x: number;
  y: number;
  target: MenuTarget;
}

export const editorMenu = writable<MenuRequest | null>(null);

export function openDialog(d: EditorDialog): void {
  editorMenu.set(null);
  editorDialog.set(d);
}

export function openMenu(m: MenuRequest): void {
  editorMenu.set(m);
}

/**
 * Where an add or paste without a target goes: the folder of the top open
 * overlay when it is on this tab, else the tab root.
 */
export function currentContainer(tabId: string): ContainerRef {
  const stack = get(overlayStack);
  const top = stack[stack.length - 1];
  const s = get(session);
  if (top && s) {
    const loc = locate(s.draft, top);
    if (loc && loc.tabId === tabId) return { tabId, folderId: top };
  }
  return { tabId };
}

/**
 * True when `target` belongs to `el` itself rather than to an item (or nested container) inside
 * it: the closest [data-node-id] at or above the target is not inside `el`. Used so a long-press
 * opens only the innermost menu.
 */
export function ownsTarget(el: Element, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const n = target.closest('[data-node-id]');
  return !n || n === el || !el.contains(n);
}

/** Viewport position for a menu opened from the keyboard (no pointer position): the element's corner. */
export function menuPointFor(e: MouseEvent, el: Element): { x: number; y: number } {
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
  const r = el.getBoundingClientRect();
  return { x: r.left + Math.min(24, r.width / 2), y: r.top + Math.min(24, r.height / 2) };
}

/**
 * Touch long-press (~500 ms, no movement beyond 8 px) opens the item menu, as right-click does.
 * INTERIM (Ruling 18(1)): Task 7's drag engine starts a touch drag on a 400 ms long-press and
 * replaces this timer with its own long-press handling (menu vs drag), so the two never race.
 */
export function longPress(node: HTMLElement, open: (x: number, y: number, target: EventTarget | null) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number; target: EventTarget | null } | null = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    start = null;
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    cancel();
    start = { x: e.clientX, y: e.clientY, target: e.target };
    timer = setTimeout(() => {
      const at = start;
      cancel();
      if (at) open(at.x, at.y, at.target);
    }, 500);
  };
  const move = (e: PointerEvent) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel();
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  return {
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
    }
  };
}
