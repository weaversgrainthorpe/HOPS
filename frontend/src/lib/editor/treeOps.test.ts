import { describe, it, expect } from 'vitest';
// M5 form throughout: tabs are 24-column grids of placed items; folder contents are ordered lists
// with no placements (the ordered operations themselves are in treeOps.m5.test.ts).
import {
  TreeOpError, newNodeId, locate, isDescendant, moveNodes, copyNodes, mergeIntoNewFolder, insertNode,
  updateNode, deleteNodes, duplicateNode, resizeNode, setZ, reorderTabs, addTab, updateTab, deleteTab,
  firstFreeCell, pushAside, assertGridNoOverlap, setFolderDisplay, duplicateTab
} from './treeOps';
import type { Container, FolderNode, LayoutDashboard, LayoutNode, Placement } from '../types/layout';

const p = (x: number, y: number, w = 1, h = 1, z?: number): Placement => (z === undefined ? { x, y, w, h } : { x, y, w, h, z });
/** A Medium tile's span on the finer grid (spec §9: 24 columns, Medium 2 x 2). */
const M = (x: number, y: number): Placement => p(x, y, 2, 2);
/** A tile (Medium unless `size`); `pl` only on a tab. */
const tile = (id: string, pl?: Placement, size?: string): LayoutNode =>
  ({ kind: 'tile', id, name: id, url: 'http://x', ...(size ? { size } : {}), ...(pl ? { placement: pl } : {}) }) as unknown as LayoutNode;
const folder = (id: string, pl: Placement | undefined, children: LayoutNode[] = [], over: Partial<FolderNode> = {}): FolderNode => ({
  kind: 'folder', id, name: id, display: 'expanded', size: 'medium', contentSize: 'medium',
  ...(pl ? { placement: pl } : {}), content: { children }, ...over
});
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o as object).forEach(deepFreeze);
  }
  return o;
}
/** 24 columns, Medium tiles 2 x 2; f1 holds [x, f2 [y]] in order. */
function dash(): LayoutDashboard {
  return deepFreeze({
    id: 'd', name: 'D', path: '/d', revision: 1,
    tabs: [
      {
        id: 't1', name: 'One',
        root: {
          columns: 24,
          children: [
            tile('a', M(0, 0)), tile('b', M(6, 0)), tile('c', M(12, 4)),
            folder('f1', p(0, 6, 8, 6), [tile('x'), folder('f2', undefined, [tile('y')])])
          ]
        }
      },
      { id: 't2', name: 'Two', root: { columns: 24, children: [tile('z', M(10, 10))] } }
    ]
  } as LayoutDashboard);
}
const rootOf = (d: LayoutDashboard, t = 't1'): LayoutNode[] => d.tabs.find((x) => x.id === t)!.root.children;
const byId = (kids: LayoutNode[], id: string) => kids.find((k) => k.id === id)!;
function allNodeIds(d: LayoutDashboard): string[] {
  const out: string[] = [];
  const walk = (cs: LayoutNode[]) => cs.forEach((n) => { out.push(n.id); if (n.kind === 'folder') walk(n.content.children); });
  d.tabs.forEach((t) => walk(t.root.children));
  return out;
}

describe('ids and lookup', () => {
  it('newNodeId is prefixed and unique', () => {
    const a = newNodeId('tile'), b = newNodeId('tile');
    expect(a).toMatch(/^tile-./);
    expect(newNodeId('folder')).toMatch(/^folder-/);
    expect(newNodeId('tab')).toMatch(/^tab-/);
    expect(a).not.toBe(b);
  });
  it('locate finds nested nodes', () => {
    const d = dash();
    expect(locate(d, 'y')).toEqual({ tabId: 't1', folderChain: ['f1', 'f2'], index: 0 });
    expect(locate(d, 'z')).toEqual({ tabId: 't2', folderChain: [], index: 0 });
    expect(locate(d, 'nope')).toBeUndefined();
  });
  it('isDescendant', () => {
    const d = dash();
    expect(isDescendant(d, 'f1', 'y')).toBe(true);
    expect(isDescendant(d, 'f2', 'x')).toBe(false);
    expect(isDescendant(d, 'f1', 'f1')).toBe(false);
  });
});

