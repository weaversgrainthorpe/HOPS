import { writable, readonly, get, type Readable, type Writable } from 'svelte/store';
import type { Container, FolderNode, LayoutDashboard, LayoutNode, LayoutTab } from '$lib/types/layout';
import { folderInnerColumns, minimisedPlacement, resolveMode } from '$lib/layout/geometry';

/** A viewer's own choice for one folder; absent = follow the saved `display`. */
export type FolderViewState = 'collapsed' | 'expanded' | 'maximised';
type Views = Record<string, FolderViewState>;

const keyFor = (dashboardId: string) => `hops.folderView.${dashboardId}`;
const isState = (v: unknown): v is FolderViewState => v === 'collapsed' || v === 'expanded' || v === 'maximised';

// Per-browser memory only (localStorage; nothing is sent to the server). Unreadable,
// corrupt or unwritable storage deliberately degrades to in-memory state, no error:
// this is a viewing convenience, not data.
function load(dashboardId: string): Views {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(keyFor(dashboardId));
  } catch {
    return {};
  }
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Views = {};
  let maximised = false;
  for (const [id, v] of Object.entries(parsed)) {
    if (!isState(v)) continue;
    if (v === 'maximised') {
      if (maximised) continue;
      maximised = true;
    }
    out[id] = v;
  }
  return out;
}

function save(dashboardId: string, v: Views): void {
  try {
    localStorage.setItem(keyFor(dashboardId), JSON.stringify(v));
  } catch {
    /* in-memory only (storage full, blocked or private mode) */
  }
}

const stores = new Map<string, Writable<Views>>();
function storeFor(dashboardId: string): Writable<Views> {
  let s = stores.get(dashboardId);
  if (!s) {
    s = writable<Views>(load(dashboardId));
    stores.set(dashboardId, s);
  }
  return s;
}

/** Test hook: forget every cached store so the next read reloads from storage. */
export function resetFolderViewsForTests(): void {
  stores.clear();
}

export function folderViewFor(dashboardId: string): Readable<Views> {
  return readonly(storeFor(dashboardId));
}

export function setFolderView(dashboardId: string, folderId: string, s: FolderViewState): void {
  const st = storeFor(dashboardId);
  const next: Views = { ...get(st) };
  if (s === 'maximised') {
    for (const id of Object.keys(next)) if (next[id] === 'maximised') delete next[id];
  }
  next[folderId] = s;
  st.set(next);
  save(dashboardId, next);
}

/** Restore: forget the remembered view so the folder follows its saved default again. */
export function clearFolderView(dashboardId: string, folderId: string): void {
  const st = storeFor(dashboardId);
  const next: Views = { ...get(st) };
  delete next[folderId];
  st.set(next);
  save(dashboardId, next);
}

/** How a folder is drawn in place; maximised draws expanded in place plus the panel. */
export function effectiveDisplay(folder: FolderNode, remembered: FolderViewState | undefined): 'collapsed' | 'expanded' {
  if (remembered === 'collapsed') return 'collapsed';
  if (remembered === 'expanded' || remembered === 'maximised') return 'expanded';
  return folder.display === 'collapsed' ? 'collapsed' : 'expanded';
}

/** True when the remembered view differs from what the saved default would show. */
export function differsFromSaved(saved: FolderNode['display'] | undefined, remembered: FolderViewState | undefined): boolean {
  if (remembered === undefined) return false;
  const savedState: FolderViewState = saved === 'collapsed' ? 'collapsed' : 'expanded';
  return remembered !== savedState;
}

/** Outermost-first chain of folders ending at `id`, or null when it is not under `c`. */
export function findFolderChain(c: Container | undefined, id: string): FolderNode[] | null {
  const kids = Array.isArray(c?.children) ? c!.children : [];
  for (const n of kids) {
    if (!n || (n as { kind?: unknown }).kind !== 'folder') continue;
    const f = n as FolderNode;
    if (f.id === id) return [f];
    const inner = findFolderChain(f.content, id);
    if (inner) return [f, ...inner];
  }
  return null;
}

/**
 * The tab as this viewer sees it: each remembered folder re-displayed. A minimised
 * folder (saved expanded) shrinks to its tile (geometry.minimisedPlacement) and keeps
 * its inner column count, so opening it shows the same content; nothing else moves.
 * Ids with no folder in the tab are ignored silently (a deleted folder's memory).
 * Returns the SAME tab object when nothing applies.
 */
export function applyFolderViews(dash: LayoutDashboard, tab: LayoutTab, views: Views): LayoutTab {
  if (Object.keys(views).length === 0) return tab;

  function walk(c: Container, chain: FolderNode[]): Container {
    const kids = Array.isArray(c?.children) ? c.children : [];
    const mode = resolveMode(dash, tab, chain);
    let changed = false;
    const next = kids.map((n: LayoutNode) => {
      if (!n || (n as { kind?: unknown }).kind !== 'folder') return n;
      const f = n as FolderNode;
      const inner = f.content ? walk(f.content, [...chain, f]) : f.content;
      const v = views[f.id];
      const display = v === undefined ? f.display : effectiveDisplay(f, v);
      const shrink = v === 'collapsed' && f.display !== 'collapsed' && !!f.placement;
      let out = f;
      if (inner !== f.content || display !== f.display || shrink) {
        out = { ...f, display, ...(inner !== f.content ? { content: inner } : {}) } as FolderNode;
        if (shrink) {
          out.placement = minimisedPlacement(f.placement, mode, tab);
          out.content = { ...out.content, columns: folderInnerColumns(f) };
        }
      }
      if (out !== f) changed = true;
      return out;
    });
    return changed ? { ...c, children: next } : c;
  }

  const root = walk(tab.root, []);
  return root === tab.root ? tab : { ...tab, root };
}

/** Context TabCanvas gives its folders: the viewer's remembered view and the saved default. */
export const FOLDER_VIEW_CONTEXT = 'hops.folderViewContext';
export interface FolderViewContext {
  dashboardId: string;
  remembered(folderId: string): FolderViewState | undefined;
  /** The folder's saved `display` (before this viewer's choice was applied). */
  saved(folderId: string): FolderNode['display'] | undefined;
}
