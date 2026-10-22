import type { Container, FolderNode, ItemSize, LayoutNode, LayoutTab, PlacedNode, Placement } from '../types/layout';

/**
 * A tab's grid: 24 columns (spec §9). Every tab is a grid tab (M5: free layout is removed).
 * Tiles on a tab are exactly Small (1 x 1 cell), Medium (2 x 2) or Large (4 x 4) — sizeSpan.
 */
export const ROOT_COLUMNS = 24;
/**
 * The stored layout format this build reads and writes (M5 §2a). Every placement-carrying write
 * sends it; the server refuses a mismatch (409). Bumped whenever the stored layout format changes.
 */
export const LAYOUT_VERSION = 1;
/** Cells a Medium item spans each way. */
export const MEDIUM_CELLS = 2;
/** Grid rows a folder's title takes on a tab (the backend's FolderTitleRows). */
export const GRID_TITLE_ROWS = 2;
export const PHONE_BREAKPOINT_PX = 768;
export const PREVIEW_COUNT = 4;

/** Cells each way per size: Small 1, Medium 2, Large 4. */
const SPAN: Record<ItemSize, number> = { small: 1, medium: MEDIUM_CELLS, large: 2 * MEDIUM_CELLS };

/**
 * A size as the client draws it: anything but small / large is drawn as Medium. Never a
 * conversion of stored data: the server refuses an unknown size (400), and only the v2→v3
 * migration maps one to Medium, with a visible notice.
 */
export function sizeOf(size: unknown): ItemSize {
  return size === 'small' || size === 'large' ? size : 'medium';
}

/** THE span table: the cells an item of `size` spans each way (S 1, M 2, L 4; unknown drawn as Medium). */
export function sizeSpan(size: unknown): number {
  return SPAN[sizeOf(size)];
}

/**
 * How many items one page of an open folder holds: its content box (px) filled row by row with
 * items of `contentSize`, each sizeSpan(contentSize) tab cells (`cellPx`) square. At least one per
 * row and one row, so a box too small for one item (or an unmeasurable one) still shows one.
 */
export function folderPage(
  box: { widthPx: number; heightPx: number }, contentSize: unknown, cellPx: number
): { perRow: number; rowsPerPage: number; perPage: number } {
  const item = sizeSpan(contentSize) * cellPx;
  const fit = (px: number) => (isNum(item) && item > 0 && isNum(px) && px > 0 ? Math.max(1, Math.floor(px / item + 1e-9)) : 1);
  const perRow = fit(box.widthPx);
  const rowsPerPage = fit(box.heightPx);
  return { perRow, rowsPerPage, perPage: perRow * rowsPerPage };
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
 * sorts AFTER the valid children, in original array order. (Tab level only: folder contents
 * are already in order.)
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
  const x = Math.min(Math.max(fin(p?.x, 0), 0), cols - 1);
  const w = Math.min(Math.max(fin(p?.w, 1), 1), cols - x);
  const out: Placement = { x, y: Math.max(fin(p?.y, 0), 0), w, h: Math.max(fin(p?.h, 1), 1) };
  if (typeof p?.z === 'number' && Number.isFinite(p.z)) out.z = Math.min(1000, Math.max(-1000, Math.trunc(p.z)));
  return out;
}

/** First PREVIEW_COUNT renderable children, in their order; non-renderable ones are skipped. */
export function previewChildren(folder: FolderNode): LayoutNode[] {
  const kids = Array.isArray(folder.content?.children) ? folder.content.children : [];
  return kids.filter(isRenderable).slice(0, PREVIEW_COUNT);
}

/**
 * THE columns rule: floor a finite value; if that is not >= 1, use `fallback` (itself floored;
 * 1 if it is no good either).
 */
export function resolveColumns(raw: unknown, fallback: number): number {
  const c = isNum(raw) ? Math.floor(raw) : NaN;
  if (c >= 1) return c;
  const f = isNum(fallback) ? Math.floor(fallback) : NaN;
  return f >= 1 ? f : 1;
}

