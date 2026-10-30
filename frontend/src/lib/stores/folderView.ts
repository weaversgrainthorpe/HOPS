import { writable, readonly, get, type Readable, type Writable } from 'svelte/store';
import type { Container, FolderNode, LayoutDashboard, LayoutNode, LayoutTab } from '$lib/types/layout';
import { minimisedPlacement } from '$lib/layout/geometry';

/**
 * This browser's memory of how each folder is viewed. Nothing here is ever sent to
 * the server or saved to the layout:
 * - the view: a folder minimised or open (absent = follow the saved `display`; edit mode shows the
 *   saved layout, so it ignores this);
 * - the page each folder shows, and the sub-folders an open folder is drilled into (both apply in
 *   edit mode too: they are how its contents are reached).
 * Two states only: a "maximised" written by an older build reads as open.
 */
export type FolderViewState = 'collapsed' | 'expanded';
type Views = Record<string, FolderViewState>;
/** Per folder id: its page (> 0 only), and an open folder's drill path (sub-folder ids, outermost first). */
export interface FolderNav {
  page: Record<string, number>;
  drill: Record<string, string[]>;
}

const viewKey = (dashboardId: string) => `hops.folderView.${dashboardId}`;
const navKey = (dashboardId: string) => `hops.folderNav.${dashboardId}`;

// Per-browser memory only (localStorage). Unreadable, corrupt or unwritable storage deliberately
// degrades to in-memory state, no error: this is a viewing convenience, not data.
function read(key: string): unknown {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* in-memory only (storage full, blocked or private mode) */
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isPage = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isPath = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x !== '');

function loadViews(dashboardId: string): Views {
  const parsed = read(viewKey(dashboardId));
  if (!isRecord(parsed)) return {};
  const out: Views = {};
  for (const [id, v] of Object.entries(parsed)) {
    if (v === 'collapsed' || v === 'expanded') out[id] = v;
    else if (v === 'maximised') out[id] = 'expanded'; // maximise is gone; it was open
  }
  return out;
}

function loadNav(dashboardId: string): FolderNav {
  const parsed = read(navKey(dashboardId));
  const out: FolderNav = { page: {}, drill: {} };
  if (!isRecord(parsed)) return out;
  if (isRecord(parsed.page)) for (const [id, v] of Object.entries(parsed.page)) if (isPage(v)) out.page[id] = v;
  if (isRecord(parsed.drill)) for (const [id, v] of Object.entries(parsed.drill)) if (isPath(v)) out.drill[id] = [...v];
  return out;
}

const viewStores = new Map<string, Writable<Views>>();
const navStores = new Map<string, Writable<FolderNav>>();
function viewsOf(dashboardId: string): Writable<Views> {
  let s = viewStores.get(dashboardId);
  if (!s) {
    s = writable<Views>(loadViews(dashboardId));
    viewStores.set(dashboardId, s);
  }
  return s;
}
function navOf(dashboardId: string): Writable<FolderNav> {
  let s = navStores.get(dashboardId);
  if (!s) {
    s = writable<FolderNav>(loadNav(dashboardId));
    navStores.set(dashboardId, s);
  }
  return s;
}

/** Test hook: forget every cached store (and any pending reveal) so the next read reloads from storage. */
export function resetFolderViewsForTests(): void {
  viewStores.clear();
  navStores.clear();
  pending.set(null);
}

export function folderViewFor(dashboardId: string): Readable<Views> {
  return readonly(viewsOf(dashboardId));
}

export function folderNavFor(dashboardId: string): Readable<FolderNav> {
  return readonly(navOf(dashboardId));
}

export function setFolderView(dashboardId: string, folderId: string, s: FolderViewState): void {
  const st = viewsOf(dashboardId);
  const next: Views = { ...get(st), [folderId]: s };
  st.set(next);
  write(viewKey(dashboardId), next);
}

/** Restore: forget the remembered view so the folder follows its saved default again. */
export function clearFolderView(dashboardId: string, folderId: string): void {
  const st = viewsOf(dashboardId);
  const next: Views = { ...get(st) };
  delete next[folderId];
  st.set(next);
  write(viewKey(dashboardId), next);
}

function setNav(dashboardId: string, change: (n: FolderNav) => void): void {
  const st = navOf(dashboardId);
  const cur = get(st);
  const next: FolderNav = { page: { ...cur.page }, drill: { ...cur.drill } };
  change(next);
  st.set(next);
  write(navKey(dashboardId), next);
}

/** The page `folderId` shows (0 = the first, forgotten). A bad page is a caller bug: refused loudly. */
export function setFolderPage(dashboardId: string, folderId: string, page: number): void {
  if (!(Number.isInteger(page) && page >= 0)) throw new Error(`Folder page must be a whole number from 0, not ${page}`);
  setNav(dashboardId, (n) => {
    if (page === 0) delete n.page[folderId];
    else n.page[folderId] = page;
  });
}

