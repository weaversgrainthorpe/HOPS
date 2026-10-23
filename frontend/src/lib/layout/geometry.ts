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

/**
 * A stacked (phone) plan carries the canvas width and the viewport (window) size: an open folder there
 * is the canvas wide, its items are the phone tab's tiles, and a page fits the viewport (M5).
 */
export type CanvasPlan =
  | { kind: 'grid'; cellPx: number }
  | { kind: 'stacked'; widthPx?: number; viewportWidthPx?: number; viewportHeightPx?: number };

/** A tab's canvas: its 24-column grid at this width, or stacked on a phone / unmeasured width. */
export function planCanvas(widthPx: number, tab: LayoutTab, viewport?: { widthPx: number; heightPx: number }): CanvasPlan {
  if (!isNum(widthPx) || widthPx < PHONE_BREAKPOINT_PX) {
    const plan: CanvasPlan = { kind: 'stacked', widthPx: nonNeg(widthPx) };
    if (viewport) {
      plan.viewportWidthPx = nonNeg(viewport.widthPx);
      plan.viewportHeightPx = nonNeg(viewport.heightPx);
    }
    return plan;
  }
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
  flow?: { span: number; perRow: number; phone?: { colPx: number; gapPx: number } };
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
/**
 * The page bar (« ‹ 1 2 3 › »), shown only when a folder has more than one page. FOLDER_CHROME,
 * PAGE_BAR_PX and MIN_GRID_CELL_PX have a Go twin (configdoc/layout.go: FolderTitlePx, FolderPadPx,
 * PageBarPx, MinGridCellPx); the shared table backend/internal/configdoc/testdata/folder_min_cases.json
 * is run by both suites (Ruling 9).
 */
export const PAGE_BAR_PX = 32;
/**
 * The narrowest a tab's grid cell gets: below PHONE_BREAKPOINT_PX the tab stacks (planCanvas), so a
 * grid cell is never under PHONE_BREAKPOINT_PX / ROOT_COLUMNS = 32 px.
 */
export const MIN_GRID_CELL_PX = PHONE_BREAKPOINT_PX / ROOT_COLUMNS;
/**
 * The smallest open folder on a tab (M5 §3.5), in whole cells: its bar, border and padding, ONE item
 * at its contents size and the page bar. Counted at the narrowest grid cell (MIN_GRID_CELL_PX), so it
 * holds at every grid width — the layout is the same at every width, and a wider cell only adds room.
 */
export function minOpenFolderCells(contentSize: unknown): { w: number; h: number } {
  const span = sizeSpan(contentSize);
  return {
    w: span + Math.ceil(FOLDER_CHROME.padXPx / MIN_GRID_CELL_PX),
    h: span + Math.ceil((FOLDER_CHROME.titlePx + FOLDER_CHROME.padYPx + PAGE_BAR_PX) / MIN_GRID_CELL_PX)
  };
}
/**
 * The largest contents size of `folder` and every folder inside it, however deep. A drilled-into
 * sub-folder's page is drawn in the same open box at ITS contents size, so the box must fit one of
 * the largest (fix round 1).
 */
export function largestContentSize(folder: FolderNode): ItemSize {
  let best = sizeOf(folder.contentSize);
  const walk = (f: FolderNode) => {
    for (const k of Array.isArray(f.content?.children) ? f.content.children : []) {
      if (!k || (k as { kind?: unknown }).kind !== 'folder') continue;
      const sub = k as FolderNode;
      if (sizeSpan(sub.contentSize) > sizeSpan(best)) best = sizeOf(sub.contentSize);
      walk(sub);
    }
  };
  walk(folder);
  return best;
}

/** The smallest open box of `folder` on a tab: minOpenFolderCells at its largest contents size. */
export function folderMinCells(folder: FolderNode): { w: number; h: number } {
  return minOpenFolderCells(largestContentSize(folder));
}

/** The content box inside an open folder's box: its bar, border and padding taken off. */
export function openFolderContentBox(box: { widthPx: number; heightPx: number }): { widthPx: number; heightPx: number } {
  return {
    widthPx: nonNeg(box.widthPx - FOLDER_CHROME.padXPx),
    heightPx: nonNeg(box.heightPx - FOLDER_CHROME.titlePx - FOLDER_CHROME.padYPx)
  };
}

/**
 * A drilled-in sub-folder's inset box (M5 §7: a folder inside a folder, one box a level). Folder.svelte's
 * .nested-box CSS: a 1px border, a compact 28px title bar (‹ and its name), 8px body padding. It fills
 * the body of the level above it.
 */
export const NESTED_CHROME = { titlePx: 28, padPx: 8, borderPx: 1, padXPx: 2 * 8 + 2 * 1, padYPx: 2 * 8 + 2 * 1 } as const;

/** The content box `levels` inset boxes in from an open folder's own content box (level 0 = its own). */
export function nestedContentBox(content: { widthPx: number; heightPx: number }, levels: number): { widthPx: number; heightPx: number } {
  const n = isNum(levels) && levels > 0 ? Math.floor(levels) : 0;
  if (n === 0) return { widthPx: content.widthPx, heightPx: content.heightPx };
  return {
    widthPx: nonNeg(content.widthPx - n * NESTED_CHROME.padXPx),
    heightPx: nonNeg(content.heightPx - n * (NESTED_CHROME.titlePx + NESTED_CHROME.padYPx))
  };
}

/** The "Not enough room" note's height: it goes inside the innermost box only when its body is this tall. */
export const NO_ROOM_NOTE_PX = 24;

/**
 * The page of the innermost box, `levels` deep inside an open folder whose content box is `content`
 * (folderPaging in nestedContentBox). `noRoom`: a drilled level whose box cannot show its page — not
 * even one item at its contents size, or not the page bar its items need (tooSmall) — so Folder.svelte
 * says "Not enough room" and draws no clipped items. `noRoomInside`: the innermost box's body is tall
 * enough to hold that note; otherwise (the inset bars themselves run out of room) the note goes on the
 * folder's own body, where it is always seen. Opening a sub-folder never resizes the saved box.
 */
export function nestedPaging(
  content: { widthPx: number; heightPx: number }, levels: number, contentSize: unknown, cellPx: number, count: number, page: number
): FolderPaging & { noRoom: boolean; noRoomInside: boolean } {
  const inner = nestedContentBox(content, levels);
  const g = folderPaging(inner, contentSize, cellPx, count, page);
  const eps = 0.5;
  const n = isNum(levels) && levels >= 1 ? Math.floor(levels) : 0;
  const noRoom = n > 0 && (g.tooSmall || inner.widthPx + eps < g.itemPx || inner.heightPx + eps < g.itemPx);
  // The innermost body as drawn: its content height (unclamped) plus its padding.
  const bodyPx = content.heightPx - n * (NESTED_CHROME.titlePx + NESTED_CHROME.padYPx) + 2 * NESTED_CHROME.padPx;
  return { ...g, noRoom, noRoomInside: noRoom && bodyPx + eps >= NO_ROOM_NOTE_PX };
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
  /**
   * The box cannot show one item, or the page bar its items need (a box below its minimum, which the
   * server refuses — Important 2's backstop). The folder then says so visibly; it never clips silently.
   */
  tooSmall: boolean;
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
  const itemPx = span * nonNeg(cellPx);
  // folderPage shows at least one item a row and one row; this is when even that one does not fit.
  const eps = 0.5;
  const tooSmall =
    n > 0 &&
    (nonNeg(content.widthPx) + eps < itemPx || nonNeg(content.heightPx) - (pageBar ? PAGE_BAR_PX : 0) + eps < itemPx);
  return { span, itemPx, ...fit, ...pageOf(n, fit.perPage, page), pageBar, tooSmall };
}

/** The page shown of `n` items at `perPage` a page: the asked-for page clamped, and its item range. */
function pageOf(n: number, perPage: number, page: number): { pages: number; page: number; start: number; end: number } {
  const pages = Math.max(1, Math.ceil(n / perPage));
  const asked = isNum(page) ? Math.floor(page) : 0;
  const p = Math.min(Math.max(0, asked), pages - 1);
  const start = p * perPage;
  return { pages, page: p, start, end: Math.min(n, start + perPage) };
}

// ---- phones (stacked): a folder's items are the phone tab's tiles (M5: one size everywhere)

/** A phone tab tile's height by size: the unfitted tile's own minimum (Entry.svelte .small/.medium/.large). */
export const PHONE_TILE_MIN_PX: Record<ItemSize, number> = { small: 100, medium: 120, large: 160 };
/**
 * The viewport height a phone page does not get: the top bar, the tab bar, the folder's own bar, its
 * page bar and padding. A page is at most the viewport less this, so it fits on screen.
 */
export const PHONE_PAGE_RESERVE_PX = 220;

/**
 * The phone tab grid (ContainerView .container-stacked, the same media queries): its column minimum
 * and gap at this viewport width.
 */
export function phoneTrack(viewportWidthPx: number): { minPx: number; gapPx: number } {
  const vw = isNum(viewportWidthPx) ? viewportWidthPx : 0;
  if (vw <= 480) return { minPx: 100, gapPx: 12 };
  if (vw <= 768) return { minPx: 120, gapPx: 12 };
  return { minPx: 135, gapPx: 14 };
}

/** A phone tab column's width: as many columns as fit the canvas (auto-fill), sharing it (1fr). */
export function phoneColumnPx(canvasWidthPx: number, track: { minPx: number; gapPx: number }): number {
  const w = nonNeg(canvasWidthPx);
  const n = Math.max(1, Math.floor((w + track.gapPx) / (track.minPx + track.gapPx)));
  return n === 1 ? w : (w - (n - 1) * track.gapPx) / n;
}

/**
 * THE page model of an open folder on a phone. Items are the phone tab's tiles: a tab column wide
 * (phoneColumnPx of the canvas) and their size's height (PHONE_TILE_MIN_PX), as many a row as fit the
 * folder's content width. Rows per page come from a pixel budget (the viewport height less
 * PHONE_PAGE_RESERVE_PX, at least one row), so a page fits the screen, Large included.
 */
export function phonePaging(
  contentWidthPx: number, canvasWidthPx: number, viewport: { widthPx: number; heightPx: number },
  contentSize: unknown, count: number, page: number
): FolderPaging & { rowPx: number; gapPx: number } {
  const track = phoneTrack(viewport.widthPx);
  const col = phoneColumnPx(canvasWidthPx, track);
  const gap = track.gapPx;
  const perRow = col > 0 ? Math.max(1, Math.floor((nonNeg(contentWidthPx) + gap) / (col + gap) + 1e-9)) : 1;
  const rowPx = PHONE_TILE_MIN_PX[sizeOf(contentSize)];
  const budget = Math.max(rowPx, nonNeg(viewport.heightPx) - PHONE_PAGE_RESERVE_PX);
  const rowsPerPage = Math.max(1, Math.floor((budget + gap) / (rowPx + gap) + 1e-9));
  const perPage = perRow * rowsPerPage;
  const n = isNum(count) && count > 0 ? Math.floor(count) : 0;
  return {
    span: 1, itemPx: col, rowPx, gapPx: gap, perRow, rowsPerPage, perPage, pageBar: n > perPage, ...pageOf(n, perPage, page),
    tooSmall: false
  };
}

/** The metrics one phone page is drawn (and hit-tested) with: perRow tab-tile columns, unfitted tiles. */
export function phoneFlowMetrics(g: FolderPaging & { rowPx: number; gapPx: number }, widthPx: number): ContainerMetrics {
  return {
    columns: g.perRow, unitPx: g.itemPx, rowPx: g.rowPx, innerWidthPx: nonNeg(widthPx),
    flow: { span: 1, perRow: g.perRow, phone: { colPx: g.itemPx, gapPx: g.gapPx } }
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

/**
 * The default open box of a folder that has none (M5 §3a.3): its size in cells x 3 wide, x 2 high —
 * raised, each way, to its smallest open box at its largest contents size (folderMinCells), since an
 * open folder box is never below its minimum (Ruling 7a). Medium with Medium contents: 6 x 5.
 */
export function defaultFolderBox(folder: Pick<FolderNode, 'size' | 'contentSize'> & { content?: FolderNode['content'] }): {
  w: number; h: number;
} {
  const s = sizeSpan(folder.size);
  const min = folderMinCells({ content: { children: [] }, ...folder } as FolderNode);
  return { w: Math.max(3 * s, min.w), h: Math.max(2 * s, min.h) };
}

/**
 * The cells an item takes when it is placed on a tab: a tile its Size's span (square); a folder
 * its stored open box, or the default box when it has none (it comes from inside a folder).
 */
export function tabSpan(
  n: Pick<LayoutNode, 'kind' | 'placement'> & { size?: unknown; contentSize?: unknown; content?: unknown }
): { w: number; h: number } {
  if (n.kind === 'tile') {
    const s = sizeSpan(n.size);
    return { w: s, h: s };
  }
  const p = n.placement;
  if (p && isNum(p.w) && isNum(p.h)) return { w: Math.max(1, Math.floor(p.w)), h: Math.max(1, Math.floor(p.h)) };
  return defaultFolderBox(n as FolderNode);
}
