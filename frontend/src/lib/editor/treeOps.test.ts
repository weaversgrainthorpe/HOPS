import { describe, it, expect } from 'vitest';
import {
  TreeOpError, newNodeId, locate, isDescendant, moveNodes, copyNodes, mergeIntoNewFolder, insertNode,
  updateNode, deleteNodes, duplicateNode, resizeNode, setZ, reorderTabs, addTab, updateTab, deleteTab,
  firstFreeCell, pushAside, assertGridNoOverlap, setFolderDisplay, duplicateTab, setTabLayout, setFolderLayout, adaptNode, originOf,
  pasteSnapshot
} from './treeOps';
import type { Container, FolderNode, LayoutDashboard, LayoutNode, Placement } from '../types/layout';

const p = (x: number, y: number, w = 1, h = 1, z?: number): Placement => (z === undefined ? { x, y, w, h } : { x, y, w, h, z });
const tile = (id: string, pl: Placement): LayoutNode =>
  ({ kind: 'tile', id, name: id, url: 'http://x', placement: pl }) as unknown as LayoutNode;
const folder = (id: string, pl: Placement, children: LayoutNode[] = [], over: Partial<FolderNode> = {}): FolderNode => ({
  kind: 'folder', id, name: id, display: 'expanded', placement: pl, content: { columns: 4, children }, ...over
});
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o as object).forEach(deepFreeze);
  }
  return o;
}
function dash(): LayoutDashboard {
  return deepFreeze({
    id: 'd', name: 'D', path: '/d', revision: 1,
    tabs: [
      {
        id: 't1', name: 'One',
        root: {
          columns: 12,
          children: [
            tile('a', p(0, 0)), tile('b', p(3, 0)), tile('c', p(6, 2)),
            folder('f1', p(0, 3, 4, 3), [tile('x', p(0, 0)), folder('f2', p(2, 0, 2, 2), [tile('y', p(0, 0))])])
          ]
        }
      },
      { id: 't2', name: 'Two', root: { columns: 12, children: [tile('z', p(5, 5))] } }
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
    const r = moveNodes(d, ['a'], { tabId: 't1' }, [p(9, 9)]);
    expect(byId(rootOf(r), 'a').placement).toEqual(p(9, 9));
    expect(byId(rootOf(r), 'b').placement).toEqual(p(3, 0));
    expect(byId(rootOf(r), 'c').placement).toEqual(p(6, 2));
    expect(rootOf(r).filter((n) => n.id === 'a')).toHaveLength(1);
  });
  it('moves across tabs and into folders, keeping others', () => {
    const d = dash();
    const r = moveNodes(d, ['a', 'b'], { tabId: 't2' }, [p(0, 0), p(1, 0)]);
    expect(rootOf(r, 't2').map((n) => n.id).sort()).toEqual(['a', 'b', 'z']);
    expect(byId(rootOf(r, 't2'), 'z').placement).toEqual(p(5, 5));
    expect(byId(rootOf(r), 'c').placement).toEqual(p(6, 2));
    const r2 = moveNodes(d, ['c'], { tabId: 't1', folderId: 'f2' }, [p(1, 1)]);
    expect(locate(r2, 'c')!.folderChain).toEqual(['f1', 'f2']);
  });
  it('rejects a folder into itself or its descendant', () => {
    const d = dash();
    expect(() => moveNodes(d, ['f1'], { tabId: 't1', folderId: 'f1' }, [p(0, 0)])).toThrow(TreeOpError);
    expect(() => moveNodes(d, ['f1'], { tabId: 't1', folderId: 'f2' }, [p(0, 0)])).toThrow(TreeOpError);
  });
  it('rejects placing outside a grid container, unknown ids, mismatched lengths', () => {
    const d = dash();
    expect(() => moveNodes(d, ['a'], { tabId: 't1' }, [p(11, 0, 2, 1)])).toThrow(TreeOpError);
    expect(() => moveNodes(d, ['a'], { tabId: 't1' }, [p(-1, 0)])).toThrow(TreeOpError);
    expect(() => moveNodes(d, ['a'], { tabId: 't1', folderId: 'f1' }, [p(3, 0, 2, 1)])).toThrow(TreeOpError);
    expect(() => moveNodes(d, ['nope'], { tabId: 't1' }, [p(0, 0)])).toThrow(TreeOpError);
    expect(() => moveNodes(d, ['a'], { tabId: 'zz' }, [p(0, 0)])).toThrow(TreeOpError);
    expect(() => moveNodes(d, ['a', 'b'], { tabId: 't1' }, [p(0, 0)])).toThrow(TreeOpError);
  });
});