/** The sub-folders open folder `folderId` is drilled into, outermost first ([] = its own level). */
export function setFolderDrill(dashboardId: string, folderId: string, path: string[]): void {
  setNav(dashboardId, (n) => {
    if (path.length === 0) delete n.drill[folderId];
    else n.drill[folderId] = [...path];
  });
}

/** Show the last folder of `chain` (outermost first) in place: the outermost remembers the rest as its path. */
export function drillTo(dashboardId: string, chain: string[]): void {
  if (chain.length === 0) return;
  setFolderDrill(dashboardId, chain[0], chain.slice(1));
}

/**
 * Back up open folder `folderId` to level `to` (the folder itself, or a sub-folder
 * on its remembered path): the drag's crumb dwell. False, with nothing changed, when `to`
 * is not on the path (the crumb is stale) — the caller says so.
 */
export function drillUpTo(dashboardId: string, folderId: string, to: string): boolean {
  if (to === folderId) {
    setFolderDrill(dashboardId, folderId, []);
    return true;
  }
  const path = get(navOf(dashboardId)).drill[folderId] ?? [];
  const i = path.indexOf(to);
  if (i < 0) return false;
  setFolderDrill(dashboardId, folderId, path.slice(0, i + 1));
  return true;
}

/**
 * Forget this browser's memory of `folderIds` — open/minimised, page and drill path. A sub-folder
 * moved out to the tab is a minimised folder there, so an "open" remembered from before
 * must not draw it open. No memory of them: nothing is written.
 */
export function forgetFolderMemory(dashboardId: string, folderIds: string[]): void {
  const views = get(viewsOf(dashboardId));
  const nav = get(navOf(dashboardId));
  const ids = folderIds.filter((id) => id in views || id in nav.page || id in nav.drill);
  if (ids.length === 0) return;
  if (ids.some((id) => id in views)) {
    const next: Views = { ...views };
    for (const id of ids) delete next[id];
    viewsOf(dashboardId).set(next);
    write(viewKey(dashboardId), next);
  }
  if (ids.some((id) => id in nav.page || id in nav.drill)) {
    setNav(dashboardId, (n) => {
      for (const id of ids) {
        delete n.page[id];
        delete n.drill[id];
      }
    });
  }
}

/**
 * Folders `folderIds` moved away (a drag, cut/paste or Move to): an open folder drilled
 * into one of them goes back up to the level above it, and the levels cut off — the moved folder and
 * any below it — forget their page and drill memory. Done with the move, so it is never mistaken for
 * "changed elsewhere". Returns the open folders whose path was cut; nothing remembered → no write.
 */
export function closeDrilledInto(dashboardId: string, folderIds: string[]): string[] {
  const moved = new Set(folderIds);
  const nav = get(navOf(dashboardId));
  const cuts: { id: string; keep: string[]; gone: string[] }[] = [];
  for (const [id, path] of Object.entries(nav.drill)) {
    const i = path.findIndex((p) => moved.has(p));
    if (i >= 0) cuts.push({ id, keep: path.slice(0, i), gone: path.slice(i) });
  }
  if (cuts.length === 0) return [];
  setNav(dashboardId, (n) => {
    for (const c of cuts) {
      if (c.keep.length === 0) delete n.drill[c.id];
      else n.drill[c.id] = c.keep;
      for (const g of c.gone) {
        delete n.page[g];
        delete n.drill[g];
      }
    }
  });
  return cuts.map((c) => c.id);
}

/**
 * The remembered drill path below `folder`, as far as it still holds: each id must be a sub-folder
 * directly inside the one before. Stops at the first that is not (gone, moved or now a tile).
 */
export function resolveDrill(folder: FolderNode, path: readonly string[] | undefined): FolderNode[] {
  const out: FolderNode[] = [];
  let at = folder;
  for (const id of path ?? []) {
    const kids = Array.isArray(at.content?.children) ? at.content.children : [];
    const next = kids.find((k) => !!k && (k as { kind?: unknown }).kind === 'folder' && (k as FolderNode).id === id) as
      | FolderNode
      | undefined;
    if (!next || !next.content || !Array.isArray(next.content.children)) break;
    out.push(next);
    at = next;
  }
  return out;
}

/**
 * A reload or an edit may remove a folder this browser is drilled into: trim every drill path of a
 * folder on `tab` to the part that still holds. Returns the folders whose path changed (the caller
 * says so). Memory for folders not on this tab is left alone (they may be on another tab).
 */
