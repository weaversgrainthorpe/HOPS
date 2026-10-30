/**
 * Pure tree operations for the layout editor. Every function takes a
 * LayoutDashboard (or Container) and returns a NEW value; inputs are never
 * mutated. Invalid operations throw TreeOpError with a user-facing message.
 *
 * Two kinds of container (one folder model):
 * - a TAB's root: a 24-column grid of placed items. Gaps persist: moving or deleting never shifts
 *   any other node; only pushAside (an explicit reflow for a drop target) relocates displaced
 *   nodes. A tile on a tab always takes its Size's span (S 1 x 1, M 2 x 2, L 4 x 4).
 * - a FOLDER's content: an ORDERED list with no placements. Items are inserted at an index.
 */
import type { Container, FolderNode, LayoutDashboard, LayoutNode, LayoutTab, Placement } from '../types/layout';
import {
  ROOT_COLUMNS, SHAPE_CREATED, clampPlacement, containerColumns, defaultFolderBox, folderMinCells, isFolderShape, isPlaced,
  isTabPosition, largestContentSize, sizeOf, sizeSpan, tabSpan
} from '../layout/geometry';

export type ContainerRef = { tabId: string; folderId?: string }; // folderId absent = tab root
export interface NodeLocation { tabId: string; folderChain: string[]; index: number }
/** Where items go: placements on a tab (one per item), or an index in a folder's order. */
export type Where = Placement[] | number;

export class TreeOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TreeOpError';
  }
}

// ---------------------------------------------------------------- ids