describe('moveNodes', () => {
  it('moves within a tab, other placements untouched (gaps persist)', () => {
    const d = dash();
    const r = moveNodes(d, ['a'], { tabId: 't1' }, [M(18, 18)]);
    expect(byId(rootOf(r), 'a').placement).toEqual(M(18, 18));
    expect(byId(rootOf(r), 'b').placement).toEqual(M(6, 0));
    expect(byId(rootOf(r), 'c').placement).toEqual(M(12, 4));
    expect(rootOf(r).filter((n) => n.id === 'a')).toHaveLength(1);
  });
  it('moves across tabs and into folders, keeping others', () => {
    const d = dash();
    const r = moveNodes(d, ['a', 'b'], { tabId: 't2' }, [M(0, 0), M(2, 0)]);
    expect(rootOf(r, 't2').map((n) => n.id).sort()).toEqual(['a', 'b', 'z']);
    expect(byId(rootOf(r, 't2'), 'z').placement).toEqual(M(10, 10));
    expect(byId(rootOf(r), 'c').placement).toEqual(M(12, 4));
    const r2 = moveNodes(d, ['c'], { tabId: 't1', folderId: 'f2' }, []);
    expect(locate(r2, 'c')).toEqual({ tabId: 't1', folderChain: ['f1', 'f2'], index: 1 });
    expect('placement' in (r2.tabs[0].root.children.find((n) => n.id === 'f1') as FolderNode).content.children[1]).toBe(false);
  });
  it('rejects a folder into itself or its descendant', () => {
    const d = dash();
    expect(() => moveNodes(d, ['f1'], { tabId: 't1', folderId: 'f1' }, [p(0, 0)])).toThrow(TreeOpError);
    expect(() => moveNodes(d, ['f1'], { tabId: 't1', folderId: 'f2' }, [p(0, 0)])).toThrow(TreeOpError);
  });
  it('rejects placing outside the grid, fractional cells, unknown ids, mismatched lengths', () => {
    const d = dash();
    expect(() => moveNodes(d, ['a'], { tabId: 't1' }, [p(23, 0, 2, 2)])).toThrow(TreeOpError);
    expect(() => moveNodes(d, ['a'], { tabId: 't1' }, [p(-1, 0)])).toThrow(TreeOpError);
    expect(() => moveNodes(d, ['a'], { tabId: 't1' }, [p(18.5, 18)])).toThrow(TreeOpError);
    expect(() => moveNodes(d, ['nope'], { tabId: 't1' }, [p(0, 0)])).toThrow(TreeOpError);
    expect(() => moveNodes(d, ['a'], { tabId: 'zz' }, [p(0, 0)])).toThrow(TreeOpError);
    expect(() => moveNodes(d, ['a', 'b'], { tabId: 't1' }, [p(0, 0)])).toThrow(TreeOpError);
  });
});

