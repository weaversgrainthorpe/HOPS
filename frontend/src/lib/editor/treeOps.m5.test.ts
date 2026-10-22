// M5 ordered folder operations: folder contents are an ordered list with no placements; only the
// tab level is placed (24 columns, tiles at their Size's span).
import { describe, it, expect } from 'vitest';
import {
  TreeOpError, insertIntoFolder, reorderInFolder, moveBetween, moveNodes, copyNodes, mergeIntoNewFolder,
  duplicateNode, pasteSnapshot, insertNode, resolveContainer, resizedPlacement, firstFreeCell, fitFolderMinimum
} from './treeOps';
import * as treeOps from './treeOps';
import type { FolderNode, LayoutDashboard, LayoutNode, Placement } from '../types/layout';

const p = (x: number, y: number, w = 2, h = 2): Placement => ({ x, y, w, h });
/** A tile; `pl` only at the tab level (folder children have none). */
const tile = (id: string, pl?: Placement, size: 'small' | 'medium' | 'large' = 'medium'): LayoutNode =>
  ({ kind: 'tile', id, name: id, url: 'http://x', size, ...(pl ? { placement: pl } : {}) }) as unknown as LayoutNode;
const folder = (id: string, children: LayoutNode[], pl?: Placement, over: Partial<FolderNode> = {}): FolderNode =>
  ({
    kind: 'folder', id, name: id, display: 'expanded', size: 'medium', contentSize: 'medium',
    ...(pl ? { placement: pl } : {}), content: { children }, ...over
  }) as FolderNode;

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o as object).forEach(deepFreeze);
  }
  return o;
}

/** t1: a (Medium), L (Large), f1 [x, y, f2 [z]]; t2: b. */
function dash(): LayoutDashboard {
  return deepFreeze({
    id: 'd', name: 'D', path: '/d', revision: 1,
    tabs: [
      { id: 't1', name: 'One', root: { columns: 24, children: [
        tile('a', p(0, 0)), tile('L', p(6, 0, 4, 4), 'large'),
        folder('f1', [tile('x'), tile('y'), folder('f2', [tile('z')])], p(0, 6, 8, 6))
      ] } },
      { id: 't2', name: 'Two', root: { columns: 24, children: [tile('b', p(0, 0))] } }
    ]
  } as LayoutDashboard);
}
const ALL = new Set(['d', 't1', 't2', 'a', 'L', 'f1', 'x', 'y', 'f2', 'z', 'b']);
const root = (d: LayoutDashboard, t = 't1') => d.tabs.find((x) => x.id === t)!.root.children;
function folderIn(d: LayoutDashboard, id: string): FolderNode {
  const walk = (c: LayoutNode[]): FolderNode | undefined => {
    for (const n of c) {
      if (n.kind !== 'folder') continue;
      if (n.id === id) return n;
      const r = walk(n.content.children);
      if (r) return r;
    }
    return undefined;
  };
  for (const t of d.tabs) {
    const f = walk(t.root.children);
    if (f) return f;
  }
  throw new Error('no folder ' + id);
}
const order = (d: LayoutDashboard, id: string) => folderIn(d, id).content.children.map((n) => n.id);
const node = (list: LayoutNode[], id: string) => list.find((n) => n.id === id)!;

describe('the removed free-mode code', () => {
  it('has no conversion path any more', () => {
    for (const gone of ['convertNode', 'adaptNode', 'originOf', 'freeSide', 'setTabLayout', 'setFolderLayout']) {
      expect((treeOps as Record<string, unknown>)[gone]).toBeUndefined();
    }
  });
});