/** A tab root's column count (24; a bad value falls back to ROOT_COLUMNS). */
export function containerColumns(container: Container | undefined): number {
  return resolveColumns(container?.columns, ROOT_COLUMNS);
}

/**
 * A tile box narrower or shorter than this is marked compact. Ruling 22. A Medium 2 x 2 tile at the
 * usual cell is above it; only a note tile drops its body when compact.
 */
export const COMPACT_TILE_PX = 110;
export type TileFit = 'fill' | 'compact';

/** How a tile in the layout renderer fits its box of wPx × hPx: always fills it; compact when small. */
export function tileFit(wPx: number, hPx: number): TileFit {
  const m = Math.min(wPx, hPx);
  return isNum(m) && m < COMPACT_TILE_PX ? 'compact' : 'fill';
}

/**
 * How an item `span` cells square fits at `cellPx` per cell: a Small item (1 cell) is always compact,
 * so it is clearly smaller than Medium at any width (spec §9); otherwise tileFit on its box.
 * The same rule on a tab and in a folder (M5: consistent sizes).
 */
export function spanFit(span: number, cellPx: number): TileFit {
  if (span <= 1) return 'compact';
  return tileFit(span * cellPx, span * cellPx);
}

/** How a tile placed at `p` on a tab fits (spanFit on its span; Small is compact). */
export function nodeFit(p: Placement, m: ContainerMetrics): TileFit {
  const c = clampPlacement(p, m.columns);
  if (c.w <= 1 && c.h <= 1) return 'compact';
  const b = nodeBox(p, m);
  return tileFit(b.widthPx, b.heightPx);
}

/** A stacked (phone) plan carries the canvas width: an open folder there is that wide (M5). */
export type CanvasPlan = { kind: 'grid'; cellPx: number } | { kind: 'stacked'; widthPx?: number };

/** A tab's canvas: its 24-column grid at this width, or stacked on a phone / unmeasured width. */
export function planCanvas(widthPx: number, tab: LayoutTab): CanvasPlan {
  if (!isNum(widthPx) || widthPx < PHONE_BREAKPOINT_PX) return { kind: 'stacked', widthPx: nonNeg(widthPx) };
  return { kind: 'grid', cellPx: widthPx / containerColumns(tab.root) };
}

// ---------------------------------------------------------------------------
// One geometry source. The renderer (and the editor's hit-testing and resize
// handles) take every size from the functions below; nothing else derives a
// column width, row height, folder chrome or box.
// ---------------------------------------------------------------------------

export interface NodeBox { leftPx: number; topPx: number; widthPx: number; heightPx: number }

export interface ContainerMetrics {
  columns: number;
  /** Width in px of one column (one tab cell). */
  unitPx: number;
  /** Height in px of one row. */
  rowPx: number;
  /** Width in px of the container's content box. */
  innerWidthPx: number;
  /**
   * A folder's content (M5): no placements; items flow in order, each `span` cells square
   * (its contents size), `perRow` to a row. Absent for a tab root.
   */
  flow?: { span: number; perRow: number };
}

const nonNeg = (v: unknown): number => (isNum(v) && v > 0 ? v : 0);

/** A tab root's metrics: square cells unless `opts.rowPx` is given. */
export function containerMetrics(container: Container, boxWidthPx: number, opts: { rowPx?: number } = {}): ContainerMetrics {
  const columns = containerColumns(container);
  const innerWidthPx = nonNeg(boxWidthPx);
  const unitPx = innerWidthPx / columns;
  const rowPx = opts.rowPx !== undefined ? nonNeg(opts.rowPx) : unitPx;
  return { columns, unitPx, rowPx, innerWidthPx };
}