describe('copyNodes / duplicateNode', () => {
  it('deep-copies with ids unique document-wide (same folder twice)', () => {
    const d = dash();
    const all = new Set(allNodeIds(d));
    const r1 = copyNodes(d, ['f1'], { tabId: 't2' }, [p(0, 0, 8, 6)], all);
    const r2 = copyNodes(r1.dashboard, ['f1'], { tabId: 't2' }, [p(8, 0, 8, 6)], all);
    const ids = allNodeIds(r2.dashboard);
    expect(new Set(ids).size).toBe(ids.length);
    const added = ids.filter((i) => !all.has(i));
    expect(added).toHaveLength(8); // (f1,x,f2,y) twice
    expect(r1.newIds).toHaveLength(1);
    expect(all.has(r1.newIds[0])).toBe(false);
    // copy is deep: same shape
    const copy = byId(rootOf(r2.dashboard, 't2'), r1.newIds[0]) as FolderNode;
    expect(copy.content.children).toHaveLength(2);
    expect(copy.placement).toEqual(p(0, 0, 8, 6));
  });
  it('avoids ids already in allIds even if generator collides', () => {
    const d = dash();
    const r = copyNodes(d, ['a', 'b'], { tabId: 't2' }, [M(0, 0), M(2, 0)], new Set(allNodeIds(d)));
    expect(new Set(r.newIds).size).toBe(2);
  });
  it('duplicateNode places the copy at the first free cell of the same container', () => {
    const d = dash();
    const r = duplicateNode(d, 'a', new Set(allNodeIds(d)));
    const copy = byId(rootOf(r.dashboard), r.newId);
    expect(copy.placement).toEqual(M(2, 0));
    expect(copy.kind).toBe('tile');
    const r2 = duplicateNode(d, 'y', new Set(allNodeIds(d)));
    expect(locate(r2.dashboard, r2.newId)).toEqual({ tabId: 't1', folderChain: ['f1', 'f2'], index: 1 });
  });
});

describe('mergeIntoNewFolder', () => {
  it('builds a minimised Medium folder at the target: [target, ...dragged] in order, no placements', () => {
    const d = dash();
    const r = mergeIntoNewFolder(d, ['b', 'a'], 'c', new Set(allNodeIds(d)));
    const f = byId(rootOf(r.dashboard), r.folderId) as FolderNode;
    expect(f).toMatchObject({ kind: 'folder', name: 'New folder', display: 'collapsed', size: 'medium', contentSize: 'medium', shape: 'folder-flat', showTitle: true });
    expect(f.placement).toEqual({ x: 12, y: 4, w: 6, h: 4 }); // the default open box of a Medium folder
    expect(f.content.children.map((c) => c.id)).toEqual(['c', 'b', 'a']);
    expect(f.content.children.every((c) => !('placement' in c))).toBe(true);
    expect('columns' in f.content).toBe(false);
    expect(locate(r.dashboard, 'a')!.folderChain).toEqual([r.folderId]);
    expect(rootOf(r.dashboard).some((n) => n.id === 'c')).toBe(false);
    expect(byId(rootOf(r.dashboard), 'f1').placement).toEqual(p(0, 6, 8, 6));
  });
  it('any number of members: the same box (the folder pages its contents, M5)', () => {
    const d = dash();
    const r = mergeIntoNewFolder(d, ['a', 'b', 'x', 'z', 'y'], 'c', new Set(allNodeIds(d)));
    const f = byId(rootOf(r.dashboard), r.folderId) as FolderNode;
    expect(f.placement).toMatchObject({ w: 6, h: 4 });
    expect(f.content.children.map((n) => n.id)).toEqual(['c', 'a', 'b', 'x', 'z', 'y']);
  });
  it('rejects bad input', () => {
    const d = dash();
    const ALL = new Set(allNodeIds(d));
    expect(() => mergeIntoNewFolder(d, ['c'], 'c', ALL)).toThrow(TreeOpError);
    expect(() => mergeIntoNewFolder(d, ['a'], 'f1', ALL)).toThrow(TreeOpError);
    expect(() => mergeIntoNewFolder(d, ['f1'], 'y', ALL)).toThrow(TreeOpError);
    expect(() => mergeIntoNewFolder(d, ['nope'], 'c', ALL)).toThrow(TreeOpError);
  });
  it('each member keeps its own size inside (it shows the contents size, M5 §2)', () => {
    const d = deepFreeze({
      id: 'd', name: 'D', path: '/d', revision: 1,
      tabs: [{ id: 't', name: 'T', root: { columns: 24, children: [tile('a', p(10, 10, 4, 4), 'large'), tile('b', p(0, 0, 1, 1), 'small')] } }]
    } as LayoutDashboard);
    const r = mergeIntoNewFolder(d, ['b'], 'a', new Set(['a', 'b']));
    const f = r.dashboard.tabs[0].root.children.find((n) => n.id === r.folderId) as FolderNode;
    expect(f.placement).toEqual({ x: 10, y: 10, w: 6, h: 4 });
    expect(f.content.children.map((c) => (c as { size?: string }).size)).toEqual(['large', 'small']);
  });
});

