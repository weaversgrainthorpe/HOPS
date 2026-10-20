import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Config } from '$lib/types';
import type { LayoutDashboard } from '$lib/types/layout';

vi.mock('$lib/utils/api', async () => {
  const actual = await vi.importActual<typeof import('$lib/utils/api')>('$lib/utils/api');
  return {
    ConflictError: actual.ConflictError,
    MigrationFailedError: actual.MigrationFailedError,
    getConfig: vi.fn(),
    saveDashboardV3: vi.fn(),
    saveDashboardSettings: vi.fn(),
    deleteDashboard: vi.fn(),
    createDashboard: vi.fn(),
    reorderDashboards: vi.fn()
  };
});

import * as api from '$lib/utils/api';
import {
  config,
  dashboards,
  loadConfig,
  saveConflict,
  migrationFailure,
  showMigrationFailedPage,
  saveDashboardSettingsChanges,
  layoutDoc,
  layoutStale,
  configLoading,
  configError,
  resolveDashboardRoute,
  deleteDashboard,
  createDashboard,
  renameDashboard,
  reorderDashboards,
  applySavedLayout,
  findLayoutDashboard,
  dashboardHref
} from './config';
import { toast } from './toast';

function dash(id: string, revision: number, extra: Partial<LayoutDashboard> = {}): LayoutDashboard {
  return { id, name: id, path: `/${id}`, revision, tabs: [], ...extra };
}

function makeConfig(...ds: LayoutDashboard[]): Config {
  return { schemaVersion: 3, dashboards: ds.length ? ds : [dash('a', 3), dash('b', 7)] };
}

const doc = (...ds: LayoutDashboard[]) => ({ schemaVersion: 3 as const, dashboards: ds });

beforeEach(() => {
  vi.clearAllMocks();
  config.set(makeConfig());
  saveConflict.set(null);
  migrationFailure.set(null);
  layoutStale.set(false);
});

describe('the store is the v3 document', () => {
  it('layoutDoc is the config itself; findLayoutDashboard looks in it', () => {
    expect(get(layoutDoc)).toEqual(makeConfig());
    expect(findLayoutDashboard('a', get(layoutDoc))?.revision).toBe(3);
    expect(findLayoutDashboard('nope', get(layoutDoc))).toBeUndefined();
    expect(findLayoutDashboard('a', null)).toBeUndefined();
    config.set(null);
    expect(get(layoutDoc)).toBeNull();
  });

  it('dashboards lists every dashboard in `order`, document order for ties and missing orders', () => {
    config.set(makeConfig(dash('x', 1, { order: 2 }), dash('y', 1), dash('z', 1, { order: 0 }), dash('w', 1, { order: 2 })));
    expect(get(dashboards).map((d) => d.id)).toEqual(['z', 'x', 'w', 'y']);
  });

  it('migration notices from GET are kept when a write response refreshes the document', () => {
    config.set({ ...makeConfig(), migrationNotices: ['renamed'] });
    applySavedLayout({ layout: doc(dash('a', 4)) });
    expect(get(config)).toEqual({ schemaVersion: 3, dashboards: [dash('a', 4)], migrationNotices: ['renamed'] });
  });
});

describe('loadConfig', () => {
  it('sets migrationFailure on MigrationFailedError', async () => {
    vi.mocked(api.getConfig).mockRejectedValue(new api.MigrationFailedError('boom'));
    await loadConfig();
    expect(get(migrationFailure)).toBe('boom');
    expect(get(config)).toBeNull();
  });

  it('clears migrationFailure on a later successful load', async () => {
    migrationFailure.set('boom');
    vi.mocked(api.getConfig).mockResolvedValue(makeConfig());
    await loadConfig();
    expect(get(migrationFailure)).toBeNull();
  });
});