/** A node's box on a tab, after clampPlacement (so fractional x/y/w/h are floored). */
export function nodeBox(p: Placement, m: ContainerMetrics): NodeBox {
  const c = clampPlacement(p, m.columns);
  return { leftPx: c.x * m.unitPx, topPx: c.y * m.rowPx, widthPx: c.w * m.unitPx, heightPx: c.h * m.rowPx };
}

/**
 * The cell under a point, given in px from the container's content-box origin. Clamped to the
 * columns and to x, y >= 0.
 */
export function pointToCell(m: ContainerMetrics, dxPx: number, dyPx: number): { x: number; y: number } {
  if (!(m.unitPx > 0) || !(m.rowPx > 0)) return { x: 0, y: 0 };
  const x = Math.floor((isNum(dxPx) ? dxPx : 0) / m.unitPx);
  const y = Math.floor((isNum(dyPx) ? dyPx : 0) / m.rowPx);
  return { x: Math.min(Math.max(x, 0), Math.max(0, m.columns - 1)), y: Math.max(y, 0) };
}

/**
 * An open folder's own chrome (Folder.svelte's CSS, global border-box). Every open folder has its
 * title bar, titled or not, since it holds the minimise control and the breadcrumb (M5 §3a.7);
 * `shape` is ignored until M6, so there is one look: a 1px border, a 40px bar, 8px body padding.
 */
export const FOLDER_CHROME = { titlePx: 40, padXPx: 2 * 8 + 2 * 1, padYPx: 2 * 8 + 2 * 1 } as const;
/** The page bar (« ‹ 1 2 3 › »), shown only when a folder has more than one page. */
export const PAGE_BAR_PX = 32;
/** The cell a folder uses on a phone (stacked: the tab has no grid there): Medium = 120 px. */
export const STACKED_CELL_PX = 60;
/** Rows of items one page shows on a phone, where an open folder has no box height of its own. */
export const PHONE_FOLDER_ROWS = 3;

/** The content box inside an open folder's box: its bar, border and padding taken off. */
export function openFolderContentBox(box: { widthPx: number; heightPx: number }): { widthPx: number; heightPx: number } {
  return {
    widthPx: nonNeg(box.widthPx - FOLDER_CHROME.padXPx),
    heightPx: nonNeg(box.heightPx - FOLDER_CHROME.titlePx - FOLDER_CHROME.padYPx)
  };
}

/** An open folder's content box on a phone: the full width, PHONE_FOLDER_ROWS rows plus the page bar. */
export function phoneFolderBox(widthPx: number, contentSize: unknown): { widthPx: number; heightPx: number } {
  return { widthPx: nonNeg(widthPx), heightPx: PHONE_FOLDER_ROWS * sizeSpan(contentSize) * STACKED_CELL_PX + PAGE_BAR_PX };
}

/** One page of an open folder (M5 §2): which items show, and whether there is a page bar. */
export interface FolderPaging {
  /** Cells each item spans each way (its contents size) and its side in px. */
  span: number;
  itemPx: number;
  perRow: number;
  rowsPerPage: number;
  perPage: number;
  pages: number;
  /** A page bar is drawn only when there is more than one page. */
  pageBar: boolean;
  /** The page shown: the asked-for page clamped to 0 .. pages - 1. */
  page: number;
  /** Items [start, end) of the folder's order are on this page. */
  start: number;
  end: number;
}

/**
 * THE page model of an open folder: `count` items of `contentSize` (in `cellPx` cells) fill its
 * content box row by row (folderPage). When they don't all fit, the page bar takes its height off
 * first. `page` (a remembered one) is clamped, so a folder made smaller or emptied still shows a
 * real page.
 */