export function newNodeId(kind: 'tile' | 'folder' | 'tab'): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return `${kind}-${c.randomUUID()}`;
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** An id absent from `used`; adds it to `used`. */
function uniqueId(kind: 'tile' | 'folder', used: Set<string>): string {
  for (let i = 0; i < 1000; i++) {
    const id = newNodeId(kind);
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
  throw new TreeOpError('Could not generate a unique id. Please try again.');
}

// ---------------------------------------------------------------- lookup

function kids(c: Container | undefined): LayoutNode[] {
  return Array.isArray(c?.children) ? (c as Container).children : [];
}

function findTab(d: LayoutDashboard, tabId: string): LayoutTab {
  const t = d.tabs.find((x) => x.id === tabId);
  if (!t) throw new TreeOpError('That tab no longer exists.');
  return t;
}

/** Folder chain (outermost first) leading to the folder with this id, or undefined. */
function folderPath(children: LayoutNode[], folderId: string): FolderNode[] | undefined {
  for (const n of children) {
    if (n.kind !== 'folder') continue;
    if (n.id === folderId) return [n];
    const sub = folderPath(kids(n.content), folderId);
    if (sub) return [n, ...sub];
  }
  return undefined;
}

interface Resolved { tab: LayoutTab; chain: FolderNode[]; container: Container; folder?: FolderNode }

function resolveRef(d: LayoutDashboard, ref: ContainerRef): Resolved {
  const tab = findTab(d, ref.tabId);
  if (ref.folderId === undefined) return { tab, chain: [], container: tab.root };
  const chain = folderPath(kids(tab.root), ref.folderId);
  if (!chain) throw new TreeOpError('That folder no longer exists.');
  const folder = chain[chain.length - 1];
  return { tab, chain, container: folder.content, folder };
}

/**
 * The container a ref names (throws TreeOpError if gone): a tab root (`columns` = its grid's) or a
 * folder's ordered content (`columns` 0: it has none).
 */
export function resolveContainer(
  d: LayoutDashboard, ref: ContainerRef
): { kind: 'tab' | 'folder'; container: Container; columns: number; folder?: FolderNode } {
  const r = resolveRef(d, ref);
  return r.folder
    ? { kind: 'folder', container: r.container, columns: 0, folder: r.folder }
    : { kind: 'tab', container: r.container, columns: containerColumns(r.container) };
}

export function locate(d: LayoutDashboard, nodeId: string): NodeLocation | undefined {
  const walk = (children: LayoutNode[], chain: string[]): { chain: string[]; index: number } | undefined => {
    for (let i = 0; i < children.length; i++) {
      const n = children[i];
      if (n.id === nodeId) return { chain, index: i };
      if (n.kind === 'folder') {
        const r = walk(kids(n.content), [...chain, n.id]);
        if (r) return r;
      }
    }
    return undefined;
  };
  for (const t of d.tabs) {
    const r = walk(kids(t.root), []);
    if (r) return { tabId: t.id, folderChain: r.chain, index: r.index };
  }
  return undefined;
}

export function isDescendant(d: LayoutDashboard, ancestorFolderId: string, nodeId: string): boolean {
  const loc = locate(d, nodeId);
  return !!loc && loc.folderChain.includes(ancestorFolderId);
}

function findNode(d: LayoutDashboard, id: string): LayoutNode {
  const loc = locate(d, id);
  if (!loc) throw new TreeOpError('That item no longer exists.');
  const tab = findTab(d, loc.tabId);
  let list = kids(tab.root);
  for (const fid of loc.folderChain) list = kids((list.find((n) => n.id === fid) as FolderNode).content);
  return list[loc.index];
}

function mustFind(d: LayoutDashboard, ids: string[]): LayoutNode[] {
  if (new Set(ids).size !== ids.length) throw new TreeOpError('The same item was selected twice.');
  return ids.map((id) => findNode(d, id));
}

function refOf(loc: NodeLocation): ContainerRef {
  const folderId = loc.folderChain[loc.folderChain.length - 1];
  return folderId === undefined ? { tabId: loc.tabId } : { tabId: loc.tabId, folderId };
}

// ---------------------------------------------------------------- immutable rewriting

/** Rewrite every container's children list through `fn` (depth-first, children first). */
function mapChildren(children: LayoutNode[], fn: (n: LayoutNode) => LayoutNode | null): LayoutNode[] {
  const out: LayoutNode[] = [];
  for (const n of children) {
    const inner: LayoutNode =
      n.kind === 'folder' ? { ...n, content: { ...n.content, children: mapChildren(kids(n.content), fn) } } : n;
    const r = fn(inner);
    if (r) out.push(r);
  }
  return out;
}

function mapTabs(d: LayoutDashboard, fn: (n: LayoutNode) => LayoutNode | null): LayoutDashboard {
  return {
    ...d,
    tabs: d.tabs.map((t) => ({ ...t, root: { ...t.root, children: mapChildren(kids(t.root), fn) } }))
  };
}

/** Replace the container at `ref` with fn(container). */
function editContainer(d: LayoutDashboard, ref: ContainerRef, fn: (c: Container) => Container): LayoutDashboard {
  const r = resolveRef(d, ref);
  const chainIds = r.chain.map((f) => f.id);
  const rewrite = (c: Container, rest: string[]): Container => {
    if (rest.length === 0) return fn(c);
    return {
      ...c,
      children: kids(c).map((n) =>
        n.kind === 'folder' && n.id === rest[0] ? { ...n, content: rewrite(n.content, rest.slice(1)) } : n
      )
    };
  };
  return { ...d, tabs: d.tabs.map((t) => (t.id === ref.tabId ? { ...t, root: rewrite(t.root, chainIds) } : t)) };
}

function removeIds(d: LayoutDashboard, ids: Set<string>): LayoutDashboard {
  return mapTabs(d, (n) => (ids.has(n.id) ? null : n));
}

// ---------------------------------------------------------------- shapes per level

/** A node as it sits in a folder: no placement. Its own size is kept. */
function unplaced(n: LayoutNode): LayoutNode {
  if (!('placement' in n)) return n;
  const out = { ...n } as Record<string, unknown>;
  delete out.placement;
  return out as unknown as LayoutNode;
}

/**
 * A node as it sits on a tab at `at`: validated inside the columns; a tile must be asked at exactly
 * its Size's span (its size is the truth) — any other footprint is REFUSED, never silently
 * resized, so a preview can never show one footprint and commit another; a folder arriving from
 * inside a folder is minimised.
 */
function placedOnTab(n: LayoutNode, at: Placement, cols: number, fromFolder: boolean): LayoutNode {
  finitePlacement(at);
  if (n.kind === 'tile') {
    const span = sizeSpan(n.size);
    if (at.w !== span || at.h !== span) {
      const name = sizeOf(n.size);
      throw new TreeOpError(
        `A ${name[0].toUpperCase()}${name.slice(1)} tile takes ${span} x ${span} cells on a tab, not ${at.w} x ${at.h}.`
      );
    }
  }
  const p: Placement = { x: at.x, y: at.y, w: at.w, h: at.h };
  if (at.z !== undefined) p.z = at.z;
  if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !Number.isInteger(p.w) || !Number.isInteger(p.h)) {
    throw new TreeOpError('That position is not valid.');
  }
  if (p.x < 0 || p.y < 0 || p.w < 1 || p.h < 1 || p.x + p.w > cols) {
    throw new TreeOpError('That position is outside the grid.');
  }
  if (n.kind === 'folder' && fromFolder) {
    // Out of a folder it has no box of its own: it is given its default box (tabSpan), never one below
    // its minimum — a smaller one is refused, never silently grown.
    const min = folderMinCells(n);
    if (p.w < min.w || p.h < min.h) {
      throw new TreeOpError(
        `"${n.name || 'Untitled'}" needs at least ${min.w} x ${min.h} cells on a tab when open, not ${p.w} x ${p.h}.`
      );
    }
    return { ...n, display: 'collapsed', placement: p };
  }
  return { ...n, placement: p } as LayoutNode;
}

function finitePlacement(p: Placement): void {
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    if (typeof p?.[k] !== 'number' || !Number.isFinite(p[k])) throw new TreeOpError('That position is not valid.');
  }
}

