// Spec §8 (M4 walkthrough changes): a tile's Small/Medium/Large sets the space it takes.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { sizeSpan, sizeShown, sizeTarget, newTileSizeProblem, editNode, addNode, blankTile, sizeFor } from './editorActions';
import { assertGridNoOverlap } from './treeOps';
import { session, undo } from '$lib/stores/editSession';
import { toast } from '$lib/stores/toast';
import { setLayout, resetEditor, startSession, draft, nodeIn, p, tile, folder, home } from '$lib/components/editor/editorTestKit';
import type { LayoutDashboard, TileNode } from '$lib/types/layout';

beforeEach(() => {
  resetEditor();
  setLayout();
  startSession();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network'))));
});

/** d1 with t1's root replaced (a grid tab) and a 1-column folder for refusals. */
function withRoot(children: ReturnType<typeof tile>[]): void {
  const d: LayoutDashboard = home();
  d.tabs[0].root = { columns: 12, children };
  setLayout([d]);
  resetEditor();
  startSession();
}

describe('sizeSpan', () => {
  it('grid: Large is 2 x 2 cells, Medium and Small are 1 x 1', () => {
    expect(sizeSpan('large', 'grid')).toEqual({ w: 2, h: 2 });
    expect(sizeSpan('medium', 'grid')).toEqual({ w: 1, h: 1 });
    expect(sizeSpan('small', 'grid')).toEqual({ w: 1, h: 1 });
    expect(sizeSpan(undefined, 'grid')).toEqual({ w: 1, h: 1 });
  });

  it('free: the free-unit equivalent of 1 x 1 or 2 x 2 cells (one cell = side units)', () => {
    expect(sizeSpan('large', 'free', 13)).toEqual({ w: 26, h: 26 });
    expect(sizeSpan('medium', 'free', 13)).toEqual({ w: 13, h: 13 });
    expect(sizeSpan('small', 'free', 13)).toEqual({ w: 13, h: 13 });
  });
});

describe('sizeShown (the dialog shows the size that matches the span)', () => {
  const t = (size: string, pl = p(0, 0)) => tile('t', pl, { size }) as TileNode;
  it('a 1 x 1 tile shows its stored size (a stored large-at-1x1 is not "Custom")', () => {
    expect(sizeShown(t('small'), 'grid', 13)).toBe('small');
    expect(sizeShown(t('medium'), 'grid', 13)).toBe('medium');
    expect(sizeShown(t('large'), 'grid', 13)).toBe('large');
  });
  it('2 x 2 shows Large; any other span shows Custom', () => {
    expect(sizeShown(t('medium', p(0, 0, 2, 2)), 'grid', 13)).toBe('large');
    expect(sizeShown(t('large', p(0, 0, 3, 1)), 'grid', 13)).toBe('custom');
    expect(sizeShown(t('medium', p(0, 0, 13, 13)), 'free', 13)).toBe('medium');
    expect(sizeShown(t('medium', p(0, 0, 16, 16)), 'free', 13)).toBe('custom');
  });
});

describe('sizeTarget (push, right-edge shift, refusal)', () => {
  it('Large pushes the overlapped neighbours aside (the M3 push), never overlapping', () => {
    const t = sizeTarget(draft(), 'a', 'large');
    expect(t.kind).toBe('size');
    if (t.kind !== 'size') return;
    expect(t.at).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(t.push.has('b')).toBe(true);
    expect(t.push.has('f1')).toBe(true);
  });

  it('at the right edge the tile shifts left to fit', () => {
    withRoot([tile('e', p(11, 0))]);
    const t = sizeTarget(draft(), 'e', 'large');
    expect(t).toMatchObject({ kind: 'size', at: { x: 10, y: 0, w: 2, h: 2 } });
  });

  it('a container too narrow for it refuses, saying why', () => {
    withRoot([folder('n', p(0, 0, 1, 3), [tile('k', p(0, 0))]) as unknown as ReturnType<typeof tile>]);
    const t = sizeTarget(draft(), 'k', 'large');
    expect(t.kind).toBe('invalid');
    if (t.kind === 'invalid') expect(t.reason).toMatch(/only 1 column wide/);
  });

  it('a new tile too large for its container is refused, saying why', () => {
    withRoot([folder('n', p(0, 0, 1, 3), [tile('k', p(0, 0))]) as unknown as ReturnType<typeof tile>]);
    expect(newTileSizeProblem(draft(), { tabId: 't1', folderId: 'n' }, 'large')).toMatch(/only 1 column wide/);
    expect(newTileSizeProblem(draft(), { tabId: 't1', folderId: 'n' }, 'medium')).toBeNull();
  });
});

