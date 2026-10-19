import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Config, Dashboard } from '$lib/types';

vi.mock('$lib/utils/api', async () => {
  const actual = await vi.importActual<typeof import('$lib/utils/api')>('$lib/utils/api');
  return {
    ConflictError: actual.ConflictError,
    MigrationFailedError: actual.MigrationFailedError,
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    saveDashboard: vi.fn(),
    saveDashboardSettings: vi.fn()
  };
});

import * as api from '$lib/utils/api';
import {
  config,
  mutateDashboard,
  updateConfig,
  loadConfig,
  saveConflict,
  migrationFailure,
  showMigrationFailedPage,
  saveDashboardSettingsChanges,
  layoutDoc,
  layoutStale
} from './config';
import { toast } from './toast';

// A write response always carries the fresh layout (else the store reloads).
const FL = { layout: { schemaVersion: 3 as const, dashboards: [] }, v3OnlyDashboards: [] };

function dash(id: string, revision: number): Dashboard {
  return { id, name: id, path: `/${id}`, tabs: [], order: 0, revision };
}

function makeConfig(): Config {
  return {
    dashboards: [dash('a', 3), dash('b', 7)],
    theme: { mode: 'auto' },
    settings: { searchHotkey: '/', defaultView: 'a' },
    dashboardRevisions: { a: 3, b: 7 }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  config.set(makeConfig());
  saveConflict.set(null);
  migrationFailure.set(null);
});

describe('mutateDashboard', () => {
  it('sends the current revision and stores the returned one', async () => {
    vi.mocked(api.saveDashboard).mockResolvedValue({ revision: 4, ...FL });
    await mutateDashboard('a', (d) => {
      d.name = 'renamed';
    });
    expect(api.saveDashboard).toHaveBeenCalledTimes(1);
    const [id, sent, rev] = vi.mocked(api.saveDashboard).mock.calls[0];
    expect(id).toBe('a');
    expect(rev).toBe(3);
    expect(sent.name).toBe('renamed');
    const cfg = get(config)!;
    expect(cfg.dashboards[0].name).toBe('renamed');
    expect(cfg.dashboards[0].revision).toBe(4);
    expect(cfg.dashboardRevisions).toEqual({ a: 4, b: 7 });
  });

  it('chains revisions across successive saves', async () => {
    vi.mocked(api.saveDashboard)
      .mockResolvedValueOnce({ revision: 4, ...FL })
      .mockResolvedValueOnce({ revision: 5, ...FL });
    await mutateDashboard('a', (d) => { d.name = 'one'; });
    await mutateDashboard('a', (d) => { d.name = 'two'; });
    expect(vi.mocked(api.saveDashboard).mock.calls[1][2]).toBe(4);
    expect(get(config)!.dashboardRevisions!.a).toBe(5);
  });

  it('on conflict sets saveConflict and leaves the store unchanged', async () => {
    vi.mocked(api.saveDashboard).mockRejectedValue(new api.ConflictError('a', 9));
    const before = JSON.stringify(get(config));
    await expect(mutateDashboard('a', (d) => { d.name = 'lost'; })).rejects.toBeInstanceOf(api.ConflictError);
    expect(get(saveConflict)).toEqual({ dashboardId: 'a' });
    expect(JSON.stringify(get(config))).toBe(before);
  });

  it('a non-conflict failure leaves the store unchanged and no conflict flag', async () => {
    vi.mocked(api.saveDashboard).mockRejectedValue(new Error('boom'));
    const before = JSON.stringify(get(config));
    await expect(mutateDashboard('a', (d) => { d.name = 'x'; })).rejects.toThrow('boom');
    expect(get(saveConflict)).toBeNull();
    expect(JSON.stringify(get(config))).toBe(before);
  });
});

