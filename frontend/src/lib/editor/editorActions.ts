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
  addTab, adaptNode, originOf, freeSide, placeNode, pushAside,
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
 * The size an item takes in `mode`, from a node ALREADY converted for the target (adaptNode).
 * Placement is the truth (spec §8): a grid tile keeps its span (Large = 2 x 2), like everything else.
 */
export function sizeFor(n: Pick<LayoutNode, 'kind' | 'placement'>, _mode: LayoutMode): { w: number; h: number } {
  return { w: Math.max(1, Math.floor(n.placement?.w ?? 1)), h: Math.max(1, Math.floor(n.placement?.h ?? 1)) };
}

// ---------------------------------------------------------------- tile size = space (spec §8)

export type TileSize = TileNode['size'];
/** What the tile dialog's Size shows: a size, or "Custom (resized)" for any other span. */
export type SizeChoice = TileSize | 'custom';

/**
 * The span a tile Size takes: Large = 2 x 2 cells, Medium and Small = 1 x 1 (Small is drawn
 * compact). Grid: cells; free: the free-unit equivalent, one cell = `side` units (freeSide).
 */
export function sizeSpan(size: unknown, mode: LayoutMode, side = 1): { w: number; h: number } {
  const cells = size === 'large' ? 2 : 1;
  const unit = mode === 'free' ? Math.max(1, Math.floor(side) || 1) : 1;
  return { w: cells * unit, h: cells * unit };
}

/**
 * The size the dialog shows for a tile: a 1 x 1 span shows its stored size (a stored large tile
 * at 1 x 1 is never silently enlarged); a 2 x 2 span shows Large; any other span is Custom.
 */
export function sizeShown(t: Pick<TileNode, 'size' | 'placement'>, mode: LayoutMode, side = 1): SizeChoice {
  const stored: TileSize = t.size === 'small' || t.size === 'large' ? t.size : 'medium';
  const is = (s: { w: number; h: number }) => t.placement?.w === s.w && t.placement?.h === s.h;
  if (is(sizeSpan('medium', mode, side))) return stored;
  if (is(sizeSpan('large', mode, side))) return 'large';
  return 'custom';
}

export type SizeResult =
  | { kind: 'size'; id: string; at: Placement; push: Map<string, Placement> }
  | { kind: 'invalid'; reason: string };

function tooNarrow(size: unknown, columns: number, ref: ContainerRef): string {
  const where = ref.folderId ? 'this folder' : 'this tab';
  return `There isn't room for a ${String(size)} tile here: ${where} is only ${columns} column${columns === 1 ? '' : 's'} wide.`;
}

/**
 * Where tile `id` goes when its Size is set to `size`: the span from sizeSpan at its own top-left,
 * shifted left when it would pass the right edge, with grid neighbours pushed aside by the M3 push
 * (pushAside, as drag and resize). Refused, with the reason, when the container is too narrow.
 * Trial-run, so a returned target never throws on commit. Pure.
 */
export function sizeTarget(d: LayoutDashboard, id: string, size: unknown): SizeResult {
  try {
    const n = findIn(d, id);
    const to = containerOfNode(d, id);
    if (!n || !to) return { kind: 'invalid', reason: 'That item no longer exists.' };
    if (n.kind !== 'tile') return { kind: 'invalid', reason: 'Only tiles have a size.' };
    const r = resolveContainer(d, to);
    const span = sizeSpan(size, r.mode, originOf(d, id).side);
    if (span.w > r.columns) return { kind: 'invalid', reason: tooNarrow(size, r.columns, to) };
    const cur = n.placement;
    const x = Math.min(Math.max(0, Math.floor(cur.x)), r.columns - span.w);
    const at: Placement = { x, y: Math.max(0, Math.floor(cur.y)), w: span.w, h: span.h };
    if (cur.z !== undefined) at.z = cur.z;
    const push = r.mode === 'grid' ? pushAside(r.container, new Set([id]), at) : new Map<string, Placement>();
    placeNode(d, id, at, push); // the very op the commit runs
    return { kind: 'size', id, at, push };
  } catch (e) {
    return { kind: 'invalid', reason: e instanceof Error && e.message ? e.message : "That size isn't possible here." };
  }
}

