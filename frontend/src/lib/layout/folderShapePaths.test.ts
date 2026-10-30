// The static SVG geometry of each folder shape.
// FolderShape.svelte draws exactly these parts; the content inset (shapeInset) must sit on the body.
import { describe, it, expect } from 'vitest';
import { FOLDER_CHROME, FOLDER_SHAPES, TAB_POSITIONS, folderTabRect, shapeInset } from './geometry';
import { shapeParts, miniTabPx, tabWantPx, MINI_NAME_FLOOR_PX, type ShapeState } from './folderShapePaths';
import type { FolderShape } from '$lib/types/layout';

const TAB_SHAPES = FOLDER_SHAPES.filter((s) => s !== 'rounded') as FolderShape[];
const STATES: ShapeState[] = ['minimised', 'open', 'nested'];
const BOXES = { minimised: { widthPx: 120, heightPx: 120 }, open: { widthPx: 640, heightPx: 360 }, nested: { widthPx: 500, heightPx: 220 } };
const NUM_PATH = /^[MLQZHV0-9.\-\s,]+$/;

describe('shapeParts: every shape, every state, every tab position', () => {
  it('Rounded draws no SVG parts (it is the plain box) and has no tab', () => {
    for (const st of STATES) {
      const p = shapeParts('rounded', 'left', st, BOXES[st]);
      expect(p.shape).toBe('rounded');
      expect(p.tab).toBeNull();
      expect(p.silhouette).toBe('');
    }
  });
  it('an unknown shape draws as Rounded (never a guess at another look)', () => {
    expect(shapeParts('folder-tab', 'left', 'open', BOXES.open).shape).toBe('rounded');
    expect(shapeParts('<svg onload=x>', 'left', 'open', BOXES.open).shape).toBe('rounded');
  });
  for (const shape of TAB_SHAPES) {
    for (const st of STATES) {
      for (const pos of TAB_POSITIONS) {
        it(`${shape} ${st} ${pos}: a numeric silhouette, a tab on top inside the box, a body below it`, () => {
          const box = BOXES[st];
          const p = shapeParts(shape, pos, st, box);
          expect(p.shape).toBe(shape);
          expect(p.silhouette).toMatch(NUM_PATH);
          expect(p.silhouette).not.toMatch(/NaN|Infinity/);
          for (const d of [p.back, p.front]) if (d) expect(d).toMatch(NUM_PATH);
          const t = p.tab!;
          expect(t.topPx).toBe(0);
          expect(t.leftPx).toBeGreaterThanOrEqual(0);
          expect(t.leftPx + t.widthPx).toBeLessThanOrEqual(box.widthPx + 0.001);
          expect(p.frontRect.topPx).toBeGreaterThanOrEqual(t.heightPx);
          expect(p.frontRect.topPx + p.frontRect.heightPx).toBeLessThanOrEqual(box.heightPx + 0.001);
          // The tab is on its side.
          const mid = t.leftPx + t.widthPx / 2;
          if (pos === 'left') expect(mid).toBeLessThan(box.widthPx / 2);
          if (pos === 'right') expect(mid).toBeGreaterThan(box.widthPx / 2);
          if (pos === 'centre') expect(Math.abs(mid - box.widthPx / 2)).toBeLessThan(1);
        });
      }
    }
  }
  it('open and nested tabs are folderTabRect (the label and the drawn tab line up), the tab allowance high', () => {
    for (const shape of TAB_SHAPES) {
      for (const pos of TAB_POSITIONS) {
        const p = shapeParts(shape, pos, 'open', BOXES.open, 120);
        expect(p.tab).toEqual(folderTabRect(shape, pos, BOXES.open, 120));
        expect(p.tab!.heightPx).toBe(FOLDER_CHROME.tabPx);
      }
    }
  });
  it('a minimised tab scales with the tile (a compact version of the shape)', () => {
    expect(miniTabPx(120)).toBeGreaterThan(miniTabPx(60));
    expect(miniTabPx(60)).toBeGreaterThanOrEqual(6);
    expect(miniTabPx(400)).toBeLessThanOrEqual(FOLDER_CHROME.tabPx);
    expect(shapeParts('folder-flat', 'left', 'minimised', { widthPx: 120, heightPx: 120 }).tab!.heightPx).toBe(miniTabPx(120));
  });
  it('the paper peeks out on the tab side', () => {
    const left = shapeParts('folder-paper', 'left', 'open', BOXES.open).paper!;
    const right = shapeParts('folder-paper', 'right', 'open', BOXES.open).paper!;
    expect(left.leftPx + left.widthPx / 2).toBeLessThan(BOXES.open.widthPx / 2);
    expect(right.leftPx + right.widthPx / 2).toBeGreaterThan(BOXES.open.widthPx / 2);
    expect(shapeParts('folder-open', 'left', 'open', BOXES.open).paper).toBeTruthy();
    expect(shapeParts('folder-flat', 'left', 'open', BOXES.open).paper).toBeFalsy();
  });
  it('only Paper uses the one gradient; Outlined is see-through; Cartoon has a dark outline', () => {
    for (const s of TAB_SHAPES) expect(shapeParts(s, 'left', 'open', BOXES.open).gradient).toBe(s === 'folder-paper');
    expect(shapeParts('folder-outline', 'left', 'open', BOXES.open).fill).toBe(false);
    expect(shapeParts('folder-cartoon', 'left', 'open', BOXES.open).stroke).toBe('dark');
  });
});

describe('the content inset sits on the body (decoration on a rectangle)', () => {
  for (const shape of TAB_SHAPES) {
    for (const st of ['open', 'nested'] as const) {
      it(`${shape} ${st}: every tile row is below the tab and on the front panel`, () => {
        const box = BOXES[st];
        const p = shapeParts(shape, 'left', st, box);
        const inset = shapeInset(shape, 'left', box);
        expect(inset.topPx).toBeGreaterThanOrEqual(p.tab!.heightPx);
        expect(inset.topPx).toBeGreaterThanOrEqual(p.frontRect.topPx);
        expect(inset.topPx + inset.heightPx).toBeLessThanOrEqual(p.frontRect.topPx + p.frontRect.heightPx);
        // Open flap: tiles sit in the upright part — inside the flap at its narrowest (the bottom).
        expect(inset.leftPx).toBeGreaterThanOrEqual(p.frontInsetPx);
        expect(inset.leftPx + inset.widthPx).toBeLessThanOrEqual(box.widthPx - p.frontInsetPx);
      });
    }
  }
});

describe('tab label width', () => {
  it('grows with the name, and an untitled tab asks for nothing (TAB_MIN_PX)', () => {
    expect(tabWantPx('Media', false)).toBeLessThan(tabWantPx('Media servers and friends', false));
    expect(tabWantPx('Media', true)).toBeGreaterThan(tabWantPx('Media', false));
    expect(tabWantPx('', false)).toBe(0);
  });
  it('the minimised name floor is 12 px', () => {
    expect(MINI_NAME_FLOOR_PX).toBe(12);
  });
});
