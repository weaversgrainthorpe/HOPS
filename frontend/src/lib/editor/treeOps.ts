/**
 * Pure tree operations for the layout editor. Every function takes a
 * LayoutDashboard (or Container) and returns a NEW value; inputs are never
 * mutated. Invalid operations throw TreeOpError with a user-facing message.
 *
 * Grid gaps persist: moving or deleting never shifts any other node. Only
 * pushAside (an explicit reflow for a drop target) relocates displaced nodes.
 */
import type {
  Container, FolderNode, LayoutDashboard, LayoutMode, LayoutNode, LayoutTab, Placement
} from '../types/layout';
import {
  DEFAULT_DESIGN_WIDTH, FREE_UNIT_PX, ROOT_COLUMNS, clampPlacement, containerColumns, containerMetrics, folderInnerMetrics,
  gridContentRows, isRenderable, readingOrder, requiredFolderHeightPx, resolveMode
} from '../layout/geometry';

export type ContainerRef = { tabId: string; folderId?: string }; // folderId absent = tab root
export interface NodeLocation { tabId: string; folderChain: string[]; index: number }

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

interface Resolved { tab: LayoutTab; chain: FolderNode[]; container: Container; folder?: FolderNode; mode: LayoutMode }

function resolveRef(d: LayoutDashboard, ref: ContainerRef): Resolved {
  const tab = findTab(d, ref.tabId);
  if (ref.folderId === undefined) return { tab, chain: [], container: tab.root, mode: resolveMode(d, tab, []) };
  const chain = folderPath(kids(tab.root), ref.folderId);
  if (!chain) throw new TreeOpError('That folder no longer exists.');
  const folder = chain[chain.length - 1];
  return { tab, chain, container: folder.content, folder, mode: resolveMode(d, tab, chain) };
}

/** The container a ref names, with its resolved mode and column count (throws TreeOpError if gone). */
export function resolveContainer(
  d: LayoutDashboard, ref: ContainerRef
): { container: Container; mode: LayoutMode; columns: number; folder?: FolderNode } {
  const r = resolveRef(d, ref);
  return { container: r.container, mode: r.mode, columns: containerColumns(r.container, r.folder), folder: r.folder };
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

// ---------------------------------------------------------------- placement validation

function finitePlacement(p: Placement): void {
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    if (typeof p?.[k] !== 'number' || !Number.isFinite(p[k])) throw new TreeOpError('That position is not valid.');
  }
}

/**
 * Validate a placement for a container. Grid: must lie wholly inside the columns
 * (else TreeOpError). Free: the design extent is soft, so it is clamped.
 */
function checkedPlacement(p: Placement, r: Resolved): Placement {
  finitePlacement(p);
  const cols = containerColumns(r.container, r.folder);
  if (r.mode === 'free') return clampPlacement(p, cols);
  if (p.x < 0 || p.y < 0 || p.w < 1 || p.h < 1 || p.x + p.w > cols) {
    throw new TreeOpError('That position is outside the grid.');
  }
  const out: Placement = { x: p.x, y: p.y, w: p.w, h: p.h };
  if (p.z !== undefined) out.z = p.z;
  return out;
}

// ---------------------------------------------------------------- grid overlap contract (Ruling 11)

const overlaps = (a: Placement, b: Placement): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Grid containers never hold overlapping siblings. Throws "That space is taken" if any node in
 * `only` (default: all) overlaps another. Checking only the changed ids keeps legacy overlaps
 * elsewhere in the container from blocking unrelated edits. Free containers never call this.
 */
export function assertGridNoOverlap(c: Container, only?: Set<string>): void {
  const cols = containerColumns(c);
  const nodes = kids(c).filter(isRenderable).map((n) => ({ id: n.id, p: clampPlacement(n.placement, cols) }));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (only && !only.has(nodes[i].id) && !only.has(nodes[j].id)) continue;
      if (overlaps(nodes[i].p, nodes[j].p)) throw new TreeOpError('That space is taken');
    }
  }
}

/**
 * True when `p` can go in `c` as it is: a grid needs it inside the columns and clear of every
 * sibling's STORED footprint (a collapsed folder's reserved cells count, Ruling 13); free
 * containers tolerate overlap, so any finite position is fine there.
 */