describe('copyNodes / duplicateNode', () => {
  it('deep-copies with ids unique document-wide (same folder twice)', () => {
    const d = dash();
    const all = new Set(allNodeIds(d));
    const r1 = copyNodes(d, ['f1'], { tabId: 't2' }, [p(0, 0, 4, 3)], all);
    const r2 = copyNodes(r1.dashboard, ['f1'], { tabId: 't2' }, [p(4, 0, 4, 3)], all);
    const ids = allNodeIds(r2.dashboard);
    expect(new Set(ids).size).toBe(ids.length);
    const added = ids.filter((i) => !all.has(i));
    expect(added).toHaveLength(8); // (f1,x,f2,y) twice
    expect(r1.newIds).toHaveLength(1);
    expect(all.has(r1.newIds[0])).toBe(false);
    // copy is deep: same shape
    const copy = byId(rootOf(r2.dashboard, 't2'), r1.newIds[0]) as FolderNode;
    expect(copy.content.children).toHaveLength(2);
    expect(copy.placement).toEqual(p(0, 0, 4, 3));
  });
  it('avoids ids already in allIds even if generator collides', () => {
    const d = dash();
    const r = copyNodes(d, ['a', 'b'], { tabId: 't2' }, [p(0, 0), p(1, 0)], new Set(allNodeIds(d)));
    expect(new Set(r.newIds).size).toBe(2);
  });
  it('duplicateNode places the copy at the first free cell of the same container', () => {
    const d = dash();
    const r = duplicateNode(d, 'a', new Set(allNodeIds(d)));
    const copy = byId(rootOf(r.dashboard), r.newId);
    expect(copy.placement).toEqual(p(1, 0));
    expect(copy.kind).toBe('tile');
    const r2 = duplicateNode(d, 'y', new Set(allNodeIds(d)));
    expect(locate(r2.dashboard, r2.newId)!.folderChain).toEqual(['f1', 'f2']);
  });
});

