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

// A tile's status check is On / Off; a dashboard, tab or folder is a gate, Enabled / Disabled.
// The row says when a Disabled gate above stops the level (or the tile) having any effect.

type Base = { override: boolean | null; global: boolean } | 'fail';
let base: Base;
let fetchSpy: ReturnType<typeof vi.fn>;

function settingsBody(b: { override: boolean | null; global: boolean }) {
  const nulls = {
    statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
    editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
  };
  return {
    overrides: { ...nulls, statusChecksEnabled: b.override },
    effective: {
      statusChecksEnabled: b.global && b.override !== false, statusCheckIntervalMinutes: 5, statusCheckTimeoutSeconds: 10,
      editIdleTimeoutMinutes: 15, animatedFolderBackgrounds: false
    },
    revision: 5
  };
}

function mutations() {
  return fetchSpy.mock.calls.filter(([, init]) => init && init.method && init.method !== 'GET');
}
function settingsCalls() {
  return fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/dashboards/d1/settings'));
}

beforeEach(() => {
  resetEditor();
  resetStatusBaseCache();
  base = { override: false, global: true };
  fetchSpy = vi.fn((url: string) => {
    if (String(url).endsWith('/dashboards/d1/settings')) {
      if (base === 'fail') return Promise.resolve(new Response('{"error":"boom"}', { status: 500 }));
      return Promise.resolve(new Response(JSON.stringify(settingsBody(base)), { status: 200 }));
    }
    if (String(url).endsWith('/api/settings')) {
      const g = base === 'fail' ? true : base.global;
      return Promise.resolve(new Response(JSON.stringify({ settings: [{ key: 'status.checks_enabled', value: String(g) }] }), { status: 200 }));
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

const radio = (name: 'On' | 'Off' | 'Enabled' | 'Disabled') => screen.getByRole('radio', { name }) as HTMLInputElement;

describe('tile dialog: On / Off', () => {
  it('a tile with no setting is Off and asks nothing of the server; there is no Inherit', async () => {
    withF1({ statusChecksEnabled: false } as Partial<FolderNode>);
    await show({ kind: 'tile', id: 'x' });
    expect(screen.getByRole('group', { name: 'Status check' })).toBeInTheDocument();
    expect(radio('Off').checked).toBe(true);
    expect(screen.queryByRole('radio', { name: 'Inherit' })).toBeNull();
    expect(screen.queryByTestId('status-blocked')).toBeNull();
    expect(settingsCalls()).toHaveLength(0);
  });

  it('On under a Disabled dashboard says it is not checked, saves into the draft, and is one undo step', async () => {
    withF1();
    await show({ kind: 'tile', id: 'a' });
    const before = draft();
    await fireEvent.click(radio('On'));
    expect(await screen.findByText('Not checked: status monitoring is disabled on dashboard Home')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect((nodeIn(draft(), 'a') as TileNode).statusCheck?.enabled).toBe(true);
    expect(mutations()).toHaveLength(0);
    undo();
    expect(draft()).toEqual(before);
    expect((nodeIn(draft(), 'a') as TileNode).statusCheck).toBeUndefined();
  });

  it('On names the outermost Disabled gate: the folder under an Enabled dashboard, Settings above all', async () => {
    base = { override: null, global: true };
    withF1({ statusChecksEnabled: false } as Partial<FolderNode>, { statusCheck: { type: 'http', enabled: true } });
    await show({ kind: 'tile', id: 'x' });
    expect(radio('On').checked).toBe(true);
    expect(await screen.findByText('Not checked: status monitoring is disabled on folder F1')).toBeInTheDocument();
    editorDialog.set(null);
    await tick();
    resetStatusBaseCache();
    base = { override: false, global: false };
    editorDialog.set({ kind: 'tile', id: 'x' });
    await tick();
    expect(await screen.findByText('Not checked: status monitoring is disabled in Settings')).toBeInTheDocument();
  });

  it('On with every gate Enabled says nothing more', async () => {
    base = { override: null, global: true };
    withF1({}, { statusCheck: { type: 'http', enabled: true } });
    await show({ kind: 'tile', id: 'x' });
    await waitFor(() => expect(screen.queryByText('Checking…')).toBeNull());
    expect(screen.queryByTestId('status-blocked')).toBeNull();
  });

  it('Off keeps the other statusCheck fields and stores enabled: false', async () => {
    withF1({}, { statusCheck: { type: 'http', enabled: true, interval: 60 } });
    await show({ kind: 'tile', id: 'x' });
    await fireEvent.click(radio('Off'));
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect((nodeIn(draft(), 'x') as TileNode).statusCheck).toEqual({ type: 'http', enabled: false, interval: 60 });
  });

  it('Cancel discards the choice', async () => {
    withF1();
    await show({ kind: 'tile', id: 'a' });
    const before = draft();
    await fireEvent.click(radio('On'));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(draft()).toBe(before);
  });

  it('leaving a tile with no setting on Off changes nothing (exact round trip)', async () => {
    withF1();
    await show({ kind: 'tile', id: 'a' });
    await fireEvent.click(radio('On'));
    await fireEvent.click(radio('Off'));
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(nodeIn(draft(), 'a')).not.toHaveProperty('statusCheck');
  });
});

describe('folder dialog: Enabled / Disabled', () => {
  it('shows Checking… while the gates above load, then that the dashboard makes it have no effect', async () => {
    withF1();
    await show({ kind: 'folder', id: 'f1' });
    expect(screen.getByRole('group', { name: 'Status checks for tiles in this folder' })).toBeInTheDocument();
    expect(radio('Enabled').checked).toBe(true);
    expect(screen.getByText('Checking…')).toBeInTheDocument();
    expect(await screen.findByText('Status monitoring is disabled on dashboard Home, so this setting has no effect')).toBeInTheDocument();
  });

  it('Disabled saves statusChecksEnabled: false with its hint (one undo step); Enabled removes the key', async () => {
    base = { override: null, global: true };
    withF1();
    await show({ kind: 'folder', id: 'f1' });
    await fireEvent.click(radio('Disabled'));
    expect(screen.getByText('No tile in this folder is checked, whatever its own setting.')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect((nodeIn(draft(), 'f1') as FolderNode).statusChecksEnabled).toBe(false);
    const stack = get(session)!.undo.length;

    editorDialog.set({ kind: 'folder', id: 'f1' });
    await tick();
    await fireEvent.click(radio('Enabled'));
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(nodeIn(draft(), 'f1')).not.toHaveProperty('statusChecksEnabled');
    expect(get(session)!.undo.length).toBe(stack + 1);
    expect(mutations()).toHaveLength(0);
  });

  it('a stored true reads as Enabled', async () => {
    base = { override: null, global: true };
    withF1({ statusChecksEnabled: true } as Partial<FolderNode>);
    await show({ kind: 'folder', id: 'f1' });
    expect(radio('Enabled').checked).toBe(true);
  });

  it('a failed settings fetch is a visible error, never a guessed value', async () => {
    base = 'fail';
    withF1();
    await show({ kind: 'folder', id: 'f1' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/couldn't check/i);
    expect(screen.queryByTestId('status-blocked')).toBeNull();
  });

  it('Retry after a failed read fetches again and then shows the result', async () => {
    base = 'fail';
    withF1();
    await show({ kind: 'folder', id: 'f1' });
    await screen.findByRole('alert');
    base = { override: false, global: true };
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/disabled on dashboard Home/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(settingsCalls()).toHaveLength(2);
  });

  it('the gates are fetched once per dashboard, and again after a settings save', async () => {
    base = { override: null, global: true };
    withF1();
    await show({ kind: 'folder', id: 'f1' });
    await waitFor(() => expect(screen.queryByText('Checking…')).toBeNull());
    editorDialog.set(null);
    await tick();
    editorDialog.set({ kind: 'folder', id: 'c1' });
    await tick();
    await waitFor(() => expect(screen.queryByText('Checking…')).toBeNull());
    expect(settingsCalls()).toHaveLength(1);
    base = { override: false, global: true };
    await refreshStatusBase('d1');
    expect(await screen.findByText(/disabled on dashboard Home/)).toBeInTheDocument();
    expect(settingsCalls()).toHaveLength(2);
  });
});

describe('tab dialog: Enabled / Disabled', () => {
  const ctx = { dashboardId: 'd1', dashboardName: 'Home', tab: null, folders: [] };

  it('Enabled by default, says the Disabled dashboard above makes it have no effect; untouched is undefined', async () => {
    const onSave = vi.fn();
    render(TabEditModal, { tabName: 'Main', statusContext: ctx, onSave, onCancel: vi.fn() });
    expect(radio('Enabled').checked).toBe(true);
    expect(await screen.findByText('Status monitoring is disabled on dashboard Home, so this setting has no effect')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave.mock.calls[0][7]).toBeUndefined();
  });

  it('Disabled is returned as false', async () => {
    const onSave = vi.fn();
    render(TabEditModal, { tabName: 'Main', statusContext: ctx, onSave, onCancel: vi.fn() });
    await fireEvent.click(radio('Disabled'));
    expect(screen.getByText('No tile in this tab is checked, whatever its own setting.')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave.mock.calls[0][7]).toBe(false);
  });

  it('Enabled on a Disabled tab returns null (remove the key)', async () => {
    const onSave = vi.fn();
    render(TabEditModal, { tabName: 'Main', tabStatusChecks: false, statusContext: ctx, onSave, onCancel: vi.fn() });
    expect(radio('Disabled').checked).toBe(true);
    await fireEvent.click(radio('Enabled'));
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave.mock.calls[0][7]).toBeNull();
  });

  it('editTab: false sets the key, null or true remove it, undefined leaves it (draft, undoable)', () => {
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
    expect(editTab('t1', { name: 'Main', statusChecksEnabled: true })).toBe(true);
    expect(draft().tabs[0]).not.toHaveProperty('statusChecksEnabled');
  });
});

describe('an invalid stored value', () => {
  it('is said so, no choice is pre-selected, and Save keeps the stored value untouched', async () => {
    withF1({ statusChecksEnabled: 'yes' } as unknown as Partial<FolderNode>);
    await show({ kind: 'folder', id: 'f1' });
    expect(screen.getByText(/^\s*Invalid setting here: no tile in this folder is checked/)).toBeInTheDocument();
    expect(radio('Enabled').checked || radio('Disabled').checked).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(get(editorDialog)).toBeNull());
    expect((nodeIn(draft(), 'f1') as FolderNode).statusChecksEnabled).toBe('yes');
  });
});