describe('insertIntoFolder', () => {
  it('inserts a new node at an index, with no placement', () => {
    const d = insertIntoFolder(dash(), 'f1', tile('n', p(3, 3)), 1);
    expect(order(d, 'f1')).toEqual(['x', 'n', 'y', 'f2']);
    expect('placement' in node(folderIn(d, 'f1').content.children, 'n')).toBe(false);
  });
  it('an index past the end appends; a negative one inserts first', () => {
    expect(order(insertIntoFolder(dash(), 'f1', tile('n'), 99), 'f1')).toEqual(['x', 'y', 'f2', 'n']);
    expect(order(insertIntoFolder(dash(), 'f1', tile('n'), -1), 'f1')).toEqual(['n', 'x', 'y', 'f2']);
  });
  it('works at depth', () => {
    expect(order(insertIntoFolder(dash(), 'f2', tile('n'), 0), 'f2')).toEqual(['n', 'z']);
  });
  it('refuses a bad index, a used id, a tile as the folder and an unknown folder', () => {
    expect(() => insertIntoFolder(dash(), 'f1', tile('n'), NaN)).toThrow(TreeOpError);
    expect(() => insertIntoFolder(dash(), 'f1', tile('n'), 1.5)).toThrow(TreeOpError);
    expect(() => insertIntoFolder(dash(), 'f1', tile('a'), 0)).toThrow(/already exists/);
    expect(() => insertIntoFolder(dash(), 'a', tile('n'), 0)).toThrow(TreeOpError);
    expect(() => insertIntoFolder(dash(), 'nope', tile('n'), 0)).toThrow(/no longer exists/);
  });
});

describe('reorderInFolder', () => {
  it('moves a child to a new index in the same folder', () => {
    expect(order(reorderInFolder(dash(), 'f1', 'x', 2), 'f1')).toEqual(['y', 'f2', 'x']);
    expect(order(reorderInFolder(dash(), 'f1', 'f2', 0), 'f1')).toEqual(['f2', 'x', 'y']);
  });
  it('the same index changes nothing (the same dashboard: no undo step)', () => {
    const d = dash();
    expect(reorderInFolder(d, 'f1', 'y', 1)).toBe(d);
  });
  it('refuses a node that is not a direct child', () => {
    expect(() => reorderInFolder(dash(), 'f1', 'z', 0)).toThrow(TreeOpError);
    expect(() => reorderInFolder(dash(), 'f1', 'a', 0)).toThrow(TreeOpError);
  });
});

describe('moveBetween', () => {
  it('tab → folder at an index: the placement is removed, the own size kept', () => {
    const d = moveBetween(dash(), ['L'], { tabId: 't1', folderId: 'f1' }, 1);
    expect(order(d, 'f1')).toEqual(['x', 'L', 'y', 'f2']);
    const L = node(folderIn(d, 'f1').content.children, 'L');
    expect('placement' in L).toBe(false);
    expect((L as { size?: string }).size).toBe('large');
    expect(root(d).map((n) => n.id)).toEqual(['a', 'f1']);
  });
  it('folder → tab: placed where asked; a tile takes its Size\'s span', () => {
    const d = moveBetween(dash(), ['x'], { tabId: 't1' }, [p(12, 0, 2, 2)]);
    expect(node(root(d), 'x').placement).toEqual(p(12, 0, 2, 2));
    expect(order(d, 'f1')).toEqual(['y', 'f2']);
    // A Large tile asked into a 4 x 4 goes in at 4 x 4.
    const inF = moveBetween(dash(), ['L'], { tabId: 't1', folderId: 'f1' }, 0);
    const d2 = moveBetween(inF, ['L'], { tabId: 't2' }, [p(10, 10, 4, 4)]);
    expect(node(root(d2, 't2'), 'L').placement).toEqual(p(10, 10, 4, 4));
  });
  it('a tile asked onto a tab at a footprint other than its Size\'s span is REFUSED (never silently resized)', () => {
    const inF = moveBetween(dash(), ['L'], { tabId: 't1', folderId: 'f1' }, 0);
    expect(() => moveBetween(inF, ['L'], { tabId: 't2' }, [p(10, 10, 2, 2)])).toThrow(TreeOpError);
    expect(() => moveBetween(inF, ['L'], { tabId: 't2' }, [p(10, 10, 2, 2)])).toThrow(/Large.*4 x 4|4 x 4/);
  });
  it('a folder leaving a folder for the tab arrives minimised, at the box it is given', () => {
    const d = moveBetween(dash(), ['f2'], { tabId: 't1' }, [p(12, 0, 6, 4)]);
    const f2 = node(root(d), 'f2') as FolderNode;
    expect(f2.display).toBe('collapsed');
    expect(f2.placement).toEqual(p(12, 0, 6, 4));
    expect(f2.content.children.map((n) => n.id)).toEqual(['z']);
  });
  it('folder → folder at an index', () => {
    const d = moveBetween(dash(), ['y'], { tabId: 't1', folderId: 'f2' }, 0);
    expect(order(d, 'f2')).toEqual(['y', 'z']);
    expect(order(d, 'f1')).toEqual(['x', 'f2']);
  });
  it('several items keep their selection order at the index', () => {
    const d = moveBetween(dash(), ['a', 'L'], { tabId: 't1', folderId: 'f2' }, 1);
    expect(order(d, 'f2')).toEqual(['z', 'a', 'L']);
  });
  it('within one folder: the index is among the items that stay', () => {
    expect(order(moveBetween(dash(), ['x'], { tabId: 't1', folderId: 'f1' }, 2), 'f1')).toEqual(['y', 'f2', 'x']);
  });
  it('refuses a folder into itself or a descendant, and an item with its own folder', () => {
    expect(() => moveBetween(dash(), ['f1'], { tabId: 't1', folderId: 'f1' }, 0)).toThrow(/into itself/);
    expect(() => moveBetween(dash(), ['f1'], { tabId: 't1', folderId: 'f2' }, 0)).toThrow(/into itself/);
    expect(() => moveBetween(dash(), ['f1', 'x'], { tabId: 't2' }, [p(0, 4), p(2, 4)])).toThrow(/folder that contains it/);
  });
  it('refuses a tab overlap without a push', () => {
    expect(() => moveBetween(dash(), ['x'], { tabId: 't1' }, [p(0, 0)])).toThrow(/space is taken/);
  });
  it('a tab target needs a placement per item, never an index', () => {
    expect(() => moveBetween(dash(), ['x'], { tabId: 't1' }, [])).toThrow(TreeOpError);
    expect(() => moveBetween(dash(), ['x'], { tabId: 't1' }, 0)).toThrow(TreeOpError);
  });
  it('moveNodes into a folder appends in order (the folder is ordered)', () => {
    expect(order(moveNodes(dash(), ['a'], { tabId: 't1', folderId: 'f1' }, []), 'f1')).toEqual(['x', 'y', 'f2', 'a']);
  });
});