/** An index into a folder's order: a whole number (clamped to the list by the insert). */
function checkIndex(i: unknown): number {
  if (typeof i !== 'number' || !Number.isInteger(i)) throw new TreeOpError('That position in the folder is not valid.');
  return i;
}

const END = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------- grid overlap contract

const overlaps = (a: Placement, b: Placement): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * A tab never holds overlapping items. Throws "That space is taken" if any node in `only`
 * (default: all) overlaps another. Checking only the changed ids keeps legacy overlaps elsewhere
 * from blocking unrelated edits.
 */
export function assertGridNoOverlap(c: Container, only?: Set<string>): void {
  const cols = containerColumns(c);
  const nodes = kids(c).filter(isPlaced).map((n) => ({ id: n.id, p: clampPlacement(n.placement, cols) }));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (only && !only.has(nodes[i].id) && !only.has(nodes[j].id)) continue;
      if (overlaps(nodes[i].p, nodes[j].p)) throw new TreeOpError('That space is taken');
    }
  }
}

/**
 * True when `p` can go on tab root `c` as it is: inside the columns and clear of every sibling's
 * STORED footprint (a minimised folder's reserved cells count).
 */
export function cellIsFree(c: Container, p: Placement): boolean {
  if (![p.x, p.y, p.w, p.h].every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  const cols = containerColumns(c);
  if (p.x < 0 || p.y < 0 || p.w < 1 || p.h < 1 || p.x + p.w > cols) return false;
  return !kids(c).filter(isPlaced).some((n) => overlaps(clampPlacement(n.placement, cols), p));
}

/** Apply a pushAside map to a children list (ids not present are ignored). */
function applyPush(children: LayoutNode[], push?: Map<string, Placement>): LayoutNode[] {
  if (!push || push.size === 0) return children;
  return children.map((n) => (push.has(n.id) ? ({ ...n, placement: push.get(n.id) } as LayoutNode) : n));
}

/**
 * Put `add` (already shaped for the level) into the container at `to`: appended on a tab, with
 * `push` applied to its siblings and no overlap; inserted at `index` in a folder (no push there).
 */
function commit(
  d: LayoutDashboard, to: ContainerRef, add: LayoutNode[], index: number | undefined, push?: Map<string, Placement>
): LayoutDashboard {
  if (to.folderId !== undefined) {
    if (push && push.size > 0) throw new TreeOpError('Items in a folder are not placed, so nothing can be pushed aside.');
    const folderId = to.folderId;
    const next = editContainer(d, to, (c) => {
      const list = [...kids(c)];
      const at = Math.min(Math.max(0, index ?? END), list.length);
      list.splice(at, 0, ...add);
      return { ...c, children: list };
    });
    return growForMinimum(d, next, folderId);
  }
  const changed = new Set<string>([...add.map((a) => a.id), ...(push ? push.keys() : [])]);
  return editContainer(d, to, (c) => {
    const next = { ...c, children: [...applyPush(kids(c), push), ...add] };
    assertGridNoOverlap(next, changed);
    return next;
  });
}

/**
 * The shaped nodes and folder index for `nodes` going to `to` at `where`. A tab needs one
 * placement per item; a folder takes an index (placements given for a folder mean "at the end").
 */
function shapeFor(
  d: LayoutDashboard, to: ContainerRef, nodes: LayoutNode[], where: Where, fromFolder: boolean[]
): { add: LayoutNode[]; index?: number } {
  const r = resolveRef(d, to);
  if (r.folder) {
    const index = typeof where === 'number' ? checkIndex(where) : END;
    return { add: nodes.map(unplaced), index };
  }
  if (!Array.isArray(where) || where.length !== nodes.length) {
    throw new TreeOpError('Each item placed on the tab needs a position.');
  }
  const cols = containerColumns(r.container);
  return { add: nodes.map((n, i) => placedOnTab(n, where[i], cols, fromFolder[i])) };
}

function fromFolderFlags(d: LayoutDashboard, ids: string[]): boolean[] {
  return ids.map((id) => (locate(d, id)?.folderChain.length ?? 0) > 0);
}

// ---------------------------------------------------------------- move / copy / insert

function checkMovable(d: LayoutDashboard, nodes: LayoutNode[], toFolderId: string | undefined, verb: string): void {
  const idSet = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    if (n.kind === 'folder' && toFolderId !== undefined && (n.id === toFolderId || isDescendant(d, n.id, toFolderId))) {
      throw new TreeOpError('A folder cannot be moved into itself.');
    }
    const loc = locate(d, n.id)!;
    if (loc.folderChain.some((f) => idSet.has(f))) {
      throw new TreeOpError(`An item cannot be ${verb} together with the folder that contains it.`);
    }
  }
}

/**
 * THE move: `ids` to `to` — tab ⇄ folder, folder ⇄ folder, within one folder — at `where`
 * (placements on a tab, an index in a folder). In a folder the index counts the items that stay
 * (the moved ones are taken out first), and several items keep their given order there. A folder
 * into itself or a descendant is refused, as is an item moved with the folder that holds it.
 */