export function reconcileNav(dashboardId: string, tab: LayoutTab): string[] {
  const nav = get(navOf(dashboardId));
  const changed: { id: string; path: string[] }[] = [];
  const walk = (c: Container | undefined) => {
    for (const n of Array.isArray(c?.children) ? c!.children : []) {
      if (!n || (n as { kind?: unknown }).kind !== 'folder') continue;
      const f = n as FolderNode;
      const path = nav.drill[f.id];
      if (path) {
        const held = resolveDrill(f, path).map((x) => x.id);
        if (held.length !== path.length) changed.push({ id: f.id, path: held });
      }
      walk(f.content);
    }
  };
  walk(tab.root);
  if (changed.length === 0) return [];
  setNav(dashboardId, (n) => {
    for (const c of changed) {
      if (c.path.length === 0) delete n.drill[c.id];
      else n.drill[c.id] = c.path;
    }
  });
  return changed.map((c) => c.id);
}

/** Search asked for an item's page: the Folder showing `folderId` flips to it once it knows its page size. */
export interface PageReveal {
  dashboardId: string;
  folderId: string;
  itemId: string;
}
const pending = writable<PageReveal | null>(null);
export const pageReveal: Readable<PageReveal | null> = readonly(pending);

/** Take the pending page reveal if it is for `folderId` on `dashboardId` (it is then gone). */
export function takePageReveal(dashboardId: string, folderId: string): PageReveal | null {
  const r = get(pending);
  if (!r || r.dashboardId !== dashboardId || r.folderId !== folderId) return null;
  pending.set(null);
  return r;
}

/** Forget a pending page reveal (the item was not found, or the reveal gave up). */
export function clearPageReveal(): void {
  pending.set(null);
}

/**
 * Search reveal: open the folder chain (outermost first, ending with the folder that holds
 * the item) in place, drill down to the last, and ask that folder to flip to the item's page — all
 * written to this browser's memory, as if the user had done it. `view: false` (edit mode) leaves the
 * open/minimised view alone.
 */
export function revealInFolders(
  dashboardId: string, folderIds: string[], itemId: string, opts: { view?: boolean } = {}
): void {
  if (folderIds.length === 0) return;
  // Edit mode opens the outermost folder in the draft instead (the caller), as its menu's Open does.
  if (opts.view !== false) setFolderView(dashboardId, folderIds[0], 'expanded');
  setFolderDrill(dashboardId, folderIds[0], folderIds.slice(1));
  pending.set({ dashboardId, folderId: folderIds[folderIds.length - 1], itemId });
}

/** How a folder is drawn in place. */
export function effectiveDisplay(folder: FolderNode, remembered: FolderViewState | undefined): 'collapsed' | 'expanded' {
  if (remembered === 'collapsed') return 'collapsed';
  if (remembered === 'expanded') return 'expanded';
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
 * The tab as this viewer sees it: each remembered folder re-displayed. Every collapsed
 * folder on the tab (saved or minimised) shrinks to a tile of its own size
 * (geometry.minimisedPlacement) in the space it keeps; nothing else moves. Folders inside a
 * folder have no placement: only their display changes (and inside a folder every sub-folder is
 * drawn as its minimised tile anyway).
 * Ids with no folder in the tab are ignored silently (a deleted folder's memory).
 * Render-only: the input is never modified. Returns the SAME tab object only when the
 * tab has no effectively collapsed folder and no remembered view changes a display;
 * every effectively collapsed folder (saved or remembered) is always re-created with
 * its shrunken placement, so a tab holding one is always a new object (and so are its
 * containers on the path to that folder).
 */
export function applyFolderViews(_dash: LayoutDashboard, tab: LayoutTab, views: Views): LayoutTab {
  function walk(c: Container): Container {
    const kids = Array.isArray(c?.children) ? c.children : [];
    let changed = false;
    const next = kids.map((n: LayoutNode) => {
      if (!n || (n as { kind?: unknown }).kind !== 'folder') return n;
      const f = n as FolderNode;
      const inner = f.content ? walk(f.content) : f.content;
      const v = views[f.id];
      const display = v === undefined ? f.display : effectiveDisplay(f, v);
      // ANY effectively collapsed folder on the tab (saved or remembered) is a tile of its own size; render-only.
      const shrink = display === 'collapsed' && !!f.placement;
      let out = f;
      if (inner !== f.content || display !== f.display || shrink) {
        out = { ...f, display, ...(inner !== f.content ? { content: inner } : {}) } as FolderNode;
        if (shrink && f.placement) out.placement = minimisedPlacement(f.placement, f.size);
      }
      if (out !== f) changed = true;
      return out;
    });
    return changed ? { ...c, children: next } : c;
  }

  const root = walk(tab.root);
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
