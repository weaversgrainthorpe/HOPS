import type {
  FolderNode, LayoutDashboard, LayoutMode, LayoutNode, LayoutTab, Placement
} from '../types/layout';

export const ROOT_COLUMNS = 12;
export const FREE_UNIT_PX = 8;
export const DEFAULT_DESIGN_WIDTH = 1280;
export const MIN_FREE_SCALE = 0.6;
export const PHONE_BREAKPOINT_PX = 768;
export const PREVIEW_COUNT = 4;

const TITLE_BAR_PX = 40;
const FOLDER_PADDING_PX = 16;

function concrete(m: unknown): m is LayoutMode {
  return m === 'grid' || m === 'free';
}

/** folder -> tab -> dashboard -> 'grid'. 'inherit'/missing defer to the parent. folderChain is outermost-first. */
export function resolveMode(dash: LayoutDashboard, tab: LayoutTab, folderChain: FolderNode[]): LayoutMode {
  for (let i = folderChain.length - 1; i >= 0; i--) {
    const m = folderChain[i].layout;
    if (concrete(m)) return m;
  }
  if (concrete(tab.layout)) return tab.layout;
  if (concrete(dash.defaultLayout)) return dash.defaultLayout;
  return 'grid';
}

/** Stable sort by placement.y, then placement.x, then original index. Does not mutate. */
export function readingOrder<T extends { placement?: Placement }>(children: T[]): T[] {
  return children
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ay = a.c.placement?.y ?? 0, by = b.c.placement?.y ?? 0;
      if (ay !== by) return ay - by;
      const ax = a.c.placement?.x ?? 0, bx = b.c.placement?.x ?? 0;
      if (ax !== bx) return ax - bx;
      return a.i - b.i;
    })
    .map((e) => e.c);
}

export function clampPlacement(p: Placement, columns: number): Placement {
  const cols = Math.max(1, columns);
  const x = Math.min(Math.max(p.x, 0), cols - 1);
  const w = Math.min(Math.max(p.w, 1), cols - x);
  const out: Placement = { x, y: Math.max(p.y, 0), w, h: Math.max(p.h, 1) };
  if (p.z !== undefined) out.z = p.z;
  return out;
}

export function previewChildren(folder: FolderNode): LayoutNode[] {
  return readingOrder(folder.content.children).slice(0, PREVIEW_COUNT);
}

export type CanvasPlan =
  | { kind: 'grid'; cellPx: number }
  | { kind: 'free'; scale: number }
  | { kind: 'stacked' };

export function planCanvas(mode: LayoutMode, widthPx: number, tab: LayoutTab): CanvasPlan {
  if (mode === 'grid') {
    if (widthPx < PHONE_BREAKPOINT_PX) return { kind: 'stacked' };
    return { kind: 'grid', cellPx: widthPx / (tab.root.columns || ROOT_COLUMNS) };
  }
  const scale = widthPx / (tab.designWidth ?? DEFAULT_DESIGN_WIDTH);
  // epsilon guards float error exactly at the 0.6 boundary
  if (scale < MIN_FREE_SCALE - 1e-9) return { kind: 'stacked' };
  return { kind: 'free', scale: Math.max(scale, MIN_FREE_SCALE) };
}

/** Height of one content row inside an expanded folder of folderHeightCells rows. */
export function folderContentRowPx(folderHeightCells: number, cellPx: number, showTitle: boolean): number {
  const total = folderHeightCells * cellPx;
  const chrome = (showTitle ? TITLE_BAR_PX : 0) + FOLDER_PADDING_PX;
  const rows = Math.max(1, folderHeightCells - 1);
  return (total - chrome) / rows;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validPlacement(p: unknown): p is Placement {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return isNum(o.x) && isNum(o.y) && isNum(o.w) && isNum(o.h);
}

/** True only for nodes the renderer can draw; false => show a visible placeholder. */
export function isRenderable(n: unknown): n is LayoutNode {
  if (!n || typeof n !== 'object') return false;
  const o = n as Record<string, unknown>;
  if (o.kind !== 'tile' && o.kind !== 'folder') return false;
  if (!validPlacement(o.placement)) return false;
  if (o.kind === 'folder') {
    const c = o.content as Record<string, unknown> | undefined;
    if (!c || typeof c !== 'object' || !Array.isArray(c.children)) return false;
  }
  return true;
}