export function moveBetween(
  d: LayoutDashboard, ids: string[], to: ContainerRef, where: Where, push?: Map<string, Placement>
): LayoutDashboard {
  const nodes = mustFind(d, ids);
  resolveRef(d, to);
  checkMovable(d, nodes, to.folderId, 'moved');
  const { add, index } = shapeFor(d, to, nodes, where, fromFolderFlags(d, ids));
  return commit(removeIds(d, new Set(ids)), to, add, index, push);
}

/** Move `ids` to `to`: at `at` on a tab; at the end of a folder (use moveBetween for an index). */
export function moveNodes(
  d: LayoutDashboard, ids: string[], to: ContainerRef, at: Placement[], push?: Map<string, Placement>
): LayoutDashboard {
  return moveBetween(d, ids, to, to.folderId !== undefined ? END : at, push);
}

/** Reorder one direct child of a folder to `toIndex` (among the others). Same place → same dashboard. */
export function reorderInFolder(d: LayoutDashboard, folderId: string, nodeId: string, toIndex: number): LayoutDashboard {
  checkIndex(toIndex);
  const loc = locate(d, folderId);
  if (!loc) throw new TreeOpError('That folder no longer exists.');
  const f = findNode(d, folderId);
  if (f.kind !== 'folder') throw new TreeOpError('Only a folder keeps its items in order.');
  const list = kids(f.content);
  const from = list.findIndex((n) => n.id === nodeId);
  if (from === -1) throw new TreeOpError('That item is not in this folder.');
  if (Math.min(Math.max(0, toIndex), list.length - 1) === from) return d;
  return moveBetween(d, [nodeId], { tabId: loc.tabId, folderId }, toIndex);
}

/** Deep-copy a node with fresh ids (nodes and every descendant) drawn from `used`. */
function cloneWithNewIds(node: LayoutNode, used: Set<string>): LayoutNode {
  const copy = structuredClone(node) as LayoutNode;
  const walk = (n: LayoutNode): void => {
    n.id = uniqueId(n.kind, used);
    if (n.kind === 'folder') kids(n.content).forEach(walk);
  };
  walk(copy);
  return copy;
}

/** Deep copies of `ids` (fresh ids avoiding `allIds`) put in `to` at `where`. */
export function copyNodes(
  d: LayoutDashboard, ids: string[], to: ContainerRef, where: Where, allIds: Set<string>,
  push?: Map<string, Placement>
): { dashboard: LayoutDashboard; newIds: string[] } {
  const nodes = mustFind(d, ids);
  resolveRef(d, to);
  const used = new Set(allIds); // never mutate the caller's set
  const copies = nodes.map((n) => cloneWithNewIds(n, used));
  const { add, index } = shapeFor(d, to, copies, where, fromFolderFlags(d, ids));
  return { dashboard: commit(d, to, add, index, push), newIds: copies.map((c) => c.id) };
}

/**
 * Paste clones of a clipboard SNAPSHOT (taken at Copy time, so later edits or deletion of the
 * originals do not change what is pasted): fresh ids for every node, avoiding `allIds`; put in `to`
 * at `where`.
 */
export function pasteSnapshot(
  d: LayoutDashboard, nodes: LayoutNode[], to: ContainerRef, where: Where,
  allIds: Set<string>, push?: Map<string, Placement>
): { dashboard: LayoutDashboard; newIds: string[] } {
  resolveRef(d, to);
  const used = new Set(allIds);
  const copies = nodes.map((n) => cloneWithNewIds(n, used));
  // A snapshot with no placement came from inside a folder.
  const { add, index } = shapeFor(d, to, copies, where, nodes.map((n) => !n.placement));
  return { dashboard: commit(d, to, add, index, push), newIds: copies.map((c) => c.id) };
}

/** Insert a NEW node (its ids unused) into `to` at `where`. */
export function insertNode(
  d: LayoutDashboard, node: LayoutNode, to: ContainerRef, where: Placement | number, push?: Map<string, Placement>
): LayoutDashboard {
  const seen = new Set<string>();
  const walk = (n: LayoutNode): void => {
    if (locate(d, n.id) || seen.has(n.id)) throw new TreeOpError('An item with that id already exists.');
    seen.add(n.id);
    if (n.kind === 'folder') kids(n.content).forEach(walk);
  };
  walk(node);
  const { add, index } = shapeFor(d, to, [node], typeof where === 'number' ? where : [where], [false]);
  return commit(d, to, add, index, push);
}

/** Insert a NEW node into folder `folderId` at `index` (past the end appends). */
export function insertIntoFolder(d: LayoutDashboard, folderId: string, node: LayoutNode, index: number): LayoutDashboard {
  checkIndex(index);
  const loc = locate(d, folderId);
  if (!loc) throw new TreeOpError('That folder no longer exists.');
  if (findNode(d, folderId).kind !== 'folder') throw new TreeOpError('Only a folder keeps its items in order.');
  return insertNode(d, node, { tabId: loc.tabId, folderId }, index);
}

