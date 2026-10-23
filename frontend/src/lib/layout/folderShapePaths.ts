/**
 * The static SVG geometry of each folder shape (M6 §2, §3.7, §3a.2, §3a.6, §3a.9, §3a.10). One pure
 * function, `shapeParts`, gives FolderShape.svelte everything it draws for a box of a given size:
 *  - the silhouette (back panel + tab as ONE path: the outline, the focus ring and Simple tab);
 *  - the back panel, the front panel (the body), and the paper that peeks out on the tab side;
 *  - the front panel's rectangle, which a background picture fills, clipped to the shape (§3a.10).
 * Only path data built from numbers here — never user markup (§3.8). No filters; Paper is the one look
 * that uses the one gradient (Tenet 4).
 *
 * Shapes are decoration on a rectangle (§2): content lays out in shapeInset (geometry.ts), which sits
 * below the tab and inside the front panel (for the open flap, inside its upright part).
 */
import type { FolderShape } from '$lib/types/layout';
import { FLAP_TILT_PX, FOLDER_CHROME, folderTabRect, shapeOf, type InsetRect } from './geometry';

export type ShapeState = 'minimised' | 'open' | 'nested';

/** A minimised folder's name is hidden below this font size (§3a.6); its accessible name stays. */
export const MINI_NAME_FLOOR_PX = 12;
/**
 * The smallest minimised tile that shows its name on the front: the mini tab, a 12 px name, the icons
 * and padding. Below it the tile is the Small silhouette with its icons (§3a.6).
 */
export const MINI_NAME_MIN_TILE_PX = 84;