describe('merge safety', () => {
  const ids = (d: LayoutDashboard) => new Set(allNodeIds(d));
  it('rejects a dragged folder together with its own descendant', () => {
    const d = dash();
    expect(() => mergeIntoNewFolder(d, ['f1', 'y'], 'c', ids(d))).toThrow(TreeOpError);
    expect(() => mergeIntoNewFolder(d, ['y', 'f1'], 'c', ids(d))).toThrow(TreeOpError);
  });
  it('keeps the folder inside the grid at the right edge', () => {
    const d = deepFreeze({
      id: 'd', name: 'D', path: '/d', revision: 1,
      tabs: [{ id: 't', name: 'T', root: { columns: 24, children: [tile('a', M(22, 0)), tile('b', M(0, 0)), tile('c', M(0, 10)), tile('n', p(18, 0, 4, 4))] } }]
    } as LayoutDashboard);
    const r = mergeIntoNewFolder(d, ['b', 'c'], 'a', ids(d));
    const root = r.dashboard.tabs[0].root;
    const f = root.children.find((x) => x.id === r.folderId)!;
    expect(f.placement).toEqual({ x: 18, y: 0, w: 6, h: 4 });
    const n = root.children.find((x) => x.id === 'n')!;
    expect(n.placement!.x === 18 && n.placement!.y === 0).toBe(false); // pushed off the footprint
    expect(() => assertGridNoOverlap(root)).not.toThrow();
  });
  it('new folder id avoids allIds', () => {
    const d = dash();
    const r = mergeIntoNewFolder(d, ['a'], 'c', ids(d));
    expect(ids(d).has(r.folderId)).toBe(false);
  });
});

describe('grid overlap contract', () => {
  const ids = (d: LayoutDashboard) => new Set(allNodeIds(d));
  const root = (d: LayoutDashboard) => d.tabs[0].root;
  it('moveNodes refuses an overlap without push, succeeds with pushAside', () => {
    const d = dash();
    expect(() => moveNodes(d, ['c'], { tabId: 't1' }, [M(6, 0)])).toThrow('That space is taken');
    const push = pushAside(root(d), new Set(['c']), M(6, 0));
    const r = moveNodes(d, ['c'], { tabId: 't1' }, [M(6, 0)], push);
    expect(byId(rootOf(r), 'c').placement).toEqual(M(6, 0));
    expect(byId(rootOf(r), 'b').placement).not.toEqual(M(6, 0));
    expect(() => assertGridNoOverlap(r.tabs[0].root)).not.toThrow();
  });
  it('copyNodes refuses an overlap without push, succeeds with it', () => {
    const d = dash();
    expect(() => copyNodes(d, ['c'], { tabId: 't1' }, [M(0, 0)], ids(d))).toThrow('That space is taken');
    const push = pushAside(root(d), new Set(), M(0, 0));
    const r = copyNodes(d, ['c'], { tabId: 't1' }, [M(0, 0)], ids(d), push);
    expect(() => assertGridNoOverlap(r.dashboard.tabs[0].root)).not.toThrow();
  });
  it('insertNode refuses an overlap without push, succeeds with it', () => {
    const d = dash();
    expect(() => insertNode(d, tile('n', M(0, 0)), { tabId: 't1' }, M(0, 0))).toThrow('That space is taken');
    const push = pushAside(root(d), new Set(), M(0, 0));
    const r = insertNode(d, tile('n', M(0, 0)), { tabId: 't1' }, M(0, 0), push);
    expect(() => assertGridNoOverlap(r.tabs[0].root)).not.toThrow();
  });
  it('resizeNode into a neighbour is refused without push', () => {
    const d = moveNodes(dash(), ['c'], { tabId: 't1' }, [M(10, 6)]); // c beside f1
    expect(() => resizeNode(d, 'f1', 14, 6)).toThrow('That space is taken');
    const push = pushAside(root(d), new Set(['f1']), p(0, 6, 14, 6));
    const r = resizeNode(d, 'f1', 14, 6, push);
    expect(byId(rootOf(r), 'f1').placement).toEqual(p(0, 6, 14, 6));
    expect(() => assertGridNoOverlap(r.tabs[0].root)).not.toThrow();
  });
});

