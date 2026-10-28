import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';

import EditorDialogs from './EditorDialogs.svelte';
import TabEditModal from '../admin/TabEditModal.svelte';
import { editorDialog } from '$lib/editor/editorUi';
import { editMode } from '$lib/stores/editMode';
import { undo, session } from '$lib/stores/editSession';
import { editTab } from '$lib/editor/editorActions';
import { resetStatusBaseCache, refreshStatusBase } from '$lib/stores/statusCheckBase';
import { setLayout, resetEditor, startSession, draft, nodeIn, home, folder, tile, p } from './editorTestKit';
import type { FolderNode, TileNode } from '$lib/types/layout';

// M4 Task 7: every level's status-check setting is Inherit / On / Off and the dialog says where
// the effective value comes from (design §4b, Ruling 12, Ruling 3).

type Base = { override: boolean | null; effective: boolean } | 'fail';
let base: Base;
let fetchSpy: ReturnType<typeof vi.fn>;

function settingsBody(b: { override: boolean | null; effective: boolean }) {
  const nulls = {
    statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
    editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
  };
  return {
    overrides: { ...nulls, statusChecksEnabled: b.override },
    effective: {
      statusChecksEnabled: b.effective, statusCheckIntervalMinutes: 5, statusCheckTimeoutSeconds: 10,
      editIdleTimeoutMinutes: 15, animatedFolderBackgrounds: false
    },
    revision: 5
  };
}

function mutations() {
  return fetchSpy.mock.calls.filter(([, init]) => init && init.method && init.method !== 'GET');
}
function settingsCalls() {
  return fetchSpy.mock.calls.filter(([url]) => String(url).includes('/settings'));
}

