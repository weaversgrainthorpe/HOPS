/**
 * Edit-mode actions behind the toolbar, context menu, dialogs and keyboard.
 * Every action edits the session DRAFT through editSession.apply (so it is
 * undoable, and a refused tree op is toasted by apply). Nothing here writes to
 * the server; saving is the session's job.
 */
import { get } from 'svelte/store';
import type {
  ContainerRef
} from './treeOps';
import {
  TreeOpError, cellIsFree, copyNodes, deleteNodes, deleteTab, duplicateNode, duplicateTab, firstFreeCell,
  insertNode, locate, moveNodes, newNodeId, resolveContainer, setFolderDisplay, setFolderLayout, setTabLayout, setZ,
  addTab, adaptNode, originOf, freeSide,
  updateNode, updateTab
} from './treeOps';
import type {
  Container, FolderNode, LayoutDashboard, LayoutMode, LayoutNode, LayoutTab, Placement, TileNode
} from '$lib/types/layout';
import type { Background, HeaderConfig } from '$lib/types';
import { layoutDoc, findLayoutDashboard, applySavedLayout, loadConfig } from '$lib/stores/config';
import { apply, session, rebaseCleanSession, sessionConflict } from '$lib/stores/editSession';
import { transferNodes, ConflictError, type TransferRequest } from '$lib/utils/api';
import { logError } from '$lib/utils/errors';
import { confirm } from '$lib/stores/confirmModal';
import { toast } from '$lib/stores/toast';
import { clearSelection, toggleNode } from '$lib/stores/nodeSelection';
import { isValidUrl } from '$lib/utils/url';

export type Cell = { x: number; y: number };

/** A plain JSON copy (dialog state may be a Svelte $state proxy, which structuredClone refuses). */
export function plain<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function currentDraft(): LayoutDashboard | null {
  return get(session)?.draft ?? null;
}

/** Every id in the document: all dashboards in the stored layout plus the draft (Ruling 2). */
export function documentIds(): Set<string> {
  const out = new Set<string>();
  const walk = (c: Container | undefined) => {
    for (const n of Array.isArray(c?.children) ? c!.children : []) {
      if (!n || typeof n.id !== 'string') continue;
      out.add(n.id);
      if (n.kind === 'folder') walk(n.content);
    }
  };
  const addDash = (d: LayoutDashboard) => {
    for (const t of Array.isArray(d.tabs) ? d.tabs : []) {
      out.add(t.id);
      walk(t.root);
    }
  };
  for (const d of get(layoutDoc)?.dashboards ?? []) addDash(d);
  const draft = currentDraft();
  if (draft) addDash(draft);
  return out;
}

function tabOf(d: LayoutDashboard, tabId: string): LayoutTab | undefined {
  return d.tabs.find((t) => t.id === tabId);
}

/**
 * The size an item takes in `mode`, from a node ALREADY converted for the target (adaptNode):
 * a grid tile is always one cell (parent spec §6.3); everything else keeps its size.
 */
export function sizeFor(n: Pick<LayoutNode, 'kind' | 'placement'>, mode: LayoutMode): { w: number; h: number } {
  if (mode === 'grid' && n.kind === 'tile') return { w: 1, h: 1 };
  return { w: Math.max(1, Math.floor(n.placement?.w ?? 1)), h: Math.max(1, Math.floor(n.placement?.h ?? 1)) };
}

/** Nodes of the draft as they would go into `to` (converted on the one path when modes differ). */
export function adaptedFor(d: LayoutDashboard, ids: string[], to: ContainerRef): LayoutNode[] {
  return ids.map((id) => {
    const n = findIn(d, id);
    if (!n) throw new TreeOpError('That item no longer exists.');
    return adaptNode(d, n, originOf(d, id), to);
  });
}