describe('insert/update/delete', () => {
  it('insertNode adds with the given placement on a tab, at an index in a folder; ids must be new', () => {
    const d = dash();
    const r = insertNode(d, tile('n', M(0, 0)), { tabId: 't1' }, M(16, 16));
    expect(byId(rootOf(r), 'n').placement).toEqual(M(16, 16));
    const r2 = insertNode(d, tile('n'), { tabId: 't1', folderId: 'f1' }, 1);
    expect(locate(r2, 'n')).toEqual({ tabId: 't1', folderChain: ['f1'], index: 1 });
    expect(() => insertNode(d, tile('a', M(0, 0)), { tabId: 't1' }, M(0, 0))).toThrow(TreeOpError);
    const nested = folder('nf', M(0, 0), [tile('z')]); // z exists in another tab
    expect(() => insertNode(d, nested, { tabId: 't1' }, p(16, 16, 4, 4))).toThrow(TreeOpError);
    const dup = folder('nf2', M(0, 0), [tile('q'), tile('q')]);
    expect(() => insertNode(d, dup, { tabId: 't1' }, p(16, 16, 4, 4))).toThrow(TreeOpError);
  });
  it('updateNode patches and refuses id/kind changes', () => {
    const d = dash();
    for (const bad of [{ id: 'y' }, { kind: 'tile' }, { placement: p(0, 0) }, { content: { children: [] } }]) {
      expect(() => updateNode(d, 'y', bad as unknown as Partial<LayoutNode>)).toThrow(TreeOpError);
    }
    const r = updateNode(d, 'y', { name: 'renamed' } as Partial<LayoutNode>);
    const y = byId(((byId((byId(rootOf(r), 'f1') as FolderNode).content.children, 'f2')) as FolderNode).content.children, 'y');
    expect(y.name).toBe('renamed');
    expect(() => updateNode(d, 'y', { id: 'q' } as Partial<LayoutNode>)).toThrow(TreeOpError);
    expect(() => updateNode(d, 'nope', {})).toThrow(TreeOpError);
  });
  it('deleteNodes removes without shifting others', () => {
    const d = dash();
    const r = deleteNodes(d, ['a', 'y']);
    expect(locate(r, 'a')).toBeUndefined();
    expect(locate(r, 'y')).toBeUndefined();
    expect(byId(rootOf(r), 'b').placement).toEqual(M(6, 0));
    expect(() => deleteNodes(d, ['nope'])).toThrow(TreeOpError);
  });
});

