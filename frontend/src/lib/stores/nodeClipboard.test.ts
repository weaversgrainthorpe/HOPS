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
import { begin, apply, session, dirty, sessionConflict, resetEditSessionForTests } from './editSession';
import { toggleNode, clearSelection, selectedNodes } from './nodeSelection';
import { nodeClipboard, copySelection, cutSelection, pasteInto, clearNodeClipboard } from './nodeClipboard';
import { updateNode, deleteNodes } from '$lib/editor/treeOps';
import { folderNavFor, folderViewFor, resetFolderViewsForTests, setFolderDrill, setFolderPage, setFolderView } from './folderView';
import type { Config } from '$lib/types';
import type { FolderNode, LayoutDashboard, LayoutDoc, LayoutNode, Placement } from '$lib/types/layout';

// M5 form: 24 columns, a Medium tile 2 x 2; folder contents are ordered, with no placements.
const p = (x: number, y: number, w = 2, h = 2): Placement => ({ x, y, w, h });
const tile = (id: string, pl?: Placement): LayoutNode =>
  ({ kind: 'tile', id, name: id, url: 'http://x', size: 'medium', ...(pl ? { placement: pl } : {}) }) as unknown as LayoutNode;
const folder = (id: string, pl: Placement | undefined, children: LayoutNode[]): FolderNode => ({
  kind: 'folder', id, name: id, display: 'expanded', size: 'medium', contentSize: 'medium',
  ...(pl ? { placement: pl } : {}), content: { children }
});
function home(): LayoutDashboard {
  return {
    id: 'd', name: 'D', path: '/d', revision: 7,
    tabs: [
      { id: 't1', name: 'One', root: { columns: 24, children: [
        tile('a', p(0, 0)), tile('b', p(2, 0)),
        folder('f1', p(0, 4, 8, 6), [tile('x')]),
        folder('src', p(10, 4, 8, 6), [tile('s1'), folder('deep', undefined, [tile('s2')])])
      ] } },
      { id: 't2', name: 'Two', root: { columns: 24, children: [] } }
    ]
  };
}
function other(): LayoutDashboard {
  return { id: 'o', name: 'O', path: '/o', revision: 3, tabs: [
    { id: 'ot', name: 'OT', root: { columns: 24, children: [tile('o1', p(0, 0))] } }
  ] };
}
const doc = (): LayoutDoc => ({ schemaVersion: 3, layoutVersion: 2, dashboards: [home(), other()] });
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
  config.set(doc());
});