describe('updateConfig', () => {
  it('applies returned revisions to the store', async () => {
    vi.mocked(api.updateConfig).mockResolvedValue({ revisions: { a: 4, b: 8 }, ...FL });
    await updateConfig(makeConfig(), false);
    const cfg = get(config)!;
    expect(cfg.dashboardRevisions).toEqual({ a: 4, b: 8 });
    expect(cfg.dashboards.map((d) => d.revision)).toEqual([4, 8]);
  });

  it('a delete after an edit sends the up-to-date revision', async () => {
    vi.mocked(api.saveDashboard).mockResolvedValue({ revision: 4, ...FL });
    await mutateDashboard('a', (d) => { d.name = 'edited'; });

    vi.mocked(api.updateConfig).mockResolvedValue({ revisions: { b: 7 }, ...FL });
    const cur = get(config)!;
    await updateConfig({ ...cur, dashboards: cur.dashboards.filter((d) => d.id !== 'b') }, false);
    const sent = vi.mocked(api.updateConfig).mock.calls[0][0];
    expect(sent.dashboardRevisions).toEqual({ a: 4, b: 7 });
    expect(sent.dashboards).toHaveLength(1);
    expect(get(config)!.dashboardRevisions).toEqual({ b: 7 });
  });

  it('a delete after another delete-free edit uses the edit revision (a only)', async () => {
    vi.mocked(api.saveDashboard).mockResolvedValue({ revision: 4, ...FL });
    await mutateDashboard('a', (d) => { d.name = 'edited'; });
    vi.mocked(api.updateConfig).mockResolvedValue({ revisions: { b: 7 }, ...FL });
    const cur = get(config)!;
    await updateConfig({ ...cur, dashboards: cur.dashboards.filter((d) => d.id !== 'a') }, false);
    expect(vi.mocked(api.updateConfig).mock.calls[0][0].dashboardRevisions!.a).toBe(4);
  });

  it('on conflict sets saveConflict and keeps the old config', async () => {
    vi.mocked(api.updateConfig).mockRejectedValue(new api.ConflictError('b', 9));
    const before = JSON.stringify(get(config));
    await expect(updateConfig(makeConfig(), false)).rejects.toBeInstanceOf(api.ConflictError);
    expect(get(saveConflict)).toEqual({ dashboardId: 'b' });
    expect(JSON.stringify(get(config))).toBe(before);
  });
});

describe('loadConfig', () => {
  it('sets migrationFailure on MigrationFailedError', async () => {
    vi.mocked(api.getConfig).mockRejectedValue(new api.MigrationFailedError('bad row 12'));
    await loadConfig();
    expect(get(migrationFailure)).toBe('bad row 12');
    expect(get(config)).toBeNull();
  });

  it('clears migrationFailure on a later successful load', async () => {
    migrationFailure.set('old');
    vi.mocked(api.getConfig).mockResolvedValue(makeConfig());
    await loadConfig();
    expect(get(migrationFailure)).toBeNull();
    expect(get(config)!.dashboards).toHaveLength(2);
  });
});

describe('showMigrationFailedPage', () => {
  it('is true on a dashboard route when migration failed', () => {
    expect(showMigrationFailedPage('/home', 'bad')).toBe(true);
  });
  it('is false on / (admin page shows its own banner)', () => {
    expect(showMigrationFailedPage('/', 'bad')).toBe(false);
  });
  it('is false when there is no failure', () => {
    expect(showMigrationFailedPage('/home', null)).toBe(false);
  });
});

// A tiny in-memory server holding one revision per dashboard, enforcing the
// same optimistic-concurrency rule as the backend (409 unless the sent
// revision equals the stored one).
function fakeServer(revisions: Record<string, number>) {
  const check = (id: string, rev: number) => {
    if (rev !== revisions[id]) throw new api.ConflictError(id, revisions[id]);
    revisions[id] += 1;
    return { revision: revisions[id], ...FL };
  };
  vi.mocked(api.saveDashboard).mockImplementation(async (id, _d, rev) => check(id, rev));
  vi.mocked(api.saveDashboardSettings).mockImplementation(async (id, _o, rev) => check(id, rev));
  return revisions;
}

