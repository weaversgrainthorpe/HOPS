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
  FREE_UNIT_PX, ROOT_COLUMNS, clampPlacement, containerColumns, containerMetrics, folderInnerMetrics,
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
  const placed = nodes.map((n, i) => ({ ...n, placement: checkedPlacement(at[i], target) }) as LayoutNode);
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
    const c = cloneWithNewIds(n, used);
    c.placement = checkedPlacement(at[i], target);
    return c;
  });
  return {
    dashboard: commitToContainer(d, to, target, copies, push),
    newIds: copies.map((c) => c.id)
  };
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

export function resizeNode(
  d: LayoutDashboard, id: string, w: number, h: number, push?: Map<string, Placement>
): LayoutDashboard {
  const node = findNode(d, id);
  if (!Number.isFinite(w) || !Number.isFinite(h)) throw new TreeOpError('That size is not valid.');
  const loc = locate(d, id)!;
  const r = resolveRef(d, { tabId: loc.tabId, folderId: loc.folderChain[loc.folderChain.length - 1] });
  const cols = containerColumns(r.container, r.folder);
  const sized = clampPlacement({ ...node.placement, w, h }, cols);
  if (node.kind === 'folder') {
    sized.h = Math.max(sized.h, minFolderHeight(node, sized.w, r.mode, cols));
  }
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

export function setZ(d: LayoutDashboard, id: string, dir: 'forward' | 'back'): LayoutDashboard {
  const node = findNode(d, id);
  const loc = locate(d, id)!;
  const r = resolveRef(d, { tabId: loc.tabId, folderId: loc.folderChain[loc.folderChain.length - 1] });
  const others = kids(r.container).filter((n) => n.id !== id).map((n) => n.placement?.z ?? 0);
  const cur = node.placement.z ?? 0;
  let z = cur;
  if (dir === 'forward' && others.length && Math.max(...others) >= cur) z = Math.min(1000, Math.max(...others) + 1);
  if (dir === 'back' && others.length && Math.min(...others) <= cur) z = Math.max(-1000, Math.min(...others) - 1);
  if (z === cur) return d;
  return mapTabs(d, (n) => (n.id === id ? ({ ...n, placement: { ...n.placement, z } } as LayoutNode) : n));
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
