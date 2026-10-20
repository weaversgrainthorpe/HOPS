import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { tick } from 'svelte';

// Spy on the tree ops while keeping their real behaviour, so a test can see
// which op an action ran AND what it did to the draft.
vi.mock('$lib/editor/treeOps', async () => {
  const real = await vi.importActual<typeof import('$lib/editor/treeOps')>('$lib/editor/treeOps');
  const spy = <K extends keyof typeof real>(k: K) => vi.fn(real[k] as (...a: unknown[]) => unknown);
  return {
    ...real,
    duplicateNode: spy('duplicateNode'),
    deleteNodes: spy('deleteNodes'),
    copyNodes: spy('copyNodes'),
    pasteSnapshot: spy('pasteSnapshot'),
    moveNodes: spy('moveNodes'),
    setZ: spy('setZ'),
    setFolderDisplay: spy('setFolderDisplay'),
    setFolderLayout: spy('setFolderLayout'),
    insertNode: spy('insertNode')
  };
});

import * as ops from '$lib/editor/treeOps';
import NodeContextMenu from './NodeContextMenu.svelte';
import { editorDialog, type MenuRequest } from '$lib/editor/editorUi';
import { nodeClipboard } from '$lib/stores/nodeClipboard';
import { selectedNodes, toggleNode } from '$lib/stores/nodeSelection';
import { overlayStack, openFolder } from '$lib/stores/folderOverlay';
import { undo, session } from '$lib/stores/editSession';
import { editMode } from '$lib/stores/editMode';
import EditorDialogs from './EditorDialogs.svelte';
import { setLayout, resetEditor, startSession, draft, nodeIn, answerConfirm } from './editorTestKit';
import type { FolderNode } from '$lib/types/layout';

function open(target: MenuRequest['target']) {
  const onClose = vi.fn();
  const r = render(NodeContextMenu, { request: { x: 40, y: 50, target }, onClose });
  return { ...r, onClose };
}
const item = (name: RegExp | string) => screen.getByRole('menuitem', { name });

beforeEach(() => {
  vi.clearAllMocks();
  resetEditor();
  setLayout();
  startSession();
});