describe('mergeIntoNewFolder', () => {
  it('builds the folder at the target with row-major content', () => {
    const d = dash();
    const r = mergeIntoNewFolder(d, ['b', 'a'], 'c', new Set(allNodeIds(d)));
    const f = byId(rootOf(r.dashboard), r.folderId) as FolderNode;
    expect(f).toMatchObject({ kind: 'folder', name: 'New folder', display: 'collapsed', layout: 'inherit', shape: 'rounded', showTitle: true });
    expect(f.placement).toEqual({ x: 6, y: 2, w: 3, h: 2 });
    expect(f.content.columns).toBe(3);
    expect(f.content.children.map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(f.content.children.map((c) => c.placement)).toEqual([p(0, 0), p(1, 0), p(2, 0)]);
    expect(locate(r.dashboard, 'a')!.folderChain).toEqual([r.folderId]);
    expect(rootOf(r.dashboard).some((n) => n.id === 'c')).toBe(false);
    expect(byId(rootOf(r.dashboard), 'f1').placement).toEqual(p(0, 3, 4, 3));
  });
  it('sizes for more than four tiles', () => {
    const d = dash();
    const r = mergeIntoNewFolder(d, ['a', 'b', 'x', 'z', 'y'], 'c', new Set(allNodeIds(d)));
    const f = byId(rootOf(r.dashboard), r.folderId) as FolderNode;
    expect(f.placement).toMatchObject({ w: 4, h: 3 }); // n=6 -> ceil(6/4)+1
    expect(f.content.children[4].placement).toEqual(p(0, 1));
  });
  it('rejects bad input', () => {
    const d = dash();
    const ALL = new Set(allNodeIds(d));
    expect(() => mergeIntoNewFolder(d, ['c'], 'c', ALL)).toThrow(TreeOpError);
    expect(() => mergeIntoNewFolder(d, ['a'], 'f1', ALL)).toThrow(TreeOpError);
    expect(() => mergeIntoNewFolder(d, ['f1'], 'y', ALL)).toThrow(TreeOpError);
    expect(() => mergeIntoNewFolder(d, ['nope'], 'c', ALL)).toThrow(TreeOpError);
  });
  it('in a free parent sizes in 8px units from the target tile size', () => {
    const d = deepFreeze({
      id: 'd', name: 'D', path: '/d', revision: 1, defaultLayout: 'free',
      tabs: [{ id: 't', name: 'T', root: { columns: 160, children: [tile('a', p(10, 10, 12, 10)), tile('b', p(50, 50, 6, 6))] } }]
    } as LayoutDashboard);
    const r = mergeIntoNewFolder(d, ['b'], 'a', new Set(['a', 'b']));
    const f = r.dashboard.tabs[0].root.children.find((n) => n.id === r.folderId) as FolderNode;
    expect(f.placement).toEqual({ x: 10, y: 10, w: 24, h: 18 }); // 2 cols x 12, 1 row x 10 + 8 title/padding
    expect(f.content.columns).toBe(24);
    expect(f.content.children.map((c) => c.placement)).toEqual([p(0, 0, 12, 10), p(12, 0, 12, 10)]);
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
      tabs: [{ id: 't', name: 'T', root: { columns: 12, children: [tile('a', p(11, 0)), tile('b', p(0, 0)), tile('c', p(0, 5)), tile('n', p(9, 0, 2, 2))] } }]
    } as LayoutDashboard);
    const r = mergeIntoNewFolder(d, ['b', 'c'], 'a', ids(d));
    const root = r.dashboard.tabs[0].root;
    const f = root.children.find((x) => x.id === r.folderId)!;
    expect(f.placement).toEqual({ x: 9, y: 0, w: 3, h: 2 });
    const n = root.children.find((x) => x.id === 'n')!;
    expect(n.placement.x === 9 && n.placement.y === 0).toBe(false); // pushed off the footprint
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
    expect(() => moveNodes(d, ['c'], { tabId: 't1' }, [p(3, 0)])).toThrow('That space is taken');
    const push = pushAside(root(d), new Set(['c']), p(3, 0));
    const r = moveNodes(d, ['c'], { tabId: 't1' }, [p(3, 0)], push);
    expect(byId(rootOf(r), 'c').placement).toEqual(p(3, 0));
    expect(byId(rootOf(r), 'b').placement).not.toEqual(p(3, 0));
    expect(() => assertGridNoOverlap(r.tabs[0].root)).not.toThrow();
  });
  it('copyNodes refuses an overlap without push, succeeds with it', () => {
    const d = dash();
    expect(() => copyNodes(d, ['c'], { tabId: 't1' }, [p(0, 0)], ids(d))).toThrow('That space is taken');
    const push = pushAside(root(d), new Set(), p(0, 0));
    const r = copyNodes(d, ['c'], { tabId: 't1' }, [p(0, 0)], ids(d), push);
    expect(() => assertGridNoOverlap(r.dashboard.tabs[0].root)).not.toThrow();
  });
  it('insertNode refuses an overlap without push, succeeds with it', () => {
    const d = dash();
    expect(() => insertNode(d, tile('n', p(0, 0)), { tabId: 't1' }, p(0, 0))).toThrow('That space is taken');
    const push = pushAside(root(d), new Set(), p(0, 0));
    const r = insertNode(d, tile('n', p(0, 0)), { tabId: 't1' }, p(0, 0), push);
    expect(() => assertGridNoOverlap(r.tabs[0].root)).not.toThrow();
  });
  it('resizeNode into a neighbour is refused without push', () => {
    const d = dash();
    expect(() => resizeNode(d, 'a', 4, 1)).toThrow('That space is taken');
    const push = pushAside(root(d), new Set(['a']), p(0, 0, 4, 1));
    const r = resizeNode(d, 'a', 4, 1, push);
    expect(byId(rootOf(r), 'a').placement).toEqual(p(0, 0, 4, 1));
    expect(() => assertGridNoOverlap(r.tabs[0].root)).not.toThrow();
  });
  it('free containers tolerate overlap', () => {
    const fd = deepFreeze({
      id: 'd', name: 'D', path: '/d', revision: 1, defaultLayout: 'free',
      tabs: [{ id: 't', name: 'T', root: { columns: 160, children: [tile('a', p(0, 0, 10, 10)), tile('b', p(20, 0, 10, 10))] } }]
    } as LayoutDashboard);
    expect(() => moveNodes(fd, ['b'], { tabId: 't' }, [p(5, 5, 10, 10)])).not.toThrow();
  });
});

