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
    saveDashboard: vi.fn()
  };
});

import * as api from '$lib/utils/api';
import {
  config,
  mutateDashboard,
  updateConfig,
  loadConfig,
  saveConflict,
  migrationFailure
} from './config';

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
    vi.mocked(api.saveDashboard).mockResolvedValue({ revision: 4 });
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
      .mockResolvedValueOnce({ revision: 4 })
      .mockResolvedValueOnce({ revision: 5 });
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
    vi.mocked(api.updateConfig).mockResolvedValue({ revisions: { a: 4, b: 8 } });
    await updateConfig(makeConfig(), false);
    const cfg = get(config)!;
    expect(cfg.dashboardRevisions).toEqual({ a: 4, b: 8 });
    expect(cfg.dashboards.map((d) => d.revision)).toEqual([4, 8]);
  });

  it('a delete after an edit sends the up-to-date revision', async () => {
    vi.mocked(api.saveDashboard).mockResolvedValue({ revision: 4 });
    await mutateDashboard('a', (d) => { d.name = 'edited'; });

    vi.mocked(api.updateConfig).mockResolvedValue({ revisions: { b: 7 } });
    const cur = get(config)!;
    await updateConfig({ ...cur, dashboards: cur.dashboards.filter((d) => d.id !== 'b') }, false);
    const sent = vi.mocked(api.updateConfig).mock.calls[0][0];
    expect(sent.dashboardRevisions).toEqual({ a: 4, b: 7 });
    expect(sent.dashboards).toHaveLength(1);
    expect(get(config)!.dashboardRevisions).toEqual({ b: 7 });
  });

  it('a delete after another delete-free edit uses the edit revision (a only)', async () => {
    vi.mocked(api.saveDashboard).mockResolvedValue({ revision: 4 });
    await mutateDashboard('a', (d) => { d.name = 'edited'; });
    vi.mocked(api.updateConfig).mockResolvedValue({ revisions: { b: 7 } });
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
