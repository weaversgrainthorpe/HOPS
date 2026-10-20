import { describe, it, expect } from 'vitest';
import {
  TreeOpError, newNodeId, locate, isDescendant, moveNodes, copyNodes, mergeIntoNewFolder, insertNode,
  updateNode, deleteNodes, duplicateNode, resizeNode, setZ, reorderTabs, addTab, updateTab, deleteTab,
  firstFreeCell, pushAside, assertGridNoOverlap
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
