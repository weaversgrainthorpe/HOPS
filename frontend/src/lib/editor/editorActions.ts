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
  insertNode, locate, moveNodes, newNodeId, resolveContainer, setFolderDisplay, setZ,
  addTab, assertFolderLook, fitFolderMinimum, placeNode, pushAside,
  updateNode, updateTab
} from './treeOps';
import type {
  Container, FolderNode, ItemSize, LayoutDashboard, LayoutNode, LayoutTab, Placement, TileNode
} from '$lib/types/layout';
import type { Background, HeaderConfig } from '$lib/types';
import { SHAPE_CREATED, defaultFolderBox, sizeOf, sizeSpan, tabSpan } from '$lib/layout/geometry';
import { config, layoutDoc, findLayoutDashboard, applySavedLayout, loadConfig, layoutFormProblem, showSaveWarning } from '$lib/stores/config';
import { apply, session, rebaseCleanSession, sessionConflict } from '$lib/stores/editSession';
import { transferNodes, ConflictError, type TransferRequest } from '$lib/utils/api';
import { logError } from '$lib/utils/errors';
import { confirm } from '$lib/stores/confirmModal';
import { toast } from '$lib/stores/toast';
import { clearSelection, toggleNode } from '$lib/stores/nodeSelection';
import { closeDrilledInto, forgetFolderMemory } from '$lib/stores/folderView';
import { outStarts, playOutOfFolders, sayAnimationFailure, type OutStart } from './drag/dropAnimation';
import { isValidUrl } from '$lib/utils/url';

export type Cell = { x: number; y: number };

/** A plain JSON copy (dialog state may be a Svelte $state proxy, which structuredClone refuses). */
export function plain<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function currentDraft(): LayoutDashboard | null {
  return get(session)?.draft ?? null;
}

/** Every id in the document: all dashboards in the stored layout plus the draft. */
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

/** The cells an item takes on a tab (geometry.tabSpan): a tile its Size's span; a folder its box. */
export function sizeFor(n: Pick<LayoutNode, 'kind' | 'placement'> & { size?: unknown }): { w: number; h: number } {
  return tabSpan(n);
}

// ---------------------------------------------------------------- sizes

export type TileSize = ItemSize;

/**
 * The size an item SHOWS at: on a tab (`parent` undefined) its own size; inside a folder
 * the folder's contents size, for tiles and sub-folders alike. The item's own size never changes
 * by being in a folder. Missing or unknown = Medium.
 */
export function displaySize(node: Pick<LayoutNode, 'kind'> & { size?: unknown }, parent: FolderNode | undefined): ItemSize {
  return sizeOf(parent ? parent.contentSize : node.size);
}

/** A tile's own Size, as the dialog shows it: Small, Medium or Large (missing or unknown = Medium). */
export function tileSizeOf(t: { size?: unknown }): TileSize {
  return sizeOf(t.size);
}

export type SizeResult =
  /** `at` is set for a tile on a tab (its new span); a tile inside a folder has no placement. */
  | { kind: 'size'; id: string; at?: Placement; push: Map<string, Placement> }
  | { kind: 'invalid'; reason: string };

/**
 * Where tile `id` goes when its Size is set to `size`. On a tab: the span (sizeSpan) at its own
 * top-left, shifted left when it would pass the right edge, with neighbours pushed aside
 * (pushAside, as drag and resize). Inside a folder nothing moves: the tile keeps its place in
 * the order and shows the folder's contents size. Trial-run, so a returned target never throws on
 * commit. Pure.
 */
export function sizeTarget(d: LayoutDashboard, id: string, size: unknown): SizeResult {
  try {
    const n = findIn(d, id);
    const to = containerOfNode(d, id);
    if (!n || !to) return { kind: 'invalid', reason: 'That item no longer exists.' };
    if (n.kind !== 'tile') return { kind: 'invalid', reason: 'Only tiles have a size.' };
    if (to.folderId !== undefined) return { kind: 'size', id, push: new Map() };
    const r = resolveContainer(d, to);
    const span = sizeSpan(size);
    if (span > r.columns) return { kind: 'invalid', reason: tooNarrow(size, r.columns) };
    const cur = n.placement as Placement;
    const x = Math.min(Math.max(0, Math.floor(cur.x)), r.columns - span);
    const at: Placement = { x, y: Math.max(0, Math.floor(cur.y)), w: span, h: span };
    if (cur.z !== undefined) at.z = cur.z;
    const push = pushAside(r.container, new Set([id]), at);
    placeNode(updateNode(d, id, { size: sizeOf(size) } as Partial<LayoutNode>), id, at, push); // the very op the commit runs
    return { kind: 'size', id, at, push };
  } catch (e) {
    return { kind: 'invalid', reason: e instanceof Error && e.message ? e.message : "That size isn't possible here." };
  }
}

