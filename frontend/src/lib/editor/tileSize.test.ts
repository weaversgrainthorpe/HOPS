// A tile's Small/Medium/Large: on a tab it sets the space the tile takes (Small 1 x 1,
// Medium 2 x 2, Large 4 x 4 of the 24-column grid); inside a folder the tile shows the folder's
// contents size, and its own size is kept for when it goes back to a tab. There is no "Custom".
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  displaySize, tileSizeOf, sizeTarget, newTileSizeProblem, editNode, addNode, blankTile, moveOrCopyTo, documentIds
} from './editorActions';
import { assertGridNoOverlap, mergeIntoNewFolder, moveBetween } from './treeOps';
import { tabSpan } from '$lib/layout/geometry';
import { session, undo } from '$lib/stores/editSession';
import { toast } from '$lib/stores/toast';
import { setLayout, resetEditor, startSession, draft, nodeIn, p, tile, folder, home } from '$lib/components/editor/editorTestKit';
import type { FolderNode, LayoutDashboard, TileNode } from '$lib/types/layout';

beforeEach(() => {
  resetEditor();
  setLayout();
  startSession();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network'))));
});

/** d1 with t1's root replaced (24 columns). */
function withRoot(children: ReturnType<typeof tile>[]): void {
  const d: LayoutDashboard = home();
  d.tabs[0].root = { columns: 24, children };
  setLayout([d]);
  resetEditor();
  startSession();
}
const asNode = (f: FolderNode) => f as unknown as ReturnType<typeof tile>;

describe('the dialog shows the tile\'s own size', () => {
  it('Small, Medium or Large; never Custom', () => {
    expect(tileSizeOf(tile('t', p(0, 0, 4, 4), { size: 'medium' }) as TileNode)).toBe('medium');
    expect(tileSizeOf(tile('t', p(0, 0), { size: 'large' }) as TileNode)).toBe('large');
    expect(tileSizeOf(tile('t', undefined, { size: undefined }) as TileNode)).toBe('medium');
  });
});

describe('sizeTarget (push, right-edge shift; inside a folder nothing moves)', () => {
  it('Large pushes the overlapped neighbours aside (the push-aside), never overlapping', () => {
    const t = sizeTarget(draft(), 'a', 'large');
    expect(t.kind).toBe('size');
    if (t.kind !== 'size') return;
    expect(t.at).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    expect(t.push.has('b')).toBe(true);
    expect(t.push.has('f1')).toBe(true);
  });

  it('at the right edge the tile shifts left to fit', () => {
    withRoot([tile('e', p(22, 0))]);
    const t = sizeTarget(draft(), 'e', 'large');
    expect(t).toMatchObject({ kind: 'size', at: { x: 20, y: 0, w: 4, h: 4 } });
  });

  it('inside a folder any size is fine and nothing is placed (the folder pages its contents)', () => {
    withRoot([asNode(folder('n', p(0, 0, 2, 6), [tile('k')]))]);
    expect(sizeTarget(draft(), 'k', 'large')).toEqual({ kind: 'size', id: 'k', push: new Map() });
    expect(newTileSizeProblem(draft(), { tabId: 't1', folderId: 'n' }, 'large')).toBeNull();
    expect(newTileSizeProblem(draft(), { tabId: 't1' }, 'large')).toBeNull();
  });
});

describe('editNode with a picked size: one undo step', () => {
  it('a refused size changes nothing and says why (never silent)', () => {
    // A 2-column tab has no room for a Large (4 x 4) tile.
    const d: LayoutDashboard = home();
    d.tabs[0].root = { columns: 2, children: [tile('a', p(0, 0))] };
    setLayout([d]);
    resetEditor();
    startSession();
    const err = vi.spyOn(toast, 'error');
    const before = draft();
    expect(editNode('a', { name: 'Big' } as Partial<TileNode>, { size: 'large' })).toBe(false);
    expect(draft()).toEqual(before);
    expect(get(session)!.undo).toHaveLength(0);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/room for a large tile.*2 columns/));
  });

  it('Save with Large: the fields, the 4 x 4 span and the push are ONE undo step; Undo restores all', () => {
    const before = draft();
    expect(editNode('a', { name: 'Big', size: 'large' } as Partial<TileNode>, { size: 'large' })).toBe(true);
    const a = nodeIn(draft(), 'a') as TileNode;
    expect(a).toMatchObject({ name: 'Big', size: 'large', placement: { x: 0, y: 0, w: 4, h: 4 } });
    expect(nodeIn(draft(), 'b')!.placement).not.toEqual(p(2, 0));
    expect(() => assertGridNoOverlap(draft().tabs[0].root)).not.toThrow();
    expect(get(session)!.undo).toHaveLength(1);
    expect(get(session)!.lastLabel).toBe('Edit tile');
    undo();
    expect(draft()).toEqual(before);
  });

  it('a save without a picked size never changes the span', () => {
    withRoot([tile('l', p(0, 0, 4, 4), { size: 'large' }), tile('m', p(4, 0))]);
    expect(editNode('l', { name: 'Renamed' } as Partial<TileNode>)).toBe(true);
    expect(nodeIn(draft(), 'l')!.placement).toEqual(p(0, 0, 4, 4));
  });

  it('Medium on a 4 x 4 tile shrinks it to 2 x 2; Small to 1 x 1', () => {
    withRoot([tile('l', p(6, 0, 4, 4), { size: 'large' })]);
    expect(editNode('l', { size: 'medium' } as Partial<TileNode>, { size: 'medium' })).toBe(true);
    expect(nodeIn(draft(), 'l')!.placement).toEqual(p(6, 0));
    expect(editNode('l', { size: 'small' } as Partial<TileNode>, { size: 'small' })).toBe(true);
    expect(nodeIn(draft(), 'l')!.placement).toEqual(p(6, 0, 1, 1));
  });

  it('inside a folder: the own size changes, nothing is placed, the folder is untouched', () => {
    withRoot([asNode(folder('n', p(0, 0, 8, 6), [tile('k'), tile('j')]))]);
    const folderBefore = (nodeIn(draft(), 'n') as FolderNode).placement;
    expect(editNode('k', { size: 'large' } as Partial<TileNode>, { size: 'large' })).toBe(true);
    const k = nodeIn(draft(), 'k') as TileNode;
    expect(k.size).toBe('large');
    expect('placement' in k).toBe(false);
    expect((nodeIn(draft(), 'n') as FolderNode).placement).toEqual(folderBefore);
    expect(displaySize(k, nodeIn(draft(), 'n') as FolderNode)).toBe('medium');
  });
});

