import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  transferNodes: vi.fn(),
  getConfig: vi.fn(async () => { throw new Error('offline in tests'); })
}));

import * as api from '$lib/utils/api';
import MoveCopyDialog from './MoveCopyDialog.svelte';
import { apply, dirty, session, sessionConflict } from '$lib/stores/editSession';
import { updateNode } from '$lib/editor/treeOps';
import { toast } from '$lib/stores/toast';
import { setLayout, resetEditor, startSession, draft, nodeIn, home, other, folder, tile, p } from './editorTestKit';
import type { FolderNode, LayoutDashboard } from '$lib/types/layout';

/** d1 gets f1 > g1 > h1 (three deep); dashboard o gets of1 > of2 > of3. */
function deepHome(): LayoutDashboard {
  const h = home();
  const f1 = h.tabs[0].root.children.find((n) => n.id === 'f1') as FolderNode;
  f1.content.children.push(folder('g1', p(4, 0, 4, 4), [folder('h1', p(0, 0, 2, 2), [])]));
  return h;
}
function deepOther(): LayoutDashboard {
  const o = other();
  o.tabs[0].root.children.push(folder('of1', p(6, 0, 4, 4), [folder('of2', p(0, 0, 4, 4), [folder('of3', p(0, 0, 2, 2), [])])]));
  return o;
}

const onClose = vi.fn();
const item = (name: RegExp | string) => screen.getByRole('treeitem', { name });
async function expand(name: RegExp | string) {
  await fireEvent.keyDown(item(name), { key: 'ArrowRight' });
}

beforeEach(() => {
  resetEditor();
  onClose.mockReset();
  vi.mocked(api.transferNodes).mockReset();
  setLayout([deepHome(), deepOther()]);
  startSession();
});