describe('resizeNode', () => {
  it('a tile is never resized: its Size sets its span', () => {
    expect(() => resizeNode(dash(), 'a', 6, 4)).toThrow(/Size/);
  });
  it('a folder clamps to the columns and never shrinks below its bar, padding, one item and the page bar', () => {
    const d = dash();
    const r = resizeNode(d, 'f1', 8, 1);
    expect(byId(rootOf(r), 'f1').placement).toMatchObject({ w: 8, h: 4 }); // geometry.minOpenFolderCells (Medium, with the M6 tab allowance, at the §13 reference cell)
    expect(byId(rootOf(resizeNode(d, 'f1', 1, 8)), 'f1').placement).toMatchObject({ w: 3, h: 8 }); // a Medium + padding
    const r2 = resizeNode(d, 'f1', 10, 12);
    expect(byId(rootOf(r2), 'f1').placement).toMatchObject({ w: 10, h: 12 });
    const r3 = resizeNode(d, 'f1', 99, 6);
    expect(byId(rootOf(r3), 'f1').placement).toMatchObject({ x: 0, w: 24 });
  });
  it('throws for an unknown id and for an item inside a folder', () => {
    expect(() => resizeNode(dash(), 'nope', 1, 1)).toThrow(TreeOpError);
    expect(() => resizeNode(dash(), 'f2', 4, 4)).toThrow(TreeOpError);
  });
});

describe('setZ', () => {
  it('forward goes above siblings, back below', () => {
    const d = dash();
    const f = setZ(d, 'a', 'forward');
    expect(byId(rootOf(f), 'a').placement!.z).toBe(1);
    const f2 = setZ(f, 'b', 'forward');
    expect(byId(rootOf(f2), 'b').placement!.z).toBe(2);
    expect(setZ(f2, 'b', 'forward')).toEqual(f2);
    const b = setZ(d, 'c', 'back');
    expect(byId(rootOf(b), 'c').placement!.z).toBe(-1);
    expect(() => setZ(d, 'nope', 'back')).toThrow(TreeOpError);
    expect(() => setZ(d, 'x', 'back')).toThrow(TreeOpError); // inside a folder: an order, no stacking
  });

  const zDash = (zs: Record<string, number>): LayoutDashboard =>
    deepFreeze({
      id: 'd', name: 'D', path: '/d', revision: 1,
      tabs: [{ id: 't1', name: 'One', root: { columns: 24, children: Object.entries(zs).map(([id, z], i) => tile(id, p(2 * i, 0, 2, 2, z))) } }]
    } as LayoutDashboard);
  const zOf = (d: LayoutDashboard, id: string) => byId(rootOf(d), id).placement!.z!;

  it('reads stored z clamped to ±1000 (an out-of-range z does not block forward / back)', () => {
    const d = zDash({ a: 0, b: 5000 });
    const f = setZ(d, 'a', 'forward');
    expect(zOf(f, 'a')).toBeGreaterThan(Math.min(1000, zOf(f, 'b')));
    expect(zOf(f, 'a')).toBeLessThanOrEqual(1000);
  });

  it('at the +1000 limit with a tie, siblings are renumbered (stacking kept) so forward really moves past', () => {
    const d = zDash({ a: 1000, b: 1000, c: 3 });
    const f = setZ(d, 'a', 'forward'); // a ties b at the limit, below it in DOM order
    expect(f).not.toBe(d);
    expect(zOf(f, 'a')).toBeGreaterThan(zOf(f, 'b'));
    expect(zOf(f, 'b')).toBeGreaterThan(zOf(f, 'c')); // the others keep their stacking
    expect(zOf(f, 'a')).toBeLessThanOrEqual(1000);
  });

  it('at the -1000 limit with a tie, back renumbers and moves below', () => {
    const d = zDash({ a: -1000, b: -1000, c: 7 });
    const f = setZ(d, 'b', 'back');
    expect(f).not.toBe(d);
    expect(zOf(f, 'b')).toBeLessThan(zOf(f, 'a'));
    expect(zOf(f, 'a')).toBeLessThan(zOf(f, 'c'));
    expect(zOf(f, 'b')).toBeGreaterThanOrEqual(-1000);
  });
});

