// The limits a save enforces on one dashboard, checked while editing so a change that could never
// be saved is refused when it is made, not hours later at Save. Twins of configdoc's
// MaxDashboardNodes, MaxNestingDepth and MaxTabs (backend/internal/configdoc/verify.go).
import type { LayoutDashboard, LayoutNode } from '$lib/types/layout';
import { locate } from './treeOps';

export const MAX_DASHBOARD_NODES = 5000;
export const MAX_NESTING_DEPTH = 12;
export const MAX_TABS = 200;

/** Tabs, items (tiles and folders) and the deepest item's level (a tab's own items are level 1). */
export interface Bounds {
  tabs: number;
  nodes: number;
  depth: number;
}

const children = (n: LayoutNode): LayoutNode[] =>
  n.kind === 'folder' && Array.isArray(n.content?.children) ? n.content.children : [];

const measured = new WeakMap<LayoutDashboard, Bounds>();

export function measureBounds(d: LayoutDashboard): Bounds {
  const hit = measured.get(d);
  if (hit) return hit;
  let nodes = 0;
  let depth = 0;
  const walk = (kids: LayoutNode[], level: number) => {
    for (const n of kids) {
      nodes++;
      if (level > depth) depth = level;
      walk(children(n), level + 1);
    }
  };
  for (const t of d.tabs ?? []) walk(Array.isArray(t.root?.children) ? t.root.children : [], 1);
  const b = { tabs: d.tabs?.length ?? 0, nodes, depth };
  measured.set(d, b);
  return b;
}

/**
 * Why `after` could not be saved where `before` could, or null. A limit `before` already broke
 * (e.g. data from elsewhere) only refuses changes that make it worse, so it can be edited back down.
 */
export function boundsProblem(before: LayoutDashboard | null, after: LayoutDashboard): string | null {
  const a = measureBounds(after);
  const b = before ? measureBounds(before) : { tabs: 0, nodes: 0, depth: 0 };
  if (a.depth > MAX_NESTING_DEPTH && a.depth > b.depth) return tooDeepMessage(a.depth);
  if (a.nodes > MAX_DASHBOARD_NODES && a.nodes > b.nodes) {
    return `That would make ${a.nodes.toLocaleString()} items on this dashboard; a dashboard holds at most ${MAX_DASHBOARD_NODES.toLocaleString()}.`;
  }
  if (a.tabs > MAX_TABS && a.tabs > b.tabs) return `That would make ${a.tabs} tabs; a dashboard holds at most ${MAX_TABS}.`;
  return null;
}

export function tooDeepMessage(depth: number): string {
  return `Too deep: that would put items ${depth} levels down, and a dashboard allows ${MAX_NESTING_DEPTH}.`;
}

/** How many levels an item takes up: 1 for a tile or an empty folder, more for a folder's contents. */
export function itemHeight(n: LayoutNode): number {
  let h = 0;
  for (const c of children(n)) h = Math.max(h, itemHeight(c));
  return 1 + h;
}

/** The level a container's items are at: 1 on a tab, one below the folder inside a folder. */
export function childLevel(d: LayoutDashboard, folderId?: string): number {
  if (folderId === undefined) return 1;
  const loc = locate(d, folderId);
  return loc ? loc.folderChain.length + 2 : 1;
}

/** Why putting `nodes` at `level` would nest too deep, or null. */
export function landingProblem(nodes: LayoutNode[], level: number): string | null {
  let deepest = 0;
  for (const n of nodes) deepest = Math.max(deepest, level + itemHeight(n) - 1);
  return deepest > MAX_NESTING_DEPTH ? tooDeepMessage(deepest) : null;
}