describe('a tile keeps its own size everywhere', () => {
  it('a new Large tile takes 4 x 4 cells on a tab', () => {
    const id = addNode({ ...blankTile(), name: 'N', url: 'https://n.test', size: 'large' }, { tabId: 't1' }, { x: 18, y: 0 });
    expect(nodeIn(draft(), id!)!.placement).toEqual({ x: 18, y: 0, w: 4, h: 4 });
  });

  it('a Large tile moved into a Small-contents folder shows Small; back on the tab it is 4 x 4 again', () => {
    withRoot([tile('big', p(12, 0, 4, 4), { size: 'large' }), asNode(folder('f', p(0, 0, 8, 8), [tile('k')], { contentSize: 'small' }))]);
    expect(moveOrCopyTo(['big'], { tabId: 't1', folderId: 'f' }, 'move')).toBe(true);
    const big = nodeIn(draft(), 'big') as TileNode;
    expect(big.size).toBe('large');
    expect('placement' in big).toBe(false);
    expect(displaySize(big, nodeIn(draft(), 'f') as FolderNode)).toBe('small');
    // Back on the tab its footprint is its own Size's span (tabSpan), the same as every caller asks.
    const back = moveBetween(draft(), ['big'], { tabId: 't1' }, [{ x: 12, y: 0, ...tabSpan(big) }]);
    expect(nodeIn(back, 'big')!.placement).toEqual(p(12, 0, 4, 4));
  });

  it('merging keeps each member\'s own size (the folder shows them at its contents size)', () => {
    withRoot([tile('t', p(0, 0)), tile('big', p(6, 0, 4, 4), { size: 'large' }), tile('s', p(12, 0, 1, 1), { size: 'small' })]);
    const r = mergeIntoNewFolder(draft(), ['big', 's'], 't', documentIds());
    const f = nodeIn(r.dashboard, r.folderId) as FolderNode;
    expect(f.content.children.map((c) => (c as TileNode).size)).toEqual(['medium', 'large', 'small']);
    expect(f.content.children.map((c) => displaySize(c, f))).toEqual(['medium', 'medium', 'medium']);
  });
});

// In the Sample dashboard's Services folder: the sizes looked "linked". Each tile's
// size is its own; every item in a folder shows the folder's contents size, and the folder
// never grows to fit its contents (it pages them).
describe("the Services folder: each tile's size is its own", () => {
  function services(): void {
    withRoot([
      asNode(folder('svc', p(0, 0, 24, 4), [tile('google'), tile('github'), tile('youtube')])),
      tile('below', p(0, 4))
    ]);
  }
  const sizes = () => ['google', 'github', 'youtube'].map((id) => `${id}:${(nodeIn(draft(), id) as TileNode).size}`);

  it('Google Large, YouTube Medium, GitHub Small: only the edited tile changes each time', () => {
    services();
    const edit = (id: string, size: TileNode['size']) =>
      expect(editNode(id, { ...(nodeIn(draft(), id) as TileNode), size } as Partial<TileNode>, { size })).toBe(true);
    edit('google', 'large');
    expect(sizes()).toEqual(['google:large', 'github:medium', 'youtube:medium']);
    edit('youtube', 'medium');
    expect(sizes()).toEqual(['google:large', 'github:medium', 'youtube:medium']);
    edit('github', 'small');
    expect(sizes()).toEqual(['google:large', 'github:small', 'youtube:medium']);
    // No two tiles share an object (a shared object would change them together).
    const [g, h, y] = ['google', 'github', 'youtube'].map((id) => nodeIn(draft(), id)!);
    expect(new Set([g, h, y]).size).toBe(3);
  });

  it('a Large inside the folder neither grows the folder nor moves its neighbour', () => {
    services();
    expect(editNode('google', { size: 'large' } as Partial<TileNode>, { size: 'large' })).toBe(true);
    expect((nodeIn(draft(), 'svc') as FolderNode).placement).toEqual(p(0, 0, 24, 4));
    expect(nodeIn(draft(), 'below')!.placement).toEqual(p(0, 4));
    expect(get(session)!.undo).toHaveLength(1);
  });

  it('a move into a folder never grows it (moveOrCopyTo)', () => {
    withRoot([
      asNode(folder('svc', p(0, 0, 24, 4), [tile('google')])),
      tile('big', p(0, 4, 4, 4), { size: 'large' }),
      tile('next', p(6, 4))
    ]);
    expect(moveOrCopyTo(['big'], { tabId: 't1', folderId: 'svc' }, 'move')).toBe(true);
    expect((nodeIn(draft(), 'svc') as FolderNode).placement).toEqual(p(0, 0, 24, 4));
    expect((nodeIn(draft(), 'svc') as FolderNode).content.children.map((n) => n.id)).toEqual(['google', 'big']);
    expect(nodeIn(draft(), 'next')!.placement).toEqual(p(6, 4));
  });
});
