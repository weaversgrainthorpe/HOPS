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
  | { kind: 'movecopy'; ids: string[] }
  /** Edit a tab of the draft (TabEditModal, mounted by Dashboard). */
  | { kind: 'tab'; id: string };

export const editorDialog = writable<EditorDialog | null>(null);

export type MenuTarget =
  | { kind: 'node'; id: string }
  | { kind: 'container'; ref: ContainerRef; cell?: Cell }
  /** A tab in the tab bar: Edit, Duplicate, Delete (the same menu, §4B). */
  | { kind: 'tab'; id: string };

export interface MenuRequest {
  x: number;
  y: number;
  target: MenuTarget;
}

export const editorMenu = writable<MenuRequest | null>(null);

/**
 * The editing canvas is in the phone (stacked) layout: no resize handles;
 * the toolbar shows a one-line hint. TabCanvas sets it while editing.
 */
export const canvasStacked = writable(false);

export function openDialog(d: EditorDialog): void {
  editorMenu.set(null);
  editorDialog.set(d);
}

export function openMenu(m: MenuRequest): void {
  editorMenu.set(m);
}

/**
 * A tab the editor asks the dashboard to show (after a menu Duplicate shows the copy). Dashboard
 * takes it (and clears it); a request for a tab it does not have is reported, never dropped.
 */
export const showTabRequest = writable<string | null>(null);

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