describe('editNode with a picked size: one undo step', () => {
  it('Save with Large: the fields, the 2 x 2 span and the push are ONE undo step; Undo restores all', () => {
    const before = draft();
    expect(editNode('a', { name: 'Big', size: 'large' } as Partial<TileNode>, { size: 'large' })).toBe(true);
    const a = nodeIn(draft(), 'a') as TileNode;
    expect(a).toMatchObject({ name: 'Big', size: 'large', placement: { x: 0, y: 0, w: 2, h: 2 } });
    expect(nodeIn(draft(), 'b')!.placement).not.toEqual(p(1, 0));
    expect(() => assertGridNoOverlap(draft().tabs[0].root)).not.toThrow();
    expect(get(session)!.undo).toHaveLength(1);
    expect(get(session)!.lastLabel).toBe('Edit tile');
    undo();
    expect(draft()).toEqual(before);
  });

  it('a save without a picked size never changes the span (a stored large-at-1x1 stays 1 x 1)', () => {
    withRoot([tile('l', p(0, 0), { size: 'large' }), tile('m', p(1, 0))]);
    expect(editNode('l', { name: 'Renamed', size: 'large' } as Partial<TileNode>)).toBe(true);
    expect(nodeIn(draft(), 'l')!.placement).toEqual(p(0, 0));
  });

  it('picking Large on a stored large-at-1x1 enlarges it (the next pick)', () => {
    withRoot([tile('l', p(0, 0), { size: 'large' })]);
    expect(editNode('l', { size: 'large' } as Partial<TileNode>, { size: 'large' })).toBe(true);
    expect(nodeIn(draft(), 'l')!.placement).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });

  it('a refused size changes nothing and says why (never silent)', () => {
    withRoot([folder('n', p(0, 0, 1, 3), [tile('k', p(0, 0))]) as unknown as ReturnType<typeof tile>]);
    const err = vi.spyOn(toast, 'error');
    const before = draft();
    expect(editNode('k', { size: 'large' } as Partial<TileNode>, { size: 'large' })).toBe(false);
    expect(draft()).toBe(before);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/only 1 column wide/));
  });

  it('Medium on a 2 x 2 tile shrinks it to 1 x 1', () => {
    withRoot([tile('l', p(3, 0, 2, 2), { size: 'large' })]);
    expect(editNode('l', { size: 'medium' } as Partial<TileNode>, { size: 'medium' })).toBe(true);
    expect(nodeIn(draft(), 'l')!.placement).toEqual(p(3, 0));
  });

  it('free mode: Large sets the free-unit equivalent of 2 x 2 cells', () => {
    expect(editNode('fa', { size: 'large' } as Partial<TileNode>, { size: 'large' })).toBe(true);
    expect(nodeIn(draft(), 'fa')!.placement).toMatchObject({ w: 26, h: 26 });
  });
});

describe('a large tile keeps its span', () => {
  it('a new Large tile takes 2 x 2 cells', () => {
    const id = addNode({ ...blankTile(), name: 'N', url: 'https://n.test', size: 'large' }, { tabId: 't1' }, { x: 9, y: 0 });
    expect(nodeIn(draft(), id!)!.placement).toEqual({ x: 9, y: 0, w: 2, h: 2 });
  });

  it('moving a grid tile keeps its placement span (placement is the truth)', () => {
    expect(sizeFor({ kind: 'tile', placement: p(0, 0, 2, 2) }, 'grid')).toEqual({ w: 2, h: 2 });
  });
});