/**
 * A copy of `id` next to it: inside a folder right after the source; on a tab at the first free
 * cells of its span.
 */
export function duplicateNode(
  d: LayoutDashboard, id: string, allIds: Set<string>
): { dashboard: LayoutDashboard; newId: string } {
  const node = findNode(d, id);
  const loc = locate(d, id)!;
  const ref = refOf(loc);
  let where: Where;
  if (ref.folderId !== undefined) {
    where = loc.index + 1;
  } else {
    const r = resolveRef(d, ref);
    const span = tabSpan(node);
    const cell = firstFreeCell(r.container, span.w, span.h);
    if (node.placement?.z !== undefined) cell.z = node.placement.z;
    where = [cell];
  }
  const out = copyNodes(d, [id], ref, where, allIds);
  return { dashboard: out.dashboard, newId: out.newIds[0] };
}

// ---------------------------------------------------------------- merge into a new folder

/**
 * Merge `draggedIds` and the target tile into a new minimised folder in the target's place:
 * `{ size: 'medium', contentSize: 'medium', content: { children: [target, ...dragged] } }`, the
 * children in that order with no placements. On a tab the folder keeps the default open box
 * (defaultFolderBox: 6 x 5 for Medium contents, raised to its minimum) at the target's top-left (shifted left at the right edge);
 * nodes it now overlaps are pushed aside (pushAside), so the result never overlaps. Inside a folder
 * it takes the target's index. `allIds` is every id in the document; the new folder id avoids it.
 */
export function mergeIntoNewFolder(
  d: LayoutDashboard, draggedIds: string[], targetTileId: string, allIds: Set<string>
): { dashboard: LayoutDashboard; folderId: string } {
  const target = findNode(d, targetTileId);
  if (target.kind !== 'tile') throw new TreeOpError('Items can only be merged onto a tile.');
  if (draggedIds.length === 0) throw new TreeOpError('Nothing to merge.');
  if (draggedIds.includes(targetTileId)) throw new TreeOpError('An item cannot be merged with itself.');
  const dragged = mustFind(d, draggedIds);
  const idSet = new Set(draggedIds);
  for (const n of dragged) {
    const loc = locate(d, n.id)!;
    if (loc.folderChain.some((f) => idSet.has(f))) {
      throw new TreeOpError('An item cannot be merged together with the folder that contains it.');
    }
    if (n.kind === 'folder' && isDescendant(d, n.id, targetTileId)) {
      throw new TreeOpError('A folder cannot be moved into itself.');
    }
  }
  const ref = refOf(locate(d, targetTileId)!);
  const folderId = uniqueId('folder', new Set(allIds));
  // Inside a folder the new sub-folder is one of its items: it is drawn at — and its own size and
  // contents size are — the parent's contents size. On the tab: Medium.
  const parent = ref.folderId !== undefined ? findNode(d, ref.folderId) : undefined;
  const size: FolderNode['contentSize'] = parent?.kind === 'folder' ? (parent.contentSize ?? 'medium') : 'medium';
  const folder: FolderNode = {
    kind: 'folder', id: folderId, name: 'New folder', display: 'collapsed', size, contentSize: size,
    shape: SHAPE_CREATED, showTitle: true, content: { children: [target, ...dragged].map(unplaced) }
  };
  const without = removeIds(d, idSet);
  if (ref.folderId !== undefined) {
    const merged = editContainer(without, ref, (c) => ({
      ...c, children: kids(c).map((x) => (x.id === targetTileId ? folder : x))
    }));
    return { dashboard: growForMinimum(d, merged, ref.folderId), folderId };
  }
  const after = resolveRef(without, ref);
  const cols = containerColumns(after.container);
  const box = defaultFolderBox(folder);
  const w = Math.min(box.w, cols);
  const tp = target.placement as Placement;
  const placement: Placement = { x: Math.max(0, Math.min(Math.floor(tp.x), cols - w)), y: Math.floor(tp.y), w, h: box.h };
  if (tp.z !== undefined) placement.z = tp.z;
  folder.placement = placement;
  const push = pushAside(after.container, new Set([targetTileId, ...draggedIds]), placement);
  const dashboard = editContainer(without, ref, (c) => {
    const next = { ...c, children: applyPush(kids(c), push).map((x) => (x.id === targetTileId ? folder : x)) };
    assertGridNoOverlap(next, new Set([folderId, ...push.keys()]));
    return next;
  });
  return { dashboard, folderId };
}

// ---------------------------------------------------------------- update / delete / resize / z

export function updateNode(d: LayoutDashboard, id: string, patch: Partial<LayoutNode>): LayoutDashboard {
  findNode(d, id);
  const p = patch as Record<string, unknown>;
  for (const k of ['id', 'kind', 'placement', 'content']) {
    if (k in p) throw new TreeOpError(`"${k}" cannot be changed here; use the dedicated operation.`);
  }
  return mapTabs(d, (n) => (n.id === id ? ({ ...n, ...patch } as LayoutNode) : n));
}