describe('copy then paste', () => {
  it('copy then paste into a folder deep-copies with new ids, at the end of its order, unplaced', async () => {
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
    // The original is still there; the copy has no placement inside the folder.
    expect(kidsOf('src')).toHaveLength(2);
    expect('placement' in copy).toBe(false);
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
    expect(kids.map((k) => k.placement)).toEqual([p(0, 0), p(2, 0)]);
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
    await pasteInto({ tabId: 't1' }, { x: 18, y: 0 });
    const kids = draft().tabs[0].root.children;
    expect(kids[kids.length - 1].placement).toEqual(p(18, 0));
    await pasteInto({ tabId: 't1' }, { x: 0, y: 0 }); // taken by a
    const k2 = draft().tabs[0].root.children;
    expect(k2[k2.length - 1].placement).toEqual(p(4, 0));
  });

  it('a collapsed folder\'s reserved footprint counts as taken (Ruling 13)', async () => {
    config.set({ schemaVersion: 3, layoutVersion: 2, dashboards: [{
      ...home(), tabs: [{ id: 't1', name: 'One', root: { columns: 4, children: [
        { ...folder('c', p(0, 0, 4, 4), []), display: 'collapsed' }, tile('a', p(0, 4))
      ] } }]
    }] } as unknown as Config);
    begin('d');
    toggleNode('a', false);
    copySelection();
    await pasteInto({ tabId: 't1' }, { x: 2, y: 2 }); // inside c's reserved cells
    const kids = draft().tabs[0].root.children;
    expect(kids[kids.length - 1].placement).toEqual(p(2, 4));
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

  // M5 §3a.3 (Task 4 fix round 1): a sub-folder cut out of a folder and pasted onto a tab is minimised
  // there, and this browser forgets that it had it open, its page and its drill path.
  it('a sub-folder pasted onto a tab forgets this browser\'s open / page / drill memory of it', async () => {
    localStorage.clear();
    resetFolderViewsForTests();
    setFolderView('d', 'deep', 'expanded');
    setFolderPage('d', 'deep', 1);
    setFolderDrill('d', 'deep', ['zz']);
    setFolderView('d', 'f1', 'collapsed'); // another folder's memory is kept
    begin('d');
    toggleNode('deep', false);
    expect(cutSelection()).toBe(true);
    await pasteInto({ tabId: 't2' });
    const pasted = draft().tabs[1].root.children.find((n) => n.id === 'deep') as FolderNode;
    expect(pasted.display).toBe('collapsed');
    expect(get(folderViewFor('d'))).toEqual({ f1: 'collapsed' });
    expect(get(folderNavFor('d'))).toEqual({ page: {}, drill: {} });
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
      schemaVersion: 3, layoutVersion: 2,
      dashboards: [
        { ...home(), revision: 8, tabs: [{ ...home().tabs[0], root: { columns: 24, children: [
          ...home().tabs[0].root.children, tile('o1', p(4, 0))
        ] } }, home().tabs[1]] },
        { ...other(), revision: 4, tabs: [{ id: 'ot', name: 'OT', root: { columns: 24, children: [] } }] }
      ]
    };
    vi.mocked(api.transferNodes).mockResolvedValue({ sourceRevision: 4, targetRevision: 8, layout: fresh });
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

describe('paste across dashboards: conflict reporting (shared transfer path)', () => {
  function copyFromOther2() {
    begin('o');
    toggleNode('o1', false);
    copySelection();
    resetEditSessionForTests();
    begin('d');
  }

  it('a 409 for the session dashboard raises the banner state', async () => {
    copyFromOther2();
    vi.mocked(api.transferNodes).mockRejectedValue(new api.ConflictError('d', 12));
    expect(await pasteInto({ tabId: 't1' })).toBe(false);
    expect(get(sessionConflict)).toEqual({ dashboardId: 'd', currentRevision: 12 });
  });

  it('a 409 for the other dashboard toasts by name and reloads the layout, with no banner', async () => {
    copyFromOther2();
    vi.mocked(api.transferNodes).mockRejectedValue(new api.ConflictError('o', 12));
    vi.mocked(api.getConfig).mockClear();
    const err = vi.spyOn(toast, 'error');
    expect(await pasteInto({ tabId: 't1' })).toBe(false);
    expect(get(sessionConflict)).toBeNull();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('was changed somewhere else — nothing was moved'));
    expect(api.getConfig).toHaveBeenCalled();
  });
});

describe('paste of a copy uses the snapshot taken at Copy time (Ruling 18(6))', () => {
  it('copy → delete the original → paste still works (fresh ids, deep)', async () => {
    begin('d');
    toggleNode('src', false);
    copySelection();
    apply('Delete', (d) => deleteNodes(d, ['src']));
    expect(await pasteInto({ tabId: 't2' })).toBe(true);
    const pasted = draft().tabs[1].root.children[0] as FolderNode;
    expect(pasted.name).toBe('src');
    expect(pasted.id).not.toBe('src');
    expect(pasted.content.children).toHaveLength(2);
    expect(pasted.content.children.map((n) => n.id)).not.toContain('s1');
  });

  it('copy → edit the original → paste gives the pre-edit version', async () => {
    begin('d');
    toggleNode('a', false);
    copySelection();
    apply('Rename', (d) => updateNode(d, 'a', { name: 'edited later' } as Partial<LayoutNode>));
    await pasteInto({ tabId: 't2' });
    expect(draft().tabs[1].root.children[0].name).toBe('a');
  });

  it('a cut whose original is gone stays refused with a toast', async () => {
    begin('d');
    toggleNode('a', false);
    cutSelection();
    apply('Delete', (d) => deleteNodes(d, ['a']));
    const err = vi.spyOn(toast, 'error');
    const before = draft();
    expect(await pasteInto({ tabId: 't2' })).toBe(false);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/no longer/i));
    expect(draft()).toBe(before);
  });

  it('inside a folder a paste goes right after its source (or after the item it was asked on)', async () => {
    begin('d');
    toggleNode('s1', false);
    copySelection();
    await pasteInto({ tabId: 't1', folderId: 'src' });
    const kids = kidsOf('src');
    expect(kids).toHaveLength(3);
    expect(kids[0].id).toBe('s1');
    expect(kids[2].id).toBe('deep');
    expect(kids[1].id).not.toBe('s1');
    await pasteInto({ tabId: 't1', folderId: 'src' }, undefined, 'deep');
    expect(kidsOf('src').map((n) => n.id).slice(-2)[0]).toBe('deep');
  });

  it('a folder copied from inside a folder lands on a tab minimised, at its default box', async () => {
    begin('d');
    toggleNode('deep', false);
    copySelection();
    await pasteInto({ tabId: 't2' });
    const pasted = draft().tabs[1].root.children[0] as FolderNode;
    expect(pasted.display).toBe('collapsed');
    expect(pasted.placement).toEqual(p(0, 0, 6, 4));
    expect('placement' in pasted.content.children[0]).toBe(false);
  });
});