describe('insert/update/delete', () => {
  it('insertNode adds with the given placement', () => {
    const d = dash();
    const r = insertNode(d, tile('n', p(0, 0)), { tabId: 't1', folderId: 'f1' }, p(3, 2));
    expect(locate(r, 'n')!.folderChain).toEqual(['f1']);
    expect((byId((byId(rootOf(r), 'f1') as FolderNode).content.children, 'n')).placement).toEqual(p(3, 2));
    expect(() => insertNode(d, tile('a', p(0, 0)), { tabId: 't1' }, p(0, 0))).toThrow(TreeOpError);
    const nested = folder('nf', p(0, 0), [tile('z', p(0, 0))]); // z exists in another tab
    expect(() => insertNode(d, nested, { tabId: 't1' }, p(8, 8, 2, 2))).toThrow(TreeOpError);
    const dup = folder('nf2', p(0, 0), [tile('q', p(0, 0)), tile('q', p(1, 0))]);
    expect(() => insertNode(d, dup, { tabId: 't1' }, p(8, 8, 2, 2))).toThrow(TreeOpError);
  });
  it('updateNode patches and refuses id/kind changes', () => {
    const d = dash();
    for (const bad of [{ id: 'y' }, { kind: 'tile' }, { placement: p(0, 0) }, { content: { columns: 1, children: [] } }]) {
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
    expect(byId(rootOf(r), 'b').placement).toEqual(p(3, 0));
    expect(() => deleteNodes(d, ['nope'])).toThrow(TreeOpError);
  });
});

describe('resizeNode', () => {
  it('resizes a tile and clamps to the container', () => {
    const d = dash();
    expect(byId(rootOf(resizeNode(d, 'a', 3, 2)), 'a').placement).toEqual(p(0, 0, 3, 2));
    expect(byId(rootOf(resizeNode(d, 'c', 99, 0)), 'c').placement).toEqual(p(6, 2, 6, 1));
  });
  it('never shrinks a folder below its content', () => {
    const d = dash(); // f1 content: f2 at y0 h2 -> 2 rows -> min h 3
    const r = resizeNode(d, 'f1', 4, 1);
    expect(byId(rootOf(r), 'f1').placement).toMatchObject({ w: 4, h: 3 });
    const r2 = resizeNode(d, 'f1', 5, 6);
    expect(byId(rootOf(r2), 'f1').placement).toMatchObject({ w: 5, h: 6 });
  });
  it('throws for unknown id', () => {
    expect(() => resizeNode(dash(), 'nope', 1, 1)).toThrow(TreeOpError);
  });
});

describe('setZ', () => {
  it('forward goes above siblings, back below', () => {
    const d = dash();
    const f = setZ(d, 'a', 'forward');
    expect(byId(rootOf(f), 'a').placement.z).toBe(1);
    const f2 = setZ(f, 'b', 'forward');
    expect(byId(rootOf(f2), 'b').placement.z).toBe(2);
    expect(setZ(f2, 'b', 'forward')).toEqual(f2);
    const b = setZ(d, 'c', 'back');
    expect(byId(rootOf(b), 'c').placement.z).toBe(-1);
    expect(() => setZ(d, 'nope', 'back')).toThrow(TreeOpError);
  });

  const zDash = (zs: Record<string, number>): LayoutDashboard =>
    deepFreeze({
      id: 'd', name: 'D', path: '/d', revision: 1,
      tabs: [{ id: 't1', name: 'One', layout: 'free', root: { columns: 160, children: Object.entries(zs).map(([id, z]) => tile(id, p(0, 0, 8, 8, z))) } }]
    } as LayoutDashboard);
  const zOf = (d: LayoutDashboard, id: string) => byId(rootOf(d), id).placement.z!;

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
    expect(nt).toMatchObject({ id: a.tabId, name: 'Three', root: { columns: 12, children: [] } });
    expect(() => addTab(d, '  ')).toThrow(TreeOpError);
    expect(updateTab(d, 't1', { name: 'X', layout: 'free' }).tabs[0]).toMatchObject({ name: 'X', layout: 'free' });
    expect(() => updateTab(d, 't1', { id: 'q' })).toThrow(TreeOpError);
    expect(deleteTab(d, 't1').tabs.map((t) => t.id)).toEqual(['t2']);
    expect(() => deleteTab(deleteTab(d, 't1'), 't2')).toThrow(TreeOpError);
    expect(() => deleteTab(d, 'zz')).toThrow(TreeOpError);
  });
});