/**
 * Set a folder's SAVED default display (what a browser with no remembered view shows).
 * Unchanged → the same dashboard (no undo step).
 */
export function setFolderDisplay(
  d: LayoutDashboard, id: string, display: FolderNode['display']
): LayoutDashboard {
  if (display !== 'expanded' && display !== 'collapsed') throw new TreeOpError('That folder display is not valid.');
  const node = findNode(d, id);
  if (node.kind !== 'folder') throw new TreeOpError('Only folders can start collapsed or expanded.');
  if (node.display === display) return d;
  return mapTabs(d, (n) => (n.id === id ? ({ ...n, display } as LayoutNode) : n));
}

export function deleteNodes(d: LayoutDashboard, ids: string[]): LayoutDashboard {
  mustFind(d, ids);
  return removeIds(d, new Set(ids));
}

/** The tab root holding `id`, refusing an item inside a folder (it has no placement there). */
function onTab(d: LayoutDashboard, id: string, what: string): { node: LayoutNode; ref: ContainerRef; r: Resolved } {
  const node = findNode(d, id);
  const loc = locate(d, id)!;
  if (loc.folderChain.length > 0 || !isPlaced(node)) {
    throw new TreeOpError(`Items inside a folder take its contents size and order, so they can't be ${what}.`);
  }
  const ref = refOf(loc);
  return { node, ref, r: resolveRef(d, ref) };
}

/**
 * The placement resizeNode would give folder `id` on a tab for a requested w x h: clamped to the
 * columns, and never smaller than its bar, padding, one item at its LARGEST contents size (its own or
 * any sub-folder's) and the page bar (geometry.folderMinCells; the folder pages its contents instead of growing to fit
 * them). Pure; the resize preview uses it so the
 * highlight shows exactly what the commit stores.
 */
export function resizedPlacement(d: LayoutDashboard, id: string, w: number, h: number): Placement {
  if (!Number.isFinite(w) || !Number.isFinite(h)) throw new TreeOpError('That size is not valid.');
  const { node, r } = onTab(d, id, 'resized');
  if (node.kind !== 'folder') throw new TreeOpError('A tile takes the space of its Size — change its Size in the tile dialog instead.');
  const cols = containerColumns(r.container);
  const sized = clampPlacement({ ...(node.placement as Placement), w, h }, cols);
  const min = folderMinCells(node);
  sized.w = Math.max(sized.w, Math.min(min.w, cols - sized.x));
  sized.h = Math.max(sized.h, min.h);
  return sized;
}

/**
 * The tab-level folder holding `id` (or `id` itself) grown to its smallest open box when it is below
 * it — after its contents size (or a sub-folder's) went up. Its neighbours are
 * pushed aside by the push-aside rules (pushAside). Already big enough, or not on a tab: the same dashboard.
 * No room across the tab: TreeOpError with the reason, nothing changed.
 */
export function fitFolderMinimum(d: LayoutDashboard, id: string): LayoutDashboard {
  const loc = locate(d, id);
  if (!loc) throw new TreeOpError('That folder no longer exists.');
  const topId = loc.folderChain[0] ?? id;
  const top = findNode(d, topId);
  if (top.kind !== 'folder' || !isPlaced(top)) return d;
  const r = resolveRef(d, refOf(locate(d, topId)!));
  const cols = containerColumns(r.container);
  const min = folderMinCells(top);
  const cur = clampPlacement(top.placement as Placement, cols);
  if (cur.w >= min.w && cur.h >= min.h) return d;
  if (min.w > cols) {
    const size = largestContentSize(top);
    throw new TreeOpError(
      `There isn't room for "${top.name || 'Untitled'}" with ${size[0].toUpperCase()}${size.slice(1)} contents here: ` +
        `open, it needs at least ${min.w} columns and this tab has ${cols}.`
    );
  }
  const w = Math.max(cur.w, min.w);
  const at: Placement = { x: Math.min(cur.x, cols - w), y: cur.y, w, h: Math.max(cur.h, min.h) };
  if (cur.z !== undefined) at.z = cur.z;
  return placeNode(d, topId, at, pushAside(r.container, new Set([topId]), at));
}

/**
 * A folder look from a dialog: `shape` one of the seven names and `tabPosition` left /
 * centre / right, when given (undefined = unchanged / absent). Anything else is a TreeOpError with the
 * reason — the server would refuse it on save, so it is refused here, visibly, before it gets there.
 */
export function assertFolderLook(patch: { shape?: unknown; tabPosition?: unknown }): void {
  if (patch.shape !== undefined && !isFolderShape(patch.shape)) {
    throw new TreeOpError(`That folder look isn't available ("${String(patch.shape)}"). Pick one of the looks in the list.`);
  }
  if (patch.tabPosition !== undefined && !isTabPosition(patch.tabPosition)) {
    throw new TreeOpError(`That tab position isn't available ("${String(patch.tabPosition)}"). Pick left, centre or right.`);
  }
}