describe('tabs', () => {
  it('reorderTabs / addTab / updateTab / deleteTab', () => {
    const d = dash();
    expect(reorderTabs(d, ['t2', 't1']).tabs.map((t) => t.id)).toEqual(['t2', 't1']);
    expect(() => reorderTabs(d, ['t2'])).toThrow(TreeOpError);
    expect(() => reorderTabs(d, ['t2', 't2'])).toThrow(TreeOpError);
    const a = addTab(d, ' Three ');
    expect(a.dashboard.tabs).toHaveLength(3);
    const nt = a.dashboard.tabs[2];
    expect(nt).toMatchObject({ id: a.tabId, name: 'Three', root: { columns: 24, children: [] } });
    expect(() => addTab(d, '  ')).toThrow(TreeOpError);
    expect(updateTab(d, 't1', { name: 'X' }).tabs[0]).toMatchObject({ name: 'X' });
    expect(() => updateTab(d, 't1', { id: 'q' })).toThrow(TreeOpError);
    expect(deleteTab(d, 't1').tabs.map((t) => t.id)).toEqual(['t2']);
    expect(() => deleteTab(deleteTab(d, 't1'), 't2')).toThrow(TreeOpError);
    expect(() => deleteTab(d, 'zz')).toThrow(TreeOpError);
  });
});

describe('firstFreeCell', () => {
  const c = (kids: LayoutNode[], columns = 4): Container => ({ columns, children: kids });
  it('row-major first fit', () => {
    expect(firstFreeCell(c([]), 2, 1)).toEqual(p(0, 0, 2, 1));
    expect(firstFreeCell(c([tile('a', p(0, 0, 3, 1))]), 2, 1)).toEqual(p(0, 1, 2, 1));
    expect(firstFreeCell(c([tile('a', p(0, 0)), tile('b', p(2, 0))]), 2, 1)).toEqual(p(0, 1, 2, 1));
    expect(firstFreeCell(c([tile('a', p(0, 0))]), 1, 1)).toEqual(p(1, 0));
    expect(firstFreeCell(c([]), 9, 1)).toEqual(p(0, 0, 4, 1));
  });
  it('items without a placement (never on a tab) take no cells', () => {
    expect(firstFreeCell(c([tile('a')]), 1, 1)).toEqual(p(0, 0));
  });
});

describe('pushAside', () => {
  const c = (kids: LayoutNode[], columns = 6): Container => ({ columns, children: kids });
  const overlap = (a: Placement, b: Placement) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  it('moves nothing when the target is free', () => {
    const cont = c([tile('a', p(0, 0)), tile('b', p(3, 3))]);
    expect(pushAside(cont, new Set(), p(1, 1)).size).toBe(0);
  });
  it('ignores the moving nodes themselves', () => {
    const cont = c([tile('a', p(0, 0)), tile('b', p(1, 0))]);
    expect(pushAside(cont, new Set(['a']), p(0, 0)).size).toBe(0);
  });
  it('displaces overlapped nodes without overlap', () => {
    const kids = [tile('a', p(0, 0, 2, 2)), tile('b', p(2, 0)), tile('c', p(0, 2)), tile('d', p(3, 0, 1, 2))];
    const target = p(0, 0, 3, 2);
    const moved = pushAside(c(kids), new Set(['m']), target);
    const final = kids.map((k) => moved.get(k.id) ?? k.placement!);
    expect(moved.has('c')).toBe(false);
    expect(moved.has('d')).toBe(false);
    expect(moved.has('a')).toBe(true);
    expect(moved.has('b')).toBe(true);
    for (let i = 0; i < final.length; i++) {
      expect(overlap(final[i], target) && moved.has(kids[i].id)).toBe(false);
      for (let j = i + 1; j < final.length; j++) expect(overlap(final[i], final[j])).toBe(false);
    }
    moved.forEach((pl, id) => {
      const orig = kids.find((k) => k.id === id)!.placement!;
      expect(pl.w).toBe(orig.w);
      expect(pl.h).toBe(orig.h);
      expect(pl.x + pl.w).toBeLessThanOrEqual(6);
    });
  });
});