beforeEach(() => {
  resetEditor();
  resetStatusBaseCache();
  base = { override: false, effective: false };
  fetchSpy = vi.fn((url: string) => {
    if (String(url).endsWith('/dashboards/d1/settings')) {
      if (base === 'fail') return Promise.resolve(new Response('{"error":"boom"}', { status: 500 }));
      return Promise.resolve(new Response(JSON.stringify(settingsBody(base)), { status: 200 }));
    }
    return Promise.reject(new Error('no network in tests'));
  });
  vi.stubGlobal('fetch', fetchSpy);
  editMode.set(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  editorDialog.set(null);
  editMode.set(false);
});

function withF1(over: Partial<FolderNode> = {}, x: Record<string, unknown> = {}) {
  const d = home();
  d.tabs[0].root.children[2] = folder('f1', p(0, 2, 8, 6), [tile('x', p(0, 0), x)], over);
  setLayout([d]);
  startSession();
}

async function show(d: Parameters<typeof editorDialog.set>[0]) {
  render(EditorDialogs, { tabId: 't1' });
  editorDialog.set(d);
  await tick();
}

const radio = (name: 'Inherit' | 'On' | 'Off') => screen.getByRole('radio', { name }) as HTMLInputElement;

describe('tile dialog: tri-state status checks', () => {
  it('a tile with no setting shows Inherit and names where it follows', async () => {
    withF1({ statusChecksEnabled: false } as Partial<FolderNode>);
    await show({ kind: 'tile', id: 'x' });
    expect(screen.getByRole('group', { name: 'Status checks' })).toBeInTheDocument();
    expect(radio('Inherit').checked).toBe(true);
    expect(screen.getByText('Inherited from F1: off')).toBeInTheDocument();
    expect(settingsCalls()).toHaveLength(0);
  });

  it('On under an off dashboard says so, saves into the draft, and is one undo step', async () => {
    withF1();
    await show({ kind: 'tile', id: 'a' });
    const before = draft();
    await fireEvent.click(radio('On'));
    expect(await screen.findByText('Overridden here: on (the dashboard is off)')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect((nodeIn(draft(), 'a') as TileNode).statusCheck?.enabled).toBe(true);
    expect(mutations()).toHaveLength(0);
    undo();
    expect(draft()).toEqual(before);
    expect((nodeIn(draft(), 'a') as TileNode).statusCheck).toBeUndefined();
  });

  it('Inherit names the folder it follows and stores enabled: null', async () => {
    withF1({ statusChecksEnabled: false } as Partial<FolderNode>, { statusCheck: { type: 'http', enabled: true, interval: 60 } });
    await show({ kind: 'tile', id: 'x' });
    await fireEvent.click(radio('Inherit'));
    expect(screen.getByText('Inherited from F1: off')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect((nodeIn(draft(), 'x') as TileNode).statusCheck).toMatchObject({ type: 'http', enabled: null });
  });

  it('an explicit Off says what it overrides; Reset to inherit switches to Inherit', async () => {
    withF1({ statusChecksEnabled: true } as Partial<FolderNode>, { statusCheck: { type: 'http', enabled: false, interval: 60 } });
    await show({ kind: 'tile', id: 'x' });
    expect(radio('Off').checked).toBe(true);
    expect(screen.getByText('Overridden here: off (the folder is on)')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Reset to inherit' }));
    expect(radio('Inherit').checked).toBe(true);
    expect(screen.getByText('Inherited from F1: on')).toBeInTheDocument();
  });

  it('Cancel discards the choice', async () => {
    withF1();
    await show({ kind: 'tile', id: 'a' });
    const before = draft();
    await fireEvent.click(radio('On'));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(draft()).toBe(before);
  });

  it('leaving a tile with no setting on Inherit changes nothing (exact round trip)', async () => {
    withF1();
    await show({ kind: 'tile', id: 'a' });
    await fireEvent.click(radio('On'));
    await fireEvent.click(radio('Inherit'));
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(nodeIn(draft(), 'a')).not.toHaveProperty('statusCheck');
  });
});

describe('folder dialog: tri-state status checks', () => {
  it('shows Checking… while the dashboard settings load, then the inherited value', async () => {
    base = { override: null, effective: true };
    withF1();
    await show({ kind: 'folder', id: 'f1' });
    expect(radio('Inherit').checked).toBe(true);
    expect(screen.getByText('Checking…')).toBeInTheDocument();
    expect(await screen.findByText('Inherited from Settings: on')).toBeInTheDocument();
  });

  it('Off saves statusChecksEnabled: false (one undo step); Reset to inherit removes the key', async () => {
    base = { override: null, effective: true };
    withF1();
    await show({ kind: 'folder', id: 'f1' });
    await fireEvent.click(radio('Off'));
    expect(await screen.findByText('Overridden here: off (the global setting is on)')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect((nodeIn(draft(), 'f1') as FolderNode).statusChecksEnabled).toBe(false);
    const stack = get(session)!.undo.length;

    editorDialog.set({ kind: 'folder', id: 'f1' });
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Reset to inherit' }));
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(nodeIn(draft(), 'f1')).not.toHaveProperty('statusChecksEnabled');
    expect(get(session)!.undo.length).toBe(stack + 1);
    expect(mutations()).toHaveLength(0);
  });

  it('a failed settings fetch is a visible error, never a guessed value', async () => {
    base = 'fail';
    withF1();
    await show({ kind: 'folder', id: 'f1' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/couldn't check/i);
    expect(screen.queryByText(/Inherited from/)).toBeNull();
  });

  it('Retry after a failed read fetches again and then shows the value', async () => {
    base = 'fail';
    withF1();
    await show({ kind: 'folder', id: 'f1' });
    await screen.findByRole('alert');
    base = { override: false, effective: false };
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Inherited from Home: off')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(settingsCalls()).toHaveLength(2);
  });

  it('the dashboard settings are fetched once per dashboard, and again after a settings save', async () => {
    base = { override: null, effective: true };
    withF1();
    await show({ kind: 'folder', id: 'f1' });
    await screen.findByText('Inherited from Settings: on');
    editorDialog.set(null);
    await tick();
    editorDialog.set({ kind: 'folder', id: 'c1' });
    await tick();
    await screen.findByText('Inherited from Settings: on');
    expect(settingsCalls()).toHaveLength(1);
    base = { override: false, effective: false };
    await refreshStatusBase('d1');
    expect(await screen.findByText('Inherited from Home: off')).toBeInTheDocument();
    expect(settingsCalls()).toHaveLength(2);
  });
});

describe('tab dialog: tri-state status checks', () => {
  const ctx = { dashboardId: 'd1', dashboardName: 'Home', tab: null, folders: [] };

  it('Inherit shows the dashboard value; Off is returned to the caller; untouched is undefined', async () => {
    const onSave = vi.fn();
    render(TabEditModal, { tabName: 'Main', statusContext: ctx, onSave, onCancel: vi.fn() });
    expect(radio('Inherit').checked).toBe(true);
    expect(await screen.findByText('Inherited from Home: off')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave.mock.calls[0][7]).toBeUndefined();
  });

  it('On is saved as true and says what it overrides', async () => {
    const onSave = vi.fn();
    render(TabEditModal, { tabName: 'Main', statusContext: ctx, onSave, onCancel: vi.fn() });
    await fireEvent.click(radio('On'));
    expect(await screen.findByText('Overridden here: on (the dashboard is off)')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave.mock.calls[0][7]).toBe(true);
  });

  it('Reset to inherit on a set tab returns null (remove the key)', async () => {
    const onSave = vi.fn();
    render(TabEditModal, { tabName: 'Main', tabStatusChecks: false, statusContext: ctx, onSave, onCancel: vi.fn() });
    expect(radio('Off').checked).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Reset to inherit' }));
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave.mock.calls[0][7]).toBeNull();
  });

  it('editTab: true/false set the key, null removes it, undefined leaves it (draft, undoable)', () => {
    setLayout([home()]);
    startSession();
    expect(editTab('t1', { name: 'Main', statusChecksEnabled: false })).toBe(true);
    expect(draft().tabs[0].statusChecksEnabled).toBe(false);
    expect(editTab('t1', { name: 'Main' })).toBe(true);
    expect(draft().tabs[0].statusChecksEnabled).toBe(false);
    expect(editTab('t1', { name: 'Main', statusChecksEnabled: null })).toBe(true);
    expect(draft().tabs[0]).not.toHaveProperty('statusChecksEnabled');
    undo();
    expect(draft().tabs[0].statusChecksEnabled).toBe(false);
  });
});

describe('an invalid stored value', () => {
  it('is said so, no choice is pre-selected, and Save keeps the stored value untouched', async () => {
    withF1({ statusChecksEnabled: 'yes' } as unknown as Partial<FolderNode>);
    await show({ kind: 'folder', id: 'f1' });
    expect(screen.getByText(/^Invalid setting here: treated as off/)).toBeInTheDocument();
    expect(radio('Inherit').checked || radio('On').checked || radio('Off').checked).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(get(editorDialog)).toBeNull());
    expect((nodeIn(draft(), 'f1') as FolderNode).statusChecksEnabled).toBe('yes');
  });
});