/**
 * After items went into folder `folderId` (`before` → `after`), the tab-level open box
 * holding it grows to its new minimum when the largest contents size inside it went UP (a folder whose
 * subtree has a larger contents size came in) — fitFolderMinimum, pushing neighbours by the push-aside rules,
 * in the same operation (so the same undo step); no room is a TreeOpError with the reason. A move that
 * does not raise the minimum leaves the box exactly as it was.
 */
function growForMinimum(before: LayoutDashboard, after: LayoutDashboard, folderId: string): LayoutDashboard {
  const loc = locate(after, folderId);
  if (!loc) return after;
  const topId = loc.folderChain[0] ?? folderId;
  const was = locate(before, topId) ? findNode(before, topId) : undefined;
  const now = findNode(after, topId);
  if (was?.kind !== 'folder' || now.kind !== 'folder') return after;
  if (sizeSpan(largestContentSize(now)) <= sizeSpan(largestContentSize(was))) return after;
  return fitFolderMinimum(after, folderId);
}

export function resizeNode(
  d: LayoutDashboard, id: string, w: number, h: number, push?: Map<string, Placement>
): LayoutDashboard {
  return placeNode(d, id, resizedPlacement(d, id, w, h), push);
}

/**
 * Put `id` at `at` (position and size) on its tab, applying `push` to its siblings (pushAside,
 * the push map). Used when a tile's Size sets its span, which may also shift it left at
 * the right edge. Validated and never overlapping (else TreeOpError).
 */
export function placeNode(
  d: LayoutDashboard, id: string, at: Placement, push?: Map<string, Placement>
): LayoutDashboard {
  const { node, ref, r } = onTab(d, id, 'placed');
  const placed = placedOnTab(node, at, containerColumns(r.container), false);
  const changed = new Set<string>([id, ...(push ? push.keys() : [])]);
  return editContainer(d, ref, (c) => {
    const next = { ...c, children: applyPush(kids(c), push).map((n) => (n.id === id ? placed : n)) };
    assertGridNoOverlap(next, changed);
    return next;
  });
}

const Z_LIMIT = 1000;
/** A node's z as stored, read the way the renderer reads it: finite, truncated, within ±1000. */
function zOf(n: LayoutNode | undefined): number {
  const z = n?.placement?.z;
  return typeof z === 'number' && Number.isFinite(z) ? Math.min(Z_LIMIT, Math.max(-Z_LIMIT, Math.trunc(z))) : 0;
}

/**
 * Bring forward (above every sibling) / send back (below every sibling) on a tab. Unchanged → the
 * same dashboard. At the ±1000 limit the siblings are first renumbered 0..n-1 in their current
 * stacking order (z, then document order, as rendered), so a tie at the limit still moves past.
 */
export function setZ(d: LayoutDashboard, id: string, dir: 'forward' | 'back'): LayoutDashboard {
  const { node, ref, r } = onTab(d, id, 'brought forward or sent back');
  const list = kids(r.container);
  const others = list.filter((n) => n.id !== id).map(zOf);
  const cur = zOf(node);
  if (others.length === 0) return d;
  const top = Math.max(...others);
  const bottom = Math.min(...others);
  if (dir === 'forward' ? top < cur : bottom > cur) return d; // already in front / behind
  const want = dir === 'forward' ? top + 1 : bottom - 1;
  if (want <= Z_LIMIT && want >= -Z_LIMIT) {
    return mapTabs(d, (n) => (n.id === id ? ({ ...n, placement: { ...n.placement, z: want } } as LayoutNode) : n));
  }
  // At the limit: renumber in stacking order, then put this one past the end.
  const stack = list.map((n, i) => ({ n, i })).filter((e) => e.n.id !== id).sort((a, b) => zOf(a.n) - zOf(b.n) || a.i - b.i);
  const z = new Map<string, number>(stack.map((e, k) => [e.n.id, k]));
  z.set(id, dir === 'forward' ? stack.length : -1);
  return editContainer(d, ref, (c) => ({
    ...c,
    children: kids(c).map((n) => (z.has(n.id) && n.placement ? ({ ...n, placement: { ...n.placement, z: z.get(n.id) } } as LayoutNode) : n))
  }));
}

// ---------------------------------------------------------------- tabs

export function reorderTabs(d: LayoutDashboard, tabIds: string[]): LayoutDashboard {
  const have = d.tabs.map((t) => t.id);
  if (tabIds.length !== have.length || new Set(tabIds).size !== tabIds.length || !tabIds.every((i) => have.includes(i))) {
    throw new TreeOpError('The tab order is not valid.');
  }
  return { ...d, tabs: tabIds.map((i) => d.tabs.find((t) => t.id === i) as LayoutTab) };
}