export interface ShapeParts {
  /** The shape drawn: the folder's own, or Rounded for a missing / unknown one. */
  shape: FolderShape;
  /** Where the tab sits (px from the box's top-left), or null for Rounded. */
  tab: InsetRect | null;
  /** Back panel + tab as one outline ('' for Rounded). */
  silhouette: string;
  /** The back panel and tab (filled darker), when the look has separate panels. */
  back: string;
  /** The front panel / body path ('' for Rounded). */
  front: string;
  /** The front panel's bounding rectangle: the area a background picture fills. */
  frontRect: InsetRect;
  /** The front panel's corner radius (for the picture's clip). */
  radiusPx: number;
  /** How far the front panel's bottom corners are in from the sides (the open flap's tilt). */
  frontInsetPx: number;
  /** The open flap's outline as a CSS polygon relative to frontRect (the picture's clip), else ''. */
  frontPolygon: string;
  /** The sheet of paper peeking out on the tab side (Paper and Open flap). */
  paper: InsetRect | null;
  /** The look uses the one gradient (Paper only). */
  gradient: boolean;
  /** Filled panels (Outlined is line only, see-through). */
  fill: boolean;
  /** The edge: none, the folder's own colour (Outlined), or a dark cartoon line. */
  stroke: 'none' | 'colour' | 'dark';
  strokePx: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A minimised tile's tab height: a compact version of the open tab (6 px .. the tab allowance). */
export function miniTabPx(tileHeightPx: number): number {
  return Math.round(clamp((Number.isFinite(tileHeightPx) ? tileHeightPx : 0) * 0.14, 6, FOLDER_CHROME.tabPx));
}

/**
 * The width a tab's label asks for (folderTabRect clamps it): the name at the tab's 14 px semibold,
 * plus its padding and an icon. An untitled tab asks for nothing (the minimum tab).
 */
export function tabWantPx(name: string, withIcon: boolean, compact = false): number {
  const n = (name ?? '').trim();
  if (!n) return 0;
  return Math.ceil(n.length * (compact ? 7.2 : 8) + 24 + (withIcon ? 20 : 0));
}

/** Rounded rectangle path in [x0, x0+w] × [y0, y0+h] with radius r. */
function roundRect(x0: number, y0: number, w: number, h: number, r: number): string {
  const x1 = x0 + w, y1 = y0 + h;
  return [
    `M${r1(x0)} ${r1(y0 + r)}`, `Q${r1(x0)} ${r1(y0)} ${r1(x0 + r)} ${r1(y0)}`, `L${r1(x1 - r)} ${r1(y0)}`,
    `Q${r1(x1)} ${r1(y0)} ${r1(x1)} ${r1(y0 + r)}`, `L${r1(x1)} ${r1(y1 - r)}`, `Q${r1(x1)} ${r1(y1)} ${r1(x1 - r)} ${r1(y1)}`,
    `L${r1(x0 + r)} ${r1(y1)}`, `Q${r1(x0)} ${r1(y1)} ${r1(x0)} ${r1(y1 - r)}`, 'Z'
  ].join(' ');
}

/**
 * The back panel with its tab, as one path, in [i, W-i] × [i, H-i] (i: half the stroke, so a line is
 * never clipped). A left tab runs from the box's left edge to the label's end and slopes down on the
 * right; a right tab mirrors it; a centre tab slopes both ways.
 */
function silhouettePath(W: number, H: number, T: number, tab: InsetRect, pos: string, r: number, i: number): string {
  const s = clamp(T * 0.75, 3, 14);
  const rt = Math.min(r, T / 2);
  const x0 = i, y0 = i, x1 = W - i, y1 = H - i;
  const bt = T; // the body's top edge
  const tl = Math.max(x0, tab.leftPx), tr = Math.min(x1, tab.leftPx + tab.widthPx);
  const p: string[] = [];
  if (pos === 'left') {
    p.push(`M${r1(x0)} ${r1(y0 + rt)}`, `Q${r1(x0)} ${r1(y0)} ${r1(x0 + rt)} ${r1(y0)}`, `L${r1(tr)} ${r1(y0)}`, `L${r1(Math.min(x1 - r, tr + s))} ${r1(bt)}`);
  } else {
    p.push(`M${r1(x0)} ${r1(bt + r)}`, `Q${r1(x0)} ${r1(bt)} ${r1(x0 + r)} ${r1(bt)}`, `L${r1(Math.max(x0 + r, tl - s))} ${r1(bt)}`);
    if (pos === 'right') {
      p.push(`L${r1(tl)} ${r1(y0)}`, `L${r1(x1 - rt)} ${r1(y0)}`, `Q${r1(x1)} ${r1(y0)} ${r1(x1)} ${r1(y0 + rt)}`);
    } else {
      p.push(`L${r1(tl)} ${r1(y0)}`, `L${r1(tr)} ${r1(y0)}`, `L${r1(Math.min(x1 - r, tr + s))} ${r1(bt)}`);
    }
  }
  if (pos !== 'right') p.push(`L${r1(x1 - r)} ${r1(bt)}`, `Q${r1(x1)} ${r1(bt)} ${r1(x1)} ${r1(bt + r)}`);
  p.push(`L${r1(x1)} ${r1(y1 - r)}`, `Q${r1(x1)} ${r1(y1)} ${r1(x1 - r)} ${r1(y1)}`, `L${r1(x0 + r)} ${r1(y1)}`, `Q${r1(x0)} ${r1(y1)} ${r1(x0)} ${r1(y1 - r)}`, 'Z');
  return p.join(' ');
}

/** The open flap: full width at its top edge, FLAP_TILT in at the bottom (it tilts forward, §3a.9). */
function flapPath(W: number, H: number, top: number, tilt: number, r: number, i: number): string {
  const x0 = i, x1 = W - i, y1 = H - i;
  return [
    `M${r1(x0 + r)} ${r1(top)}`, `L${r1(x1 - r)} ${r1(top)}`, `Q${r1(x1)} ${r1(top)} ${r1(x1 - 0.2)} ${r1(top + r)}`,
    `L${r1(x1 - tilt)} ${r1(y1 - r)}`, `Q${r1(x1 - tilt)} ${r1(y1)} ${r1(x1 - tilt - r)} ${r1(y1)}`,
    `L${r1(x0 + tilt + r)} ${r1(y1)}`, `Q${r1(x0 + tilt)} ${r1(y1)} ${r1(x0 + tilt)} ${r1(y1 - r)}`,
    `L${r1(x0 + 0.2)} ${r1(top + r)}`, `Q${r1(x0)} ${r1(top)} ${r1(x0 + r)} ${r1(top)}`, 'Z'
  ].join(' ');
}

/**
 * Everything FolderShape draws for `shape` in a box of `box` px, at `state`. Open and nested tabs are
 * exactly folderTabRect (so the real label on the tab lines up with the drawn tab); a minimised tab is
 * a compact one (miniTabPx high, ~40% wide). An unknown shape is Rounded.
 */
export function shapeParts(
  rawShape: unknown, tabPosition: unknown, state: ShapeState, box: { widthPx: number; heightPx: number }, wantPx?: number
): ShapeParts {
  const shape = shapeOf(rawShape);
  const W = Math.max(0, box.widthPx || 0), H = Math.max(0, box.heightPx || 0);
  const empty: ShapeParts = {
    shape, tab: null, silhouette: '', back: '', front: '', frontRect: { leftPx: 0, topPx: 0, widthPx: W, heightPx: H },
    radiusPx: 8, frontInsetPx: 0, frontPolygon: '', paper: null, gradient: false, fill: true, stroke: 'none', strokePx: 0
  };
  if (shape === 'rounded') return empty;
  const mini = state === 'minimised';
  const T = mini ? miniTabPx(H) : FOLDER_CHROME.tabPx;
  const rect0 = folderTabRect(shape, tabPosition, box, mini ? W * 0.42 : wantPx)!;
  const tab: InsetRect = mini ? { ...rect0, heightPx: T } : rect0;
  const pos = tabPosition === 'centre' || tabPosition === 'right' ? tabPosition : 'left';
  const r = mini ? clamp(Math.min(W, H) * 0.08, 3, 10) : 10;
  const stroke: ShapeParts['stroke'] = shape === 'folder-outline' ? 'colour' : shape === 'folder-cartoon' ? 'dark' : 'none';
  const strokePx = stroke === 'none' ? 0 : mini ? 2 : shape === 'folder-cartoon' ? 3 : 2;
  const i = strokePx / 2;
  const silhouette = silhouettePath(W, H, T, tab, pos, r, i);
  // Where the front panel starts: a strip of the back panel shows above it (a real folder).
  const drop = (n: number) => (mini ? Math.round(T * n) : Math.round(FOLDER_CHROME.tabPx * n));
  const frontTop =
    shape === 'folder-paper' ? T + drop(0.45) : shape === 'folder-open' ? T + drop(0.5) : shape === 'simple-tab' ? T : T + drop(0.17);
  const tilt = shape === 'folder-open' ? (mini ? clamp(W * 0.05, 2, FLAP_TILT_PX) : FLAP_TILT_PX) : 0;
  const frontRect: InsetRect = { leftPx: 0, topPx: frontTop, widthPx: W, heightPx: Math.max(0, H - frontTop) };
  let front = '';
  if (shape === 'folder-open') front = flapPath(W, H, frontTop, tilt, r, i);
  else if (shape !== 'simple-tab') front = roundRect(i, frontTop, W - 2 * i, Math.max(0, H - frontTop - i), Math.min(r, (H - frontTop) / 2));
  // The paper: on the tab's side, from just under the tab to below the front's top edge.
  let paper: InsetRect | null = null;
  if (shape === 'folder-paper' || shape === 'folder-open') {
    const pw = W * (pos === 'centre' ? 0.6 : 0.55);
    const inset = Math.max(r, mini ? 3 : 12);
    const left = pos === 'left' ? inset : pos === 'right' ? W - inset - pw : (W - pw) / 2;
    const top = T + (mini ? 1 : 3);
    paper = { leftPx: r1(left), topPx: top, widthPx: r1(pw), heightPx: Math.max(0, frontTop - top + (mini ? 4 : 12)) };
  }
  const frontPolygon =
    shape === 'folder-open'
      ? `polygon(0px 0px, ${r1(W)}px 0px, ${r1(W - tilt)}px ${r1(H - frontTop)}px, ${r1(tilt)}px ${r1(H - frontTop)}px)`
      : '';
  return {
    shape, tab, silhouette, back: shape === 'simple-tab' ? '' : silhouette, front, frontRect, radiusPx: r,
    frontInsetPx: tilt, frontPolygon, paper, gradient: shape === 'folder-paper', fill: shape !== 'folder-outline', stroke, strokePx
  };
}
