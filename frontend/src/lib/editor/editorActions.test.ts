import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  documentIds, setFolderBackground, setLook, addNode, blankTile, blankFolder, placementsFor,
  moveOrCopyTo, tileProblem, editNode, duplicate, editTab, editFolder
} from './editorActions';
import { dirty, session, undo } from '$lib/stores/editSession';
import { toast } from '$lib/stores/toast';
import {
  setLayout, resetEditor, startSession, draft, nodeIn, p
} from '$lib/components/editor/editorTestKit';
import type { FolderNode, TileNode } from '$lib/types/layout';

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetEditor();
  setLayout();
  startSession();
  fetchSpy = vi.fn(() => Promise.reject(new Error('no network')));
  vi.stubGlobal('fetch', fetchSpy);
});

describe('editorActions', () => {
  it('documentIds covers every dashboard in the stored layout plus the draft (Ruling 2)', () => {
    addNode({ ...blankTile(), name: 'N', url: 'https://n.test' }, { tabId: 't1' });
    const ids = documentIds();
    for (const id of ['a', 'f1', 'x', 'c1', 'y', 'fa', 't1', 't2', 'o1', 'ot']) expect(ids.has(id)).toBe(true);
    const added = draft().tabs[0].root.children.at(-1)!;
    expect(ids.has(added.id)).toBe(true);
  });

  it('a duplicate never reuses an id from another dashboard', () => {
    const newId = duplicate('a')!;
    expect(newId).toMatch(/^tile-/);
    expect(['o1', 'ot', 'a']).not.toContain(newId);
  });

  it('Header and Background edit the draft (parent spec §7.1) — no request, undoable', () => {
    setLook({ centerTitle: 'Draft' }, { type: 'color', value: '#123456' });
    expect(draft().header).toEqual({ centerTitle: 'Draft' });
    expect(draft().background).toEqual({ type: 'color', value: '#123456' });
    expect(get(dirty)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    undo();
    expect(get(dirty)).toBe(false);
  });

  it('setLook applies header and background as ONE undo step (walkthrough §4C); unchanged adds none', () => {
    const before = draft();
    expect(setLook({ centerTitle: 'Saved title' }, undefined)).toBe(true);
    expect(draft()).toBe(before); // nothing changed: no undo step
    expect(get(session)!.undo).toHaveLength(0);
    expect(setLook({ centerTitle: 'Both' }, { type: 'color', value: '#123456' })).toBe(true);
    expect(draft().header).toEqual({ centerTitle: 'Both' });
    expect(draft().background).toEqual({ type: 'color', value: '#123456' });
    expect(get(session)!.undo).toHaveLength(1);
    expect(get(session)!.lastLabel).toBe('Edit dashboard');
    // Key order does not count as a change.
    expect(setLook({ centerTitle: 'Both' }, { value: '#123456', type: 'color' })).toBe(true);
    expect(get(session)!.undo).toHaveLength(1);
    undo();
    expect(draft()).toEqual(before);
    expect(get(dirty)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a new (Medium) tile on a tab takes its 2 x 2 span at the first free cell; in a folder it goes last, unplaced', () => {
    const id = addNode({ ...blankTile(), name: 'F', url: 'https://f.test' }, { tabId: 't2' })!;
    const t = nodeIn(draft(), id) as TileNode;
    expect(t.placement).toEqual(p(2, 0));
    const inF = addNode({ ...blankTile(), name: 'G', url: 'https://g.test' }, { tabId: 't1', folderId: 'f1' })!;
    const kids = (nodeIn(draft(), 'f1') as FolderNode).content.children;
    expect(kids.map((n) => n.id)).toEqual(['x', inF]);
    expect('placement' in kids[1]).toBe(false);
  });

  it('a new folder on a tab takes its default box (Medium: 6 x 4 at the M6 §13 reference cell, Ruling 7a) at the first free cell, Medium with Medium contents', () => {
    const id = addNode({ ...blankFolder(), name: 'G' }, { tabId: 't1' })!;
    const f = nodeIn(draft(), id) as FolderNode;
    expect(f.placement).toEqual(p(14, 0, 6, 4));
    expect(f).toMatchObject({ size: 'medium', contentSize: 'medium', content: { children: [] } });
    expect('columns' in f.content).toBe(false);
    expect('layout' in f).toBe(false);
  });

  it('placements for several items never overlap, and a taken cell falls back to the first free one', () => {
    const at = placementsFor(draft(), { tabId: 't1' }, [
      { kind: 'tile', placement: p(0, 0) }, { kind: 'tile', placement: p(0, 0) }
    ] as never, { x: 0, y: 0 });
    expect(at).toEqual([p(4, 0), p(6, 0)]);
  });

  it('tiles need a name and an allowed URL (notes need no URL)', () => {
    expect(tileProblem({ name: 'x', url: 'javascript:alert(1)' })).toMatch(/URL/);
    expect(tileProblem({ name: 'x', url: 'https://ok.test' })).toBeNull();
    expect(tileProblem({ name: 'x', type: 'note', url: '' })).toBeNull();
    expect(tileProblem({ name: ' ', url: 'https://ok.test' })).toMatch(/name/);
    const err = vi.spyOn(toast, 'error');
    expect(editNode('a', { url: 'data:text/html,hi' } as never)).toBe(false);
    expect(err).toHaveBeenCalled();
  });

  it('editNode never patches id, kind, placement or content', () => {
    editNode('f1', { name: 'N', id: 'zz', placement: p(9, 9), content: { children: [] } } as never);
    const f = nodeIn(draft(), 'f1') as FolderNode;
    expect(f.name).toBe('N');
    expect(f.placement).toEqual(p(0, 2, 8, 6));
    expect(f.content.children).toHaveLength(1);
  });

  it('moveOrCopyTo moves to another tab, or copies with new ids', () => {
    expect(moveOrCopyTo(['a'], { tabId: 't2' }, 'move')).toBe(true);
    expect(nodeIn(draft(), 'a')).toBeDefined();
    expect(draft().tabs[1].root.children.some((n) => n.id === 'a')).toBe(true);
    expect(moveOrCopyTo(['b'], { tabId: 't1', folderId: 'f1' }, 'copy')).toBe(true);
    const inF1 = (nodeIn(draft(), 'f1') as FolderNode).content.children;
    expect(inF1).toHaveLength(2);
    expect(inF1[1].id).not.toBe('b');
  });

  it('editTab changes the name as one undo step; there is no layout to change (every tab is a grid)', () => {
    editTab('t1', { name: 'Renamed', layout: 'free', designWidth: 960 } as never);
    const t = draft().tabs[0];
    expect(t.name).toBe('Renamed');
    expect('layout' in t).toBe(false);
    expect('designWidth' in t).toBe(false);
    expect(t.root.columns).toBe(24);
    expect(nodeIn(draft(), 'b')!.placement).toEqual(p(2, 0));
    expect(get(session)!.undo).toHaveLength(1);
  });

  it('setFolderBackground is one undoable draft edit; undefined clears it (M4 Task 5)', () => {
    const bg = { inherit: true, type: 'image' as const, value: '/backgrounds/a.jpg', opacity: 0.5 };
    expect(setFolderBackground('f1', bg)).toBe(true);
    expect((nodeIn(draft(), 'f1') as FolderNode).background).toEqual(bg);
    expect(get(session)!.undo).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setFolderBackground('f1', undefined)).toBe(true);
    expect(nodeIn(draft(), 'f1')).not.toHaveProperty('background');
    expect(get(session)!.undo).toHaveLength(2);
    undo();
    expect((nodeIn(draft(), 'f1') as FolderNode).background).toEqual(bg);
    undo();
    expect((nodeIn(draft(), 'f1') as FolderNode).background).toBeUndefined();
    expect(get(dirty)).toBe(false);
  });

  it('setFolderBackground refuses a tile or a missing id visibly, leaving the draft alone', () => {
    const err = vi.spyOn(toast, 'error');
    err.mockClear();
    const before = draft();
    expect(setFolderBackground('a', { type: 'color', value: '#000000' })).toBe(false);
    expect(setFolderBackground('nope', { type: 'color', value: '#000000' })).toBe(false);
    expect(draft()).toBe(before);
    expect(err).toHaveBeenCalledTimes(2);
  });

  it('editTab with a background is ONE undo step; null removes it; undefined leaves it (Ruling 11(5))', () => {
    expect(editTab('t1', { name: 'Main 2', background: { type: 'color', value: '#123456', opacity: 0.5 } })).toBe(true);
    expect(draft().tabs[0]).toMatchObject({ name: 'Main 2', background: { type: 'color', value: '#123456', opacity: 0.5 } });
    expect(get(session)!.undo).toHaveLength(1);
    expect(editTab('t1', { name: 'Main 3' })).toBe(true);
    expect(draft().tabs[0].background).toEqual({ type: 'color', value: '#123456', opacity: 0.5 });
    expect(editTab('t1', { name: 'Main 3', background: null })).toBe(true);
    expect(draft().tabs[0]).not.toHaveProperty('background');
    undo();
    undo();
    undo();
    expect(draft().tabs[0].name).toBe('Main');
    expect(draft().tabs[0]).not.toHaveProperty('background');
    expect(get(dirty)).toBe(false);
  });

  it('editFolder with a background is ONE undo step that reverts fields and background', () => {
    expect(editFolder('f1', { name: 'Renamed', background: { type: 'image', value: '/presets/network-grid.jpg' } })).toBe(true);
    expect(nodeIn(draft(), 'f1')).toMatchObject({ name: 'Renamed', background: { type: 'image' } });
    expect(get(session)!.undo).toHaveLength(1);
    undo();
    expect(nodeIn(draft(), 'f1')!.name).toBe('F1');
    expect(nodeIn(draft(), 'f1')).not.toHaveProperty('background');
  });
});