/**
 * Placements for `nodes` going into `to`, none overlapping each other or what is there (grid).
 * The first goes at `cell` when it is free there; the rest (or all, without a usable cell) at
 * firstFreeCell — never a fake push (Ruling 11). Stored footprints count, so a collapsed
 * folder's reserved cells are taken (Ruling 13).
 */
export function placementsFor(
  d: LayoutDashboard, to: ContainerRef, nodes: Pick<LayoutNode, 'kind' | 'placement'>[], cell?: Cell
): Placement[] {
  const r = resolveContainer(d, to);
  const work: Container = { columns: r.columns, children: [...r.container.children] };
  const out: Placement[] = [];
  nodes.forEach((n, i) => {
    const { w, h } = sizeFor(n, r.mode);
    let at: Placement | undefined;
    if (i === 0 && cell) {
      const cand: Placement = { x: Math.floor(cell.x), y: Math.floor(cell.y), w: Math.min(w, r.columns), h };
      if (cellIsFree(work, cand, r.mode)) at = cand;
    }
    if (!at) {
      at = firstFreeCell(work, w, h, r.mode);
      if (r.mode === 'grid') at.h = h;
    }
    out.push(at);
    work.children.push({ kind: 'tile', id: `\u0000slot-${i}`, placement: at } as unknown as LayoutNode);
  });
  return out;
}

// ---------------------------------------------------------------- new nodes

export function blankTile(): TileNode {
  return {
    kind: 'tile', id: '', type: 'link', name: '', url: '', icon: '', openMode: 'newtab', size: 'medium', order: 0,
    placement: { x: 0, y: 0, w: 1, h: 1 }
  };
}

export function blankFolder(): FolderNode {
  return {
    kind: 'folder', id: '', name: 'New folder', display: 'expanded', layout: 'inherit', shape: 'rounded',
    showTitle: true, placement: { x: 0, y: 0, w: 4, h: 3 }, content: { columns: 4, children: [] }
  };
}

function freshId(kind: 'tile' | 'folder'): string {
  const used = documentIds();
  for (let i = 0; i < 1000; i++) {
    const id = newNodeId(kind);
    if (!used.has(id)) return id;
  }
  throw new TreeOpError('Could not generate a unique id. Please try again.');
}

/** A link tile needs a URL the allow-list accepts (security checklist). Returns the reason, or null. */
export function tileProblem(t: Partial<TileNode>): string | null {
  if (!t.name || !String(t.name).trim()) return 'A tile needs a name.';
  if (t.type !== 'note' && !isValidUrl(String(t.url ?? ''))) {
    return "That URL can't be used: it must start with http://, https:// or another allowed scheme.";
  }
  return null;
}

/**
 * Add a new tile or folder to `to`: at `cell` if free there, else the first free cell. The new id
 * avoids every id in the document. Selects the new item. Returns its id, or null if refused.
 */
export function addNode(node: LayoutNode, to: ContainerRef, cell?: Cell): string | null {
  const d = currentDraft();
  if (!d) {
    toast.error('Not editing: click Edit first.');
    return null;
  }
  if (node.kind === 'tile') {
    const why = tileProblem(node);
    if (why) {
      toast.error(why);
      return null;
    }
  }
  let id: string;
  try {
    id = freshId(node.kind);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not add that item.');
    return null;
  }
  const placed = { ...plain(node), id } as LayoutNode;
  if (placed.kind === 'folder') placed.content = { ...placed.content, children: [] };
  const ok = apply(node.kind === 'tile' ? 'Add tile' : 'Add folder', (dd) => {
    // New items are drawn at grid sizes (a tile one cell, a folder 4 x 3); in a free container
    // they are converted on the one mode-conversion path (one cell = one dashboard column).
    let fresh = adaptNode(dd, placed, { mode: 'grid', side: freeSide(tabOf(dd, to.tabId)) }, to);
    const [at] = placementsFor(dd, to, [fresh], cell);
    if (fresh.kind === 'folder' && fresh.content.children.length === 0) {
      fresh = { ...fresh, content: { ...fresh.content, columns: Math.max(1, at.w) } };
    }
    return insertNode(dd, fresh, to, at);
  });
  if (!ok) return null;
  toggleNode(id, false);
  return id;
}

