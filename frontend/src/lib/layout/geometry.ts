import type {
  Container, FolderNode, LayoutDashboard, LayoutMode, LayoutNode, LayoutTab, Placement
} from '../types/layout';

export const ROOT_COLUMNS = 12;
export const FREE_UNIT_PX = 8;
export const DEFAULT_DESIGN_WIDTH = 1280;
export const MIN_FREE_SCALE = 0.6;
export const PHONE_BREAKPOINT_PX = 768;
export const PREVIEW_COUNT = 4;

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

/** True when c is an object whose placement has finite numeric x and y (it has a position). */
export function hasPosition(c: unknown): boolean {
  return hasPos(c);
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
  const cols = resolveColumns(columns, ROOT_COLUMNS);
  const x = Math.min(Math.max(fin(p.x, 0), 0), cols - 1);
  const w = Math.min(Math.max(fin(p.w, 1), 1), cols - x);
  const out: Placement = { x, y: Math.max(fin(p.y, 0), 0), w, h: Math.max(fin(p.h, 1), 1) };
  if (typeof p.z === 'number' && Number.isFinite(p.z)) out.z = Math.min(1000, Math.max(-1000, Math.trunc(p.z)));
  return out;
}

/** First PREVIEW_COUNT renderable children in reading order; non-renderable ones are skipped. */
export function previewChildren(folder: FolderNode): LayoutNode[] {
  const kids = Array.isArray(folder.content?.children) ? folder.content.children : [];
  return readingOrder(kids.filter(isRenderable)).slice(0, PREVIEW_COUNT);
}

/**
 * THE columns rule, used everywhere a column count is read: floor a finite value;
 * if that is not >= 1, use `fallback` (itself floored; 1 if it is no good either).
 */
export function resolveColumns(raw: unknown, fallback: number): number {
  const c = isNum(raw) ? Math.floor(raw) : NaN;
  if (c >= 1) return c;
  const f = isNum(fallback) ? Math.floor(fallback) : NaN;
  return f >= 1 ? f : 1;
}

/**
 * A container's column count. A root falls back to ROOT_COLUMNS; a folder's
 * content falls back to the folder's placement.w (and that to 1).
 */
export function containerColumns(container: Container | undefined, folder?: FolderNode): number {
  const fallback = folder ? resolveColumns(folder.placement?.w, 1) : ROOT_COLUMNS;
  return resolveColumns(container?.columns, fallback);
}

/** A folder's inner column count: its content.columns (design extent when free), else its placement width. */
export function folderInnerColumns(folder: FolderNode): number {
  return containerColumns(folder.content, folder);
}

/** A tile box narrower or shorter than this renders compact (icon + name). Ruling 22. */
export const COMPACT_TILE_PX = 110;
export type TileFit = 'fill' | 'compact';

/** How a tile in the layout renderer fits its box of wPx × hPx: always fills it; compact when small. */
export function tileFit(wPx: number, hPx: number): TileFit {
  const m = Math.min(wPx, hPx);
  return isNum(m) && m < COMPACT_TILE_PX ? 'compact' : 'fill';
}

export type CanvasPlan =
  | { kind: 'grid'; cellPx: number }
  | { kind: 'free'; scale: number }
  | { kind: 'stacked' };

export function planCanvas(mode: LayoutMode, widthPx: number, tab: LayoutTab): CanvasPlan {
  if (!isNum(widthPx) || widthPx <= 0) return { kind: 'stacked' };
  if (mode === 'grid') {
    if (widthPx < PHONE_BREAKPOINT_PX) return { kind: 'stacked' };
    return { kind: 'grid', cellPx: widthPx / containerColumns(tab.root) };
  }
  const dw = tab.designWidth;
  const scale = widthPx / (isNum(dw) && dw > 0 ? dw : DEFAULT_DESIGN_WIDTH);
  // epsilon guards float error exactly at the 0.6 boundary
  if (scale < MIN_FREE_SCALE - 1e-9) return { kind: 'stacked' };
  return { kind: 'free', scale: Math.max(scale, MIN_FREE_SCALE) };
}