describe('copy, paste and duplicate inside folders', () => {
  it('copyNodes into a folder at an index: fresh ids, no placement', () => {
    const r = copyNodes(dash(), ['a'], { tabId: 't1', folderId: 'f1' }, 0, ALL);
    const kids = folderIn(r.dashboard, 'f1').content.children;
    expect(kids[0].id).toBe(r.newIds[0]);
    expect(r.newIds[0]).not.toBe('a');
    expect('placement' in kids[0]).toBe(false);
    expect(root(r.dashboard).map((n) => n.id)).toContain('a');
  });
  it('duplicate inside a folder goes right after the source', () => {
    const r = duplicateNode(dash(), 'x', ALL);
    expect(order(r.dashboard, 'f1')).toEqual(['x', r.newId, 'y', 'f2']);
  });
  it('duplicate on the tab takes the first free cell at the span of its size', () => {
    const r = duplicateNode(dash(), 'L', ALL);
    const copy = node(root(r.dashboard), r.newId);
    expect({ w: copy.placement!.w, h: copy.placement!.h }).toEqual({ w: 4, h: 4 });
  });
  it('pasteSnapshot into a folder at an index', () => {
    const snap = [structuredClone(node(root(dash()), 'L'))];
    const r = pasteSnapshot(dash(), snap, { tabId: 't1', folderId: 'f1' }, 1, ALL);
    expect(order(r.dashboard, 'f1')).toEqual(['x', r.newIds[0], 'y', 'f2']);
    expect('placement' in node(folderIn(r.dashboard, 'f1').content.children, r.newIds[0])).toBe(false);
  });
  it('insertNode into a folder at an index', () => {
    expect(order(insertNode(dash(), tile('n'), { tabId: 't1', folderId: 'f1' }, 0), 'f1')).toEqual(['n', 'x', 'y', 'f2']);
  });
});