function tooNarrow(size: unknown, columns: number): string {
  return `There isn't room for a ${String(size)} tile here: this tab is only ${columns} column${columns === 1 ? '' : 's'} wide.`;
}

/** Why a NEW tile of `size` can't go in `to` (too narrow), or null. A folder takes any size. */
export function newTileSizeProblem(d: LayoutDashboard, to: ContainerRef, size: unknown): string | null {
  try {
    const r = resolveContainer(d, to);
    if (r.kind === 'folder') return null;
    return sizeSpan(size) > r.columns ? tooNarrow(size, r.columns) : null;
  } catch (e) {
    return e instanceof Error && e.message ? e.message : "That size isn't possible here.";
  }
}

/** Nodes of the draft by id (refusing one that has gone). */
export function nodesOf(d: LayoutDashboard, ids: string[]): LayoutNode[] {
  return ids.map((id) => {
    const n = findIn(d, id);
    if (!n) throw new TreeOpError('That item no longer exists.');
    return n;
  });
}

/**
 * Placements for `nodes` going onto tab `to`, none overlapping each other or what is there. The
 * first goes at `cell` when it is free there; the rest (or all, without a usable cell) at
 * firstFreeCell — never a fake push. Stored footprints count, so a minimised folder's
 * reserved cells are taken. A folder target is ordered: no placements ([]).
 */
export function placementsFor(
  d: LayoutDashboard, to: ContainerRef, nodes: (Pick<LayoutNode, 'kind' | 'placement'> & { size?: unknown })[], cell?: Cell
): Placement[] {
  const r = resolveContainer(d, to);
  if (r.kind === 'folder') return [];
  const work: Container = { columns: r.columns, children: [...r.container.children] };
  const out: Placement[] = [];
  nodes.forEach((n, i) => {
    const { w, h } = sizeFor(n);
    let at: Placement | undefined;
    if (i === 0 && cell) {
      const cand: Placement = { x: Math.floor(cell.x), y: Math.floor(cell.y), w: Math.min(w, r.columns), h };
      if (cellIsFree(work, cand)) at = cand;
    }
    if (!at) {
      at = firstFreeCell(work, w, h);
      at.h = h;
    }
    out.push(at);
    work.children.push({ kind: 'tile', id: `\u0000slot-${i}`, placement: at } as unknown as LayoutNode);
  });
  return out;
}

// ---------------------------------------------------------------- new nodes

export function blankTile(): TileNode {
  return { kind: 'tile', id: '', type: 'link', name: '', url: '', icon: '', openMode: 'newtab', size: 'medium', order: 0 };
}

