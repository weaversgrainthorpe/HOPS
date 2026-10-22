import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { tick } from 'svelte';

import EditorDialogs from './EditorDialogs.svelte';
import FolderEditModal from './FolderEditModal.svelte';
import { editorDialog, editorMenu } from '$lib/editor/editorUi';
import { editMode } from '$lib/stores/editMode';
import { dirty, session, undo } from '$lib/stores/editSession';
import { toast } from '$lib/stores/toast';
import { setLayout, resetEditor, startSession, draft, nodeIn, home, answerConfirm, p, noRequestsButSettingsRead } from './editorTestKit';
import type { FolderNode, TileNode } from '$lib/types/layout';

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetEditor();
  setLayout();
  startSession();
  editMode.set(true);
  fetchSpy = vi.fn(() => Promise.reject(new Error('no network in tests')));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  editorDialog.set(null);
  editMode.set(false);
});

async function show(d: Parameters<typeof editorDialog.set>[0]) {
  render(EditorDialogs, { tabId: 't1' });
  editorDialog.set(d);
  await tick();
}



describe('FolderEditModal', () => {
  it('shows the folder fields and returns them on Save', async () => {
    const onSave = vi.fn();
    const f = { ...(nodeIn(home(), 'f1') as FolderNode), color: '#112233', opacity: 0.5, textColor: 'dark' as const };
    render(FolderEditModal, { folder: f, onSave, onCancel: vi.fn() });
    const name = screen.getByLabelText(/Folder name/) as HTMLInputElement;
    expect(name.value).toBe('F1');
    await fireEvent.input(name, { target: { value: 'Media' } });
    await fireEvent.click(screen.getByRole('radio', { name: 'Collapsed' }));
    expect(screen.queryByLabelText('Layout')).toBeNull(); // M5: folders always flow; no layout
    await fireEvent.click(screen.getByLabelText('Show title bar'));
    await fireEvent.change(screen.getByLabelText('Look'), { target: { value: 'folder-tab' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Media', display: 'collapsed', showTitle: false, shape: 'folder-tab',
      color: '#112233', opacity: 0.5, textColor: 'dark'
    }));
    const patch = onSave.mock.calls[0][0];
    expect(patch).not.toHaveProperty('layout');
    expect(patch).not.toHaveProperty('placement');
    expect(patch).not.toHaveProperty('content');
  });

  it('a blank name is refused visibly', async () => {
    const onSave = vi.fn();
    render(FolderEditModal, { folder: nodeIn(home(), 'f1') as FolderNode, onSave, onCancel: vi.fn() });
    await fireEvent.input(screen.getByLabelText(/Folder name/), { target: { value: '  ' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/needs a name/i);
  });
});

describe('EditorDialogs (the dialogs edit the draft only)', () => {
  it('a FolderEditModal save updates the draft only — no api call', async () => {
    await show({ kind: 'folder', id: 'f1' });
    await fireEvent.input(screen.getByLabelText(/Folder name/), { target: { value: 'Renamed' } });
    await fireEvent.click(screen.getByRole('radio', { name: 'Collapsed' }));
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    const f = nodeIn(draft(), 'f1') as FolderNode;
    expect(f.name).toBe('Renamed');
    expect(f.display).toBe('collapsed');
    expect(f.placement).toEqual(p(0, 2, 8, 6));
    expect(get(dirty)).toBe(true);
    noRequestsButSettingsRead(fetchSpy);
    expect(get(editorDialog)).toBeNull();
  });

  it('folder dialog "Contents size" and "Size when minimised" (M5): staged until Save, then ONE undo step', async () => {
    await show({ kind: 'folder', id: 'f1' });
    const contents = screen.getByLabelText('Contents size') as HTMLSelectElement;
    const minimised = screen.getByLabelText('Size when minimised') as HTMLSelectElement;
    expect(contents.value).toBe('medium');
    expect(minimised.value).toBe('medium');
    expect(Array.from(contents.options).map((o) => o.value)).toEqual(['small', 'medium', 'large']);
    expect(Array.from(minimised.options).map((o) => o.value)).toEqual(['small', 'medium', 'large']);
    const before = draft();
    await fireEvent.change(contents, { target: { value: 'small' } });
    await fireEvent.change(minimised, { target: { value: 'large' } });
    expect(draft()).toEqual(before); // staged
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    const f = nodeIn(draft(), 'f1') as FolderNode;
    expect(f).toMatchObject({ contentSize: 'small', size: 'large', placement: p(0, 2, 8, 6) });
    expect(get(session)!.undo).toHaveLength(1);
    undo();
    expect(draft()).toEqual(before);
  });

  it('folder dialog Cancel discards a staged size change', async () => {
    await show({ kind: 'folder', id: 'f1' });
    const before = draft();
    await fireEvent.change(screen.getByLabelText('Contents size'), { target: { value: 'large' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(draft()).toEqual(before);
  });

  it('Add folder: Create inserts a folder at the first free cell of the target (draft only)', async () => {
    await show({ kind: 'folder', to: { tabId: 't1' } });
    await fireEvent.input(screen.getByLabelText(/Folder name/), { target: { value: 'Tools' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Create/ }));
    const root = draft().tabs[0].root.children;
    const f = root[root.length - 1] as FolderNode;
    expect(f.kind).toBe('folder');
    expect(f.name).toBe('Tools');
    expect(f.content.children).toEqual([]);
    noRequestsButSettingsRead(fetchSpy);
  });

  it('folder dialog Delete asks, then deletes; Duplicate deep-copies', async () => {
    await show({ kind: 'folder', id: 'f1' });
    await fireEvent.click(screen.getByRole('button', { name: /^Duplicate/ }));
    const root = draft().tabs[0].root.children;
    expect(root.filter((n) => n.kind === 'folder' && n.name === 'F1')).toHaveLength(2);
    editorDialog.set({ kind: 'folder', id: 'f1' });
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
    await answerConfirm(true);
    expect(nodeIn(draft(), 'f1')).toBeUndefined();
  });

  it('tile dialog: a v3 tile in, a v3 tile out — kind, id and placement kept, fields updated', async () => {
    await show({ kind: 'tile', id: 'a' });
    await fireEvent.input(screen.getByLabelText(/^Name/), { target: { value: 'Router' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    const t = nodeIn(draft(), 'a') as TileNode;
    expect(t).toMatchObject({ kind: 'tile', id: 'a', name: 'Router', placement: p(0, 0) });
    noRequestsButSettingsRead(fetchSpy);
  });

  it('tile dialog Size (spec §8/§9): Large saves a 4 x 4 span with neighbours pushed, as ONE undo step', async () => {
    await show({ kind: 'tile', id: 'a' });
    const sel = screen.getByLabelText(/^Size/) as HTMLSelectElement;
    expect(sel.value).toBe('medium');
    await fireEvent.change(sel, { target: { value: 'large' } });
    expect(nodeIn(draft(), 'a')!.placement).toEqual(p(0, 0)); // staged until Save
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(nodeIn(draft(), 'a')).toMatchObject({ size: 'large', placement: p(0, 0, 4, 4) });
    expect(nodeIn(draft(), 'b')!.placement).not.toEqual(p(2, 0));
    expect(get(session)!.undo).toHaveLength(1);
    undo();
    expect(nodeIn(draft(), 'a')!.placement).toEqual(p(0, 0));
    expect(nodeIn(draft(), 'b')!.placement).toEqual(p(2, 0));
  });

  it('tile dialog Size inside a folder: any size is accepted, nothing is placed, the folder is untouched', async () => {
    await show({ kind: 'tile', id: 'x' });
    const folderBefore = (nodeIn(draft(), 'f1') as FolderNode).placement;
    await fireEvent.change(screen.getByLabelText(/^Size/), { target: { value: 'large' } });
    expect(screen.queryByRole('alert')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    const x = nodeIn(draft(), 'x') as TileNode;
    expect(x.size).toBe('large');
    expect('placement' in x).toBe(false);
    expect((nodeIn(draft(), 'f1') as FolderNode).placement).toEqual(folderBefore);
    expect(get(session)!.undo).toHaveLength(1);
  });

  it('tile dialog Size offers Small, Medium and Large only (no Custom)', async () => {
    await show({ kind: 'tile', id: 'b' });
    const sel = screen.getByLabelText(/^Size/) as HTMLSelectElement;
    expect(sel.value).toBe('medium');
    expect([...sel.options].map((o) => o.value)).toEqual(['small', 'medium', 'large']);
  });

  it('tile dialog refuses a javascript: URL with a toast and leaves the draft alone', async () => {
    const err = vi.spyOn(toast, 'error');
    await show({ kind: 'tile', id: 'a' });
    const before = draft();
    await fireEvent.input(screen.getByLabelText(/^URL/), { target: { value: 'javascript:alert(1)' } });
    await fireEvent.submit(document.getElementById('entry-edit-form')!);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/URL/));
    expect(draft()).toBe(before);
  });

  it('Add tile at a right-clicked free cell lands there', async () => {
    await show({ kind: 'tile', to: { tabId: 't1' }, cell: { x: 18, y: 0 } });
    await fireEvent.input(screen.getByLabelText(/^Name/), { target: { value: 'New one' } });
    await fireEvent.input(screen.getByLabelText(/^URL/), { target: { value: 'https://new.test' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Create/ }));
    const root = draft().tabs[0].root.children;
    expect(root[root.length - 1]).toMatchObject({ kind: 'tile', name: 'New one', placement: p(18, 0) });
  });

  it("the tile dialog's move/copy section opens the move/copy dialog", async () => {
    await show({ kind: 'tile', id: 'a' });
    await fireEvent.click(screen.getByRole('button', { name: /Move or copy/i }));
    expect(get(editorDialog)).toEqual({ kind: 'movecopy', ids: ['a'] });
  });

  it('Move/Copy dialog: move to another tab and copy into a folder (same dashboard, draft only)', async () => {
    await show({ kind: 'movecopy', ids: ['a'] });
    // The item's own container is listed but cannot be chosen for a move.
    await fireEvent.click(screen.getByRole('treeitem', { name: /^Two/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^Move$/ }));
    expect(draft().tabs[1].root.children.map((n) => n.id)).toContain('a');
    noRequestsButSettingsRead(fetchSpy);
    editorDialog.set({ kind: 'movecopy', ids: ['a'] });
    await tick();
    await fireEvent.keyDown(screen.getByRole('treeitem', { name: /^Main/ }), { key: 'ArrowRight' });
    await fireEvent.click(screen.getByRole('treeitem', { name: /^F1/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    expect((nodeIn(draft(), 'f1') as FolderNode).content.children).toHaveLength(2);
  });

  it('Move/Copy dialog disables a folder as a destination for itself and its descendants', async () => {
    await show({ kind: 'movecopy', ids: ['f1'] });
    await fireEvent.keyDown(screen.getByRole('treeitem', { name: /^Main/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('treeitem', { name: /^F1/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('treeitem', { name: /^C1/ })).not.toHaveAttribute('aria-disabled');
  });

  it('the item menu is rendered from the menu request', async () => {
    render(EditorDialogs, { tabId: 't1' });
    editorMenu.set({ x: 10, y: 10, target: { kind: 'node', id: 'a' } });
    await tick();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  // Real-browser bug: the menu closes itself (the parent nulls `request`) before the
  // action runs, so actions that read the request-derived state threw and did nothing.
  describe('menu actions through the real store wiring (closing nulls the request)', () => {
    async function menuFor(id: string) {
      editorMenu.set({ x: 10, y: 10, target: { kind: 'node', id } });
      await tick();
    }
    const pick = (name: string) => fireEvent.click(screen.getByRole('menuitem', { name }));

    it('Edit on a tile opens the tile dialog', async () => {
      render(EditorDialogs, { tabId: 't1' });
      await menuFor('a');
      await pick('Edit');
      await tick();
      expect(get(editorMenu)).toBeNull();
      expect(get(editorDialog)).toEqual({ kind: 'tile', id: 'a' });
    });

    it('Edit on a folder (expanded or collapsed) opens the folder dialog', async () => {
      render(EditorDialogs, { tabId: 't1' });
      await menuFor('f1');
      await pick('Edit');
      await tick();
      expect(get(editorDialog)).toEqual({ kind: 'folder', id: 'f1' });
      editorDialog.set(null);
      await tick();
      await menuFor('c1');
      await pick('Edit');
      await tick();
      expect(get(editorDialog)).toEqual({ kind: 'folder', id: 'c1' });
    });

    it('Move/Copy to… opens the move/copy dialog for the item', async () => {
      render(EditorDialogs, { tabId: 't1' });
      await menuFor('f1');
      await pick('Move/Copy to…');
      await tick();
      expect(get(editorDialog)).toEqual({ kind: 'movecopy', ids: ['f1'] });
    });

    it('Delete asks, then deletes the item', async () => {
      render(EditorDialogs, { tabId: 't1' });
      await menuFor('b');
      await pick('Delete');
      await answerConfirm(true);
      expect(nodeIn(draft(), 'b')).toBeUndefined();
    });
  });
});

describe('FolderEditModal background (M4 Task 5, Ruling 11(5))', () => {
  beforeEach(() => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ categories: [], images: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    );
  });
  /** Open the folder picker from the dialog, pick Colour at 50%, Save the picker. */
  async function pickColour() {
    await fireEvent.click(screen.getByRole('button', { name: /Background/ }));
    expect(screen.getByRole('heading', { name: /Folder background/i })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^Color$/ }));
    expect(screen.queryByText(/Overlay Darkness/i)).toBeNull();
    await fireEvent.input(screen.getByLabelText(/^Background opacity/), { target: { value: '0.5' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Save Background/ }));
    await tick();
    expect(screen.queryByRole('heading', { name: /Folder background/i })).toBeNull();
  }
  const noWrites = () => {
    for (const [url, init] of fetchSpy.mock.calls) {
      expect(String(url)).toMatch(/\/api\/backgrounds$/);
      expect((init as RequestInit | undefined)?.method ?? 'GET').toBe('GET');
    }
  };

  it('a picked background is staged: the status shows it, but the draft is untouched until the dialog saves', async () => {
    await show({ kind: 'folder', id: 'f1' });
    expect(screen.getByText(/No background of its own/i)).toBeInTheDocument();
    await pickColour();
    expect(screen.getByText(/Colour .*50% opacity/i, { selector: '.background-status' }).textContent).toMatch(/applies when you save/i);
    expect((nodeIn(draft(), 'f1') as FolderNode).background).toBeUndefined();
    expect(get(session)!.undo).toHaveLength(0);
  });

  it('Cancel discards a picked background: draft unchanged, no undo entry', async () => {
    await show({ kind: 'folder', id: 'f1' });
    const before = draft();
    await fireEvent.input(screen.getByLabelText(/Folder name/), { target: { value: 'Renamed' } });
    await pickColour();
    await fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(get(editorDialog)).toBeNull();
    expect(draft()).toBe(before);
    expect(get(session)!.undo).toHaveLength(0);
    expect(get(dirty)).toBe(false);
    noWrites();
  });

  it('Save applies the fields and the background as ONE undo step; undo reverts both', async () => {
    await show({ kind: 'folder', id: 'f1' });
    await fireEvent.input(screen.getByLabelText(/Folder name/), { target: { value: 'Renamed' } });
    await pickColour();
    await fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    const f = nodeIn(draft(), 'f1') as FolderNode;
    expect(f.name).toBe('Renamed');
    expect(f.background).toMatchObject({ type: 'color', opacity: 0.5 });
    expect(get(session)!.undo).toHaveLength(1);
    noWrites();
    undo();
    const back = nodeIn(draft(), 'f1') as FolderNode;
    expect(back.name).toBe('F1');
    expect(back).not.toHaveProperty('background');
    expect(get(dirty)).toBe(false);
  });

  it('picking None removes an existing background on Save (key gone)', async () => {
    const d = home();
    (d.tabs[0].root.children.find((n) => n.id === 'f1') as FolderNode).background = { type: 'color', value: '#000000' };
    resetEditor();
    setLayout([d]);
    startSession();
    await show({ kind: 'folder', id: 'f1' });
    await fireEvent.click(screen.getByRole('button', { name: /Background/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^None$/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^Save Background/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(nodeIn(draft(), 'f1')).not.toHaveProperty('background');
    expect(get(session)!.undo).toHaveLength(1);
  });

  it('a new folder can get a background, set on Create', async () => {
    await show({ kind: 'folder', to: { tabId: 't1' } });
    await fireEvent.input(screen.getByLabelText(/Folder name/), { target: { value: 'Tools' } });
    await pickColour();
    await fireEvent.click(screen.getByRole('button', { name: /^Create/ }));
    const root = draft().tabs[0].root.children;
    const f = root[root.length - 1] as FolderNode;
    expect(f.name).toBe('Tools');
    expect(f.background).toMatchObject({ type: 'color', opacity: 0.5 });
  });
});