// ---------------------------------------------------------------- edit

const LOCKED = ['id', 'kind', 'placement', 'content'];

/** Update a node's own fields from a dialog (id/kind/placement/content are never patched here). */
export function editNode(id: string, edited: Partial<LayoutNode>): boolean {
  const d = currentDraft();
  const node = d ? findIn(d, id) : undefined;
  if (!d || !node) {
    toast.error('That item no longer exists.');
    return false;
  }
  if (node.kind === 'folder') return editFolder(id, edited as Partial<FolderNode>);
  if (node.kind === 'tile') {
    const why = tileProblem({ ...node, ...(edited as Partial<TileNode>) });
    if (why) {
      toast.error(why);
      return false;
    }
  }
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(plain(edited))) if (!LOCKED.includes(k)) patch[k] = v;
  return apply(node.kind === 'tile' ? 'Edit tile' : 'Edit folder', (dd) => updateNode(dd, id, patch as Partial<LayoutNode>));
}

/**
 * Save the folder dialog as ONE undo step: its look through updateNode, "Starts" through
 * setFolderDisplay, and its layout through setFolderLayout (which converts the content).
 */
export function editFolder(id: string, fields: Partial<FolderNode>): boolean {
  const { display, layout, ...rest } = plain(fields) as Partial<FolderNode>;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) if (!LOCKED.includes(k)) patch[k] = v;
  return apply('Edit folder', (dd) => {
    let next = updateNode(dd, id, patch as Partial<LayoutNode>);
    if (display !== undefined) next = setFolderDisplay(next, id, display);
    if (layout !== undefined) next = setFolderLayout(next, id, layout);
    return next;
  });
}

export function findIn(d: LayoutDashboard, id: string): LayoutNode | undefined {
  const loc = locate(d, id);
  if (!loc) return undefined;
  let list = tabOf(d, loc.tabId)?.root.children ?? [];
  for (const fid of loc.folderChain) list = (list.find((n) => n.id === fid) as FolderNode).content.children;
  return list[loc.index];
}

/** The container holding a node. */
export function containerOfNode(d: LayoutDashboard, id: string): ContainerRef | undefined {
  const loc = locate(d, id);
  if (!loc) return undefined;
  const folderId = loc.folderChain[loc.folderChain.length - 1];
  return folderId ? { tabId: loc.tabId, folderId } : { tabId: loc.tabId };
}

function describe(d: LayoutDashboard, ids: string[]): string {
  if (ids.length === 1) {
    const n = findIn(d, ids[0]);
    return n ? `"${n.name || 'Untitled'}"` : 'this item';
  }
  return `${ids.length} items`;
}

/** Delete after asking. Undoable. */
export async function deleteWithConfirm(ids: string[]): Promise<boolean> {
  const d = currentDraft();
  if (!d || ids.length === 0) return false;
  const what = describe(d, ids);
  const hasFolder = ids.some((id) => findIn(d, id)?.kind === 'folder');
  const ok = await confirm({
    title: `Delete ${what}?`,
    message:
      (hasFolder ? 'Folders are deleted with everything inside them. ' : '') +
      'You can undo this (Ctrl+Z) until you save.',
    confirmText: 'Delete',
    cancelText: 'Cancel',
    confirmStyle: 'danger'
  });
  if (!ok) return false;
  const done = apply(ids.length === 1 ? 'Delete item' : `Delete ${ids.length} items`, (dd) => deleteNodes(dd, ids));
  if (done) clearSelection();
  return done;
}

export function duplicate(id: string): string | null {
  let newId: string | null = null;
  const ok = apply('Duplicate', (dd) => {
    const r = duplicateNode(dd, id, documentIds());
    newId = r.newId;
    return r.dashboard;
  });
  if (!ok || !newId) return null;
  toggleNode(newId, false);
  return newId;
}