/**
 * Overlay content unit (Ruling 23): min(the dashboard's own unit for this mode, bodyPx / columns),
 * so tiles in a folder overlay keep their size on the canvas and only shrink when the
 * viewport is too narrow. Grid: one cell; free: one 8 px design unit × scale.
 */
export function overlayUnitPx(plan: CanvasPlan, tab: LayoutTab, mode: LayoutMode, columns: number, bodyPx: number): number {
  const cols = resolveColumns(columns, 1);
  const fit = Math.max(1, isNum(bodyPx) ? bodyPx : 1) / cols;
  const canvas = canvasUnitPx(plan, tab, mode);
  return canvas > 0 ? Math.min(canvas, fit) : fit;
}

function canvasUnitPx(plan: CanvasPlan, tab: LayoutTab, mode: LayoutMode): number {
  if (plan.kind === 'stacked') return 0; // phone stacking ignores sizes
  const dw = tab.designWidth;
  const canvasW =
    plan.kind === 'grid'
      ? plan.cellPx * containerColumns(tab.root)
      : plan.scale * (isNum(dw) && dw > 0 ? dw : DEFAULT_DESIGN_WIDTH);
  if (mode === 'grid') return plan.kind === 'grid' ? plan.cellPx : canvasW / ROOT_COLUMNS;
  return FREE_UNIT_PX * (plan.kind === 'free' ? plan.scale : canvasW / DEFAULT_DESIGN_WIDTH);
}

// ---------------------------------------------------------------------------
// One geometry source. The renderer (and the M3 editor's hit-testing and
// resize handles) take every size from the functions below; nothing else
// derives a column width, row height, folder chrome or box.
// ---------------------------------------------------------------------------

export interface NodeBox { leftPx: number; topPx: number; widthPx: number; heightPx: number }

export interface ContainerMetrics {
  mode: 'grid' | 'free';
  columns: number;
  /** Width in px of one column. */
  unitPx: number;
  /** Height in px of one row (free: always unitPx). */
  rowPx: number;
  /** Width in px of the container's content box (= columns * unitPx). */
  innerWidthPx: number;
}

const nonNeg = (v: unknown): number => (isNum(v) && v > 0 ? v : 0);

/**
 * The ONLY function that turns a container + its box into child geometry.
 * Grid rows are square unless `opts.rowPx` is given; free rows are the unit.
 * Pass `opts.folder` for a folder's content so a bad `columns` falls back to its placement.w.
 */
export function containerMetrics(
  container: Container,
  mode: LayoutMode,
  boxWidthPx: number,
  opts: { rowPx?: number; folder?: FolderNode } = {}
): ContainerMetrics {
  const columns = containerColumns(container, opts.folder);
  const innerWidthPx = nonNeg(boxWidthPx);
  const unitPx = innerWidthPx / columns;
  const m: LayoutMode = mode === 'free' ? 'free' : 'grid';
  const rowPx = m === 'grid' && opts.rowPx !== undefined ? nonNeg(opts.rowPx) : unitPx;
  return { mode: m, columns, unitPx, rowPx, innerWidthPx };
}

/** A node's box inside a container, after clampPlacement (so fractional x/y/w/h are floored). */
export function nodeBox(p: Placement, m: ContainerMetrics): NodeBox {
  const c = clampPlacement(p, m.columns);
  return { leftPx: c.x * m.unitPx, topPx: c.y * m.rowPx, widthPx: c.w * m.unitPx, heightPx: c.h * m.rowPx };
}

/**
 * The cell under a point, given in px from the container's content-box origin (grid: a column and
 * row; free: an 8 px design unit). Clamped to the columns and to x, y >= 0.
 */
export function pointToCell(m: ContainerMetrics, dxPx: number, dyPx: number): { x: number; y: number } {
  if (!(m.unitPx > 0) || !(m.rowPx > 0)) return { x: 0, y: 0 };
  const x = Math.floor((isNum(dxPx) ? dxPx : 0) / m.unitPx);
  const y = Math.floor((isNum(dyPx) ? dyPx : 0) / m.rowPx);
  return { x: Math.min(Math.max(x, 0), Math.max(0, m.columns - 1)), y: Math.max(y, 0) };
}