export function folderPaging(
  content: { widthPx: number; heightPx: number }, contentSize: unknown, cellPx: number, count: number, page: number
): FolderPaging {
  const span = sizeSpan(contentSize);
  const n = isNum(count) && count > 0 ? Math.floor(count) : 0;
  let fit = folderPage(content, contentSize, cellPx);
  const pageBar = n > fit.perPage;
  if (pageBar) fit = folderPage({ widthPx: content.widthPx, heightPx: content.heightPx - PAGE_BAR_PX }, contentSize, cellPx);
  const pages = Math.max(1, Math.ceil(n / fit.perPage));
  const asked = isNum(page) ? Math.floor(page) : 0;
  const p = Math.min(Math.max(0, asked), pages - 1);
  const start = p * fit.perPage;
  return {
    span, itemPx: span * nonNeg(cellPx), ...fit, pages, pageBar, page: p, start, end: Math.min(n, start + fit.perPage)
  };
}

/** The metrics one page is drawn (and hit-tested) with: `perRow` items of `span` cells in a row. */
export function folderFlowMetrics(g: Pick<FolderPaging, 'span' | 'perRow'>, cellPx: number, widthPx: number): ContainerMetrics {
  const unitPx = nonNeg(cellPx);
  return { columns: g.perRow * g.span, unitPx, rowPx: unitPx, innerWidthPx: nonNeg(widthPx), flow: { span: g.span, perRow: g.perRow } };
}

/** Box width of a tab's root container for a plan (0 when stacked). */
export function rootBoxWidthPx(plan: CanvasPlan, tab: LayoutTab): number {
  return plan.kind === 'grid' ? plan.cellPx * containerColumns(tab.root) : 0;
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
 * True only for nodes the renderer can draw; false => show a visible placeholder.
 * Folder contents have no placements (M5): a tab-level node must also pass isPlaced.
 */
export function isRenderable(n: unknown): n is LayoutNode {
  if (!n || typeof n !== 'object') return false;
  const o = n as Record<string, unknown>;
  if (o.kind !== 'tile' && o.kind !== 'folder') return false;
  if (o.kind === 'folder') {
    const c = o.content as Record<string, unknown> | undefined;
    if (!c || typeof c !== 'object' || !Array.isArray(c.children)) return false;
  }
  return true;
}

/** A renderable node with a valid placement: what may sit on a tab. */
export function isPlaced(n: unknown): n is PlacedNode {
  return isRenderable(n) && validPlacement((n as { placement?: unknown }).placement);
}

/**
 * Placement of a folder minimised on a tab (per-browser view or saved): a tile of its own size
 * (sizeSpan) at the top-left of the space it keeps, clamped to that space so it never draws over a
 * neighbour (M5 §3a.2).
 */
export function minimisedPlacement(p: Placement, size: unknown): Placement {
  const span = sizeSpan(size);
  // A non-finite side (unreachable for placed nodes) is the span, never NaN.
  const w = isNum(p.w) ? Math.min(span, Math.max(1, p.w)) : span;
  const h = isNum(p.h) ? Math.min(span, Math.max(1, p.h)) : span;
  const out: Placement = { x: p.x, y: p.y, w, h };
  if (p.z !== undefined) out.z = p.z;
  return out;
}

/** The default open box of a folder that has none (M5 §3a.3): its size in cells x 3 wide, x 2 high. */
export function defaultFolderBox(size: unknown): { w: number; h: number } {
  const s = sizeSpan(size);
  return { w: 3 * s, h: 2 * s };
}

/**
 * The cells an item takes when it is placed on a tab: a tile its Size's span (square); a folder
 * its stored open box, or the default box when it has none (it comes from inside a folder).
 */
export function tabSpan(n: Pick<LayoutNode, 'kind' | 'placement'> & { size?: unknown }): { w: number; h: number } {
  if (n.kind === 'tile') {
    const s = sizeSpan(n.size);
    return { w: s, h: s };
  }
  const p = n.placement;
  if (p && isNum(p.w) && isNum(p.h)) return { w: Math.max(1, Math.floor(p.w)), h: Math.max(1, Math.floor(p.h)) };
  return defaultFolderBox(n.size);
}
