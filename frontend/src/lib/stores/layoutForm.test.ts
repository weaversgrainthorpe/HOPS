// A document not at `layoutVersion: 2` is in another layout form (or was served by another
// backend). This build writes the current form, so it must REFUSE to save into it — visibly — rather than
// mix forms. Never silent: a toast says why and what to do.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn(),
  transferNodes: vi.fn(),
  getConfig: vi.fn()
}));

import * as api from '$lib/utils/api';
import { config, layoutFormProblem, OLD_LAYOUT_FORM, applySavedLayout, renameDashboard } from './config';
import { apply, begin, save, resetEditSessionForTests, session, dirty } from './editSession';
import { toast } from './toast';
import { updateNode } from '$lib/editor/treeOps';
import { transferAndRebase } from '$lib/editor/editorActions';
import type { Config } from '$lib/types';
import type { LayoutDashboard } from '$lib/types/layout';

function dash(): LayoutDashboard {
  return {
    id: 'd', name: 'D', path: '/d', revision: 7,
    tabs: [{ id: 't', name: 'T', root: { columns: 24, children: [
      { kind: 'tile', id: 'a', name: 'A', url: 'http://a.test', placement: { x: 0, y: 0, w: 2, h: 2 } } as never
    ] } }]
  };
}
function load(layoutVersion?: number): void {
  config.set({ schemaVersion: 3, ...(layoutVersion === undefined ? {} : { layoutVersion }), dashboards: [dash()] } as Config);
}
function edit(): void {
  begin('d');
  apply('Rename', (d) => updateNode(d, 'a', { name: 'Renamed' } as never));
}

beforeEach(() => {
  resetEditSessionForTests();
  vi.mocked(api.saveDashboardV3).mockReset();
  vi.mocked(api.transferNodes).mockReset();
  toast.clear();
});

describe('layoutFormProblem', () => {
  it('is null only for a document at layoutVersion 2', () => {
    expect(layoutFormProblem({ schemaVersion: 3, layoutVersion: 2, dashboards: [] })).toBeNull();
    expect(layoutFormProblem({ schemaVersion: 3, dashboards: [] })).toBe(OLD_LAYOUT_FORM);
    // The older form (1) and any other version are another form (the minimum changed).
    expect(layoutFormProblem({ schemaVersion: 3, layoutVersion: 1, dashboards: [] })).toBe(OLD_LAYOUT_FORM);
    expect(layoutFormProblem({ schemaVersion: 3, layoutVersion: 3, dashboards: [] })).toBe(OLD_LAYOUT_FORM);
    expect(layoutFormProblem(null)).toBe(OLD_LAYOUT_FORM);
  });
  it('tells the user what happened and what to do', () => {
    expect(OLD_LAYOUT_FORM).toMatch(/different HOPS layout version/);
    expect(OLD_LAYOUT_FORM).toMatch(/reload/i);
  });
});

describe('the editor refuses to save into a document at another layout version', () => {
  it('save(): refused with a visible error; nothing is sent; the draft is kept', async () => {
    load();
    edit();
    const err = vi.spyOn(toast, 'error');
    expect(await save()).toBe('error');
    expect(api.saveDashboardV3).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(OLD_LAYOUT_FORM);
  });
  it('save(): a marked document saves', async () => {
    load(2);
    edit();
    vi.mocked(api.saveDashboardV3).mockResolvedValue({ revision: 8, layout: { schemaVersion: 3, layoutVersion: 2, dashboards: [{ ...dash(), revision: 8 }] } } as never);
    expect(await save()).toBe('saved');
    expect(api.saveDashboardV3).toHaveBeenCalledTimes(1);
  });
  it('the marker is taken from each write response: a response without it blocks the next save', async () => {
    load(2);
    applySavedLayout({ layout: { schemaVersion: 3, layoutVersion: 2, dashboards: [dash()] } } as never);
    expect(get(config)?.layoutVersion).toBe(2);
    applySavedLayout({ layout: { schemaVersion: 3, dashboards: [dash()] } } as never);
    expect(get(config)?.layoutVersion).toBeUndefined();
    edit();
    expect(await save()).toBe('error');
    expect(api.saveDashboardV3).not.toHaveBeenCalled();
  });
  it('rename: refused with a visible error; nothing is sent', async () => {
    load();
    const err = vi.spyOn(toast, 'error');
    await expect(renameDashboard('d', { name: 'New', path: '/new' })).rejects.toThrow(OLD_LAYOUT_FORM);
    expect(api.saveDashboardV3).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(OLD_LAYOUT_FORM);
  });
  it('a move/copy to another dashboard: refused with a visible error; nothing is sent', async () => {
    load();
    const err = vi.spyOn(toast, 'error');
    expect(await transferAndRebase({} as never, 'Moved', 'Not moved')).toBe(false);
    expect(api.transferNodes).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(OLD_LAYOUT_FORM);
  });
});

// The server refuses a write without layoutVersion: 2 (a page loaded before the update).
// The user sees the reason, and nothing is lost: the draft stays exactly as it was, still dirty.
describe('the server refuses a write (409 layout_version_mismatch)', () => {
  const REFUSED = 'HOPS was updated since this page was loaded, so this change was not saved. Reload the page, then make the change again.';
  it('save(): the reload message is shown and the draft is kept', async () => {
    load(2);
    edit();
    const draft = get(session)?.draft;
    vi.mocked(api.saveDashboardV3).mockRejectedValue(new Error(REFUSED));
    const err = vi.spyOn(toast, 'error');
    expect(await save()).toBe('error');
    expect(err).toHaveBeenCalledWith(expect.stringContaining(REFUSED));
    expect(get(session)?.draft).toBe(draft);
    expect(get(dirty)).toBe(true);
  });
  it('rename: the reload message is shown and the held document is unchanged', async () => {
    load(2);
    const before = structuredClone(get(config));
    vi.mocked(api.saveDashboardV3).mockRejectedValue(new Error(REFUSED));
    const err = vi.spyOn(toast, 'error');
    await expect(renameDashboard('d', { name: 'New', path: '/new' })).rejects.toThrow(REFUSED);
    expect(err).toHaveBeenCalledWith(expect.stringContaining(REFUSED));
    expect(get(config)).toEqual(before);
  });
  it('a move/copy to another dashboard: the reload message is shown', async () => {
    load(2);
    vi.mocked(api.transferNodes).mockRejectedValue(new Error(REFUSED));
    const err = vi.spyOn(toast, 'error');
    expect(await transferAndRebase({ mode: 'move' } as never, 'Moved', 'Not moved')).toBe(false);
    expect(err).toHaveBeenCalledWith(expect.stringContaining(REFUSED));
  });
});