export function addTab(d: LayoutDashboard, name: string): { dashboard: LayoutDashboard; tabId: string } {
  const clean = (name ?? '').trim();
  if (!clean) throw new TreeOpError('A tab needs a name.');
  const tabId = newNodeId('tab');
  const tab: LayoutTab = { id: tabId, name: clean, root: { columns: ROOT_COLUMNS, children: [] } };
  return { dashboard: { ...d, tabs: [...d.tabs, tab] }, tabId };
}

export function updateTab(d: LayoutDashboard, tabId: string, patch: Partial<LayoutTab>): LayoutDashboard {
  findTab(d, tabId);
  if ('id' in patch && patch.id !== tabId) throw new TreeOpError('A tab id cannot be changed.');
  return { ...d, tabs: d.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) };
}

/**
 * Append a deep copy of a tab, named "<name> (Copy)", with a new tab id and new ids for every
 * node. `allIds` is every id in the document (all dashboards + draft); new ids avoid it.
 */
export function duplicateTab(
  d: LayoutDashboard, tabId: string, allIds: Set<string>
): { dashboard: LayoutDashboard; tabId: string } {
  const src = findTab(d, tabId);
  const used = new Set(allIds);
  for (const t of d.tabs) used.add(t.id);
  let newId = newNodeId('tab');
  for (let i = 0; used.has(newId) && i < 1000; i++) newId = newNodeId('tab');
  if (used.has(newId)) throw new TreeOpError('Could not generate a unique id. Please try again.');
  const copy: LayoutTab = {
    ...structuredClone(src),
    id: newId,
    name: `${src.name} (Copy)`,
    root: { ...src.root, children: kids(src.root).map((n) => cloneWithNewIds(n, used)) }
  };
  return { dashboard: { ...d, tabs: [...d.tabs, copy] }, tabId: newId };
}

export function deleteTab(d: LayoutDashboard, tabId: string): LayoutDashboard {
  findTab(d, tabId);
  if (d.tabs.length <= 1) throw new TreeOpError('A dashboard needs at least one tab.');
  return { ...d, tabs: d.tabs.filter((t) => t.id !== tabId) };
}

// ---------------------------------------------------------------- free cells / reflow (tab level)

/** First position of size w x h on tab root `c` that overlaps nothing: row-major, one cell at a time. */
export function firstFreeCell(c: Container, w: number, h: number): Placement {
  const cols = containerColumns(c);
  const cw = Math.min(Math.max(1, Math.floor(w) || 1), cols);
  const chh = Math.max(1, Math.floor(h) || 1);
  const taken = kids(c).filter(isPlaced).map((n) => n.placement);
  const bottom = taken.reduce((m, t) => Math.max(m, t.y + t.h), 0);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + cw <= cols; x++) {
      const cand = { x, y, w: cw, h: chh };
      if (!taken.some((t) => overlaps(cand, t))) return cand;
    }
  }
  return { x: 0, y: bottom, w: cw, h: chh };
}

/**
 * Grid reflow for a drop on a tab. `moving` are the ids being dragged (they vacate their cells, so
 * they are ignored); `target` is where they will land. Returns only the nodes that must move (empty
 * when the target is free). Algorithm: take the other nodes that overlap the target, in reading
 * order; each keeps its size and moves to the nearest free position at or below its own row (same
 * row first, nearest column, right before left on a tie, then the next row down, ...), where free
 * means clear of the target, of every node that stays put, and of nodes already re-homed. Displaced
 * nodes only take free cells, so nothing cascades and the result never overlaps.
 */
export function pushAside(c: Container, moving: Set<string>, target: Placement): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const cols = containerColumns(c);
  const tgt = clampPlacement(target, cols);
  const others = kids(c)
    .filter((n) => isPlaced(n) && !moving.has(n.id))
    .map((n, i) => ({ n, i, p: clampPlacement(n.placement as Placement, cols) }))
    .sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x || a.i - b.i);
  const displaced = others.filter((o) => overlaps(o.p, tgt));
  if (displaced.length === 0) return out;
  const displacedIds = new Set(displaced.map((o) => o.n.id));
  const occupied: Placement[] = [tgt];
  for (const o of others) if (!displacedIds.has(o.n.id)) occupied.push(o.p);
  for (const { n, p: orig } of displaced) {
    const xs: number[] = [];
    for (let x = 0; x + orig.w <= cols; x++) xs.push(x);
    xs.sort((a, b) => Math.abs(a - orig.x) - Math.abs(b - orig.x) || b - a);
    let placed: Placement | undefined;
    for (let y = orig.y; !placed; y++) {
      for (const x of xs) {
        const cand: Placement = { ...orig, x, y };
        if (!occupied.some((o) => overlaps(cand, o))) {
          placed = cand;
          break;
        }
      }
    }
    const final = placed as Placement; // rows grow downward without bound, so a free cell is always found
    occupied.push(final);
    out.set(n.id, final);
  }
  return out;
}