describe('loadConfig while the layout is stale (M3 Task 1)', () => {
  it('reloads in the background: never shows the global loading screen', async () => {
    configLoading.set(false);
    layoutStale.set(true);
    const seen: boolean[] = [];
    const unsub = configLoading.subscribe((v) => seen.push(v));
    vi.mocked(api.getConfig).mockResolvedValue(makeConfig(dash('a', 9)));
    await loadConfig();
    unsub();
    expect(seen.every((v) => v === false)).toBe(true);
    expect(get(layoutStale)).toBe(false);
    expect(findLayoutDashboard('a', get(layoutDoc))?.revision).toBe(9);
  });

  it('a first (non-stale) load still shows the loading screen', async () => {
    config.set(null);
    const seen: boolean[] = [];
    const unsub = configLoading.subscribe((v) => seen.push(v));
    vi.mocked(api.getConfig).mockResolvedValue(makeConfig());
    await loadConfig();
    unsub();
    expect(seen).toContain(true);
  });

  it('a failed stale reload is still surfaced', async () => {
    layoutStale.set(true);
    vi.mocked(api.getConfig).mockRejectedValue(new Error('offline'));
    await loadConfig();
    expect(get(configError)).toBe('offline');
    expect(get(layoutStale)).toBe(true);
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

describe('write responses refresh the document', () => {
  it('a session save (applySavedLayout) takes the response document and does NOT reload the whole config', () => {
    applySavedLayout({ layout: doc(dash('a', 4, { name: 'fresh' })) });
    expect(findLayoutDashboard('a', get(layoutDoc))?.name).toBe('fresh');
    expect(get(layoutStale)).toBe(false);
    expect(api.getConfig).not.toHaveBeenCalled();
  });

  it('a response without a document marks it stale and reloads', async () => {
    let release!: () => void;
    vi.mocked(api.getConfig).mockImplementation(
      () => new Promise((res) => { release = () => res(makeConfig(dash('a', 5, { name: 'reloaded' }))); })
    );
    vi.mocked(api.deleteDashboard).mockResolvedValue({});
    await deleteDashboard('b');
    expect(get(layoutStale)).toBe(true);
    expect(api.getConfig).toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(get(layoutStale)).toBe(false));
    expect(findLayoutDashboard('a', get(layoutDoc))?.name).toBe('reloaded');
  });

  it('stays stale (visibly) when the reload fails', async () => {
    vi.mocked(api.getConfig).mockRejectedValue(new Error('down'));
    vi.mocked(api.reorderDashboards).mockResolvedValue({});
    await reorderDashboards(['b', 'a']);
    await vi.waitFor(() => expect(api.getConfig).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(get(layoutStale)).toBe(true);
  });
});

describe('createDashboard (POST /api/dashboards)', () => {
  it('sends name and path and takes the fresh document', async () => {
    vi.mocked(api.createDashboard).mockResolvedValue({ id: 'new1', revision: 1, layout: doc(dash('a', 3), dash('new1', 1)) });
    const id = await createDashboard('Media', '/media');
    expect(api.createDashboard).toHaveBeenCalledWith('Media', '/media');
    expect(id).toBe('new1');
    expect(get(config)!.dashboards.map((d) => d.id)).toEqual(['a', 'new1']);
  });

  it('a 409 path_taken is shown and the store is untouched', async () => {
    const err = vi.spyOn(toast, 'error');
    vi.mocked(api.createDashboard).mockRejectedValue(new Error('Path /a is already used by the dashboard a'));
    const before = get(config);
    await expect(createDashboard('A', '/a')).rejects.toThrow();
    expect(err).toHaveBeenCalledWith('Not created: Path /a is already used by the dashboard a');
    expect(get(config)).toBe(before);
    err.mockRestore();
  });
});

describe('renameDashboard (PUT schema 3 at the stored revision, no session)', () => {
  it('sends the stored dashboard with the new name/path at the revision the store holds', async () => {
    const full = dash('a', 3, { tabs: [{ id: 't', name: 'T', root: { columns: 12, children: [] } }], header: { leftText: 'x' } });
    config.set(makeConfig(full, dash('b', 7)));
    vi.mocked(api.saveDashboardV3).mockResolvedValue({ revision: 4, layout: doc({ ...full, name: 'Renamed', path: '/r', revision: 4 }, dash('b', 7)) });
    await renameDashboard('a', { name: 'Renamed', path: '/r' });
    expect(api.saveDashboardV3).toHaveBeenCalledWith('a', { ...full, name: 'Renamed', path: '/r' }, 3);
    expect(findLayoutDashboard('a', get(layoutDoc))?.revision).toBe(4);
    expect(findLayoutDashboard('a', get(layoutDoc))?.name).toBe('Renamed');
  });

  it('a 409 raises the conflict banner, toasts, leaves the store untouched and rethrows', async () => {
    const err = vi.spyOn(toast, 'error');
    vi.mocked(api.saveDashboardV3).mockRejectedValue(new api.ConflictError('a', 5));
    const before = get(config);
    await expect(renameDashboard('a', { name: 'X', path: '/a' })).rejects.toBeInstanceOf(api.ConflictError);
    expect(get(saveConflict)).toEqual({ dashboardId: 'a' });
    expect(err).toHaveBeenCalledWith('Not saved — changed somewhere else');
    expect(get(config)).toBe(before);
    err.mockRestore();
  });

  it('successive writes chain revisions (the queue reads the store after each result)', async () => {
    vi.mocked(api.saveDashboardV3)
      .mockResolvedValueOnce({ revision: 4, layout: doc(dash('a', 4, { name: 'one' }), dash('b', 7)) })
      .mockResolvedValueOnce({ revision: 5, layout: doc(dash('a', 5, { name: 'two' }), dash('b', 7)) });
    await Promise.all([renameDashboard('a', { name: 'one', path: '/a' }), renameDashboard('a', { name: 'two', path: '/a' })]);
    expect(vi.mocked(api.saveDashboardV3).mock.calls.map((c) => c[2])).toEqual([3, 4]);
  });
});

describe('reorderDashboards (PUT /api/dashboards/order)', () => {
  it('sends every id in the new order and takes the fresh document', async () => {
    vi.mocked(api.reorderDashboards).mockResolvedValue({ layout: doc(dash('a', 3, { order: 1 }), dash('b', 7, { order: 0 })) });
    await reorderDashboards(['b', 'a']);
    expect(api.reorderDashboards).toHaveBeenCalledWith(['b', 'a']);
    expect(get(dashboards).map((d) => d.id)).toEqual(['b', 'a']);
  });

  it('a failure is shown and rethrown', async () => {
    const err = vi.spyOn(toast, 'error');
    vi.mocked(api.reorderDashboards).mockRejectedValue(new Error('Unknown dashboard in order: z'));
    await expect(reorderDashboards(['z'])).rejects.toThrow();
    expect(err).toHaveBeenCalledWith('Order not saved: Unknown dashboard in order: z');
    err.mockRestore();
  });
});

describe('deleteDashboard', () => {
  it('deletes with the held revision and applies the response document', async () => {
    vi.mocked(api.deleteDashboard).mockResolvedValue({ layout: doc(dash('b', 7)) });
    await deleteDashboard('a');
    expect(api.deleteDashboard).toHaveBeenCalledWith('a', 3);
    expect(get(config)!.dashboards.map((d) => d.id)).toEqual(['b']);
  });

  it('a 409 raises the conflict banner, leaves the store untouched and rethrows', async () => {
    const before = get(config);
    vi.mocked(api.deleteDashboard).mockRejectedValue(new api.ConflictError('a', 6));
    await expect(deleteDashboard('a')).rejects.toBeInstanceOf(api.ConflictError);
    expect(get(saveConflict)).toEqual({ dashboardId: 'a' });
    expect(get(config)).toBe(before);
  });

  it('refuses (visibly) when the dashboard is unknown', async () => {
    const err = vi.spyOn(toast, 'error');
    await expect(deleteDashboard('ghost')).rejects.toThrow(/not found/i);
    expect(api.deleteDashboard).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('surfaces the server warning when the pre-update backup failed', async () => {
    const warn = vi.spyOn(toast, 'warning');
    vi.mocked(api.deleteDashboard).mockResolvedValue({ warning: 'Pre-update backup failed: disk full. Config saved anyway.', layout: doc(dash('b', 7)) });
    await deleteDashboard('a');
    expect(warn).toHaveBeenCalledWith('Pre-update backup failed: disk full. Config saved anyway.');
    warn.mockRestore();
  });
});

// A tiny in-memory server holding one revision per dashboard, enforcing the
// same optimistic-concurrency rule as the backend (409 unless the sent
// revision equals the stored one).
function fakeServer(revisions: Record<string, number>) {
  const check = (id: string, rev: number) => {
    if (rev !== revisions[id]) throw new api.ConflictError(id, revisions[id]);
    revisions[id] += 1;
    const cur = get(config)!;
    return {
      revision: revisions[id],
      layout: doc(...cur.dashboards.map((d) => (d.id === id ? { ...d, revision: revisions[id] } : d)))
    };
  };
  vi.mocked(api.saveDashboardV3).mockImplementation(async (id, _d, rev) => check(id, rev));
  vi.mocked(api.saveDashboardSettings).mockImplementation(async (id, _o, rev) => check(id, rev));
  return revisions;
}

describe('saveDashboardSettingsChanges', () => {
  it('sends the store revision and applies the result on success', async () => {
    fakeServer({ a: 3, b: 7 });
    await saveDashboardSettingsChanges('a', { editIdleTimeoutMinutes: 30 });
    expect(vi.mocked(api.saveDashboardSettings).mock.calls[0]).toEqual(['a', { editIdleTimeoutMinutes: 30 }, 3]);
    expect(findLayoutDashboard('a', get(layoutDoc))?.revision).toBe(4);
  });

  it('a stale store cannot be fast-forwarded: settings save and the next rename both conflict', async () => {
    // Store holds a at 3; another browser already saved a (server at 4).
    fakeServer({ a: 4, b: 7 });
    const before = JSON.stringify(get(config));
    await expect(saveDashboardSettingsChanges('a', { editIdleTimeoutMinutes: 30 })).rejects.toBeInstanceOf(api.ConflictError);
    expect(vi.mocked(api.saveDashboardSettings).mock.calls[0][2]).toBe(3);
    expect(get(saveConflict)).toEqual({ dashboardId: 'a' });
    expect(JSON.stringify(get(config))).toBe(before);
    await expect(renameDashboard('a', { name: 'stale', path: '/a' })).rejects.toBeInstanceOf(api.ConflictError);
    expect(vi.mocked(api.saveDashboardV3).mock.calls[0][2]).toBe(3);
    expect(JSON.stringify(get(config))).toBe(before);
  });

  it('routes a migration failure to migrationFailure and leaves the store alone', async () => {
    vi.mocked(api.saveDashboardSettings).mockRejectedValue(new api.MigrationFailedError('boom'));
    const before = JSON.stringify(get(config));
    await expect(saveDashboardSettingsChanges('a', { statusChecksEnabled: false })).rejects.toThrow('boom');
    expect(get(migrationFailure)).toBe('boom');
    expect(JSON.stringify(get(config))).toBe(before);
  });

  it('works on a free-layout (Showcase) dashboard like any other', async () => {
    const show = dash('s', 8, { tabs: [{ id: 'ft', name: 'Free', layout: 'free', designWidth: 1280, root: { columns: 160, children: [] } }] });
    config.set(makeConfig(show));
    const fresh = doc({ ...show, revision: 9 });
    vi.mocked(api.saveDashboardSettings).mockResolvedValue({ revision: 9, layout: fresh });
    await saveDashboardSettingsChanges('s', { statusChecksEnabled: false });
    expect(vi.mocked(api.saveDashboardSettings).mock.calls[0][2]).toBe(8);
    expect(get(layoutDoc)).toEqual(fresh);
  });
});

describe('resolveDashboardRoute (path first, then id)', () => {
  const cfgWith = (): Config =>
    makeConfig(dash('a', 3, { path: '/alpha' }), dash('zed', 1, { path: '/a' }), dash('home', 2, { path: '/other' }));

  it('a path match beats an id match', () => {
    expect(resolveDashboardRoute('a', cfgWith())?.id).toBe('zed');
  });

  it('falls back to id when no path matches; accepts a leading slash', () => {
    expect(resolveDashboardRoute('home', cfgWith())?.id).toBe('home');
    expect(resolveDashboardRoute('/a', makeConfig(dash('a', 3, { path: '/alpha' })))?.id).toBe('a');
  });

  it('resolves every dashboard (a free-layout Showcase included) to its v3 dashboard', () => {
    const show = dash('s', 4, { path: '/showcase', tabs: [{ id: 'ft', name: 'Free', layout: 'free', root: { columns: 160, children: [] } }] });
    expect(resolveDashboardRoute('showcase', makeConfig(show))).toBe(show);
  });

  it('returns undefined when nothing matches', () => {
    expect(resolveDashboardRoute('nope', cfgWith())).toBeUndefined();
  });
});

describe('dashboardHref', () => {
  const tricky = [
    '\\evil.test', '/a\\b', '\t/evil.test', '\n//evil.test', '//x', '/a%2Fb', '/café', '/my dash',
    'javascript:alert(1)', 'home', '/home'
  ];
  for (const p of tricky) {
    it(`keeps ${JSON.stringify(p)} same-origin and resolving to its dashboard`, () => {
      const h = dashboardHref(p);
      const u = new URL(h, 'https://hops.local/a/b');
      expect(u.origin).toBe('https://hops.local');
      expect(h.startsWith('/')).toBe(true);
      expect(h.startsWith('//')).toBe(false);
      expect(/[\s\\]/.test(h)).toBe(false);
      // The route sees the decoded segment; it must find the same dashboard.
      const cfg = makeConfig(dash('target', 1, { path: p }));
      expect(resolveDashboardRoute(decodeURIComponent(u.pathname.slice(1)), cfg)?.id).toBe('target');
    });
  }

  it('front and back normPath agree: every leading slash is stripped', () => {
    expect(resolveDashboardRoute('x', makeConfig(dash('x', 1, { path: '//x' })))?.id).toBe('x');
    expect(dashboardHref('///x')).toBe('/x');
  });
});
