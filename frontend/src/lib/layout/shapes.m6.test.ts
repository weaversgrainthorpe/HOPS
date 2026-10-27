// M6 folder shapes: the shape model, the tab allowance, and each shape's rectangular content inset
// (spec §3, §3a.4, §3a.9). Task 3's FolderShape draws inside these numbers; nothing else derives them.
import { describe, it, expect } from 'vitest';
import {
  FOLDER_CHROME, NESTED_CHROME, FOLDER_SHAPES, TAB_POSITIONS, SHAPE_CREATED, FLAP_TILT_PX, LAYOUT_VERSION,
  REFERENCE_CELL_PX, PAGE_BAR_PX, TAB_MIN_PX, TAB_MAX_PX, TAB_EDGE_PX,
  isFolderShape, shapeOf, tabPositionOf, hasTab, shapeInset, folderTabRect, openFolderContentBox,
  minOpenFolderCells, nestedContentBox, nestedPaging, sizeSpan
} from './geometry';
import type { FolderShape, TabPosition } from '$lib/types/layout';

const TAB_SHAPES: FolderShape[] = ['simple-tab', 'folder-flat', 'folder-paper', 'folder-outline', 'folder-cartoon', 'folder-open'];

describe('the shape model (M6 §3.9, §3a.8)', () => {
  it('seven shapes, in spec order — the twin of configdoc.FolderShapes; three tab positions', () => {
    expect(FOLDER_SHAPES).toEqual(['rounded', 'simple-tab', 'folder-flat', 'folder-paper', 'folder-outline', 'folder-cartoon', 'folder-open']);
    expect(TAB_POSITIONS).toEqual(['left', 'centre', 'right']);
  });
  it('folder-tab (the old converter value) is NOT a shape any more (§3a.1)', () => {
    expect(isFolderShape('folder-tab')).toBe(false);
    expect(FOLDER_SHAPES).not.toContain('folder-tab');
  });
  it('isFolderShape accepts exactly the seven names', () => {
    for (const s of FOLDER_SHAPES) expect(isFolderShape(s)).toBe(true);
    for (const bad of ['', 'Rounded', 'folder', '<svg/>', null, undefined, 3, {}]) expect(isFolderShape(bad)).toBe(false);
  });
  it('shapeOf: a missing or unknown shape draws as Rounded (the renderer notes the unknown one, §3.9)', () => {
    expect(shapeOf(undefined)).toBe('rounded');
    expect(shapeOf('folder-tab')).toBe('rounded');
    expect(shapeOf('folder-open')).toBe('folder-open');
  });
  it('tabPositionOf: absent or unknown is left (§3.2)', () => {
    expect(tabPositionOf(undefined)).toBe('left');
    expect(tabPositionOf('middle')).toBe('left');
    expect(tabPositionOf('centre')).toBe('centre');
    expect(tabPositionOf('right')).toBe('right');
  });
  it('every shape but Rounded has a tab', () => {
    expect(hasTab('rounded')).toBe(false);
    for (const s of TAB_SHAPES) expect(hasTab(s)).toBe(true);
  });
  it('HOPS-created folders start Flat (§3a.5)', () => {
    expect(SHAPE_CREATED).toBe('folder-flat');
  });
  it('the stored layout form is version 2 (the stricter minimum is a format rule, §3a.4)', () => {
    expect(LAYOUT_VERSION).toBe(2);
  });
});

describe('the tab allowance (§3a.4): one constant, no shape parameter', () => {
  it('24 px, on the open folder and on every nested level — the twin of configdoc.FolderTabPx', () => {
    expect(FOLDER_CHROME.tabPx).toBe(24);
    expect(NESTED_CHROME.tabPx).toBe(24);
  });
  it('the minimum counts bar + tab + padding + page bar at the desktop reference cell (M6 §13)', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const span = sizeSpan(size);
      expect(minOpenFolderCells(size)).toEqual({
        w: span + Math.ceil(FOLDER_CHROME.padXPx / REFERENCE_CELL_PX),
        h: span + Math.ceil((FOLDER_CHROME.titlePx + FOLDER_CHROME.tabPx + FOLDER_CHROME.padYPx + PAGE_BAR_PX) / REFERENCE_CELL_PX)
      });
    }
    expect(minOpenFolderCells('small')).toEqual({ w: 2, h: 3 });
    expect(minOpenFolderCells('medium')).toEqual({ w: 3, h: 4 });
    expect(minOpenFolderCells('large')).toEqual({ w: 5, h: 6 });
  });
  it('the nested inset per level takes the tab allowance too (M5 §7 + §3a.4)', () => {
    const outer = { widthPx: 702, heightPx: 400 };
    expect(nestedContentBox(outer, 1)).toEqual({ widthPx: 684, heightPx: 400 - (28 + 24 + 18) });
    expect(nestedContentBox(outer, 2)).toEqual({ widthPx: 666, heightPx: 400 - 2 * (28 + 24 + 18) });
  });
  it('the innermost body (for the "Not enough room" note) counts the per-level tab allowance', () => {
    // Level 1 in 100 px: 100 - (28 + 24 + 18) + 16 = 46 px → the note fits inside.
    expect(nestedPaging({ widthPx: 300, heightPx: 100 }, 1, 'large', 32, 1, 0)).toMatchObject({ noRoom: true, noRoomInside: true });
    // Level 2 in 100 px: 100 - 140 + 16 < 24 → the note goes on the top body.
    expect(nestedPaging({ widthPx: 300, heightPx: 100 }, 2, 'medium', 32, 1, 0)).toMatchObject({ noRoom: true, noRoomInside: false });
  });
});

