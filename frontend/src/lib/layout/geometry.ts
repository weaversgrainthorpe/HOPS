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

function hasPos(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const p = (c as { placement?: unknown }).placement as Record<string, unknown> | undefined;
  return !!p && typeof p === 'object' && isNum(p.x) && isNum(p.y);
}

/**
 * Stable sort by placement.y, then placement.x, then original index. Does not mutate.
 * Never throws: anything that is not an object with finite numeric placement x/y
 * sorts AFTER the valid children, in original array order.
 */
export function readingOrder<T extends { placement?: Placement }>(children: T[]): T[] {
  const valid: { c: T; i: number }[] = [];
  const bad: T[] = [];
  children.forEach((c, i) => (hasPos(c) ? valid.push({ c, i }) : bad.push(c)));
  valid.sort((a, b) => {
    const ap = a.c.placement as Placement, bp = b.c.placement as Placement;
    return ap.y - bp.y || ap.x - bp.x || a.i - b.i;
  });
  return [...valid.map((e) => e.c), ...bad];
}

function fin(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : dflt;
}

export function clampPlacement(p: Placement, columns: number): Placement {
  const cols = Math.max(1, fin(columns, ROOT_COLUMNS));
  const x = Math.min(Math.max(fin(p.x, 0), 0), cols - 1);
  const w = Math.min(Math.max(fin(p.w, 1), 1), cols - x);
  const out: Placement = { x, y: Math.max(fin(p.y, 0), 0), w, h: Math.max(fin(p.h, 1), 1) };
  if (p.z !== undefined) out.z = p.z;
  return out;
}

/** First PREVIEW_COUNT renderable children in reading order; non-renderable ones are skipped. */
export function previewChildren(folder: FolderNode): LayoutNode[] {
  const kids = Array.isArray(folder.content?.children) ? folder.content.children : [];
  return readingOrder(kids.filter(isRenderable)).slice(0, PREVIEW_COUNT);
}

/** A folder's inner column count: its content.columns (design extent when free), else its placement width. */
export function folderInnerColumns(folder: FolderNode): number {
  const cc = folder.content?.columns;
  if (isNum(cc) && cc >= 1) return Math.floor(cc);
  const w = folder.placement?.w;
  return isNum(w) && w >= 1 ? Math.floor(w) : 1;
}

export const FOLDER_CHROME_PX = 18; // body padding (16) + border (2)
export const FOLDER_TITLE_PX = TITLE_BAR_PX;

export type CanvasPlan =
  | { kind: 'grid'; cellPx: number }
  | { kind: 'free'; scale: number }
  | { kind: 'stacked' };

export function planCanvas(mode: LayoutMode, widthPx: number, tab: LayoutTab): CanvasPlan {
  if (!isNum(widthPx) || widthPx <= 0) return { kind: 'stacked' };
  if (mode === 'grid') {
    if (widthPx < PHONE_BREAKPOINT_PX) return { kind: 'stacked' };
    const c = tab.root?.columns;
    return { kind: 'grid', cellPx: widthPx / (isNum(c) && c > 0 ? c : ROOT_COLUMNS) };
  }
  const dw = tab.designWidth;
  const scale = widthPx / (isNum(dw) && dw > 0 ? dw : DEFAULT_DESIGN_WIDTH);
  // epsilon guards float error exactly at the 0.6 boundary
  if (scale < MIN_FREE_SCALE - 1e-9) return { kind: 'stacked' };
  return { kind: 'free', scale: Math.max(scale, MIN_FREE_SCALE) };
}

/** Height of one content row inside an expanded folder of folderHeightCells rows. */
export function folderContentRowPx(folderHeightCells: number, cellPx: number, showTitle: boolean): number {
  const h = isNum(folderHeightCells) && folderHeightCells >= 1 ? folderHeightCells : 1;
  const total = h * cellPx;
  const chrome = (showTitle ? TITLE_BAR_PX : 0) + FOLDER_PADDING_PX;
  const rows = Math.max(1, h - 1);
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

/**
 * SHALLOW check: validates this node only (and that a folder's content.children is an array).
 * Contract: the renderer calls it on every child at every container level.
 * True only for nodes the renderer can draw; false => show a visible placeholder. */
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
