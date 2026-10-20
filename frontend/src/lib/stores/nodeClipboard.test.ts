import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  transferNodes: vi.fn(),
  saveDashboardV3: vi.fn(),
  getConfig: vi.fn(async () => { throw new Error('offline in tests'); })
}));

import * as api from '$lib/utils/api';
import { config } from './config';
import { toast } from './toast';
import { begin, apply, session, dirty, resetEditSessionForTests } from './editSession';
import { toggleNode, clearSelection, selectedNodes } from './nodeSelection';
import { nodeClipboard, copySelection, cutSelection, pasteInto, clearNodeClipboard } from './nodeClipboard';
import { updateNode } from '$lib/editor/treeOps';
import type { Config } from '$lib/types';
import type { FolderNode, LayoutDashboard, LayoutDoc, LayoutNode, Placement } from '$lib/types/layout';

const p = (x: number, y: number, w = 1, h = 1): Placement => ({ x, y, w, h });
const tile = (id: string, pl: Placement): LayoutNode =>
  ({ kind: 'tile', id, name: id, url: 'http://x', placement: pl }) as unknown as LayoutNode;
const folder = (id: string, pl: Placement, children: LayoutNode[]): FolderNode => ({
  kind: 'folder', id, name: id, display: 'expanded', placement: pl, content: { columns: 4, children }
});
function home(): LayoutDashboard {
  return {
    id: 'd', name: 'D', path: '/d', revision: 7,
    tabs: [
      { id: 't1', name: 'One', root: { columns: 12, children: [
        tile('a', p(0, 0)), tile('b', p(1, 0)),
        folder('f1', p(0, 2, 4, 3), [tile('x', p(0, 0))]),
        folder('src', p(5, 2, 4, 3), [tile('s1', p(0, 0)), folder('deep', p(1, 0, 2, 2), [tile('s2', p(0, 0))])])
      ] } },
      { id: 't2', name: 'Two', root: { columns: 12, children: [] } }
    ]
  };
}
function other(): LayoutDashboard {
  return { id: 'o', name: 'O', path: '/o', revision: 3, tabs: [
    { id: 'ot', name: 'OT', root: { columns: 12, children: [tile('o1', p(0, 0))] } }
  ] };
}
const doc = (): LayoutDoc => ({ schemaVersion: 3, dashboards: [home(), other()] });
const draft = () => get(session)!.draft;
const kidsOf = (folderId: string): LayoutNode[] => {
  const walk = (c: LayoutNode[]): FolderNode | undefined => {
    for (const n of c) {
      if (n.kind === 'folder') {
        if (n.id === folderId) return n;
        const r = walk(n.content.children);
        if (r) return r;
      }
    }
    return undefined;
  };
  for (const t of draft().tabs) { const f = walk(t.root.children); if (f) return f.content.children; }
  throw new Error('no folder ' + folderId);
};
const allIds = (d: LayoutDashboard) => {
  const out: string[] = [];
  const walk = (c: LayoutNode[]) => c.forEach((n) => { out.push(n.id); if (n.kind === 'folder') walk(n.content.children); });
  d.tabs.forEach((t) => walk(t.root.children));
  return out;
};

beforeEach(() => {
  vi.clearAllMocks();
  resetEditSessionForTests();
  clearSelection();
  clearNodeClipboard();
  toast.clear();
  config.set({ dashboards: [], layout: doc(), v3OnlyDashboards: [] } as unknown as Config);
});

describe('copy then paste', () => {
  it('copy then paste into a folder deep-copies with new ids, at a free cell', async () => {
    begin('d');
    toggleNode('src', false);
    expect(copySelection()).toBe(true);
    expect(get(nodeClipboard)!.mode).toBe('copy');
    expect(get(nodeClipboard)!.sourceDashboardId).toBe('d');
    await pasteInto({ tabId: 't1', folderId: 'f1' });
    const inF1 = kidsOf('f1');
    expect(inF1).toHaveLength(2);
    const copy = inF1[1] as FolderNode;
    expect(copy.kind).toBe('folder');
    expect(copy.id).not.toBe('src');
    const before = new Set(allIds(home()).concat(allIds(other())));
    const copiedIds = allIds({ ...home(), tabs: [{ id: 'x', name: 'x', root: { columns: 4, children: [copy] } }] });
    expect(copiedIds).toHaveLength(4); // folder + s1 + deep + s2
    for (const id of copiedIds) expect(before.has(id)).toBe(false);
    // The original is still there; the copy does not overlap x (0,0).
    expect(kidsOf('src')).toHaveLength(2);
    expect(copy.placement.x === 0 && copy.placement.y === 0).toBe(false);
    // The clipboard stays for another paste; the selection is the new copy.
    expect(get(nodeClipboard)).not.toBeNull();
    expect([...get(selectedNodes)]).toEqual([copy.id]);
    expect(api.transferNodes).not.toHaveBeenCalled();
  });

  it('several items paste without overlapping each other', async () => {
    begin('d');
    toggleNode('a', false);
    toggleNode('b', true);
    copySelection();
    await pasteInto({ tabId: 't2' });
    const kids = draft().tabs[1].root.children;
    expect(kids.map((k) => k.placement)).toEqual([p(0, 0), p(1, 0)]);
  });

  it('an item inside a selected folder is not copied twice', () => {
    begin('d');
    toggleNode('src', false);
    toggleNode('s1', true);
    copySelection();
    expect(get(nodeClipboard)!.nodes.map((n) => n.id)).toEqual(['src']);
  });

  it('nothing selected: says so and keeps the clipboard', () => {
    begin('d');
    const info = vi.spyOn(toast, 'info');
    expect(copySelection()).toBe(false);
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/select/i));
  });

  it('paste with an empty clipboard says so', async () => {
    begin('d');
    const info = vi.spyOn(toast, 'info');
    await pasteInto({ tabId: 't1' });
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/nothing to paste/i));
  });

  it('a paste at a free right-clicked cell lands there; at a taken cell, at the first free one', async () => {
    begin('d');
    toggleNode('a', false);
    copySelection();
    await pasteInto({ tabId: 't1' }, { x: 9, y: 0 });
    const kids = draft().tabs[0].root.children;
    expect(kids[kids.length - 1].placement).toEqual(p(9, 0));
    await pasteInto({ tabId: 't1' }, { x: 0, y: 0 }); // taken by a
    const k2 = draft().tabs[0].root.children;
    expect(k2[k2.length - 1].placement).toEqual(p(2, 0));
  });

  it('a collapsed folder\'s reserved footprint counts as taken (Ruling 13)', async () => {
    config.set({ dashboards: [], layout: { schemaVersion: 3, dashboards: [{
      ...home(), tabs: [{ id: 't1', name: 'One', root: { columns: 2, children: [
        { ...folder('c', p(0, 0, 2, 2), []), display: 'collapsed' }, tile('a', p(0, 2))
      ] } }]
    }] } } as unknown as Config);
    begin('d');
    toggleNode('a', false);
    copySelection();
    await pasteInto({ tabId: 't1' }, { x: 1, y: 1 }); // inside c's reserved cells
    const kids = draft().tabs[0].root.children;
    expect(kids[kids.length - 1].placement).toEqual(p(1, 2));
  });
});

