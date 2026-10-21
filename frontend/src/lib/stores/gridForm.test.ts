// Controller Ruling 3 (finer grid): a document not marked `gridUnit: 2` is in the old 12-column form
// (or was served by an older backend). This build writes 24-column placements, so it must REFUSE to
// save into it — visibly — rather than mix units. Never silent: a toast says why and what to do.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn(),
  transferNodes: vi.fn(),
  getConfig: vi.fn()
}));

import * as api from '$lib/utils/api';
import { config, gridFormProblem, OLD_GRID_FORM, applySavedLayout, renameDashboard } from './config';
import { apply, begin, save, resetEditSessionForTests } from './editSession';
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
function load(gridUnit?: number): void {
  config.set({ schemaVersion: 3, ...(gridUnit === undefined ? {} : { gridUnit }), dashboards: [dash()] } as Config);
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

describe('gridFormProblem', () => {
  it('is null only for a document marked gridUnit 2', () => {
    expect(gridFormProblem({ schemaVersion: 3, gridUnit: 2, dashboards: [] })).toBeNull();
    expect(gridFormProblem({ schemaVersion: 3, dashboards: [] })).toBe(OLD_GRID_FORM);
    expect(gridFormProblem({ schemaVersion: 3, gridUnit: 1, dashboards: [] })).toBe(OLD_GRID_FORM);
    expect(gridFormProblem(null)).toBe(OLD_GRID_FORM);
  });
  it('tells the user what happened and what to do', () => {
    expect(OLD_GRID_FORM).toMatch(/older HOPS layout/);
    expect(OLD_GRID_FORM).toMatch(/reload/i);
  });
});

describe('the editor refuses to save into an unmarked document', () => {
  it('save(): refused with a visible error; nothing is sent; the draft is kept', async () => {
    load();
    edit();
    const err = vi.spyOn(toast, 'error');
    expect(await save()).toBe('error');
    expect(api.saveDashboardV3).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(OLD_GRID_FORM);
  });
  it('save(): a marked document saves', async () => {
    load(2);
    edit();
    vi.mocked(api.saveDashboardV3).mockResolvedValue({ revision: 8, layout: { schemaVersion: 3, gridUnit: 2, dashboards: [{ ...dash(), revision: 8 }] } } as never);
    expect(await save()).toBe('saved');
    expect(api.saveDashboardV3).toHaveBeenCalledTimes(1);
  });
  it('the marker is taken from each write response: a response without it blocks the next save', async () => {
    load(2);
    applySavedLayout({ layout: { schemaVersion: 3, gridUnit: 2, dashboards: [dash()] } } as never);
    expect(get(config)?.gridUnit).toBe(2);
    applySavedLayout({ layout: { schemaVersion: 3, dashboards: [dash()] } } as never);
    expect(get(config)?.gridUnit).toBeUndefined();
    edit();
    expect(await save()).toBe('error');
    expect(api.saveDashboardV3).not.toHaveBeenCalled();
  });
  it('rename: refused with a visible error; nothing is sent', async () => {
    load();
    const err = vi.spyOn(toast, 'error');
    await expect(renameDashboard('d', { name: 'New', path: '/new' })).rejects.toThrow(OLD_GRID_FORM);
    expect(api.saveDashboardV3).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(OLD_GRID_FORM);
  });
  it('a move/copy to another dashboard: refused with a visible error; nothing is sent', async () => {
    load();
    const err = vi.spyOn(toast, 'error');
    expect(await transferAndRebase({} as never, 'Moved', 'Not moved')).toBe(false);
    expect(api.transferNodes).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(OLD_GRID_FORM);
  });
});
