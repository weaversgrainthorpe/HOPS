import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { tick } from 'svelte';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn(),
  transferNodes: vi.fn(),
  getConfig: vi.fn(() => new Promise(() => {})) // a background reload never lands in these tests
}));

import * as api from '$lib/utils/api';
import EditToolbar from './EditToolbar.svelte';
import NodeContextMenu from './NodeContextMenu.svelte';
import { apply, dirty } from '$lib/stores/editSession';
import { updateNode } from '$lib/editor/treeOps';
import { editorDialog } from '$lib/editor/editorUi';
import { selectedNodes, toggleNode } from '$lib/stores/nodeSelection';
import { nodeClipboard } from '$lib/stores/nodeClipboard';
import { confirmModalState } from '$lib/stores/confirmModal';
import { setLayout, resetEditor, startSession, draft, nodeIn, answerConfirm } from './editorTestKit';
import * as kit from './editorTestKit';
import type { FolderNode, LayoutNode } from '$lib/types/layout';
import type { Background } from '$lib/types';
import { reportBackgroundError, clearBackgroundErrors } from '$lib/stores/backgroundErrors';

const rename = (id: string, name: string) =>
  apply('Rename', (d) => updateNode(d, id, { name } as Partial<LayoutNode>));
const key = (k: string, mods: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(window, { key: k, ...mods });

beforeEach(() => {
  vi.clearAllMocks();
  resetEditor();
  setLayout();
  startSession();
});

describe('EditToolbar', () => {
  it('has Save, Discard, Undo, Redo, Add tile, Add folder, Add tab; "Unsaved changes" only when dirty', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    for (const n of ['Save', 'Discard', 'Undo', 'Redo', 'Add tile', 'Add folder', 'Add tab']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${n}`) })).toBeInTheDocument();
    }
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect((screen.getByRole('button', { name: /^Undo/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /^Save/ }) as HTMLButtonElement).disabled).toBe(true);
    rename('a', 'Changed');
    await tick();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect((screen.getByRole('button', { name: /^Undo/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Undo / Redo buttons step the draft', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    rename('a', 'Changed');
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(nodeIn(draft(), 'a')!.name).toBe('A');
    await fireEvent.click(screen.getByRole('button', { name: /^Redo/ }));
    expect(nodeIn(draft(), 'a')!.name).toBe('Changed');
  });

  it('Ctrl+Z undoes; Ctrl+Shift+Z and Ctrl+Y redo; Cmd works too', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    rename('a', 'One');
    rename('a', 'Two');
    await key('z', { ctrlKey: true });
    expect(nodeIn(draft(), 'a')!.name).toBe('One');
    await key('z', { metaKey: true });
    expect(nodeIn(draft(), 'a')!.name).toBe('A');
    await key('Z', { ctrlKey: true, shiftKey: true });
    expect(nodeIn(draft(), 'a')!.name).toBe('One');
    await key('y', { ctrlKey: true });
    expect(nodeIn(draft(), 'a')!.name).toBe('Two');
  });

  it('Ctrl+S saves the draft (one v3 save), and the browser save dialog is suppressed', async () => {
    vi.mocked(api.saveDashboardV3).mockResolvedValue({ revision: 6 });
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    rename('a', 'Changed');
    const ev = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.saveDashboardV3).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.saveDashboardV3).mock.calls[0][0]).toBe('d1');
    expect(get(dirty)).toBe(false);
  });

  it('shortcuts are ignored while typing in a field', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    rename('a', 'Changed');
    const input = document.createElement('input');
    document.body.appendChild(input);
    await fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(nodeIn(draft(), 'a')!.name).toBe('Changed');
    input.remove();
  });

  it('Discard asks, then restores the saved dashboard', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    rename('a', 'Changed');
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: /^Discard/ }));
    expect(get(confirmModalState).isOpen).toBe(true);
    await answerConfirm(true);
    expect(get(dirty)).toBe(false);
    expect(nodeIn(draft(), 'a')!.name).toBe('A');
  });

  it('Add tile / Add folder open the new-item dialog for the tab root (folders open in place: a folder\'s menu adds into it)', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: /^Add tile/ }));
    expect(get(editorDialog)).toEqual({ kind: 'tile', to: { tabId: 't1' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Add folder/ }));
    expect(get(editorDialog)).toEqual({ kind: 'folder', to: { tabId: 't1' } });
  });

  it('holds the Dashboard pencil: labelled "Dashboard", always shown, and it calls its handler', async () => {
    const onEditDashboard = vi.fn();
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn(), onEditDashboard });
    const bar = screen.getByRole('toolbar', { name: 'Editing' });
    const handle = within(bar).getByRole('button', { name: 'Edit Dashboard' });
    expect(handle).toHaveTextContent('Dashboard');
    await fireEvent.click(handle);
    expect(onEditDashboard).toHaveBeenCalledTimes(1);
  });

  it('shows a failed dashboard / tab background as a compact warning inside the toolbar (never silent)', async () => {
    clearBackgroundErrors();
    const bg = (value: string) => ({ type: 'image', value }) as Background;
    const r = render(EditToolbar, {
      tabId: 't1', onAddTab: vi.fn(), onEditDashboard: vi.fn(),
      dashboardBackground: bg('/backgrounds/dash.jpg'), tabBackground: bg('/backgrounds/tab.jpg')
    });
    const bar = screen.getByRole('toolbar', { name: 'Editing' });
    expect(bar.querySelector('[data-bg-failed]')).toBeNull();
    reportBackgroundError('/backgrounds/dash.jpg');
    await tick();
    expect(bar.querySelector('[data-bg-failed="dashboard"]')?.textContent).toContain("couldn't be loaded");
    expect(bar.querySelector('[data-bg-failed="tab"]')).toBeNull();
    reportBackgroundError('/backgrounds/tab.jpg');
    await tick();
    expect(bar.querySelector('[data-bg-failed="tab"]')?.textContent).toContain("couldn't be loaded");
    r.unmount();
    clearBackgroundErrors();
  });

  it('Add tab calls its handler', async () => {
    const onAddTab = vi.fn();
    render(EditToolbar, { tabId: 't1', onAddTab });
    await fireEvent.click(screen.getByRole('button', { name: /^Add tab/ }));
    expect(onAddTab).toHaveBeenCalled();
  });

  it('Escape clears the selection', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    toggleNode('a', false);
    toggleNode('b', true);
    await key('Escape');
    expect(get(selectedNodes).size).toBe(0);
  });

  it('Ctrl+C / Ctrl+X / Ctrl+V copy, cut and paste the selection into the tab root', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    toggleNode('a', false);
    await key('c', { ctrlKey: true });
    expect(get(nodeClipboard)!.mode).toBe('copy');
    const before = draft().tabs[0].root.children.length;
    await key('v', { ctrlKey: true });
    await tick();
    expect(draft().tabs[0].root.children).toHaveLength(before + 1);
    expect((nodeIn(draft(), 'f1') as FolderNode).content.children).toHaveLength(1);
    toggleNode('b', false);
    await key('x', { ctrlKey: true });
    expect(get(nodeClipboard)!.mode).toBe('cut');
    toggleNode('x', false);
    await key('v', { ctrlKey: true });
    await tick();
    // Into the tab root. b was already there, so it moves to a free cell.
    expect(nodeIn(draft(), 'b')).toBeDefined();
    expect(get(nodeClipboard)).toBeNull();
  });

  it('Delete deletes the selection after asking', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    toggleNode('a', false);
    await key('Delete');
    await answerConfirm(true);
    expect(nodeIn(draft(), 'a')).toBeUndefined();
  });

  it('shortcuts are ignored while a modal dialog is open', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    rename('a', 'Changed');
    toggleNode('b', false);
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    document.body.appendChild(dlg);
    await key('z', { ctrlKey: true });
    await key('Delete');
    expect(nodeIn(draft(), 'a')!.name).toBe('Changed');
    expect(get(confirmModalState).isOpen).toBe(false);
    dlg.remove();
  });

  it('keys pressed in an open item menu never reach the shortcuts (Delete, Ctrl+Z, Ctrl+C/X/V)', async () => {
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    render(NodeContextMenu, { request: { x: 1, y: 1, target: { kind: 'node', id: 'b' } }, onClose: vi.fn() });
    await tick();
    rename('a', 'Changed');
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute('role')).toBe('menuitem');
    await fireEvent.keyDown(focused, { key: 'Delete' });
    await fireEvent.keyDown(focused, { key: 'Backspace' });
    await fireEvent.keyDown(focused, { key: 'z', ctrlKey: true });
    await fireEvent.keyDown(focused, { key: 'c', ctrlKey: true });
    await fireEvent.keyDown(focused, { key: 'x', ctrlKey: true });
    await fireEvent.keyDown(focused, { key: 'v', ctrlKey: true });
    expect(get(confirmModalState).isOpen).toBe(false);
    expect(nodeIn(draft(), 'a')!.name).toBe('Changed');
    expect(get(nodeClipboard)).toBeNull();
  });
});

describe('§9 saved tick', () => {
  const animated: { el: Element; kind: string | null }[] = [];
  beforeEach(async () => {
    animated.length = 0;
    const { setAnimationEnv } = await import('$lib/editor/drag/dropAnimation');
    setAnimationEnv({
      reducedMotion: () => false,
      animate: (el) => {
        animated.push({ el, kind: (el as HTMLElement).dataset.savedTick !== undefined ? 'tick' : null });
        return { onfinish: null, oncancel: null, cancel() {} } as unknown as Animation;
      }
    });
    setLayoutWithAnimations('on');
  });
  const setLayoutWithAnimations = (mode: 'on' | 'off') => {
    resetEditor();
    const { home, other } = kit;
    const h = home();
    h.display = { animatedFolderBackgrounds: false, animations: mode };
    setLayout([h, other()]);
    startSession();
  };

  it('a successful save shows the tick on the Save control', async () => {
    vi.mocked(api.saveDashboardV3).mockResolvedValue({ revision: 6 });
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    rename('a', 'Changed');
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await vi.waitFor(() => expect(animated.filter((a) => a.kind === 'tick')).toHaveLength(1));
  });

  it('a failed save never shows it (the failure keeps its visible error)', async () => {
    vi.mocked(api.saveDashboardV3).mockRejectedValue(new Error('disk full'));
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    rename('a', 'Changed');
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await vi.waitFor(() => expect(api.saveDashboardV3).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(animated.filter((a) => a.kind === 'tick')).toHaveLength(0);
    expect(get(dirty)).toBe(true);
  });

  it('animations Off: a successful save shows no tick', async () => {
    setLayoutWithAnimations('off');
    vi.mocked(api.saveDashboardV3).mockResolvedValue({ revision: 6 });
    render(EditToolbar, { tabId: 't1', onAddTab: vi.fn() });
    rename('a', 'Changed');
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await vi.waitFor(() => expect(get(dirty)).toBe(false));
    expect(animated).toHaveLength(0);
  });
});