/** Space a folder's own chrome takes, per look. Mirrors FolderView's CSS (global border-box). */
export interface FolderChrome { titlePx: number; padXPx: number; padYPx: number }

/** Title bar height (FolderView .folder-header, border-box). */
const TITLE_BAR_PX = 40;
/** Body padding 0.5rem each side + 1px border each side. */
const BODY_PAD_PX = 2 * 8 + 2 * 1;

/**
 * The one chrome table.
 * - rounded (default): 1px border round the folder, 40px title, body padding 8px.
 * - folder-tab: no outer border; the 40px tab sits over the bordered body and
 *   overlaps its top border by 1px; body padding 8px + 1px border.
 */
export function folderChrome(shape: string | undefined, showTitle: boolean): FolderChrome {
  if (shape === 'folder-tab') {
    return { titlePx: showTitle ? TITLE_BAR_PX - 1 : 0, padXPx: BODY_PAD_PX, padYPx: BODY_PAD_PX };
  }
  return { titlePx: showTitle ? TITLE_BAR_PX : 0, padXPx: BODY_PAD_PX, padYPx: BODY_PAD_PX };
}

/** The content box inside a folder's box (a collapsed folder has none). */
export function folderContentBox(folder: FolderNode, box: NodeBox, chrome: FolderChrome): { widthPx: number; heightPx: number } {
  if (folder.display === 'collapsed') return { widthPx: 0, heightPx: 0 };
  return {
    widthPx: nonNeg(box.widthPx - chrome.padXPx),
    heightPx: nonNeg(box.heightPx - chrome.titlePx - chrome.padYPx)
  };
}

function chromeOf(folder: FolderNode): FolderChrome {
  return folderChrome(folder.shape, folder.showTitle !== false);
}

/** A folder's own mode: concrete folder.layout, else its parent container's (as resolveMode). */
function innerMode(folder: FolderNode, parent: ContainerMetrics): LayoutMode {
  return concrete(folder.layout) ? folder.layout : parent.mode;
}

/** Rows a grid folder's content spans: max(h - 1, deepest child bottom), at least 1. */
export function gridContentRows(folder: FolderNode, columns: number, minRows: number): number {
  let rows = Math.max(1, minRows);
  const kids = Array.isArray(folder.content?.children) ? folder.content.children : [];
  for (const c of kids) {
    if (!isRenderable(c)) continue;
    const p = clampPlacement(c.placement, columns);
    rows = Math.max(rows, p.y + p.h);
  }
  return rows;
}

/**
 * Metrics of an expanded folder's content, inside a parent container.
 * Width: the folder box minus its chrome (so free children never exceed it).
 * Rows: a grid folder in a grid parent fits its rows to its height (content
 * rows = max(h-1, deepest child), shrunk to fit, never clipped); a grid folder
 * in a free parent uses square cells and grows; free rows are the unit.
 */
export function folderInnerMetrics(folder: FolderNode, parent: ContainerMetrics): ContainerMetrics {
  const box = nodeBox(folder.placement, parent);
  const content = folderContentBox({ ...folder, display: 'expanded' }, box, chromeOf(folder));
  const mode = innerMode(folder, parent);
  const columns = folderInnerColumns(folder);
  let rowPx: number | undefined;
  if (mode === 'grid' && parent.mode === 'grid') {
    const h = clampPlacement(folder.placement, parent.columns).h;
    rowPx = content.heightPx / gridContentRows(folder, columns, h - 1);
  }
  return containerMetrics(folder.content, mode, content.widthPx, { rowPx, folder });
}

/** Height free children need: the lowest bottom edge (folders at their required height). */
export function freeContentHeightPx(children: unknown, m: ContainerMetrics): number {
  let bottom = 0;
  for (const c of Array.isArray(children) ? children : []) {
    if (!isRenderable(c)) continue;
    const b = nodeBox(c.placement, m);
    bottom = Math.max(bottom, b.topPx + (c.kind === 'folder' ? requiredFolderHeightPx(c, m) : b.heightPx));
  }
  return bottom;
}