describe('MoveCopyDialog tree picker', () => {
  it('lists folders three deep across two dashboards, rendering only expanded branches', async () => {
    render(MoveCopyDialog, { ids: ['a'], onClose });
    expect(screen.getAllByRole('treeitem').length).toBeLessThan(10);
    expect(screen.queryByRole('treeitem', { name: /^G1/ })).toBeNull();
    await expand(/^Main/);
    await expand(/^F1/);
    await expand(/^G1/);
    expect(item(/^H1/)).toBeInTheDocument();
    expect(item(/^H1/)).toHaveAttribute('aria-level', '5');
    await expand(/^Other/);
    await expand(/^OT/);
    await expand(/^OF1/);
    await expand(/^OF2/);
    expect(item(/^OF3/)).toBeInTheDocument();
  });

  it('a same-dashboard move changes the draft only (one undo step)', async () => {
    render(MoveCopyDialog, { ids: ['a'], onClose });
    await fireEvent.click(item(/^Two/));
    await fireEvent.click(screen.getByRole('button', { name: /^Move$/ }));
    expect(draft().tabs[1].root.children.map((n) => n.id)).toContain('a');
    expect(api.transferNodes).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('other-dashboard targets are disabled with the reason while the session is dirty', async () => {
    apply('edit', (d) => updateNode(d, 'a', { name: 'changed' }));
    expect(get(dirty)).toBe(true);
    render(MoveCopyDialog, { ids: ['a'], onClose });
    await expand(/^Other/);
    const ot = item(/^OT/);
    expect(ot).toHaveAttribute('aria-disabled', 'true');
    expect(ot.textContent).toContain('Save or discard your changes first');
    await fireEvent.click(ot);
    expect(screen.getByRole('button', { name: /^Copy$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Move$/ })).toBeDisabled();
  });

  it('copy to another dashboard calls transfer with both revisions, then refreshes the session', async () => {
    const fresh = {
      schemaVersion: 3 as const,
      dashboards: [{ ...deepHome(), revision: 6 }, { ...deepOther(), revision: 3 }]
    };
    vi.mocked(api.transferNodes).mockResolvedValue({ sourceRevision: 6, targetRevision: 3, layout: fresh });
    render(MoveCopyDialog, { ids: ['a'], onClose });
    await expand(/^Other/);
    await fireEvent.click(item(/^OT/));
    await fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.transferNodes).toHaveBeenCalledWith({
      mode: 'copy', sourceId: 'd1', sourceRevision: 5, nodeIds: ['a'],
      targetId: 'o', targetRevision: 2, target: { tabId: 'ot' }
    });
    expect(get(session)!.baseRevision).toBe(6);
    expect(get(dirty)).toBe(false);
  });

  it('a folder target on another dashboard passes folderId', async () => {
    vi.mocked(api.transferNodes).mockResolvedValue({ sourceRevision: 6, targetRevision: 3 });
    render(MoveCopyDialog, { ids: ['a'], onClose });
    await expand(/^Other/);
    await expand(/^OT/);
    await fireEvent.click(item(/^OF1/));
    await fireEvent.click(screen.getByRole('button', { name: /^Move$/ }));
    await waitFor(() => expect(api.transferNodes).toHaveBeenCalled());
    expect(vi.mocked(api.transferNodes).mock.calls[0][0]).toMatchObject({ mode: 'move', target: { tabId: 'ot', folderId: 'of1' } });
  });

  it('a folder and its descendants are disabled as targets for it', async () => {
    render(MoveCopyDialog, { ids: ['f1'], onClose });
    await expand(/^Main/);
    await expand(/^F1/);
    expect(item(/^F1/)).toHaveAttribute('aria-disabled', 'true');
    expect(item(/^G1/)).toHaveAttribute('aria-disabled', 'true');
    expect(item(/^G1/).textContent).toContain("can't go inside itself");
    expect(item(/^C1/)).not.toHaveAttribute('aria-disabled');
  });

  it('a 409 for the session dashboard raises the conflict banner state', async () => {
    vi.mocked(api.transferNodes).mockRejectedValue(new api.ConflictError('d1', 9));
    render(MoveCopyDialog, { ids: ['a'], onClose });
    await expand(/^Other/);
    await fireEvent.click(item(/^OT/));
    await fireEvent.click(screen.getByRole('button', { name: /^Move$/ }));
    await waitFor(() => expect(get(sessionConflict)).toEqual({ dashboardId: 'd1', currentRevision: 9 }));
    expect(onClose).not.toHaveBeenCalled();
    expect(nodeIn(draft(), 'a')).toBeTruthy();
  });

  it('a 409 for the target dashboard toasts by name, reloads the layout, and raises no banner', async () => {
    vi.mocked(api.transferNodes).mockRejectedValue(new api.ConflictError('o', 9));
    vi.mocked(api.getConfig).mockClear();
    const err = vi.spyOn(toast, 'error');
    render(MoveCopyDialog, { ids: ['a'], onClose });
    await expand(/^Other/);
    await fireEvent.click(item(/^OT/));
    await fireEvent.click(screen.getByRole('button', { name: /^Move$/ }));
    await waitFor(() => expect(err).toHaveBeenCalledWith(expect.stringContaining('\u2018Other\u2019 was changed somewhere else')));
    expect(get(sessionConflict)).toBeNull();
    await waitFor(() => expect(api.getConfig).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a chosen destination that vanishes from the layout is cleared with a visible notice', async () => {
    render(MoveCopyDialog, { ids: ['a'], onClose });
    await expand(/^Other/);
    await fireEvent.click(item(/^OT/));
    expect(screen.getByRole('button', { name: /^Copy$/ })).toBeEnabled();
    setLayout([deepHome(), { ...other(), tabs: [] }]);
    await waitFor(() => expect(screen.getByText(/That destination no longer exists/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^Copy$/ })).toBeDisabled();
  });

  it('dashboard rows are never selectable (aria-disabled)', () => {
    render(MoveCopyDialog, { ids: ['a'], onClose });
    expect(item(/^Home/)).toHaveAttribute('aria-disabled', 'true');
  });

  it('another failure is toasted visibly and the dialog stays open', async () => {
    vi.mocked(api.transferNodes).mockRejectedValue(new Error('boom'));
    const err = vi.spyOn(toast, 'error');
    render(MoveCopyDialog, { ids: ['a'], onClose });
    await expand(/^Other/);
    await fireEvent.click(item(/^OT/));
    await fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    await waitFor(() => expect(err).toHaveBeenCalledWith(expect.stringContaining('boom')));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('arrow keys move focus, collapse and expand; Enter selects', async () => {
    render(MoveCopyDialog, { ids: ['a'], onClose });
    const main = item(/^Main/);
    main.focus();
    await fireEvent.keyDown(main, { key: 'ArrowDown' });
    await waitFor(() => expect(item(/^Two/)).toHaveFocus());
    await fireEvent.keyDown(item(/^Two/), { key: 'Enter' });
    expect(item(/^Two/)).toHaveAttribute('aria-selected', 'true');
    await fireEvent.keyDown(item(/^Two/), { key: 'ArrowLeft' });
    await waitFor(() => expect(item(/^Home/)).toHaveFocus());
    await fireEvent.keyDown(item(/^Home/), { key: 'ArrowLeft' });
    expect(screen.queryByRole('treeitem', { name: /^Main/ })).toBeNull();
  });
});