describe('saveDashboardSettingsChanges (C1)', () => {
  it('sends the store revision and applies the result on success', async () => {
    fakeServer({ a: 3, b: 7 });
    await saveDashboardSettingsChanges('a', { editIdleTimeoutMinutes: 30 });
    expect(vi.mocked(api.saveDashboardSettings).mock.calls[0]).toEqual(['a', { editIdleTimeoutMinutes: 30 }, 3]);
    const cfg = get(config)!;
    expect(cfg.dashboards[0].revision).toBe(4);
    expect(cfg.dashboardRevisions!.a).toBe(4);
    expect(cfg.dashboards[0].settings?.editIdleTimeoutMinutes).toBe(30);
  });

  it('a stale store cannot be fast-forwarded: settings save and the next tile edit both conflict', async () => {
    // Store holds a at 3; another browser already saved a (server at 4).
    fakeServer({ a: 4, b: 7 });
    const before = JSON.stringify(get(config));
    await expect(saveDashboardSettingsChanges('a', { editIdleTimeoutMinutes: 30 })).rejects.toBeInstanceOf(
      api.ConflictError
    );
    expect(vi.mocked(api.saveDashboardSettings).mock.calls[0][2]).toBe(3);
    expect(get(saveConflict)).toEqual({ dashboardId: 'a' });
    expect(JSON.stringify(get(config))).toBe(before);

    // The stale store still says 3, so the next tile edit is refused too
    // instead of overwriting the other browser's change.
    await expect(mutateDashboard('a', (d) => { d.name = 'stale edit'; })).rejects.toBeInstanceOf(api.ConflictError);
    expect(vi.mocked(api.saveDashboard).mock.calls[0][2]).toBe(3);
    expect(JSON.stringify(get(config))).toBe(before);
  });

  it('routes a migration failure to migrationFailure and leaves the store alone', async () => {
    vi.mocked(api.saveDashboardSettings).mockRejectedValue(new api.MigrationFailedError('boom'));
    const before = JSON.stringify(get(config));
    await expect(saveDashboardSettingsChanges('a', { statusChecksEnabled: false })).rejects.toThrow('boom');
    expect(get(migrationFailure)).toBe('boom');
    expect(JSON.stringify(get(config))).toBe(before);
  });
});

describe('saveOneDashboard backup warning (I4)', () => {
  it('surfaces the server warning when the pre-update backup failed', async () => {
    const warn = vi.spyOn(toast, 'warning');
    vi.mocked(api.saveDashboard).mockResolvedValue({ revision: 4, warning: 'Pre-update backup failed: disk full. Config saved anyway.', ...FL });
    await mutateDashboard('a', (d) => { d.name = 'x'; });
    expect(warn).toHaveBeenCalledWith('Pre-update backup failed: disk full. Config saved anyway.');
    expect(get(config)!.dashboards[0].revision).toBe(4);
    warn.mockRestore();
  });
});

describe('save failure messages (I5)', () => {
  it('a rejected tile save shows the server reason, not just "failed"', async () => {
    const err = vi.spyOn(toast, 'error');
    vi.mocked(api.saveDashboard).mockRejectedValue(new Error('Invalid config: duplicate id "t1"'));
    await expect(mutateDashboard('a', (d) => { d.name = 'x'; })).rejects.toThrow();
    expect(err).toHaveBeenCalledWith('Failed to save changes: Invalid config: duplicate id "t1"');
    err.mockRestore();
  });

  it('a rejected whole-config save shows the server reason', async () => {
    const err = vi.spyOn(toast, 'error');
    vi.mocked(api.updateConfig).mockRejectedValue(new Error('Invalid config: dashboard id is empty'));
    await expect(updateConfig(makeConfig(), false)).rejects.toThrow();
    expect(err).toHaveBeenCalledWith('Failed to save changes: Invalid config: dashboard id is empty');
    err.mockRestore();
  });
});