describe('firstFreeCell', () => {
  const c = (kids: LayoutNode[], columns = 4): Container => ({ columns, children: kids });
  it('grid: row-major first fit', () => {
    expect(firstFreeCell(c([]), 2, 1)).toEqual(p(0, 0, 2, 1));
    expect(firstFreeCell(c([tile('a', p(0, 0, 3, 1))]), 2, 1)).toEqual(p(0, 1, 2, 1));
    expect(firstFreeCell(c([tile('a', p(0, 0)), tile('b', p(2, 0))]), 2, 1)).toEqual(p(0, 1, 2, 1));
    expect(firstFreeCell(c([tile('a', p(0, 0))]), 1, 1)).toEqual(p(1, 0));
    expect(firstFreeCell(c([]), 9, 1)).toEqual(p(0, 0, 4, 1));
  });
  it('free: tile-sized steps, non-overlapping', () => {
    const r = firstFreeCell(c([tile('a', p(0, 0, 12, 10))], 40), 12, 10, 'free');
    expect(r).toEqual(p(12, 0, 12, 10));
    const full = firstFreeCell(c([tile('a', p(0, 0, 36, 10))], 36), 12, 10, 'free');
    expect(full).toEqual(p(0, 10, 12, 10));
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
    const final = kids.map((k) => moved.get(k.id) ?? k.placement);
    expect(moved.has('c')).toBe(false);
    expect(moved.has('d')).toBe(false);
    expect(moved.has('a')).toBe(true);
    expect(moved.has('b')).toBe(true);
    for (let i = 0; i < final.length; i++) {
      expect(overlap(final[i], target) && moved.has(kids[i].id)).toBe(false);
      for (let j = i + 1; j < final.length; j++) expect(overlap(final[i], final[j])).toBe(false);
    }
    moved.forEach((pl, id) => {
      const orig = kids.find((k) => k.id === id)!.placement;
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
    moveNodes(d, ['a'], { tabId: 't2' }, [p(0, 0)]);
    copyNodes(d, ['f1'], { tabId: 't2' }, [p(0, 0, 4, 3)], all);
    mergeIntoNewFolder(d, ['a'], 'c', all);
    insertNode(d, tile('n', p(0, 0)), { tabId: 't1' }, p(2, 2));
    updateNode(d, 'a', { name: 'q' } as Partial<LayoutNode>);
    deleteNodes(d, ['f1']);
    duplicateNode(d, 'f1', all);
    resizeNode(d, 'f1', 3, 4);
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
    expect(f2.placement).toEqual(p(2, 0, 2, 2));
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

describe('setTabLayout', () => {
  it('grid → free scales every placement by one column (designWidth / 12 / 8) and converts inheriting folders', () => {
    const d = dash();
    const out = setTabLayout(d, 't1', 'free', 960); // side = 10
    const t = out.tabs[0];
    expect(t.layout).toBe('free');
    expect(t.designWidth).toBe(960);
    expect(t.root.columns).toBe(120);
    expect(rootOf(out).find((n) => n.id === 'b')!.placement).toEqual(p(30, 0, 10, 10));
    const f1 = rootOf(out).find((n) => n.id === 'f1') as FolderNode;
    expect(f1.placement).toEqual(p(0, 30, 40, 30));
    expect(f1.content.columns).toBe(40);
    expect(f1.content.children.find((n) => n.id === 'f2')!.placement).toEqual(p(20, 0, 20, 20));
  });

  it('free → grid divides back, tiles become one cell, collisions go to the first free cell', () => {
    const d: LayoutDashboard = {
      ...dash(),
      tabs: [{ id: 'f', name: 'F', layout: 'free', designWidth: 960, root: { columns: 120, children: [
        tile('a', p(0, 0, 10, 10)), tile('b', p(2, 1, 10, 10)), tile('c', p(115, 0, 10, 10))
      ] } }]
    };
    const out = setTabLayout(d, 'f', 'grid');
    const kids = out.tabs[0].root.children;
    expect(out.tabs[0].root.columns).toBe(12);
    expect(kids.map((n) => n.placement)).toEqual([p(0, 0), p(1, 0), p(11, 0)]);
    expect(() => assertGridNoOverlap(out.tabs[0].root)).not.toThrow();
  });

  it('same mode: a new design width only updates the free root columns; unchanged → same object', () => {
    const d: LayoutDashboard = { ...dash(), tabs: [{ id: 'f', name: 'F', layout: 'free', designWidth: 1280, root: { columns: 160, children: [] } }] };
    expect(setTabLayout(d, 'f', 'free', 1280)).toBe(d);
    const out = setTabLayout(d, 'f', 'free', 1600);
    expect(out.tabs[0].designWidth).toBe(1600);
    expect(out.tabs[0].root.columns).toBe(200);
  });

  it('refuses a bad layout or design width', () => {
    expect(() => setTabLayout(dash(), 't1', 'free', 50)).toThrow(TreeOpError);
    expect(() => setTabLayout(dash(), 't1', 'wavy' as never)).toThrow(TreeOpError);
  });
});

// ---------------------------------------------------------------- M3 Task 6 fix round 1: one mode-conversion path

function mixed(): LayoutDashboard {
  // t1 grid; tf free (designWidth 960 → side 10). gf: a 4 x 3 grid folder with an inheriting grid sub-folder.
  return deepFreeze({
    id: 'd', name: 'D', path: '/d', revision: 1,
    tabs: [
      { id: 't1', name: 'Grid', root: { columns: 12, children: [
        tile('a', p(0, 0)),
        folder('gf', p(0, 1, 4, 3), [tile('g1', p(0, 0)), folder('gs', p(1, 0, 2, 2), [tile('g2', p(0, 0))], { content: { columns: 2, children: [tile('g2', p(0, 0))] } })]),
        tile('b', p(5, 1))
      ] } },
      { id: 'tf', name: 'Free', layout: 'free', designWidth: 960, root: { columns: 120, children: [
        tile('fa', p(0, 0, 10, 10)),
        folder('ff', p(20, 0, 40, 30), [tile('f1x', p(0, 0, 10, 10)), tile('f2x', p(12, 0, 10, 10))], { content: { columns: 40, children: [tile('f1x', p(0, 0, 10, 10)), tile('f2x', p(12, 0, 10, 10))] } })
      ] } }
    ]
  } as LayoutDashboard);
}
const findDeep = (d: LayoutDashboard, id: string): LayoutNode => {
  const walk = (c: LayoutNode[]): LayoutNode | undefined => {
    for (const n of c) {
      if (n.id === id) return n;
      if (n.kind === 'folder') { const r = walk(n.content.children); if (r) return r; }
    }
    return undefined;
  };
  for (const t of d.tabs) { const r = walk(t.root.children); if (r) return r; }
  throw new Error('missing ' + id);
};

describe('cross-mode move / copy / paste (one conversion path)', () => {
  it('a grid folder moved into a free tab is scaled by one column (side) with its inheriting content', () => {
    const d = mixed();
    const at = adaptNode(d, findDeep(d, 'gf'), originOf(d, 'gf'), { tabId: 'tf' }).placement;
    expect(at).toMatchObject({ w: 40, h: 30 });
    const out = moveNodes(d, ['gf'], { tabId: 'tf' }, [{ ...at, x: 0, y: 40 }]);
    const gf = findDeep(out, 'gf') as FolderNode;
    expect(gf.placement).toEqual(p(0, 40, 40, 30));
    expect(gf.content.columns).toBe(40);
    expect(findDeep(out, 'g1').placement).toEqual(p(0, 0, 10, 10));
    const gs = findDeep(out, 'gs') as FolderNode;
    expect(gs.placement).toEqual(p(10, 0, 20, 20));
    expect(gs.content.columns).toBe(20); // from its ORIGINAL 2 columns, scaled once
    expect(findDeep(out, 'g2').placement).toEqual(p(0, 0, 10, 10));
  });

  it('a free folder copied into a grid tab is divided back, tiles one cell, content without overlaps', () => {
    const d = mixed();
    const adapted = adaptNode(d, findDeep(d, 'ff'), originOf(d, 'ff'), { tabId: 't1' });
    expect(adapted.placement).toMatchObject({ w: 4, h: 3 });
    const { dashboard, newIds } = copyNodes(d, ['ff'], { tabId: 't1' }, [p(6, 0, 4, 3)], new Set(allNodeIds(d)));
    const copy = findDeep(dashboard, newIds[0]) as FolderNode;
    expect(copy.content.columns).toBe(4);
    expect(copy.content.children.map((n) => n.placement)).toEqual([p(0, 0), p(1, 0)]);
    expect(() => assertGridNoOverlap(copy.content)).not.toThrow();
    expect(() => assertGridNoOverlap(dashboard.tabs[0].root)).not.toThrow();
  });

  it('a converted folder is never shorter than its content needs', () => {
    const d: LayoutDashboard = deepFreeze({
      ...mixed(),
      tabs: [mixed().tabs[0], { id: 'tf', name: 'Free', layout: 'free', designWidth: 960, root: { columns: 120, children: [
        // 10 units tall (one row once divided) but holds tiles in 3 rows.
        folder('flat', p(0, 0, 20, 10), [tile('r1', p(0, 0, 10, 10)), tile('r2', p(0, 10, 10, 10)), tile('r3', p(0, 20, 10, 10))], { content: { columns: 20, children: [tile('r1', p(0, 0, 10, 10)), tile('r2', p(0, 10, 10, 10)), tile('r3', p(0, 20, 10, 10))] } })
      ] } }]
    } as LayoutDashboard);
    const adapted = adaptNode(d, findDeep(d, 'flat'), originOf(d, 'flat'), { tabId: 't1' }) as FolderNode;
    expect(adapted.placement.h).toBeGreaterThanOrEqual(4); // 3 content rows + the title row
  });

  it('pasteSnapshot clones a snapshot with fresh ids, converted from its recorded origin', () => {
    const d = mixed();
    const snap = structuredClone(findDeep(d, 'gf'));
    const { dashboard, newIds } = pasteSnapshot(d, [snap], [{ mode: 'grid', side: 10 }], { tabId: 'tf' }, [p(0, 40, 40, 30)], new Set(allNodeIds(d)));
    const c = findDeep(dashboard, newIds[0]) as FolderNode;
    expect(c.id).not.toBe('gf');
    expect(c.content.children.map((n) => n.id)).not.toContain('g1');
    expect(c.content.columns).toBe(40);
  });

  it('same mode: nothing is converted', () => {
    const d = mixed();
    const n = findDeep(d, 'gf');
    expect(adaptNode(d, n, originOf(d, 'gf'), { tabId: 't1' })).toBe(n);
  });
});

describe('setFolderLayout', () => {
  it('grid → free converts the content (side of its own tab: 1280 / 12 / 8 = 13) and keeps the folder in place', () => {
    const out = setFolderLayout(mixed(), 'gf', 'free');
    const gf = findDeep(out, 'gf') as FolderNode;
    expect(gf.layout).toBe('free');
    expect(gf.placement).toEqual(p(0, 1, 4, 3));
    expect(gf.content.columns).toBe(52);
    expect(findDeep(out, 'g1').placement).toEqual(p(0, 0, 13, 13));
  });

  it('free → grid (in a free tab) divides the content back without overlaps', () => {
    const out = setFolderLayout(mixed(), 'ff', 'grid');
    const ff = findDeep(out, 'ff') as FolderNode;
    expect(ff.content.columns).toBe(4);
    expect(ff.content.children.map((n) => n.placement)).toEqual([p(0, 0), p(1, 0)]);
    expect(() => assertGridNoOverlap(ff.content)).not.toThrow();
  });

  it('a folder that now needs more height grows, pushing grid neighbours aside (never overlapping)', () => {
    // A free folder in a grid tab whose content, once a grid, needs 3 rows + title.
    const d: LayoutDashboard = deepFreeze({
      ...mixed(),
      tabs: [{ id: 't1', name: 'Grid', root: { columns: 4, children: [
        folder('fz', p(0, 0, 2, 2), [tile('q1', p(0, 0, 10, 10)), tile('q2', p(0, 10, 10, 10)), tile('q3', p(0, 20, 10, 10))], { layout: 'free', content: { columns: 20, children: [tile('q1', p(0, 0, 10, 10)), tile('q2', p(0, 10, 10, 10)), tile('q3', p(0, 20, 10, 10))] } }),
        tile('below', p(0, 2))
      ] } }]
    } as LayoutDashboard);
    const out = setFolderLayout(d, 'fz', 'inherit');
    const fz = findDeep(out, 'fz') as FolderNode;
    expect(fz.placement.h).toBeGreaterThanOrEqual(4);
    expect(() => assertGridNoOverlap(out.tabs[0].root)).not.toThrow();
    expect(findDeep(out, 'below').placement).not.toEqual(p(0, 2)); // pushed aside
  });

  it('unchanged → same dashboard; refuses tiles and bad values', () => {
    const d = mixed();
    expect(setFolderLayout(d, 'gf', 'inherit')).toBe(d);
    expect(() => setFolderLayout(d, 'a', 'free')).toThrow(TreeOpError);
    expect(() => setFolderLayout(d, 'gf', 'wavy' as never)).toThrow(TreeOpError);
  });

  it('setTabLayout scales a folder whose content.columns is missing from its ORIGINAL width (no double scaling)', () => {
    const d: LayoutDashboard = deepFreeze({
      ...mixed(),
      tabs: [{ id: 't1', name: 'G', root: { columns: 12, children: [
        { kind: 'folder', id: 'nc', name: 'nc', display: 'expanded', placement: p(0, 0, 3, 2), content: { children: [tile('k', p(2, 0))] } }
      ] } }]
    } as unknown as LayoutDashboard);
    const out = setTabLayout(d, 't1', 'free', 960);
    const nc = findDeep(out, 'nc') as FolderNode;
    expect(nc.content.columns).toBe(30); // 3 x 10, not 30 x 10
    expect(findDeep(out, 'k').placement).toEqual(p(20, 0, 10, 10));
  });
});
