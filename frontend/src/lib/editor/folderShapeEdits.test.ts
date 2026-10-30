// A shape change in the folder dialog grows a box below the (tab-aware) minimum,
// pushing neighbours, in the Save's one undo step — or refuses visibly. New and
// merged folders start Flat.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { addNode, blankFolder, editFolder, shapeProblem, currentDraft, documentIds } from './editorActions';
import { mergeIntoNewFolder } from './treeOps';
import { session, undo } from '$lib/stores/editSession';
import { toast } from '$lib/stores/toast';
import { setLayout, resetEditor, startSession, draft, nodeIn, p, tile, folder } from '$lib/components/editor/editorTestKit';
import type { FolderNode, LayoutDashboard } from '$lib/types/layout';

/** One tab: folder g at 3 x 3 (below the Medium minimum 3 x 4) with tile `below` under it. */
function tight(columns = 24): LayoutDashboard {
  return {
    id: 'd1', name: 'Home', path: '/home', revision: 5,
    tabs: [{ id: 't1', name: 'Main', root: { columns, children: [
      folder('g', p(0, 0, Math.min(3, columns), 3), [tile('x')], { shape: 'rounded' }),
      tile('below', p(0, 3))
    ] } }]
  };
}

beforeEach(() => {
  resetEditor();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network'))));
});

describe('a shape change grows the box to the minimum, or refuses visibly', () => {
  it('grows the box to the new minimum and pushes the neighbour, in ONE undo step', () => {
    setLayout([tight()]);
    startSession();
    expect(editFolder('g', { name: 'G', shape: 'folder-paper', tabPosition: 'right' })).toBe(true);
    const g = nodeIn(draft(), 'g') as FolderNode;
    expect(g.shape).toBe('folder-paper');
    expect(g.tabPosition).toBe('right');
    expect(g.placement).toEqual(p(0, 0, 3, 4));
    const below = nodeIn(draft(), 'below')!.placement!;
    expect(below.x >= 3 || below.y >= 4).toBe(true); // pushed clear of the grown box
    expect(get(session)!.undo).toHaveLength(1);
    undo();
    expect((nodeIn(draft(), 'g') as FolderNode).placement).toEqual(p(0, 0, 3, 3));
    expect((nodeIn(draft(), 'g') as FolderNode).shape).toBe('rounded');
  });

  it('a box already at its minimum is not grown', () => {
    setLayout([tight()]);
    startSession();
    expect(editFolder('g', { shape: 'folder-flat' })).toBe(true);
    expect(editFolder('g', { shape: 'simple-tab' })).toBe(true);
    expect((nodeIn(draft(), 'g') as FolderNode).placement).toEqual(p(0, 0, 3, 4));
  });

  it('no room: the Save is refused with the reason, nothing changes (no undo step)', () => {
    setLayout([tight(2)]);
    startSession();
    const err = vi.spyOn(toast, 'error');
    const before = draft();
    expect(editFolder('g', { shape: 'folder-cartoon' })).toBe(false);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/room/));
    expect(draft()).toBe(before);
    expect(get(session)!.undo).toHaveLength(0);
  });

  it('shapeProblem: the dialog\'s trial run of the same op — null when it fits, the reason when not', () => {
    setLayout([tight()]);
    startSession();
    expect(shapeProblem(currentDraft()!, 'g', 'folder-open')).toBeNull();
    resetEditor();
    setLayout([tight(2)]);
    startSession();
    expect(shapeProblem(currentDraft()!, 'g', 'folder-open')).toMatch(/room/);
  });

  it('an unknown shape or tab position is refused visibly, never saved (the server would refuse it)', () => {
    setLayout([tight()]);
    startSession();
    const err = vi.spyOn(toast, 'error');
    expect(editFolder('g', { shape: 'folder-tab' } as unknown as Partial<FolderNode>)).toBe(false);
    expect(err).toHaveBeenLastCalledWith(expect.stringMatching(/look/i));
    expect(editFolder('g', { tabPosition: 'middle' } as unknown as Partial<FolderNode>)).toBe(false);
    expect(err).toHaveBeenLastCalledWith(expect.stringMatching(/tab position/i));
    expect((nodeIn(draft(), 'g') as FolderNode).shape).toBe('rounded');
    expect(shapeProblem(currentDraft()!, 'g', 'folder-tab')).toMatch(/look/i);
  });
});

describe('folders made in HOPS start Flat', () => {
  beforeEach(() => {
    setLayout();
    startSession();
  });

  it('a new folder (the dialog\'s blank) is Flat, and keeps it when added', () => {
    expect(blankFolder().shape).toBe('folder-flat');
    const id = addNode({ ...blankFolder(), name: 'N' }, { tabId: 't1' })!;
    expect((nodeIn(draft(), id) as FolderNode).shape).toBe('folder-flat');
  });

  it('a merge on a tab makes a Flat folder', () => {
    const r = mergeIntoNewFolder(draft(), ['b'], 'a', documentIds());
    expect((nodeIn(r.dashboard, r.folderId) as FolderNode).shape).toBe('folder-flat');
  });

  it('a merge inside a folder makes a Flat sub-folder', () => {
    const d: LayoutDashboard = {
      id: 'd1', name: 'Home', path: '/home', revision: 1,
      tabs: [{ id: 't1', name: 'Main', root: { columns: 24, children: [
        folder('f', p(0, 0, 8, 8), [tile('i1'), tile('i2')])
      ] } }]
    };
    const r = mergeIntoNewFolder(d, ['i2'], 'i1', new Set(['d1', 't1', 'f', 'i1', 'i2']));
    expect((nodeIn(r.dashboard, r.folderId) as FolderNode).shape).toBe('folder-flat');
  });
});