export function setDisplay(id: string, display: FolderNode['display']): boolean {
  return apply(display === 'collapsed' ? 'Start collapsed' : 'Start expanded', (dd) => setFolderDisplay(dd, id, display));
}

/** Bring forward / Send back (menu and Ctrl+] / Ctrl+[): one undo step, or a toast when already there. */
export function zOrder(id: string, dir: 'forward' | 'back'): boolean {
  const before = currentDraft();
  const ok = apply(dir === 'forward' ? 'Bring forward' : 'Send back', (dd) => setZ(dd, id, dir));
  if (ok && before && currentDraft() === before) {
    toast.info(dir === 'forward' ? 'It is already in front of everything here.' : 'It is already behind everything here.');
  }
  return ok;
}

/**
 * Ctrl+] / Ctrl+[ on the selection: z-order of ONE item in a FREE container (as the item menu).
 * Anything else changes nothing and says why — never a silent no-op.
 */
export function zOrderSelection(ids: string[], dir: 'forward' | 'back'): boolean {
  const d = currentDraft();
  if (!d || ids.length === 0) return false;
  if (ids.length > 1) {
    toast.info('Select one item to bring it forward or send it back.');
    return false;
  }
  const ref = containerOfNode(d, ids[0]);
  let mode: LayoutMode | null = null;
  try {
    mode = ref ? resolveContainer(d, ref).mode : null;
  } catch {
    mode = null;
  }
  if (!ref || mode === null) {
    toast.error('That item no longer exists.');
    return false;
  }
  if (mode !== 'free') {
    toast.info('Bring forward / Send back are for free layouts — items in a grid never overlap.');
    return false;
  }
  return zOrder(ids[0], dir);
}

/** Move or copy items to another container on THIS dashboard (first free cells). */
export function moveOrCopyTo(ids: string[], to: ContainerRef, mode: 'move' | 'copy'): boolean {
  const d = currentDraft();
  if (!d || ids.length === 0) return false;
  let newIds: string[] = [];
  const ok = apply(mode === 'move' ? 'Move' : 'Copy', (dd) => {
    const nodes = adaptedFor(dd, ids, to);
    // Moving within the same container: the moved items vacate their own cells first.
    const vacated = mode === 'move' ? deleteNodes(dd, ids) : dd;
    const at = placementsFor(vacated, to, nodes);
    if (mode === 'move') return moveNodes(dd, ids, to, at);
    const r = copyNodes(dd, ids, to, at, documentIds());
    newIds = r.newIds;
    return r.dashboard;
  });
  if (ok && mode === 'copy' && newIds.length) {
    clearSelection();
    newIds.forEach((id) => toggleNode(id, true));
  }
  return ok;
}

// ---------------------------------------------------------------- tabs

export interface TabFields {
  name: string;
  icon?: string;
  iconUrl?: string;
  iconBgColor?: string;
  color?: string;
  opacity?: number;
  layout?: 'inherit' | LayoutMode;
  designWidth?: number;
}

function tabPatch(f: TabFields): Partial<LayoutTab> {
  const patch: Partial<LayoutTab> = {
    name: f.name, icon: f.icon, iconUrl: f.iconUrl, iconBgColor: f.iconBgColor, color: f.color, opacity: f.opacity
  };
  return patch;
}

/** Name/look via updateTab; layout and design width via setTabLayout (which converts the content). */
function applyTabFields(d: LayoutDashboard, tabId: string, f: TabFields): LayoutDashboard {
  const named = updateTab(d, tabId, tabPatch(f));
  return f.layout !== undefined ? setTabLayout(named, tabId, f.layout, f.designWidth) : named;
}

export function addTabWith(f: TabFields): string | null {
  let tabId: string | null = null;
  const ok = apply('Add tab', (dd) => {
    const r = addTab(dd, f.name);
    tabId = r.tabId;
    return applyTabFields(r.dashboard, r.tabId, f);
  });
  return ok ? tabId : null;
}