export function cellIsFree(c: Container, p: Placement, mode: LayoutMode): boolean {
  if (![p.x, p.y, p.w, p.h].every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  if (mode === 'free') return p.x >= 0 && p.y >= 0;
  const cols = containerColumns(c);
  if (p.x < 0 || p.y < 0 || p.w < 1 || p.h < 1 || p.x + p.w > cols) return false;
  return !kids(c).filter(isRenderable).some((n) => overlaps(clampPlacement(n.placement, cols), p));
}

/** Apply a pushAside map to a children list (ids not present are ignored). */
function applyPush(children: LayoutNode[], push?: Map<string, Placement>): LayoutNode[] {
  if (!push || push.size === 0) return children;
  return children.map((n) => (push.has(n.id) ? ({ ...n, placement: push.get(n.id) } as LayoutNode) : n));
}

/** Append `add` to the container at `to`, applying `push` to its siblings; grid result must not overlap. */
function commitToContainer(
  d: LayoutDashboard, to: ContainerRef, r: Resolved, add: LayoutNode[], push?: Map<string, Placement>
): LayoutDashboard {
  const changed = new Set<string>([...add.map((a) => a.id), ...(push ? push.keys() : [])]);
  return editContainer(d, to, (c) => {
    const next = { ...c, children: [...applyPush(kids(c), push), ...add] };
    if (r.mode === 'grid') assertGridNoOverlap(next, changed);
    return next;
  });
}

// ---------------------------------------------------------------- move / copy / insert

export function moveNodes(
  d: LayoutDashboard, ids: string[], to: ContainerRef, at: Placement[], push?: Map<string, Placement>
): LayoutDashboard {
  if (ids.length !== at.length) throw new TreeOpError('Each moved item needs a position.');
  const nodes = mustFind(d, ids);
  const target = resolveRef(d, to);
  const idSet = new Set(ids);
  for (const n of nodes) {
    if (n.kind === 'folder' && (n.id === to.folderId || (to.folderId && isDescendant(d, n.id, to.folderId)))) {
      throw new TreeOpError('A folder cannot be moved into itself.');
    }
    const loc = locate(d, n.id)!;
    if (loc.folderChain.some((f) => idSet.has(f))) {
      throw new TreeOpError('An item cannot be moved together with the folder that contains it.');
    }
  }
  // Across modes, a node is converted (size and inheriting content) on the one path: convertNode.
  const placed = nodes.map(
    (n, i) => ({ ...adaptNode(d, n, originOf(d, n.id), to), placement: checkedPlacement(at[i], target) }) as LayoutNode
  );
  return commitToContainer(removeIds(d, idSet), to, target, placed, push);
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

export function copyNodes(
  d: LayoutDashboard, ids: string[], to: ContainerRef, at: Placement[], allIds: Set<string>,
  push?: Map<string, Placement>
): { dashboard: LayoutDashboard; newIds: string[] } {
  if (ids.length !== at.length) throw new TreeOpError('Each copied item needs a position.');
  const nodes = mustFind(d, ids);
  const target = resolveRef(d, to);
  const used = new Set(allIds); // never mutate the caller's set
  const copies = nodes.map((n, i) => {
    const c = cloneWithNewIds(adaptNode(d, n, originOf(d, n.id), to), used);
    c.placement = checkedPlacement(at[i], target);
    return c;
  });
  return {
    dashboard: commitToContainer(d, to, target, copies, push),
    newIds: copies.map((c) => c.id)
  };
}

/**
 * Paste clones of a clipboard SNAPSHOT (taken at Copy time, so later edits or deletion of the
 * originals do not change what is pasted): fresh ids for every node, avoiding `allIds`; each node
 * converted from its recorded origin when the target's mode differs; placed at `at`.
 */
export function pasteSnapshot(
  d: LayoutDashboard, nodes: LayoutNode[], origins: NodeOrigin[], to: ContainerRef, at: Placement[],
  allIds: Set<string>, push?: Map<string, Placement>
): { dashboard: LayoutDashboard; newIds: string[] } {
  if (nodes.length !== at.length || nodes.length !== origins.length) {
    throw new TreeOpError('Each pasted item needs a position.');
  }
  const target = resolveRef(d, to);
  const used = new Set(allIds);
  const copies = nodes.map((n, i) => {
    const c = cloneWithNewIds(adaptNode(d, n, origins[i], to), used);
    c.placement = checkedPlacement(at[i], target);
    return c;
  });
  return { dashboard: commitToContainer(d, to, target, copies, push), newIds: copies.map((c) => c.id) };
}

export function insertNode(
  d: LayoutDashboard, node: LayoutNode, to: ContainerRef, at: Placement, push?: Map<string, Placement>
): LayoutDashboard {
  const seen = new Set<string>();
  const walk = (n: LayoutNode): void => {
    if (locate(d, n.id) || seen.has(n.id)) throw new TreeOpError('An item with that id already exists.');
    seen.add(n.id);
    if (n.kind === 'folder') kids(n.content).forEach(walk);
  };
  walk(node);
  const target = resolveRef(d, to);
  const placed = { ...node, placement: checkedPlacement(at, target) } as LayoutNode;
  return commitToContainer(d, to, target, [placed], push);
}

export function duplicateNode(
  d: LayoutDashboard, id: string, allIds: Set<string>
): { dashboard: LayoutDashboard; newId: string } {
  const node = findNode(d, id);
  const loc = locate(d, id)!;
  const ref: ContainerRef = { tabId: loc.tabId, folderId: loc.folderChain[loc.folderChain.length - 1] };
  const r = resolveRef(d, ref);
  const cell = firstFreeCell(r.container, node.placement.w, node.placement.h, r.mode);
  if (r.mode === 'grid') cell.h = node.placement.h;
  if (node.placement.z !== undefined) cell.z = node.placement.z;
  const out = copyNodes(d, [id], ref, [cell], allIds);
  return { dashboard: out.dashboard, newId: out.newIds[0] };
}

// ---------------------------------------------------------------- merge into a new folder

/**
 * Merge `draggedIds` and the target tile into a new collapsed folder in the target's slot.
 * The folder's placement is its STORED (expanded) size; how a collapsed folder renders is the
 * renderer's business.
 * Grid parent: n = 1 + dragged; per = min(4, n, parent columns); folder w = per, h = ceil(n / per) + 1
 * (= ceil(n / 4) + 1 whenever the parent has >= 4 columns); x = min(target x, columns - w) so it
 * stays inside the grid; content.columns = w; children are 1 x 1, row-major, target first then the
 * dragged nodes in reading order. Nodes the new footprint overlaps are pushed aside (pushAside,
 * merged nodes excluded) inside this op, so the result never overlaps.
 * Free parent (8 px units): children keep the target tile's size (cw x ch); the folder is
 * per * cw wide and ceil(n / per) * ch + 8 tall (8 units = 64 px, enough for the 40 px title bar
 * and body padding) at the target's x,y; content.columns = folder width; children are placed
 * row-major in cw x ch steps. Free parents tolerate overlap.
 * `allIds` is every id in the document (all dashboards + draft); the new folder id avoids it.
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
  const tloc = locate(d, targetTileId)!;
  const ref: ContainerRef = { tabId: tloc.tabId, folderId: tloc.folderChain[tloc.folderChain.length - 1] };
  const parent = resolveRef(d, ref);
  const cols = containerColumns(parent.container, parent.folder);
  const members = [target, ...readingOrder(dragged)];
  const n = members.length;
  const per = Math.min(4, n, parent.mode === 'grid' ? cols : n);
  const rows = Math.ceil(n / per);
  const tp = target.placement;
  let cw = 1, ch = 1, fw = per, fh = rows + 1, fx = tp.x;
  if (parent.mode === 'free') {
    cw = Math.max(1, Math.floor(tp.w));
    ch = Math.max(1, Math.floor(tp.h));
    fw = per * cw;
    fh = rows * ch + 8;
  } else {
    fx = Math.max(0, Math.min(tp.x, cols - fw));
  }
  const children = members.map((m, i) => {
    const place: Placement = { x: (i % per) * cw, y: Math.floor(i / per) * ch, w: cw, h: ch };
    return { ...m, placement: place } as LayoutNode;
  });
  const placement: Placement = { x: fx, y: tp.y, w: fw, h: fh };
  if (tp.z !== undefined) placement.z = tp.z;
  const folderId = uniqueId('folder', new Set(allIds));
  const folder: FolderNode = {
    kind: 'folder', id: folderId, name: 'New folder', display: 'collapsed', layout: 'inherit',
    shape: 'rounded', showTitle: true, placement, content: { columns: fw, children }
  };
  const without = removeIds(d, idSet);
  const after = resolveRef(without, ref);
  const push = parent.mode === 'grid'
    ? pushAside(after.container, new Set([targetTileId, ...draggedIds]), placement)
    : undefined;
  const dashboard = editContainer(without, ref, (c) => {
    const next = { ...c, children: applyPush(kids(c), push).map((x) => (x.id === targetTileId ? folder : x)) };
    if (parent.mode === 'grid') assertGridNoOverlap(next, new Set([folderId, ...(push ? push.keys() : [])]));
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

/**
 * Smallest height (in the parent's rows) a folder of width w can have without clipping its content.
 * Grid folder in a grid parent: its content rows + 1 (the title row), per geometry's rows rule.
 * Otherwise geometry's requiredFolderHeightPx on a nominal parent (80 px cells in a grid parent,
 * 8 px in a free one), converted back to parent rows. The nominal 80 px is an internal bound
 * (the real unit depends on viewport width), not a rendering value.
 */
function minFolderHeight(folder: FolderNode, w: number, parentMode: LayoutMode, parentCols: number): number {
  const unit = parentMode === 'free' ? FREE_UNIT_PX : 80;
  const m = containerMetrics({ columns: parentCols, children: [] }, parentMode, parentCols * unit);
  const probe: FolderNode = { ...folder, display: 'expanded', placement: { ...folder.placement, w, h: 1 } };
  const inner = folderInnerMetrics(probe, m);
  if (inner.mode === 'grid' && m.mode === 'grid') return gridContentRows(probe, inner.columns, 0) + 1;
  return Math.max(1, Math.ceil(requiredFolderHeightPx(probe, m) / m.rowPx - 1e-9));
}

/**
 * The placement resizeNode would give `id` for a requested w x h: clamped to the container's
 * columns, and an expanded folder never shorter than its content. Pure; the resize preview uses
 * it so the highlight shows exactly what the commit stores.
 */
export function resizedPlacement(d: LayoutDashboard, id: string, w: number, h: number): Placement {
  const node = findNode(d, id);
  if (!Number.isFinite(w) || !Number.isFinite(h)) throw new TreeOpError('That size is not valid.');
  const loc = locate(d, id)!;
  const r = resolveRef(d, { tabId: loc.tabId, folderId: loc.folderChain[loc.folderChain.length - 1] });
  const cols = containerColumns(r.container, r.folder);
  const sized = clampPlacement({ ...node.placement, w, h }, cols);
  if (node.kind === 'folder') {
    sized.h = Math.max(sized.h, minFolderHeight(node, sized.w, r.mode, cols));
  }
  return sized;
}

export function resizeNode(
  d: LayoutDashboard, id: string, w: number, h: number, push?: Map<string, Placement>
): LayoutDashboard {
  const sized = resizedPlacement(d, id, w, h);
  const loc = locate(d, id)!;
  const r = resolveRef(d, { tabId: loc.tabId, folderId: loc.folderChain[loc.folderChain.length - 1] });
  const ref: ContainerRef = { tabId: loc.tabId, folderId: loc.folderChain[loc.folderChain.length - 1] };
  const changed = new Set<string>([id, ...(push ? push.keys() : [])]);
  return editContainer(d, ref, (c) => {
    const next = {
      ...c,
      children: applyPush(kids(c), push).map((n) => (n.id === id ? ({ ...n, placement: sized } as LayoutNode) : n))
    };
    if (r.mode === 'grid') assertGridNoOverlap(next, changed);
    return next;
  });
}

/**
 * Put `id` at `at` (position and size) in its own container, applying `push` to its siblings
 * (pushAside, Ruling 11). Used when a tile's Size sets its span (spec §8), which may also shift
 * it left at the container's right edge. Grid: validated and never overlapping (else TreeOpError).
 */
export function placeNode(
  d: LayoutDashboard, id: string, at: Placement, push?: Map<string, Placement>
): LayoutDashboard {
  findNode(d, id);
  const loc = locate(d, id)!;
  const ref: ContainerRef = { tabId: loc.tabId, folderId: loc.folderChain[loc.folderChain.length - 1] };
  const r = resolveRef(d, ref);
  const placed = checkedPlacement(at, r);
  const changed = new Set<string>([id, ...(push ? push.keys() : [])]);
  return editContainer(d, ref, (c) => {
    const next = {
      ...c,
      children: applyPush(kids(c), push).map((n) => (n.id === id ? ({ ...n, placement: placed } as LayoutNode) : n))
    };
    if (r.mode === 'grid') assertGridNoOverlap(next, changed);
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
 * Bring forward (above every sibling) / send back (below every sibling). Unchanged → the same
 * dashboard. At the ±1000 limit the siblings are first renumbered 0..n-1 in their current stacking
 * order (z, then document order, as rendered), so a tie at the limit still moves past.
 */
export function setZ(d: LayoutDashboard, id: string, dir: 'forward' | 'back'): LayoutDashboard {
  const node = findNode(d, id);
  const loc = locate(d, id)!;
  const ref: ContainerRef = { tabId: loc.tabId, folderId: loc.folderChain[loc.folderChain.length - 1] };
  const r = resolveRef(d, ref);
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

/**
 * Set a tab's layout ('inherit' | grid | free) and, for free tabs, its design width (px).
 * When the tab's effective mode changes, the tab's content is converted so it looks the same:
 * one grid cell = one dashboard column = round(designWidth / 12 / 8) free units ("side").
 * Grid → free multiplies every placement by side (exact, no overlaps); free → grid divides and
 * rounds (min 1 x 1; tiles become one cell), then any item that would overlap or fall outside the
 * columns goes to the first free cell, in reading order. Folders that inherit the mode are
 * converted with their content; folders with their own layout keep their content as is. The
 * root's columns follow the mode (grid: 12; free: designWidth / 8).
 */
export function setTabLayout(
  d: LayoutDashboard, tabId: string, layout: 'inherit' | LayoutMode, designWidth?: number
): LayoutDashboard {
  const tab = findTab(d, tabId);
  if (layout !== 'inherit' && layout !== 'grid' && layout !== 'free') throw new TreeOpError('That layout is not valid.');
  if (designWidth !== undefined && (!Number.isInteger(designWidth) || designWidth < 320 || designWidth > 7680)) {
    throw new TreeOpError('The design width must be a whole number of pixels from 320 to 7680.');
  }
  const next: LayoutTab = { ...tab, layout };
  if (designWidth !== undefined) next.designWidth = designWidth;
  const before = resolveMode(d, tab, []);
  const after = resolveMode(d, next, []);
  const dw = typeof next.designWidth === 'number' && next.designWidth > 0 ? next.designWidth : DEFAULT_DESIGN_WIDTH;
  const freeCols = Math.max(1, Math.round(dw / FREE_UNIT_PX));
  if (before === after) {
    if (after === 'free' && containerColumns(tab.root) !== freeCols) next.root = { ...tab.root, columns: freeCols };
    if (next.layout === tab.layout && next.designWidth === tab.designWidth && next.root === tab.root) return d;
    return { ...d, tabs: d.tabs.map((t) => (t.id === tabId ? next : t)) };
  }
  next.root = convertContainer(tab.root, after, freeSide(next), after === 'free' ? freeCols : ROOT_COLUMNS);
  return { ...d, tabs: d.tabs.map((t) => (t.id === tabId ? next : t)) };
}

// ---------------------------------------------------------------- mode conversion (the one path)

/** One dashboard column in free design units for a tab: round(designWidth / 12 / 8), at least 1. */
export function freeSide(tab: LayoutTab | undefined): number {
  const dw = typeof tab?.designWidth === 'number' && tab.designWidth > 0 ? tab.designWidth : DEFAULT_DESIGN_WIDTH;
  return Math.max(1, Math.round(dw / ROOT_COLUMNS / FREE_UNIT_PX));
}

const isInheriting = (f: FolderNode): boolean => f.layout === undefined || f.layout === 'inherit';

/**
 * THE mode-conversion path (tab layout, folder layout, and move/copy/paste across modes).
 * A node sitting in a `from`-mode container is converted to look the same in a `to`-mode container
 * of `cols` columns, computed from the node's ORIGINAL values (never from already-scaled ones):
 * one grid cell = `side` free units. Grid → free multiplies by side; free → grid divides and
 * rounds (min 1 x 1; a tile is one cell; x kept inside the columns). A folder that inherits its
 * mode is converted with its content; a folder with its own layout keeps its content. A
 * converted folder is never shorter than its content needs. Same mode → the node unchanged.
 */
export function convertNode(n: LayoutNode, from: LayoutMode, to: LayoutMode, side: number, cols: number): LayoutNode {
  if (from === to || !isRenderable(n)) return n;
  const p = n.placement;
  let q: Placement;
  if (to === 'free') {
    q = { x: p.x * side, y: p.y * side, w: p.w * side, h: p.h * side };
  } else {
    const w = n.kind === 'tile' ? 1 : Math.max(1, Math.round(p.w / side));
    const h = n.kind === 'tile' ? 1 : Math.max(1, Math.round(p.h / side));
    const qw = Math.min(w, cols);
    q = { x: Math.min(Math.max(0, Math.round(p.x / side)), cols - qw), y: Math.max(0, Math.round(p.y / side)), w: qw, h };
  }
  if (p.z !== undefined) q.z = p.z;
  if (n.kind === 'tile') return { ...n, placement: q };
  let out: FolderNode = { ...n, placement: q };
  if (isInheriting(n)) {
    out = { ...out, content: convertContainer(n.content, to, side, innerColumnsFor(n, to, side)) };
  }
  q.h = Math.max(q.h, minFolderHeight(out, q.w, to, cols));
  return out;
}

/** A folder's content columns after its content changes mode (from its ORIGINAL columns). */
function innerColumnsFor(f: FolderNode, to: LayoutMode, side: number): number {
  const c = containerColumns(f.content, f);
  return to === 'free' ? Math.max(1, c * side) : Math.max(1, Math.round(c / side));
}

/** Convert every child of a container to `to` mode; `cols` = the result's columns. Grid: no overlaps. */
function convertContainer(c: Container, to: LayoutMode, side: number, cols: number): Container {
  const from: LayoutMode = to === 'free' ? 'grid' : 'free';
  const converted = kids(c).map((n) => convertNode(n, from, to, side, cols));
  if (to === 'free') return { ...c, columns: cols, children: converted };
  return { ...c, columns: cols, children: settleGrid(converted, cols) };
}

/** Grid: keep each item where it is when it fits; otherwise the first free cell, in reading order. */
function settleGrid(children: LayoutNode[], cols: number): LayoutNode[] {
  const placed: LayoutNode[] = [];
  const work: Container = { columns: cols, children: placed };
  for (const n of readingOrder(children.filter(isRenderable))) {
    const p = n.placement;
    const fits = p.x + p.w <= cols && !placed.some((m) => overlaps(m.placement, p));
    placed.push(fits ? n : ({ ...n, placement: { ...firstFreeCell(work, p.w, p.h), ...(p.z !== undefined ? { z: p.z } : {}) } } as LayoutNode));
  }
  const byId = new Map(placed.map((n) => [n.id, n]));
  return children.map((n) => (isRenderable(n) ? byId.get(n.id)! : n));
}

/** Where a node sits: its container's mode and its tab's free side (the inputs convertNode needs). */
export interface NodeOrigin { mode: LayoutMode; side: number }

export function originOf(d: LayoutDashboard, id: string): NodeOrigin {
  const loc = locate(d, id);
  if (!loc) throw new TreeOpError('That item no longer exists.');
  const r = resolveRef(d, { tabId: loc.tabId, folderId: loc.folderChain[loc.folderChain.length - 1] });
  return { mode: r.mode, side: freeSide(r.tab) };
}

/**
 * A node as it should go into `to` (converted when the modes differ). The side comes from the
 * free end: the target tab's when going to free, the origin's when coming from free.
 */
export function adaptNode(d: LayoutDashboard, n: LayoutNode, origin: NodeOrigin, to: ContainerRef): LayoutNode {
  const r = resolveRef(d, to);
  if (origin.mode === r.mode) return n;
  const side = r.mode === 'free' ? freeSide(r.tab) : origin.side;
  return convertNode(n, origin.mode, r.mode, side, containerColumns(r.container, r.folder));
}

/**
 * Set a folder's own layout ('inherit' | grid | free). When its content's effective mode changes,
 * the content is converted (convertNode); the folder keeps its place and grows if its content now
 * needs more height (neighbours in a grid are pushed aside, never overlapped). Unchanged → same d.
 */
export function setFolderLayout(d: LayoutDashboard, id: string, layout: 'inherit' | LayoutMode): LayoutDashboard {
  if (layout !== 'inherit' && layout !== 'grid' && layout !== 'free') throw new TreeOpError('That layout is not valid.');
  const node = findNode(d, id);
  if (node.kind !== 'folder') throw new TreeOpError('Only folders have a layout here.');
  if ((node.layout ?? 'inherit') === layout) return d;
  const loc = locate(d, id)!;
  const ref: ContainerRef = { tabId: loc.tabId, folderId: loc.folderChain[loc.folderChain.length - 1] };
  const parent = resolveRef(d, ref);
  const before = resolveMode(d, parent.tab, [...parent.chain, node]);
  let next: FolderNode = { ...node, layout };
  const after = resolveMode(d, parent.tab, [...parent.chain, next]);
  if (before !== after) {
    const side = freeSide(parent.tab);
    next = { ...next, content: convertContainer(node.content, after, side, innerColumnsFor(node, after, side)) };
    const cols = containerColumns(parent.container, parent.folder);
    const h = Math.max(node.placement.h, minFolderHeight(next, node.placement.w, parent.mode, cols));
    if (h !== node.placement.h) next = { ...next, placement: { ...node.placement, h } };
  }
  const push = parent.mode === 'grid' && next.placement !== node.placement
    ? pushAside(parent.container, new Set([id]), next.placement)
    : undefined;
  const changed = new Set<string>([id, ...(push ? push.keys() : [])]);
  return editContainer(d, ref, (c) => {
    const out = { ...c, children: applyPush(kids(c), push).map((n) => (n.id === id ? next : n)) };
    if (parent.mode === 'grid') assertGridNoOverlap(out, changed);
    return out;
  });
}

export function deleteTab(d: LayoutDashboard, tabId: string): LayoutDashboard {
  findTab(d, tabId);
  if (d.tabs.length <= 1) throw new TreeOpError('A dashboard needs at least one tab.');
  return { ...d, tabs: d.tabs.filter((t) => t.id !== tabId) };
}

// ---------------------------------------------------------------- free cells / reflow

function renderablePlacements(c: Container): Placement[] {
  return kids(c).filter(isRenderable).map((n) => n.placement);
}

/**
 * First position of size w x h that overlaps nothing in `c`. Grid (default): row-major, one cell at
 * a time. Free: row-major in tile-sized steps (x in multiples of w, y in multiples of h), so a copy
 * lands beside/below the others on a tile-aligned lattice. `mode` is an optional addition to the
 * brief's signature; width is capped at the column count.
 */
export function firstFreeCell(c: Container, w: number, h: number, mode: LayoutMode = 'grid'): Placement {
  const cols = containerColumns(c);
  const cw = Math.min(Math.max(1, Math.floor(w) || 1), cols);
  const chh = Math.max(1, Math.floor(h) || 1);
  const taken = renderablePlacements(c);
  const bottom = taken.reduce((m, t) => Math.max(m, t.y + t.h), 0);
  const stepX = mode === 'free' ? cw : 1;
  const stepY = mode === 'free' ? chh : 1;
  for (let y = 0; y <= bottom; y += stepY) {
    for (let x = 0; x + cw <= cols; x += stepX) {
      const cand = { x, y, w: cw, h: chh };
      if (!taken.some((t) => overlaps(cand, t))) return cand;
    }
  }
  return { x: 0, y: Math.ceil(bottom / stepY) * stepY, w: cw, h: chh };
}

/**
 * Grid reflow for a drop. `moving` are the ids being dragged (they vacate their cells, so they are
 * ignored); `target` is where they will land. Returns only the nodes that must move (empty when the
 * target is free). Algorithm: take the other nodes that overlap the target, in reading order; each
 * keeps its size and moves to the nearest free position at or below its own row (same row first,
 * nearest column, right before left on a tie, then the next row down, ...), where free means clear of
 * the target, of every node that stays put, and of nodes already re-homed. Displaced nodes only
 * take free cells, so nothing cascades and the result never overlaps. Grid containers only.
 */
export function pushAside(c: Container, moving: Set<string>, target: Placement): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const cols = containerColumns(c);
  const tgt = clampPlacement(target, cols);
  const others = readingOrder(kids(c).filter((n) => isRenderable(n) && !moving.has(n.id)));
  const displaced = others.filter((n) => overlaps(clampPlacement(n.placement, cols), tgt));
  if (displaced.length === 0) return out;
  const displacedIds = new Set(displaced.map((n) => n.id));
  const occupied: Placement[] = [tgt];
  for (const n of others) if (!displacedIds.has(n.id)) occupied.push(clampPlacement(n.placement, cols));
  for (const n of displaced) {
    const orig = clampPlacement(n.placement, cols);
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