describe('mergeIntoNewFolder', () => {
  it('on the tab: a Medium folder with Medium contents [target, dragged] at the target\'s position', () => {
    const r = mergeIntoNewFolder(dash(), ['L'], 'a', ALL);
    const f = node(root(r.dashboard), r.folderId) as FolderNode;
    expect(f).toMatchObject({ kind: 'folder', size: 'medium', contentSize: 'medium', display: 'collapsed' });
    expect(f.content).toEqual({ children: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'L' })] });
    expect(f.content.children.every((c) => !('placement' in c))).toBe(true);
    expect('layout' in f).toBe(false);
    // The open box: size cells x 3 wide by x 2 high, at the target's top-left.
    expect(f.placement).toEqual(p(0, 0, 6, 4));
  });
  it('inside a folder: the new folder takes the target\'s place in the order', () => {
    const r = mergeIntoNewFolder(dash(), ['y'], 'x', ALL);
    const kids = folderIn(r.dashboard, 'f1').content.children;
    expect(kids.map((n) => n.id)).toEqual([r.folderId, 'f2']);
    const f = kids[0] as FolderNode;
    expect('placement' in f).toBe(false);
    expect(f.content.children.map((n) => n.id)).toEqual(['x', 'y']);
  });
  it('refuses merging a folder into its own descendant', () => {
    expect(() => mergeIntoNewFolder(dash(), ['f1'], 'z', ALL)).toThrow(/into itself/);
  });
});

describe('tab-level helpers', () => {
  it('resolveContainer says whether a container is a tab or a folder', () => {
    expect(resolveContainer(dash(), { tabId: 't1' }).kind).toBe('tab');
    expect(resolveContainer(dash(), { tabId: 't1', folderId: 'f2' }).kind).toBe('folder');
  });
  it('only items on the tab resize', () => {
    expect(() => resizedPlacement(dash(), 'x', 4, 4)).toThrow(TreeOpError);
  });
  it('a folder is no longer grown to fit its contents: it resizes down to bar + padding + one item + page bar', () => {
    // Medium contents (geometry.minOpenFolderCells): 2 cells + the 18 px padding wide (3), and the
    // 40 px bar, 18 px padding, 32 px page bar and 2 cells high (5), at the narrowest grid cell.
    expect(resizedPlacement(dash(), 'f1', 1, 1)).toEqual(p(0, 6, 3, 5));
  });
  it('firstFreeCell is grid only', () => {
    expect(firstFreeCell({ columns: 24, children: [tile('a', p(0, 0))] }, 2, 2)).toEqual(p(2, 0));
  });
});

// Fix round 1: the minimum is the folder's LARGEST contents size (its own or any sub-folder's), and a
// folder whose contents size went up grows to that minimum, pushing its neighbours (M3 rules).
describe('the minimum at the largest contents size', () => {
  /** t1: f1 (Small contents, at its Small minimum 2 x 4) holding sub-folder f2 (contents `inner`), tile `below` under it. */
  function small(inner: 'small' | 'large', columns = 24): LayoutDashboard {
    return deepFreeze({
      id: 'd', name: 'D', path: '/d', revision: 1,
      tabs: [{ id: 't1', name: 'One', root: { columns, children: [
        folder('f1', [tile('x'), folder('f2', [tile('z')], undefined, { contentSize: inner })], p(0, 0, 2, 4), { contentSize: 'small' }),
        tile('below', p(0, 4))
      ] } }]
    } as LayoutDashboard);
  }
  const at = (d: LayoutDashboard, id: string) => (d.tabs[0].root.children.find((n) => n.id === id) as LayoutNode).placement;

  it('resizing stops at the largest contents size inside (a Large-contents sub-folder: 5 x 7)', () => {
    expect(resizedPlacement(small('large'), 'f1', 1, 1)).toEqual(p(0, 0, 5, 7));
    expect(resizedPlacement(small('small'), 'f1', 1, 1)).toEqual(p(0, 0, 2, 4));
  });

  it('fitFolderMinimum grows a box below its minimum and pushes the neighbours aside; a box that fits is untouched', () => {
    const d = small('large');
    const r = fitFolderMinimum(d, 'f2'); // any folder inside: its tab-level folder is fitted
    expect(at(r, 'f1')).toEqual(p(0, 0, 5, 7));
    const b = at(r, 'below')!; // pushed (M3 rules: the nearest free spot), clear of the grown box
    expect(b).not.toEqual(p(0, 4));
    expect(b.x >= 5 || b.y >= 7).toBe(true);
    const ok = small('small');
    expect(fitFolderMinimum(ok, 'f1')).toBe(ok);
  });

  it('no room across the tab: refused with a reason, nothing changed', () => {
    const d = small('large', 4);
    expect(() => fitFolderMinimum(d, 'f1')).toThrow(TreeOpError);
    expect(() => fitFolderMinimum(d, 'f1')).toThrow(/room/);
  });
});