describe('layout fields', () => {
  it('layoutDoc follows config.layout and v3OnlyDashboardIds follows v3OnlyDashboards', async () => {
    const { layoutDoc, v3OnlyDashboardIds, findLayoutDashboard } = await import('./config');
    expect(get(layoutDoc)).toBeNull();
    const doc = {
      schemaVersion: 3 as const,
      dashboards: [{ id: 'a', name: 'a', path: '/a', revision: 1, tabs: [] }]
    };
    config.set({ ...makeConfig(), layout: doc, v3OnlyDashboards: [{ id: 'z', name: 'z', path: '/z', reason: 'r' }] });
    expect(get(layoutDoc)).toEqual(doc);
    expect(get(v3OnlyDashboardIds).has('z')).toBe(true);
    expect(findLayoutDashboard('a', get(layoutDoc))?.id).toBe('a');
    expect(findLayoutDashboard('nope', get(layoutDoc))).toBeUndefined();
    expect(findLayoutDashboard('a', null)).toBeUndefined();
  });

  it('updateConfig PUT body has no layout or v3OnlyDashboards', async () => {
    vi.mocked(api.updateConfig).mockResolvedValue({ ...FL });
    const cfg: Config = {
      ...makeConfig(),
      layout: { schemaVersion: 3, dashboards: [] },
      v3OnlyDashboards: [{ id: 'z', name: 'z', path: '/z', reason: 'r' }]
    };
    await updateConfig(cfg);
    const sent = vi.mocked(api.updateConfig).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect('layout' in sent).toBe(false);
    expect('v3OnlyDashboards' in sent).toBe(false);
    expect(sent.dashboards).toBeDefined();
  });
});

describe('write responses refresh the layout', () => {
  const docWith = (name: string) => ({
    schemaVersion: 3 as const,
    dashboards: [{ id: 'a', name, path: '/a', revision: 9, tabs: [] }]
  });
  const old = docWith('old');

  beforeEach(() => {
    layoutStale.set(false);
    config.set({ ...makeConfig(), layout: old, v3OnlyDashboards: [] });
  });

  it('updateConfig takes the response layout', async () => {
    vi.mocked(api.updateConfig).mockResolvedValue({ layout: docWith('fresh'), v3OnlyDashboards: [] });
    await updateConfig({ ...makeConfig(), layout: old });
    expect(get(layoutDoc)).toEqual(docWith('fresh'));
    expect(get(layoutStale)).toBe(false);
  });

  it('mutateDashboard (dashboard save, also covers delete-by-save paths) takes the response layout', async () => {
    vi.mocked(api.saveDashboard).mockResolvedValue({ revision: 4, layout: docWith('fresh2'), v3OnlyDashboards: [] });
    await mutateDashboard('a', (d) => { d.name = 'x'; });
    expect(get(layoutDoc)).toEqual(docWith('fresh2'));
  });

  it('settings save takes the response layout', async () => {
    vi.mocked(api.saveDashboardSettings).mockResolvedValue({ revision: 4, layout: docWith('fresh3'), v3OnlyDashboards: [] });
    await saveDashboardSettingsChanges('a', { statusChecksEnabled: false });
    expect(get(layoutDoc)).toEqual(docWith('fresh3'));
  });

  it('a response without layout marks it stale and reloads', async () => {
    let release!: () => void;
    vi.mocked(api.getConfig).mockImplementation(
      () => new Promise((res) => { release = () => res({ ...makeConfig(), layout: docWith('reloaded') }); })
    );
    vi.mocked(api.updateConfig).mockResolvedValue({});
    await updateConfig(makeConfig());
    expect(get(layoutStale)).toBe(true);
    expect(api.getConfig).toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(get(layoutStale)).toBe(false));
    expect(get(layoutDoc)).toEqual(docWith('reloaded'));
  });

  it('stays stale (visibly) when the reload fails', async () => {
    vi.mocked(api.getConfig).mockRejectedValue(new Error('down'));
    vi.mocked(api.saveDashboard).mockResolvedValue({ revision: 4 });
    await mutateDashboard('a', (d) => { d.name = 'x'; });
    await vi.waitFor(() => expect(api.getConfig).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(get(layoutStale)).toBe(true);
  });
});