describe('NodeContextMenu — structure and keyboard', () => {
  it('is a menu of menuitems, focuses the first item, and arrows move between items', async () => {
    open({ kind: 'node', id: 'a' });
    await tick();
    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitem').filter((b) => !(b as HTMLButtonElement).disabled);
    expect(document.activeElement).toBe(items[0]);
    await fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    await fireEvent.keyDown(menu, { key: 'ArrowUp' });
    await fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    await fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    await fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('Escape closes it and is not passed on (an open folder overlay stays open)', async () => {
    openFolder('f1');
    const { onClose } = open({ kind: 'node', id: 'x' });
    await tick();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    screen.getByRole('menu').dispatchEvent(ev);
    expect(onClose).toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
    expect(get(overlayStack)).toEqual(['f1']);
  });

  it('a tile in a grid offers the v2 actions and no z-order; a free tile adds Bring forward / Send back', async () => {
    const r = open({ kind: 'node', id: 'a' });
    for (const n of ['Edit', 'Duplicate', 'Cut', 'Copy', 'Paste here', 'Move/Copy to…', 'Delete']) expect(item(n)).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Bring forward' })).toBeNull();
    r.unmount();
    open({ kind: 'node', id: 'fa' });
    expect(item('Bring forward')).toBeInTheDocument();
    expect(item('Send back')).toBeInTheDocument();
  });

  it('right-clicking an unselected item selects just it', () => {
    toggleNode('b', false);
    open({ kind: 'node', id: 'a' });
    expect([...get(selectedNodes)]).toEqual(['a']);
  });
});

describe('NodeContextMenu — each action calls the right op', () => {
  it('Edit opens the tile dialog; for a folder, the folder dialog', async () => {
    const r = open({ kind: 'node', id: 'a' });
    await fireEvent.click(item('Edit'));
    expect(get(editorDialog)).toEqual({ kind: 'tile', id: 'a' });
    expect(r.onClose).toHaveBeenCalled();
    r.unmount();
    open({ kind: 'node', id: 'f1' });
    await fireEvent.click(item('Edit'));
    expect(get(editorDialog)).toEqual({ kind: 'folder', id: 'f1' });
  });

  it('Duplicate (folder) → duplicateNode: a deep copy with new ids', async () => {
    open({ kind: 'node', id: 'f1' });
    await fireEvent.click(item('Duplicate'));
    expect(ops.duplicateNode).toHaveBeenCalledTimes(1);
    const root = draft().tabs[0].root.children;
    const copy = root[root.length - 1] as FolderNode;
    expect(copy.kind).toBe('folder');
    expect(copy.id).not.toBe('f1');
    expect(copy.content.children[0].id).not.toBe('x');
    expect([...get(selectedNodes)]).toEqual([copy.id]);
  });

  it('Delete asks, then deleteNodes; Undo brings it back', async () => {
    open({ kind: 'node', id: 'b' });
    await fireEvent.click(item('Delete'));
    expect(ops.deleteNodes).not.toHaveBeenCalled();
    await answerConfirm(true);
    expect(ops.deleteNodes).toHaveBeenCalledTimes(1);
    expect(nodeIn(draft(), 'b')).toBeUndefined();
    undo();
    expect(nodeIn(draft(), 'b')).toBeDefined();
  });

  it('Delete cancelled changes nothing', async () => {
    const before = draft();
    open({ kind: 'node', id: 'b' });
    await fireEvent.click(item('Delete'));
    await answerConfirm(false);
    expect(draft()).toBe(before);
  });

  it('Delete acts on the whole selection when the item is part of it', async () => {
    toggleNode('a', false);
    toggleNode('b', true);
    open({ kind: 'node', id: 'b' });
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull(); // single-item actions hidden
    await fireEvent.click(item('Delete 2 items'));
    await answerConfirm(true);
    expect(vi.mocked(ops.deleteNodes).mock.calls.at(-1)![1]).toEqual(['a', 'b']);
  });

  it('Copy and Cut fill the clipboard; Paste here on a folder → pasteSnapshot (copy) / moveNodes (cut)', async () => {
    let r = open({ kind: 'node', id: 'a' });
    await fireEvent.click(item('Copy'));
    expect(get(nodeClipboard)).toMatchObject({ mode: 'copy', sourceDashboardId: 'd1' });
    r.unmount();
    r = open({ kind: 'node', id: 'f1' });
    await fireEvent.click(item('Paste here'));
    await tick();
    expect(ops.pasteSnapshot).toHaveBeenCalledTimes(1);
    expect((nodeIn(draft(), 'f1') as FolderNode).content.children).toHaveLength(2);
    r.unmount();
    r = open({ kind: 'node', id: 'b' });
    await fireEvent.click(item('Cut'));
    expect(get(nodeClipboard)).toMatchObject({ mode: 'cut' });
    r.unmount();
    open({ kind: 'node', id: 'x' }); // paste beside x = into f1
    await fireEvent.click(item('Paste here'));
    await tick();
    expect(ops.moveNodes).toHaveBeenCalledTimes(1);
    expect((nodeIn(draft(), 'f1') as FolderNode).content.children.map((n) => n.id)).toContain('b');
  });

  it('Paste here is disabled with an empty clipboard', () => {
    open({ kind: 'node', id: 'a' });
    expect((item('Paste here') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Move/Copy to… opens the move/copy dialog for the selection', async () => {
    open({ kind: 'node', id: 'a' });
    await fireEvent.click(item('Move/Copy to…'));
    expect(get(editorDialog)).toEqual({ kind: 'movecopy', ids: ['a'] });
  });

  it('Bring forward / Send back → setZ in free mode', async () => {
    let r = open({ kind: 'node', id: 'fa' });
    await fireEvent.click(item('Bring forward'));
    expect(ops.setZ).toHaveBeenLastCalledWith(expect.anything(), 'fa', 'forward');
    expect(nodeIn(draft(), 'fa')!.placement.z).toBe(2);
    r.unmount();
    r = open({ kind: 'node', id: 'fa' });
    await fireEvent.click(item('Send back'));
    expect(ops.setZ).toHaveBeenLastCalledWith(expect.anything(), 'fa', 'back');
  });

  it('a folder offers "Start collapsed" / "Start expanded" → setFolderDisplay (saved default, undoable)', async () => {
    let r = open({ kind: 'node', id: 'f1' });
    expect(screen.queryByRole('menuitem', { name: 'Start expanded' })).toBeNull();
    await fireEvent.click(item('Start collapsed'));
    expect(ops.setFolderDisplay).toHaveBeenLastCalledWith(expect.anything(), 'f1', 'collapsed');
    expect((nodeIn(draft(), 'f1') as FolderNode).display).toBe('collapsed');
    r.unmount();
    r = open({ kind: 'node', id: 'f1' });
    await fireEvent.click(item('Start expanded'));
    expect((nodeIn(draft(), 'f1') as FolderNode).display).toBe('expanded');
    undo();
    expect((nodeIn(draft(), 'f1') as FolderNode).display).toBe('collapsed');
  });

  it('a collapsed folder offers Open, which opens its overlay', async () => {
    open({ kind: 'node', id: 'c1' });
    await fireEvent.click(item('Open'));
    expect(get(overlayStack)).toEqual(['c1']);
  });

  it('empty space: Add tile here / Add folder here open the new-item dialog at that cell; Paste here pastes there', async () => {
    let r = open({ kind: 'container', ref: { tabId: 't1' }, cell: { x: 9, y: 0 } });
    await fireEvent.click(item('Add tile here'));
    expect(get(editorDialog)).toEqual({ kind: 'tile', to: { tabId: 't1' }, cell: { x: 9, y: 0 } });
    r.unmount();
    r = open({ kind: 'container', ref: { tabId: 't1', folderId: 'f1' }, cell: { x: 2, y: 1 } });
    await fireEvent.click(item('Add folder here'));
    expect(get(editorDialog)).toEqual({ kind: 'folder', to: { tabId: 't1', folderId: 'f1' }, cell: { x: 2, y: 1 } });
    r.unmount();
    toggleNode('a', false);
    const { copySelection } = await import('$lib/stores/nodeClipboard');
    copySelection();
    open({ kind: 'container', ref: { tabId: 't1' }, cell: { x: 9, y: 0 } });
    await fireEvent.click(item('Paste here'));
    await tick();
    const root = draft().tabs[0].root.children;
    expect(root[root.length - 1].placement).toEqual({ x: 9, y: 0, w: 1, h: 1 });
  });

  it('an item that no longer exists shows a visible note instead of actions', () => {
    open({ kind: 'node', id: 'gone' });
    expect(screen.getByRole('menu').textContent).toMatch(/no longer exists/i);
  });

  it('the folder dialog saves "Starts" via setFolderDisplay and the layout via setFolderLayout, as ONE undo step', async () => {
    editMode.set(true);
    render(EditorDialogs, { tabId: 't1' });
    editorDialog.set({ kind: 'folder', id: 'f1' });
    await tick();
    await fireEvent.click(screen.getByRole('radio', { name: 'Collapsed' }));
    await fireEvent.change(screen.getByLabelText('Layout'), { target: { value: 'free' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(ops.setFolderDisplay).toHaveBeenLastCalledWith(expect.anything(), 'f1', 'collapsed');
    expect(ops.setFolderLayout).toHaveBeenLastCalledWith(expect.anything(), 'f1', 'free');
    const f1 = nodeIn(draft(), 'f1') as FolderNode;
    expect(f1.display).toBe('collapsed');
    expect(f1.content.columns).toBe(4 * 13); // content converted (side 13 for 1280)
    expect(get(session)!.undo).toHaveLength(1);
    editMode.set(false);
  });
});