describe('pushAside on a full grid', () => {
  it('never overlaps when displaced nodes outnumber free cells', () => {
    const kidsN = [0, 1, 2, 3, 4].map((i) => tile('n' + i, p(0, i)));
    const cont: Container = { columns: 1, children: kidsN };
    const m = pushAside(cont, new Set(), p(0, 0, 1, 5));
    expect(m.size).toBe(5);
    const all = [...m.values(), p(0, 0, 1, 5)];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
      }
    }
  });
});

describe('purity', () => {
  it('does not mutate frozen inputs', () => {
    const d = dash();
    const all = new Set(allNodeIds(d));
    const before = JSON.stringify(d);
    moveNodes(d, ['a'], { tabId: 't2' }, [M(0, 0)]);
    copyNodes(d, ['f1'], { tabId: 't2' }, [p(0, 0, 8, 6)], all);
    mergeIntoNewFolder(d, ['a'], 'c', all);
    insertNode(d, tile('n', M(0, 0)), { tabId: 't1' }, M(2, 2));
    updateNode(d, 'a', { name: 'q' } as Partial<LayoutNode>);
    deleteNodes(d, ['f1']);
    duplicateNode(d, 'f1', all);
    resizeNode(d, 'f1', 6, 8);
    setZ(d, 'a', 'forward');
    reorderTabs(d, ['t2', 't1']);
    addTab(d, 'n');
    updateTab(d, 't1', { name: 'n' });
    deleteTab(d, 't2');
    pushAside(d.tabs[0].root, new Set(), p(0, 0, 3, 3));
    expect(JSON.stringify(d)).toBe(before);
    expect(all.size).toBe(allNodeIds(d).length);
  });
});

// ---------------------------------------------------------------- M3 Task 6 additions

describe('setFolderDisplay', () => {
  it("sets a folder's saved display and leaves everything else alone", () => {
    const d = dash();
    const out = setFolderDisplay(d, 'f2', 'collapsed');
    const f1 = rootOf(out).find((n) => n.id === 'f1') as FolderNode;
    const f2 = f1.content.children.find((n) => n.id === 'f2') as FolderNode;
    expect(f2.display).toBe('collapsed');
    expect('placement' in f2).toBe(false);
    expect(rootOf(out).find((n) => n.id === 'a')).toBe(rootOf(d).find((n) => n.id === 'a'));
  });
  it('returns the same dashboard when nothing changes (no undo step)', () => {
    const d = dash();
    expect(setFolderDisplay(d, 'f1', 'expanded')).toBe(d);
  });
  it('refuses tiles, unknown ids and bad values', () => {
    const d = dash();
    expect(() => setFolderDisplay(d, 'a', 'collapsed')).toThrow(TreeOpError);
    expect(() => setFolderDisplay(d, 'nope', 'collapsed')).toThrow(TreeOpError);
    expect(() => setFolderDisplay(d, 'f1', 'maximised' as never)).toThrow(TreeOpError);
  });
});

describe('duplicateTab', () => {
  it('appends a deep copy with new ids for the tab and every node, named "(Copy)"', () => {
    const d = dash();
    const all = new Set(allNodeIds(d));
    const { dashboard, tabId } = duplicateTab(d, 't1', all);
    expect(dashboard.tabs).toHaveLength(3);
    const copy = dashboard.tabs[2];
    expect(copy.id).toBe(tabId);
    expect(copy.name).toBe('One (Copy)');
    const ids = (c: LayoutNode[]): string[] =>
      c.flatMap((n) => [n.id, ...(n.kind === 'folder' ? ids(n.content.children) : [])]);
    const copied = ids(copy.root.children);
    expect(copied).toHaveLength(ids(rootOf(d)).length);
    for (const id of copied) expect(all.has(id)).toBe(false);
    expect(new Set(copied).size).toBe(copied.length);
    expect(d.tabs).toHaveLength(2);
  });
  it('refuses an unknown tab', () => {
    expect(() => duplicateTab(dash(), 'nope', new Set())).toThrow(TreeOpError);
  });
});