export function blankFolder(): FolderNode {
  const box = defaultFolderBox({ size: 'medium', contentSize: 'medium' });
  return {
    kind: 'folder', id: '', name: 'New folder', display: 'expanded', size: 'medium', contentSize: 'medium',
    shape: SHAPE_CREATED, showTitle: true, placement: { x: 0, y: 0, ...box }, content: { children: [] }
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
 * Insert an already-id'd new item into `to` (pure): a tile takes its Size's span on a tab (too
 * narrow a tab refuses, saying why) at `cell` if free, else the first free cell; in a folder it goes
 * at the end of the order (no placement). Shared by addNode and the "Add to HOPS" page.
 */
export function insertNew(d: LayoutDashboard, placed: LayoutNode, to: ContainerRef, cell?: Cell): LayoutDashboard {
  if (placed.kind === 'tile') {
    const why = newTileSizeProblem(d, to, placed.size);
    if (why) throw new TreeOpError(why);
  }
  if (to.folderId !== undefined) return insertNode(d, placed, to, Number.MAX_SAFE_INTEGER);
  const [at] = placementsFor(d, to, [placed], cell);
  return insertNode(d, placed, to, at);
}

/**
 * A new tile added to a STORED dashboard outside any edit session ("Add to HOPS"): the same checks
 * (tileProblem, size) and placement as the tile dialog's Add. Returns the new dashboard and id, or
 * throws a TreeOpError saying why not. Pure apart from reading the document's ids.
 */
export function withNewTile(d: LayoutDashboard, tile: TileNode, to: ContainerRef): { dashboard: LayoutDashboard; id: string } {
  const why = tileProblem(tile);
  if (why) throw new TreeOpError(why);
  const id = freshId('tile');
  return { dashboard: insertNew(plain(d), { ...plain(tile), id }, to), id };
}

/**
 * Add a new tile or folder to `to`: on a tab at `cell` if free there, else the first free cell; in
 * a folder at the end of its order. The new id avoids every id in the document. Selects the new
 * item. Returns its id, or null if refused.
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
  if (placed.kind === 'folder') {
    placed.content = { ...placed.content, children: [] };
    // A new folder's box is its default box for the size and contents size picked in the dialog,
    // never below its minimum.
    if (to.folderId === undefined) placed.placement = { ...(placed.placement ?? { x: 0, y: 0 }), ...defaultFolderBox(placed) } as Placement;
  }
  const ok = apply(node.kind === 'tile' ? 'Add tile' : 'Add folder', (dd) => {
    // A new tile takes the span of its Size on a tab; too narrow a tab refuses, saying why.
    // In a folder it goes at the end of the order (no placement).
    return insertNew(dd, placed, to, cell);
  });
  if (!ok) return null;
  toggleNode(id, false);
  return id;
}

// ---------------------------------------------------------------- edit

const LOCKED = ['id', 'kind', 'placement', 'content'];

/**
 * A dialog's fields as a patch: a field set to undefined is REMOVED from the node (e.g. "no
 * colour"), a field not given is left as it is. plain() alone would drop the undefined ones, so
 * the old value stayed.
 */
function toPatch(fields: Record<string, unknown>): { patch: Record<string, unknown>; cleared: string[] } {
  const patch: Record<string, unknown> = {};
  const cleared: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (LOCKED.includes(k)) continue;
    if (v === undefined) cleared.push(k);
    else patch[k] = plain(v);
  }
  return { patch, cleared };
}

/** Node `id` with the `cleared` fields removed. */
function withoutFields(d: LayoutDashboard, id: string, cleared: string[]): LayoutDashboard {
  if (cleared.length === 0) return d;
  return mapNode(d, id, (n) => {
    const c = { ...n } as Record<string, unknown>;
    for (const k of cleared) delete c[k];
    return c as unknown as LayoutNode;
  });
}

/**
 * Update a node's own fields from a dialog (id/kind/placement/content are never patched here).
 * `opts.size` (a tile's Size picked in the dialog) also sets its span, pushing grid
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
  const { patch, cleared } = toPatch(edited as Record<string, unknown>);
  return apply(node.kind === 'tile' ? 'Edit tile' : 'Edit folder', (dd) => {
    const next = withoutFields(updateNode(dd, id, patch as Partial<LayoutNode>), id, cleared);
    if (node.kind !== 'tile' || opts.size === undefined) return next;
    const t = sizeTarget(next, id, opts.size);
    if (t.kind === 'invalid') throw new TreeOpError(t.reason);
    const sized = updateNode(next, id, { size: opts.size } as Partial<LayoutNode>);
    return t.at ? placeNode(sized, id, t.at, t.push) : sized;
  });
}

/**
 * Save the folder dialog as ONE undo step: its look (and sizes) through updateNode, and "Starts"
 * through setFolderDisplay.
 */
export function editFolder(
  id: string, fields: Omit<Partial<FolderNode>, 'background'> & { background?: Background | null }
): boolean {
  // background: undefined = unchanged, null = removed (a picker choice staged in the dialog).
  // statusChecksEnabled: undefined = unchanged, false = Disabled, null or true = Enabled (the key is removed).
  const { background: rawBackground, statusChecksEnabled, display: rawDisplay, ...rest } = fields as {
    background?: Background | null; statusChecksEnabled?: boolean | null; display?: FolderNode['display']
  } & Record<string, unknown>;
  const background = plain(rawBackground);
  const display = plain(rawDisplay);
  const { patch, cleared } = toPatch(rest);
  return apply('Edit folder', (dd) => {
    assertFolderLook(patch);
    let next = withoutFields(updateNode(dd, id, patch as Partial<LayoutNode>), id, cleared);
    if (display !== undefined) next = setFolderDisplay(next, id, display);
    if (background !== undefined) next = folderWithBackground(next, id, background ?? undefined);
    if (statusChecksEnabled !== undefined) {
      next = mapNode(next, id, (f) => withStatusChecks(f, statusChecksEnabled) as LayoutNode);
    }
    // A larger contents size needs a larger smallest open box, and a shape change needs room
    // for its tab (a box below the tab-aware minimum): grown here, neighbours pushed, in this
    // same undo step — or the whole Save is refused with the reason (TreeOpError → toast).
    return LOOK_KEYS.some((k) => k in patch) ? fitFolderMinimum(next, id) : next;
  });
}

/** The dialog fields that can change a folder's smallest open box. */
const LOOK_KEYS = ['contentSize', 'shape', 'tabPosition'];

/**
 * Why folder `id` can't take look `shape` (and `tabPosition`), or null: an unknown name, or its open
 * box can't grow to the minimum on its tab. The trial run of the very op editFolder runs;
 * the dialog shows it.
 */
export function shapeProblem(d: LayoutDashboard, id: string, shape: unknown, tabPosition?: unknown): string | null {
  try {
    const patch = { shape, ...(tabPosition !== undefined ? { tabPosition } : {}) };
    assertFolderLook(patch);
    fitFolderMinimum(updateNode(d, id, patch as Partial<LayoutNode>), id);
    return null;
  } catch (e) {
    return e instanceof Error && e.message ? e.message : "That look isn't possible here.";
  }
}

/**
 * Why folder `id` can't take contents size `contentSize` (its open box can't grow to the new smallest
 * box on its tab), or null. The trial run of the very op editFolder runs; the dialog shows it.
 */
export function contentSizeProblem(d: LayoutDashboard, id: string, contentSize: unknown): string | null {
  try {
    fitFolderMinimum(updateNode(d, id, { contentSize: sizeOf(contentSize) } as Partial<LayoutNode>), id);
    return null;
  } catch (e) {
    return e instanceof Error && e.message ? e.message : "That contents size isn't possible here.";
  }
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

/**
 * After `ids` were MOVED to `to`: a drilled-into folder among them closes (closeDrilledInto, * 14), and each folder among them that came out of a folder onto a tab is a
 * minimised folder there (treeOps.placedOnTab), so this browser forgets its open / page /
 * drill memory — an "open" remembered from before must not draw it open. `before` is the draft the
 * move was made from.
 */
export function forgetMovedOutFolders(before: LayoutDashboard, ids: string[], to: ContainerRef): void {
  // A folder this browser is drilled into (an inset box) closes when it moves, wherever to.
  const folders = ids.filter((id) => findIn(before, id)?.kind === 'folder');
  if (folders.length > 0) closeDrilledInto(before.id, folders);
  if (to.folderId !== undefined) return;
  const out = ids.filter((id) => findIn(before, id)?.kind === 'folder' && (locate(before, id)?.folderChain.length ?? 0) > 0);
  if (out.length > 0) forgetFolderMemory(before.id, out);
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

/** Edit mode's open / minimise of a folder on the tab: its saved default (how it starts), one undo step. */
export function setDisplay(id: string, display: FolderNode['display']): boolean {
  return apply(display === 'collapsed' ? 'Minimise folder' : 'Open folder', (dd) => setFolderDisplay(dd, id, display));
}

/**
 * "Make it big enough": a folder stored below its smallest open box (imported, converted, or saved
 * before the minimum) grown to it, neighbours pushed aside by the push-aside rules — one undo step, the same
 * growth path as a contents-size change (fitFolderMinimum); no room: toasted with the reason.
 */
export function makeFolderBigEnough(id: string): boolean {
  return apply('Make folder big enough', (dd) => fitFolderMinimum(dd, id));
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
 * Ctrl+] / Ctrl+[ on the selection. Every tab is a grid (free layout is removed), where items
 * never overlap, so this changes nothing and says why — never a silent no-op.
 */
export function zOrderSelection(ids: string[], _dir: 'forward' | 'back'): boolean {
  const d = currentDraft();
  if (!d || ids.length === 0) return false;
  if (!containerOfNode(d, ids[0])) {
    toast.error('That item no longer exists.');
    return false;
  }
  toast.info('Items never overlap, so there is nothing to bring forward or send back.');
  return false;
}

/** Move or copy items to another container on THIS dashboard (first free cells; a folder's end). */
export function moveOrCopyTo(ids: string[], to: ContainerRef, mode: 'move' | 'copy'): boolean {
  const d = currentDraft();
  if (!d || ids.length === 0) return false;
  // Each item leaving a folder pops out of where it was (measured now, before the change is drawn).
  // Each with its tab: when the source isn't drawn (it is on another tab), it starts from that tab's button.
  const leaving: { id: string; sourceId: string; tabId: string }[] = [];
  for (const id of ids) {
    const src = containerOfNode(d, id);
    if (src?.folderId !== undefined && (src.folderId !== to.folderId || src.tabId !== to.tabId)) leaving.push({ id, sourceId: src.folderId, tabId: src.tabId });
  }
  const starts: OutStart[] = leaving.length ? (safely(() => outStarts(d.id, leaving)) ?? []) : [];
  let newIds: string[] = [];
  const ok = apply(mode === 'move' ? 'Move' : 'Copy', (dd) => {
    const nodes = nodesOf(dd, ids);
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
  if (ok && mode === 'move') forgetMovedOutFolders(d, ids, to);
  if (ok && starts.length) {
    safely(() => playOutOfFolders(d.id, starts, {
      landed: (id) => (mode === 'copy' ? newIds[ids.indexOf(id)] : id),
      label: (id) => findIn(d, id)?.name ?? '',
      intoId: to.folderId
    }));
  }
  return ok;
}

/** Decoration after a change is made: a throw is said once, never undoing or hiding the change. */
function safely<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (e) {
    sayAnimationFailure(e);
    return null;
  }
}

// ---------------------------------------------------------------- tabs

export interface TabFields {
  name: string;
  icon?: string;
  iconUrl?: string;
  iconBgColor?: string;
  color?: string;
  opacity?: number;
  /** A background picked in the dialog: undefined = unchanged, null = removed. */
  background?: Background | null;
  /** Status checks: undefined = unchanged, null = inherit (key removed), true/false = set. */
  statusChecksEnabled?: boolean | null;
}

function tabPatch(f: TabFields): Partial<LayoutTab> {
  const patch: Partial<LayoutTab> = {
    name: f.name, icon: f.icon, iconUrl: f.iconUrl, iconBgColor: f.iconBgColor, color: f.color, opacity: f.opacity
  };
  return patch;
}

/** A tab or folder with its status-check gate: Disabled is stored as false; Enabled removes the key. */
function withStatusChecks<T extends object>(o: T, v: boolean | null): T {
  const next = { ...o } as Record<string, unknown>;
  if (v === false) next.statusChecksEnabled = false;
  else delete next.statusChecksEnabled;
  return next as T;
}

/** Name/look via updateTab, plus its background and status-check setting. */
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
  return named;
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
 * A folder's background: one undoable draft edit. `undefined` removes the
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

// ---------------------------------------------------------------- dashboard-level (draft)

/** JSON with object keys sorted: equal values compare equal whatever their key order. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]]))
      : x
  );
}

/**
 * The dashboard dialog's Header and Background, applied as ONE undo step.
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
  const formProblem = layoutFormProblem(get(config));
  if (formProblem) {
    toast.error(formProblem); // never write this layout form into a document of another
    return false;
  }
  try {
    const resp = await transferNodes(req);
    applySavedLayout(resp);
    if (resp.warning) showSaveWarning(resp.warning);
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