/** Why a NEW tile of `size` can't go in `to` (too narrow), or null. */
export function newTileSizeProblem(d: LayoutDashboard, to: ContainerRef, size: unknown): string | null {
  try {
    const r = resolveContainer(d, to);
    const side = freeSide(tabOf(d, to.tabId));
    return sizeSpan(size, r.mode, side).w > r.columns ? tooNarrow(size, r.columns, to) : null;
  } catch (e) {
    return e instanceof Error && e.message ? e.message : "That size isn't possible here.";
  }
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
    // A new tile takes the span of its Size (spec §8); too narrow a container refuses, saying why.
    let sized = placed;
    if (placed.kind === 'tile') {
      const why = newTileSizeProblem(dd, to, placed.size);
      if (why) throw new TreeOpError(why);
      sized = { ...placed, placement: { ...placed.placement, ...sizeSpan(placed.size, 'grid') } };
    }
    let fresh = adaptNode(dd, sized, { mode: 'grid', side: freeSide(tabOf(dd, to.tabId)) }, to);
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

/**
 * Update a node's own fields from a dialog (id/kind/placement/content are never patched here).
 * `opts.size` (a tile's Size picked in the dialog, spec §8) also sets its span, pushing grid
 * neighbours aside — in the SAME undo step. A refused size changes nothing and says why.
 */
export function editNode(id: string, edited: Partial<LayoutNode>, opts: { size?: TileSize } = {}): boolean {
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
  return apply(node.kind === 'tile' ? 'Edit tile' : 'Edit folder', (dd) => {
    const next = updateNode(dd, id, patch as Partial<LayoutNode>);
    if (node.kind !== 'tile' || opts.size === undefined) return next;
    const t = sizeTarget(next, id, opts.size);
    if (t.kind === 'invalid') throw new TreeOpError(t.reason);
    return placeNode(next, id, t.at, t.push);
  });
}

/**
 * Save the folder dialog as ONE undo step: its look through updateNode, "Starts" through
 * setFolderDisplay, and its layout through setFolderLayout (which converts the content).
 */
export function editFolder(
  id: string, fields: Omit<Partial<FolderNode>, 'background'> & { background?: Background | null }
): boolean {
  // background: undefined = unchanged, null = removed (a picker choice staged in the dialog).
  // statusChecksEnabled: undefined = unchanged, null = inherit (the key is removed), true/false = set.
  const { background, statusChecksEnabled, ...others } = plain(fields) as {
    background?: Background | null; statusChecksEnabled?: boolean | null
  } & Record<string, unknown>;
  const { display, layout, ...rest } = others as Partial<FolderNode>;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) if (!LOCKED.includes(k)) patch[k] = v;
  return apply('Edit folder', (dd) => {
    let next = updateNode(dd, id, patch as Partial<LayoutNode>);
    if (display !== undefined) next = setFolderDisplay(next, id, display);
    if (layout !== undefined) next = setFolderLayout(next, id, layout);
    if (background !== undefined) next = folderWithBackground(next, id, background ?? undefined);
    if (statusChecksEnabled !== undefined) {
      next = mapNode(next, id, (f) => withStatusChecks(f, statusChecksEnabled) as LayoutNode);
    }
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
  /** A background picked in the dialog: undefined = unchanged, null = removed. */
  background?: Background | null;
  /** Status checks (M4 §4b): undefined = unchanged, null = inherit (key removed), true/false = set. */
  statusChecksEnabled?: boolean | null;
}

function tabPatch(f: TabFields): Partial<LayoutTab> {
  const patch: Partial<LayoutTab> = {
    name: f.name, icon: f.icon, iconUrl: f.iconUrl, iconBgColor: f.iconBgColor, color: f.color, opacity: f.opacity
  };
  return patch;
}

/** A tab or folder with its status-check setting: null removes the key (inherit). */
function withStatusChecks<T extends object>(o: T, v: boolean | null): T {
  const next = { ...o } as Record<string, unknown>;
  if (v === null) delete next.statusChecksEnabled;
  else next.statusChecksEnabled = v;
  return next as T;
}

/** Name/look via updateTab; layout and design width via setTabLayout (which converts the content). */
function applyTabFields(d: LayoutDashboard, tabId: string, f: TabFields): LayoutDashboard {
  let named = updateTab(d, tabId, tabPatch(f));
  if (f.background !== undefined) {
    const bg = f.background === null ? undefined : plain(f.background);
    named = {
      ...named,
      tabs: named.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const next = { ...t };
        if (bg === undefined) delete next.background;
        else next.background = bg;
        return next;
      })
    };
  }
  if (f.statusChecksEnabled !== undefined) {
    const v = f.statusChecksEnabled;
    named = { ...named, tabs: named.tabs.map((t) => (t.id === tabId ? withStatusChecks(t, v) : t)) };
  }
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

/**
 * A folder's background (M4): one undoable draft edit. `undefined` removes the
 * key (no background of its own); the inherit form keeps its stored picture.
 * A missing id or a non-folder is refused (apply toasts the TreeOpError).
 */
export function setFolderBackground(folderId: string, background: Background | undefined): boolean {
  return apply('Folder background', (dd) => folderWithBackground(dd, folderId, background));
}

/** The draft with one folder's background set (undefined removes the key). Throws for a non-folder. */
function folderWithBackground(dd: LayoutDashboard, folderId: string, background: Background | undefined): LayoutDashboard {
  const n = findIn(dd, folderId);
  if (!n) throw new TreeOpError('That folder no longer exists.');
  if (n.kind !== 'folder') throw new TreeOpError('Only folders have a background here.');
  const bg = plain(background);
  return mapNode(dd, folderId, (f) => {
    const next = { ...f } as FolderNode;
    if (bg === undefined) delete next.background;
    else next.background = bg;
    return next;
  });
}

/** Replace one node anywhere in the draft (tabs and folders, any depth). */
function mapNode(d: LayoutDashboard, id: string, fn: (n: LayoutNode) => LayoutNode): LayoutDashboard {
  // A malformed container is passed through untouched (never emptied).
  const walk = (c: Container): Container => !Array.isArray(c?.children) ? c : ({
    ...c,
    children: c.children.map((n) => {
      if (n?.id === id) return fn(n);
      return n?.kind === 'folder' && n.content ? { ...n, content: walk(n.content) } : n;
    })
  });
  return { ...d, tabs: d.tabs.map((t) => ({ ...t, root: walk(t.root) })) };
}

// ---------------------------------------------------------------- dashboard-level (draft, parent spec §7.1)

/** JSON with object keys sorted: equal values compare equal whatever their key order. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]]))
      : x
  );
}

/**
 * The dashboard dialog's Header and Background (walkthrough §4C), applied as ONE undo step.
 * Nothing changed (whatever the key order): no undo step.
 */
export function setLook(header: HeaderConfig | undefined, background: Background | undefined): boolean {
  return apply('Edit dashboard', (dd) => {
    const h = plain(header);
    const b = plain(background);
    if (canonical(dd.header) === canonical(h) && canonical(dd.background) === canonical(b)) return dd;
    return { ...dd, header: h, background: b };
  });
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