/**
 * Height a folder renders at inside container m: its box, or more when its
 * content needs it (folders grow past their box, never clip). FolderView in a
 * free container renders exactly this as its min-height.
 */
export function requiredFolderHeightPx(folder: FolderNode, m: ContainerMetrics): number {
  const box = nodeBox(folder.placement, m);
  if (folder.display === 'collapsed' || !isRenderable(folder)) return box.heightPx;
  const inner = folderInnerMetrics(folder, m);
  const ch = chromeOf(folder);
  let content: number;
  if (inner.mode === 'free') {
    content = freeContentHeightPx(folder.content.children, inner);
  } else if (m.mode === 'grid') {
    return box.heightPx; // rows were fitted to the box
  } else {
    content = gridContentRows(folder, inner.columns, 0) * inner.rowPx;
  }
  return Math.max(box.heightPx, ch.titlePx + ch.padYPx + content);
}

/** Overlay backdrop padding (2 x 1rem) and panel chrome (body padding 2 x 16 + border 2 x 1). */
export const OVERLAY_GUTTER_PX = 32;
export const OVERLAY_PANEL_CHROME_PX = 34;

/** Width of a page scrollbar: innerWidth - clientWidth (0 when clientWidth is unmeasurable). */
export function scrollbarPx(innerWidth: number, clientWidth: number): number {
  if (!isNum(innerWidth) || !isNum(clientWidth) || clientWidth <= 0) return 0;
  return Math.max(0, innerWidth - clientWidth);
}

/** Viewport width usable by fixed overlays/maximised panels: innerWidth minus the measured scrollbar. */
export function viewportContentPx(innerWidth: number, clientWidth: number): number {
  return nonNeg(innerWidth) - scrollbarPx(innerWidth, clientWidth);
}

/** Widest content box a folder overlay body may have in this viewport. */
export function overlayBodyPx(innerWidth: number, clientWidth: number): number {
  return Math.max(1, viewportContentPx(innerWidth, clientWidth) - OVERLAY_GUTTER_PX - OVERLAY_PANEL_CHROME_PX);
}

/**
 * Sizing of a folder shown in a panel above the canvas (folder overlay; Task 2's
 * maximised panel). Cells keep the dashboard's size, capped so the content fits
 * bodyPx (Ruling 23). panelWidthPx = content + the panel's own chrome.
 */
export function overlayMetrics(
  plan: CanvasPlan,
  tab: LayoutTab,
  mode: LayoutMode,
  folder: FolderNode,
  bodyPx: number
): { metrics: ContainerMetrics; panelWidthPx: number } {
  const columns = folderInnerColumns(folder);
  const unit = overlayUnitPx(plan, tab, mode, columns, bodyPx);
  const metrics = containerMetrics(folder.content, mode, columns * unit, { folder });
  return { metrics, panelWidthPx: metrics.innerWidthPx + OVERLAY_PANEL_CHROME_PX };
}

/** Box width of a tab's root container for a plan (0 when stacked). */
export function rootBoxWidthPx(plan: CanvasPlan, tab: LayoutTab): number {
  const cols = containerColumns(tab.root);
  if (plan.kind === 'grid') return plan.cellPx * cols;
  if (plan.kind === 'free') return plan.scale * FREE_UNIT_PX * cols;
  return 0;
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

/**
 * Placement of a folder minimised to its tile (per-browser view): a grid folder keeps its
 * top-left cell (1 x 1); a free folder becomes a square one dashboard column wide
 * (round(designWidth / 12 / 8) design units, at least 1) at the same x,y.
 */
export function minimisedPlacement(p: Placement, mode: LayoutMode, tab: LayoutTab): Placement {
  const dw = tab.designWidth;
  const side =
    mode === 'free'
      ? Math.max(1, Math.round((isNum(dw) && dw > 0 ? dw : DEFAULT_DESIGN_WIDTH) / ROOT_COLUMNS / FREE_UNIT_PX))
      : 1;
  const out: Placement = { x: p.x, y: p.y, w: side, h: side };
  if (p.z !== undefined) out.z = p.z;
  return out;
}