describe('cut then paste', () => {
  it('moves within the dashboard (same ids) and empties the clipboard', async () => {
    begin('d');
    toggleNode('a', false);
    expect(cutSelection()).toBe(true);
    await pasteInto({ tabId: 't1', folderId: 'f1' });
    expect(kidsOf('f1').map((n) => n.id)).toEqual(['x', 'a']);
    expect(draft().tabs[0].root.children.some((n) => n.id === 'a')).toBe(false);
    expect(get(nodeClipboard)).toBeNull();
    expect(api.transferNodes).not.toHaveBeenCalled();
  });

  it('a refused move (folder into itself) is toasted and changes nothing', async () => {
    begin('d');
    toggleNode('src', false);
    cutSelection();
    const err = vi.spyOn(toast, 'error');
    const before = draft();
    await pasteInto({ tabId: 't1', folderId: 'deep' });
    expect(err).toHaveBeenCalled();
    expect(draft()).toBe(before);
    expect(get(nodeClipboard)).not.toBeNull();
  });
});

describe('across dashboards', () => {
  function copyFromOther(mode: 'copy' | 'cut') {
    begin('o');
    toggleNode('o1', false);
    if (mode === 'copy') copySelection(); else cutSelection();
    resetEditSessionForTests();
    begin('d');
  }

  it('is refused while the session has unsaved changes, with a toast saying why', async () => {
    copyFromOther('cut');
    apply('Rename', (d) => updateNode(d, 'a', { name: 'zz' } as Partial<LayoutNode>));
    expect(get(dirty)).toBe(true);
    const err = vi.spyOn(toast, 'error');
    await pasteInto({ tabId: 't1' });
    expect(api.transferNodes).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/save or discard/i));
    expect(get(nodeClipboard)).not.toBeNull();
  });

  it('a clean session uses the transfer endpoint with both revisions, then rebases on the fresh layout', async () => {
    copyFromOther('cut');
    const fresh: LayoutDoc = {
      schemaVersion: 3,
      dashboards: [
        { ...home(), revision: 8, tabs: [{ ...home().tabs[0], root: { columns: 12, children: [
          ...home().tabs[0].root.children, tile('o1', p(2, 0))
        ] } }, home().tabs[1]] },
        { ...other(), revision: 4, tabs: [{ id: 'ot', name: 'OT', root: { columns: 12, children: [] } }] }
      ]
    };
    vi.mocked(api.transferNodes).mockResolvedValue({ sourceRevision: 4, targetRevision: 8, layout: fresh, v3OnlyDashboards: [] });
    await pasteInto({ tabId: 't1', folderId: 'f1' });
    expect(api.transferNodes).toHaveBeenCalledWith({
      mode: 'move', sourceId: 'o', sourceRevision: 3, nodeIds: ['o1'],
      targetId: 'd', targetRevision: 7, target: { tabId: 't1', folderId: 'f1' }
    });
    const s = get(session)!;
    expect(s.baseRevision).toBe(8);
    expect(s.draft.tabs[0].root.children.some((n) => n.id === 'o1')).toBe(true);
    expect(get(dirty)).toBe(false);
    expect(get(nodeClipboard)).toBeNull();
  });

  it('a copy across dashboards keeps the clipboard; a failure is toasted and changes nothing', async () => {
    copyFromOther('copy');
    vi.mocked(api.transferNodes).mockRejectedValue(new Error('Dashboard not found: o'));
    const err = vi.spyOn(toast, 'error');
    const before = draft();
    await pasteInto({ tabId: 't1' });
    expect(vi.mocked(api.transferNodes).mock.calls[0][0].mode).toBe('copy');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Dashboard not found: o'));
    expect(draft()).toBe(before);
    expect(get(nodeClipboard)).not.toBeNull();
  });
});