describe('shapeInset: the rectangular content area of each shape (§3a.2, §3a.9)', () => {
  const box = { widthPx: 320, heightPx: 260 };

  it('Rounded keeps the M5 title bar: 1 px border, 40 px bar, 8 px padding (no tab drawn)', () => {
    expect(shapeInset('rounded', 'left', box)).toEqual({ leftPx: 9, topPx: 49, widthPx: 302, heightPx: 260 - 58 });
  });
  it('an unknown shape insets as Rounded', () => {
    expect(shapeInset('folder-tab', 'left', box)).toEqual(shapeInset('rounded', 'left', box));
  });
  it('tab shapes: the tab above the body, then the body (border, controls row, padding)', () => {
    for (const s of TAB_SHAPES) {
      expect(shapeInset(s, 'left', box), s).toEqual({ leftPx: 9, topPx: 24 + 49, widthPx: 302, heightPx: 260 - 24 - 58 });
    }
  });
  it('the tab position moves only the tab, never the content area', () => {
    for (const s of FOLDER_SHAPES) {
      const left = shapeInset(s, 'left', box);
      for (const pos of TAB_POSITIONS) expect(shapeInset(s, pos, box), `${s} ${pos}`).toEqual(left);
      expect(shapeInset(s, 'bogus', box)).toEqual(left);
    }
  });
  it('Open flap: tiles sit in the flap\'s upright area — clear of the tilt on both sides, never skewed', () => {
    const r = shapeInset('folder-open', 'left', box);
    expect(r.leftPx).toBeGreaterThanOrEqual(1 + FLAP_TILT_PX);
    expect(box.widthPx - (r.leftPx + r.widthPx)).toBeGreaterThanOrEqual(1 + FLAP_TILT_PX);
    // The tilt lives inside the body padding, so the one minimum still holds (§3a.4).
    expect(FLAP_TILT_PX).toBeLessThanOrEqual(8);
  });
  it('every shape\'s inset at its minimum box still holds one item and the page bar (one minimum for all, §3a.4)', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const min = minOpenFolderCells(size);
      const b = { widthPx: min.w * REFERENCE_CELL_PX, heightPx: min.h * REFERENCE_CELL_PX };
      const item = sizeSpan(size) * REFERENCE_CELL_PX;
      for (const s of FOLDER_SHAPES) {
        const r = shapeInset(s, 'centre', b);
        expect(r.widthPx, `${s} ${size}`).toBeGreaterThanOrEqual(item);
        expect(r.heightPx - PAGE_BAR_PX, `${s} ${size}`).toBeGreaterThanOrEqual(item);
        expect(r.leftPx + r.widthPx).toBeLessThanOrEqual(b.widthPx);
        expect(r.topPx + r.heightPx).toBeLessThanOrEqual(b.heightPx);
      }
    }
  });
  it('a box too small for the chrome gives an empty (never negative) area', () => {
    for (const s of FOLDER_SHAPES) {
      const r = shapeInset(s, 'left', { widthPx: 10, heightPx: 10 });
      expect(r.widthPx).toBe(0);
      expect(r.heightPx).toBe(0);
    }
  });
  it('openFolderContentBox is the inset\'s size: Rounded by default (the M5 renderer), the shape when given', () => {
    expect(openFolderContentBox(box)).toEqual({ widthPx: 302, heightPx: 202 });
    expect(openFolderContentBox(box, 'folder-flat')).toEqual({ widthPx: 302, heightPx: 178 });
  });
});

describe('folderTabRect: where a tab shape draws its tab (§3.2, §3.4)', () => {
  const box = { widthPx: 400, heightPx: 300 };
  it('Rounded (and an unknown shape) has no tab', () => {
    expect(folderTabRect('rounded', 'left', box)).toBeNull();
    expect(folderTabRect('folder-tab', 'left', box)).toBeNull();
  });
  it('a tab is the tab allowance high, at the top of the box', () => {
    const r = folderTabRect('folder-flat', 'left', box, 100)!;
    expect(r).toMatchObject({ topPx: 0, heightPx: FOLDER_CHROME.tabPx, widthPx: 100 });
  });
  it('left, centre and right place it on that side; unknown is left', () => {
    const at = (pos: TabPosition | string) => folderTabRect('simple-tab', pos, box, 100)!.leftPx;
    expect(at('left')).toBe(TAB_EDGE_PX);
    expect(at('centre')).toBe(150);
    expect(at('right')).toBe(400 - 100 - TAB_EDGE_PX);
    expect(at('nope')).toBe(TAB_EDGE_PX);
  });
  it('the tab grows with its name up to a maximum, and an untitled tab is the small minimum (§3.4)', () => {
    expect(folderTabRect('folder-paper', 'left', box)!.widthPx).toBe(TAB_MIN_PX);
    expect(folderTabRect('folder-paper', 'left', box, 5)!.widthPx).toBe(TAB_MIN_PX);
    expect(folderTabRect('folder-paper', 'left', { widthPx: 2000, heightPx: 300 }, 5000)!.widthPx).toBe(TAB_MAX_PX);
    // Never wider than most of the box, so the tab reads as a tab.
    expect(folderTabRect('folder-paper', 'left', box, 5000)!.widthPx).toBeLessThanOrEqual(0.6 * box.widthPx);
  });
  it('a narrow box: the tab always fits inside the box', () => {
    for (const pos of TAB_POSITIONS) {
      const r = folderTabRect('folder-cartoon', pos, { widthPx: 64, heightPx: 160 }, 500)!;
      expect(r.leftPx).toBeGreaterThanOrEqual(0);
      expect(r.leftPx + r.widthPx).toBeLessThanOrEqual(64);
      expect(r.widthPx).toBeGreaterThan(0);
    }
  });
});