export function editTab(tabId: string, f: TabFields): boolean {
  return apply('Edit tab', (dd) => applyTabFields(dd, tabId, f));
}

export function duplicateTabAction(tabId: string): string | null {
  let newId: string | null = null;
  const ok = apply('Duplicate tab', (dd) => {
    const r = duplicateTab(dd, tabId, documentIds());
    newId = r.tabId;
    return r.dashboard;
  });
  return ok ? newId : null;
}

export async function deleteTabWithConfirm(tabId: string): Promise<boolean> {
  const d = currentDraft();
  const tab = d ? tabOf(d, tabId) : undefined;
  if (!d || !tab) return false;
  const ok = await confirm({
    title: 'Delete Tab',
    message: `Delete "${tab.name}" and all its contents? You can undo this (Ctrl+Z) until you save.`,
    confirmText: 'Delete',
    confirmStyle: 'danger'
  });
  if (!ok) return false;
  return apply('Delete tab', (dd) => deleteTab(dd, tabId));
}

export function setTabBackground(tabId: string, background: Background | undefined): boolean {
  return apply('Tab background', (dd) => updateTab(dd, tabId, { background: plain(background) } as Partial<LayoutTab>));
}

// ---------------------------------------------------------------- dashboard-level (draft, parent spec §7.1)

export function setHeader(header: HeaderConfig): boolean {
  return apply('Edit header', (dd) => ({ ...dd, header: plain(header) }));
}

export function setBackground(background: Background | undefined): boolean {
  return apply('Edit background', (dd) => ({ ...dd, background: plain(background) }));
}

export function setPerTabBackgrounds(enabled: boolean): boolean {
  return apply('Per-tab backgrounds', (dd) => (dd.perTabBackgrounds === enabled ? dd : { ...dd, perTabBackgrounds: enabled }));
}

// ---------------------------------------------------------------- cross-dashboard transfer

/**
 * THE one path for a cross-dashboard move/copy (item-menu paste and the
 * Move/Copy dialog): transfer endpoint, then refresh the layout and rebase the
 * clean session. Returns true when the server did it. Failures are always
 * visible: a 409 for the session's own dashboard raises the conflict banner; a
 * 409 for the other dashboard toasts, and the layout is reloaded so pickers
 * show fresh data (nothing was changed); anything else is toasted.
 * `success` is the toast after a refreshed rebase; `failure` prefixes other errors.
 */
export async function transferAndRebase(req: TransferRequest, success: string, failure: string): Promise<boolean> {
  const sessionId = get(session)?.dashboardId ?? '';
  try {
    const resp = await transferNodes(req);
    applySavedLayout(resp);
    if (!rebaseCleanSession(resp.layout)) {
      // No fresh layout came back (or edits arrived meanwhile): the layout is
      // marked stale and reloading; say so rather than show the old draft as current.
      toast.warning('Saved, but the editor could not refresh. Leave edit mode and reload to see it.');
    } else {
      toast.success(success);
    }
    return true;
  } catch (e) {
    logError(failure, e);
    if (e instanceof ConflictError) {
      if (e.dashboardId && e.dashboardId === sessionId) {
        sessionConflict.set({ dashboardId: sessionId, currentRevision: e.currentRevision });
        toast.error('Not saved — this dashboard was changed somewhere else.');
      } else {
        const other = e.dashboardId ? findLayoutDashboard(e.dashboardId, get(layoutDoc)) : undefined;
        toast.error(`\u2018${other?.name || 'The other dashboard'}\u2019 was changed somewhere else — nothing was moved; try again.`);
        void loadConfig({ background: true });
      }
    } else {
      toast.error(e instanceof Error && e.message ? `${failure}: ${e.message}` : `${failure}.`);
    }
    return false;
  }
}
