import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Config } from '$lib/types';
import type { LayoutDashboard } from '$lib/types/layout';

// Viewer pages load only the open dashboard first (GET /api/config?dashboard=), then the rest in
// the background (GET /api/config). Nothing ever shows a partial set as complete, and answers at
// different revisions are never shown together.

const pageStore = vi.hoisted(() => ({ set: null as null | ((p: unknown) => void) }));
vi.mock('$app/stores', async () => {
  const { writable } = await import('svelte/store');
  const page = writable({ url: new URL('http://localhost/a'), params: { dashboard: 'a' }, route: { id: '/[dashboard]' } });
  pageStore.set = page.set as (p: unknown) => void;
  return { page, navigating: writable(null), updated: writable(false) };
});

vi.mock('$lib/utils/api', async () => {
  const actual = await vi.importActual<typeof import('$lib/utils/api')>('$lib/utils/api');
  return {
    ...actual,
    getConfig: vi.fn(),
    getConfigFor: vi.fn(),
    getDashboard: vi.fn(),
    listSettings: vi.fn(),
    getDashboardSettings: vi.fn()
  };
});

import * as api from '$lib/utils/api';
import { noteKept } from '$lib/utils/swCache';
import {
  config,
  configError,
  layoutStale,
  showingKept,
  applySavedLayout,
  loadConfig,
  otherDashboards,
  retryOtherDashboards,
  ensureFullConfig,
  hasPartialDashboards,
  fetchDashboard,
  dashboardFetches,
  DASHBOARD_MISMATCH,
  WHOLE_LOAD_TIMEOUT_MS,
  resetPartialLoadingForTests
} from './config';
import { isAuthenticated } from './auth';
import { editMode, editEntry, enableEditMode } from './editMode';
import { session, begin, resetEditSessionForTests } from './editSession';
import { toast } from './toast';

const tab = (id: string) => ({ id: `t-${id}`, name: 'Main', root: { columns: 24, children: [] } });
function full(id: string, revision: number): LayoutDashboard {
  return { id, name: id.toUpperCase(), path: `/${id}`, order: id.charCodeAt(0), revision, tabs: [tab(id)] } as LayoutDashboard;
}
function index(id: string, revision: number): LayoutDashboard {
  return { id, name: id.toUpperCase(), path: `/${id}`, order: id.charCodeAt(0), revision, partial: true } as unknown as LayoutDashboard;
}
const doc = (...ds: LayoutDashboard[]): Config => ({ schemaVersion: 3, layoutVersion: 2, dashboards: ds });
const idx = (configRevision: string, ...ds: LayoutDashboard[]) => ({ config: doc(...ds), configRevision });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Every value the store takes: which revision each dashboard it holds in full is at. */
function watchShown() {
  const seen: Array<Record<string, number>> = [];
  const unsub = config.subscribe((c) => {
    if (!c) return;
    const shown: Record<string, number> = {};
    for (const d of c.dashboards) if (d.partial !== true) shown[d.id] = d.revision;
    seen.push(shown);
  });
  return { seen, unsub };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {}); // the failures below are expected
  resetPartialLoadingForTests();
  resetEditSessionForTests();
  config.set(null);
  configError.set(null);
  layoutStale.set(false);
  editMode.set(false);
  editEntry.set(null);
  isAuthenticated.set(false);
  pageStore.set!({ url: new URL('http://localhost/a'), params: { dashboard: 'a' }, route: { id: '/[dashboard]' } });
});

describe('first load of a dashboard page', () => {
  it('first load uses index-plus-one then fetches the rest', async () => {
    const order: string[] = [];
    const rest = deferred<Config>();
    vi.mocked(api.getConfigFor).mockImplementation(async (key) => {
      order.push(`index:${key}`);
      return idx('r1', full('a', 3), index('b', 7));
    });
    vi.mocked(api.getConfig).mockImplementation(() => {
      order.push('rest');
      return rest.promise;
    });

    await loadConfig({ dashboard: 'a' });
    expect(order).toEqual(['index:a', 'rest']);
    // The open dashboard is whole; the other is an index entry, and that is said.
    expect(get(config)!.dashboards.find((d) => d.id === 'a')!.tabs).toHaveLength(1);
    expect(hasPartialDashboards(get(config))).toBe(true);
    expect(get(otherDashboards)).toBe('loading');

    rest.resolve(doc(full('a', 3), full('b', 7)));
    await flush();
    expect(get(otherDashboards)).toBe('ready');
    expect(hasPartialDashboards(get(config))).toBe(false);
    expect(get(config)!.dashboards.find((d) => d.id === 'b')!.tabs).toHaveLength(1);
  });

  it('with one dashboard there is nothing else to load: ready at once, one request', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValue(idx('r1', full('a', 3)));
    await loadConfig({ dashboard: '' });
    expect(api.getConfigFor).toHaveBeenCalledWith('');
    expect(api.getConfig).not.toHaveBeenCalled();
    expect(get(otherDashboards)).toBe('ready');
  });

  it('rest fails → {error}, and retryOtherDashboards recovers', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValue(idx('r1', full('a', 3), index('b', 7)));
    vi.mocked(api.getConfig).mockRejectedValueOnce(new Error('HOPS hit an error'));
    await loadConfig({ dashboard: 'a' });
    await flush();
    expect(get(otherDashboards)).toEqual({ error: 'HOPS hit an error' });
    // Still the index: never adopted as if it were everything.
    expect(hasPartialDashboards(get(config))).toBe(true);
    // The open dashboard keeps showing (the page itself is fine).
    expect(get(configError)).toBeNull();

    vi.mocked(api.getConfig).mockResolvedValueOnce(doc(full('a', 3), full('b', 7)));
    const retry = retryOtherDashboards();
    expect(get(otherDashboards)).toBe('loading');
    await retry;
    expect(get(otherDashboards)).toBe('ready');
    expect(hasPartialDashboards(get(config))).toBe(false);
  });

  it('a failed first load is the config error (with the page’s Retry), never an empty set', async () => {
    vi.mocked(api.getConfigFor).mockRejectedValue(new Error('offline'));
    await loadConfig({ dashboard: 'a' });
    expect(get(configError)).toBe('offline');
    expect(get(config)).toBeNull();
    expect(api.getConfig).not.toHaveBeenCalled();
  });

  it('an unknown dashboard: every entry is an index entry, the rest still loads', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValue({ ...idx('r1', index('a', 3), index('b', 7)), missing: 'nope' });
    vi.mocked(api.getConfig).mockResolvedValue(doc(full('a', 3), full('b', 7)));
    await loadConfig({ dashboard: 'nope' });
    expect(get(configError)).toBeNull();
    await flush();
    expect(get(otherDashboards)).toBe('ready');
  });
});

describe('consistency', () => {
  it('newer revision in the rest → layoutStale + full reload, no mixed state', async () => {
    // State 1: a=3, b=7. Someone saves a and b: state 2: a=4, b=8.
    vi.mocked(api.getConfigFor)
      .mockResolvedValueOnce(idx('r1', full('a', 3), index('b', 7)))
      .mockResolvedValueOnce(idx('r2', full('a', 4), index('b', 8)));
    const reload = deferred<Config>();
    vi.mocked(api.getConfig)
      .mockResolvedValueOnce(doc(full('a', 4), full('b', 8)))
      .mockImplementationOnce(() => reload.promise);
    const { seen, unsub } = watchShown();
    const stale: boolean[] = [];
    const unsubStale = layoutStale.subscribe((v) => stale.push(v));

    await loadConfig({ dashboard: 'a' });
    await flush();
    // The open dashboard changed under the viewer: the stale path ran, and the index was re-read.
    expect(stale).toContain(true);
    expect(api.getConfigFor).toHaveBeenCalledTimes(2);
    expect(api.getConfigFor).toHaveBeenLastCalledWith('a');
    expect(get(config)!.dashboards.find((d) => d.id === 'a')!.revision).toBe(4);
    expect(get(otherDashboards)).toBe('loading');

    reload.resolve(doc(full('a', 4), full('b', 8)));
    await flush();
    unsub();
    unsubStale();
    expect(get(otherDashboards)).toBe('ready');
    expect(get(layoutStale)).toBe(false);
    // Never a=3 shown next to b=8 (or a=4 next to b=7).
    for (const shown of seen) {
      expect(shown.a === 3 && shown.b === 8).toBe(false);
      expect(shown.a === 4 && shown.b === 7).toBe(false);
    }
    expect(seen.at(-1)).toEqual({ a: 4, b: 8 });
  });

  it('two different states in a row (kept copies offline): one reload, then the whole document alone, never a loop', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValue(idx('r1', full('a', 3), index('b', 7)));
    vi.mocked(api.getConfig).mockResolvedValue(doc(full('a', 4), full('b', 8)));
    const { seen, unsub } = watchShown();
    await loadConfig({ dashboard: 'a' });
    await flush();
    unsub();
    expect(api.getConfigFor).toHaveBeenCalledTimes(2);
    expect(get(otherDashboards)).toBe('ready');
    expect(get(layoutStale)).toBe(false);
    for (const shown of seen) expect(shown.a === 3 && shown.b === 8).toBe(false);
    expect(seen.at(-1)).toEqual({ a: 4, b: 8 });
  });

  it('a newer revision only on another dashboard: the rest is adopted as is, no stale reload', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValueOnce(idx('r1', full('a', 3), index('b', 7)));
    vi.mocked(api.getConfig).mockResolvedValueOnce(doc(full('a', 3), full('b', 9), full('c', 1)));
    const stale: boolean[] = [];
    const unsubStale = layoutStale.subscribe((v) => stale.push(v));
    await loadConfig({ dashboard: 'a' });
    await flush();
    unsubStale();
    expect(stale).not.toContain(true);
    expect(api.getConfigFor).toHaveBeenCalledTimes(1);
    expect(get(config)!.dashboards.map((d) => [d.id, d.revision])).toEqual([
      ['a', 3],
      ['b', 9],
      ['c', 1]
    ]);
    expect(get(otherDashboards)).toBe('ready');
  });

  it('a dashboard opened before the rest arrives is fetched on its own and taken at the same state', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValueOnce(idx('r1', full('a', 3), index('b', 7)));
    vi.mocked(api.getConfig).mockImplementation(() => new Promise(() => {})); // the rest never arrives
    vi.mocked(api.getDashboard).mockResolvedValueOnce({ dashboard: full('b', 7), revision: 7, configRevision: 'r1' });
    await loadConfig({ dashboard: 'a' });
    await fetchDashboard('b');
    expect(api.getDashboard).toHaveBeenCalledWith('b');
    const b = get(config)!.dashboards.find((d) => d.id === 'b')!;
    expect(b.partial).toBeUndefined();
    expect(b.tabs).toHaveLength(1);
    expect(get(dashboardFetches)).toEqual({});
  });

  it('a dashboard fetched at another config revision is not taken: index + open reloaded instead', async () => {
    vi.mocked(api.getConfigFor)
      .mockResolvedValueOnce(idx('r1', full('a', 3), index('b', 7)))
      .mockResolvedValueOnce(idx('r2', index('a', 4), full('b', 8)));
    vi.mocked(api.getConfig).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.getDashboard).mockResolvedValueOnce({ dashboard: full('b', 8), revision: 8, configRevision: 'r2' });
    await loadConfig({ dashboard: 'a' });
    pageStore.set!({ url: new URL('http://localhost/b'), params: { dashboard: 'b' }, route: { id: '/[dashboard]' } });
    const { seen, unsub } = watchShown();
    await fetchDashboard('b');
    await flush();
    unsub();
    expect(api.getConfigFor).toHaveBeenLastCalledWith('b');
    for (const shown of seen) expect(shown.a === 3 && shown.b === 8).toBe(false);
    expect(get(config)!.dashboards.find((d) => d.id === 'b')!.revision).toBe(8);
  });

  it('a one-dashboard read that keeps disagreeing with the index: one reload, then the visible error, and Retry starts fresh', async () => {
    // Kept copies offline: this copy of B is older than every index the page can get.
    vi.mocked(api.getConfigFor).mockResolvedValue(idx('r2', full('a', 3), index('b', 7)));
    vi.mocked(api.getConfig).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.getDashboard).mockResolvedValue({ dashboard: full('b', 6), revision: 6, configRevision: 'r1' });
    await loadConfig({ dashboard: 'a' });
    pageStore.set!({ url: new URL('http://localhost/b'), params: { dashboard: 'b' }, route: { id: '/[dashboard]' } });

    await fetchDashboard('b');
    await flush();
    expect(api.getConfigFor).toHaveBeenCalledTimes(2); // the one reload
    expect(get(dashboardFetches)).toEqual({});

    await fetchDashboard('b');
    await flush();
    expect(api.getConfigFor).toHaveBeenCalledTimes(2); // no second reload: the failure is shown
    expect(get(dashboardFetches)).toEqual({ b: { error: DASHBOARD_MISMATCH } });

    // The route's Retry: a fresh start, with its own one reload.
    await loadConfig({ background: true, dashboard: 'b' });
    expect(get(dashboardFetches)).toEqual({});
    await fetchDashboard('b');
    await flush();
    expect(api.getConfigFor).toHaveBeenCalledTimes(4);
    await fetchDashboard('b');
    await flush();
    expect(api.getConfigFor).toHaveBeenCalledTimes(4);
    expect(get(dashboardFetches)).toEqual({ b: { error: DASHBOARD_MISMATCH } });
  });

  it('a failed one-dashboard fetch is kept for the page to show, with Retry', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValueOnce(idx('r1', full('a', 3), index('b', 7)));
    vi.mocked(api.getConfig).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.getDashboard).mockRejectedValueOnce(new Error('HOPS hit an error'));
    await loadConfig({ dashboard: 'a' });
    await fetchDashboard('b');
    expect(get(dashboardFetches)).toEqual({ b: { error: 'HOPS hit an error' } });
    expect(get(config)!.dashboards.find((d) => d.id === 'b')!.partial).toBe(true);
  });
});

describe('a held whole document is never downgraded', () => {
  it('loadConfig({dashboard}) with the whole document held reads the whole document', async () => {
    config.set(doc(full('a', 3), full('b', 7)));
    vi.mocked(api.getConfig).mockResolvedValue(doc(full('a', 3), full('b', 7)));
    await loadConfig({ dashboard: 'a' });
    expect(api.getConfigFor).not.toHaveBeenCalled();
    expect(hasPartialDashboards(get(config))).toBe(false);
  });

  it('nor while an edit session exists, even after the config went away (a failed reload)', async () => {
    config.set(doc(full('a', 3), full('b', 7)));
    begin('a');
    expect(get(session)?.dashboardId).toBe('a');
    config.set(null);
    vi.mocked(api.getConfig).mockResolvedValue(doc(full('a', 3), full('b', 7)));
    await loadConfig({ dashboard: 'a' });
    expect(api.getConfigFor).not.toHaveBeenCalled();
  });

  it('a light answer landing after a whole document does not replace it', async () => {
    config.set(doc(full('a', 3), index('b', 7)));
    const light = deferred<ReturnType<typeof idx>>();
    vi.mocked(api.getConfigFor).mockImplementationOnce(() => light.promise);
    const load = loadConfig({ dashboard: 'a' });
    config.set(doc(full('a', 4), full('b', 7))); // a write's response
    light.resolve(idx('r1', full('a', 3), index('b', 7)));
    await load;
    expect(hasPartialDashboards(get(config))).toBe(false);
    expect(get(config)!.dashboards[0].revision).toBe(4);
  });

  it('begin refuses visibly while the store holds index entries, on the entry itself or another dashboard', () => {
    const err = vi.spyOn(toast, 'error');
    config.set(doc(full('a', 3), index('b', 7)));
    begin('b');
    expect(get(session)).toBeNull();
    begin('a');
    expect(get(session)).toBeNull();
    expect(err).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("editing can't start"));
  });
});

describe('ensureFullConfig', () => {
  it('editor entry awaits ensureFullConfig', async () => {
    isAuthenticated.set(true);
    vi.mocked(api.getConfigFor).mockResolvedValueOnce(idx('r1', full('a', 3), index('b', 7)));
    const rest = deferred<Config>();
    vi.mocked(api.getConfig).mockImplementationOnce(() => rest.promise);
    await loadConfig({ dashboard: 'a' });

    const entering = enableEditMode();
    await flush();
    // Not editing yet: the other dashboards are still loading.
    expect(get(session)).toBeNull();
    expect(get(editMode)).toBe(false);

    rest.resolve(doc(full('a', 3), full('b', 7)));
    expect(await entering).toBe(true);
    expect(hasPartialDashboards(get(config))).toBe(false);
    expect(get(session)?.dashboardId).toBe('a');
    expect(get(editMode)).toBe(true);
    // The rest was joined, not fetched twice.
    expect(api.getConfig).toHaveBeenCalledTimes(1);
  });

  it('editing does not start when the whole config cannot be loaded, and says why', async () => {
    isAuthenticated.set(true);
    const err = vi.spyOn(toast, 'error');
    vi.mocked(api.getConfigFor).mockResolvedValueOnce(idx('r1', full('a', 3), index('b', 7)));
    vi.mocked(api.getConfig).mockRejectedValue(new Error('HOPS hit an error'));
    await loadConfig({ dashboard: 'a' });
    await flush();
    expect(await enableEditMode()).toBe(false);
    expect(get(editMode)).toBe(false);
    expect(get(session)).toBeNull();
    expect(err).toHaveBeenCalledWith(expect.stringContaining("Couldn't load all your dashboards"));
  });

  it('signed out while the whole config loads: editing does not start', async () => {
    isAuthenticated.set(true);
    vi.mocked(api.getConfigFor).mockResolvedValueOnce(idx('r1', full('a', 3), index('b', 7)));
    const rest = deferred<Config>();
    vi.mocked(api.getConfig).mockImplementationOnce(() => rest.promise);
    await loadConfig({ dashboard: 'a' });
    const entering = enableEditMode();
    await flush();
    isAuthenticated.set(false);
    rest.resolve(doc(full('a', 3), full('b', 7)));
    expect(await entering).toBe(false);
    expect(get(session)).toBeNull();
  });

  it('after ensureFullConfig every reload loads the whole config', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValueOnce(idx('r1', full('a', 3), index('b', 7)));
    vi.mocked(api.getConfig).mockResolvedValue(doc(full('a', 3), full('b', 7)));
    await loadConfig({ dashboard: 'a' });
    await ensureFullConfig();
    vi.mocked(api.getConfigFor).mockClear();
    await loadConfig({ dashboard: 'a' });
    expect(api.getConfigFor).not.toHaveBeenCalled();
    expect(hasPartialDashboards(get(config))).toBe(false);
  });

  it('while waiting the pencil is busy and the wait is named; a failure stays shown, and Retry starts editing', async () => {
    isAuthenticated.set(true);
    vi.mocked(api.getConfigFor).mockResolvedValueOnce(idx('r1', full('a', 3), index('b', 7)));
    const rest = deferred<Config>();
    vi.mocked(api.getConfig).mockImplementationOnce(() => rest.promise);
    await loadConfig({ dashboard: 'a' });

    const first = enableEditMode();
    await flush();
    expect(get(editEntry)).toEqual({ dashboardId: 'a', busy: true });
    expect(await enableEditMode()).toBe(false); // a second press while busy does nothing
    rest.reject(new Error('Loading took too long. Check the connection and try again.'));
    expect(await first).toBe(false);
    expect(get(editEntry)).toEqual({ dashboardId: 'a', busy: false });
    expect(get(otherDashboards)).toEqual({ error: 'Loading took too long. Check the connection and try again.' });

    vi.mocked(api.getConfig).mockResolvedValueOnce(doc(full('a', 3), full('b', 7)));
    expect(await enableEditMode()).toBe(true);
    expect(get(editEntry)).toBeNull();
    expect(get(session)?.dashboardId).toBe('a');
  });

  it('waiting for the rest is bounded: the reads carry the timeout', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValueOnce(idx('r1', full('a', 3), index('b', 7)));
    vi.mocked(api.getConfig).mockResolvedValue(doc(full('a', 3), full('b', 7)));
    await loadConfig({ dashboard: 'a' });
    await flush();
    expect(api.getConfig).toHaveBeenCalledWith({ timeoutMs: WHOLE_LOAD_TIMEOUT_MS });
  });

  it('moved to another dashboard while it loaded: editing silently does not start', async () => {
    isAuthenticated.set(true);
    const err = vi.spyOn(toast, 'error');
    vi.mocked(api.getConfigFor).mockResolvedValueOnce(idx('r1', full('a', 3), index('b', 7)));
    const rest = deferred<Config>();
    vi.mocked(api.getConfig).mockImplementationOnce(() => rest.promise);
    await loadConfig({ dashboard: 'a' });
    const entering = enableEditMode();
    await flush();
    pageStore.set!({ url: new URL('http://localhost/b'), params: { dashboard: 'b' }, route: { id: '/[dashboard]' } });
    rest.resolve(doc(full('a', 3), full('b', 7)));
    expect(await entering).toBe(false);
    expect(get(session)).toBeNull();
    expect(get(editEntry)).toBeNull();
    expect(err).not.toHaveBeenCalled();
  });

  it('a rest that fails after a newer load took over is not reported', async () => {
    vi.mocked(api.getConfigFor).mockResolvedValueOnce(idx('r1', full('a', 3), index('b', 7)));
    const rest = deferred<Config>();
    vi.mocked(api.getConfig).mockImplementationOnce(() => rest.promise);
    await loadConfig({ dashboard: 'a' });
    const waiting = ensureFullConfig();
    await flush();
    vi.mocked(api.getConfig).mockResolvedValueOnce(doc(full('a', 3), full('b', 7)));
    const newer = loadConfig();
    await newer;
    rest.reject(new Error('aborted'));
    await expect(waiting).resolves.toBeUndefined();
    expect(get(otherDashboards)).toBe('ready');
  });

  it('with nothing held it loads the whole config, and rejects visibly on failure', async () => {
    vi.mocked(api.getConfig).mockRejectedValueOnce(new Error('offline'));
    await expect(ensureFullConfig()).rejects.toThrow('offline');
    expect(get(configError)).toBe('offline');
  });
});

describe('showing a kept copy', () => {
  const getConfig = vi.mocked(api.getConfig);
  const getConfigFor = vi.mocked(api.getConfigFor);
  const getDashboard = vi.mocked(api.getDashboard);

  beforeEach(() => {
    resetPartialLoadingForTests();
    getConfig.mockReset();
    getConfigFor.mockReset();
    getDashboard.mockReset();
    config.set(null);
    showingKept.set(false);
  });

  const keptWhole = () => noteKept(doc(full('a', 1)));

  it('a kept answer is held as kept, even with the probe still saying online', async () => {
    getConfigFor.mockResolvedValue({ config: keptWhole(), configRevision: '' });
    await loadConfig({ dashboard: 'a' });
    expect(get(showingKept)).toBe(true);
  });

  it('a kept whole config in the background turns it on over a fresh index', async () => {
    getConfigFor.mockResolvedValue(idx('r1', full('a', 1), index('b', 1)));
    getConfig.mockResolvedValue(noteKept(doc(full('a', 1), full('b', 1))));
    await loadConfig({ dashboard: 'a' });
    await flush();
    expect(get(showingKept)).toBe(true);
  });

  it('a kept dashboard joining a fresh index turns it on', async () => {
    getConfigFor.mockResolvedValue(idx('r1', full('a', 1), index('b', 1)));
    getConfig.mockImplementation(() => new Promise(() => {}));
    await loadConfig({ dashboard: 'a' });
    expect(get(showingKept)).toBe(false);
    getDashboard.mockResolvedValue(noteKept({ dashboard: full('b', 1), revision: 1, configRevision: 'r1' }));
    await fetchDashboard('b');
    expect(get(showingKept)).toBe(true);
  });

  it('stays on through a failed read, and only a read from the server ends it', async () => {
    getConfig.mockResolvedValue(keptWhole());
    await loadConfig();
    getConfig.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await loadConfig({ background: true });
    expect(get(showingKept)).toBe(true);
    expect(get(configError)).toBeTruthy();
    getConfig.mockResolvedValue(keptWhole());
    await loadConfig({ background: true });
    expect(get(showingKept)).toBe(true);
    getConfig.mockResolvedValue(doc(full('a', 2)));
    await loadConfig({ background: true });
    expect(get(showingKept)).toBe(false);
    expect(get(config)?.dashboards[0].revision).toBe(2);
  });

  it('a failed migration leaves nothing held, so no saved-copy banner over it', async () => {
    getConfig.mockResolvedValue(keptWhole());
    await loadConfig();
    getConfig.mockRejectedValue(new api.MigrationFailedError('broken'));
    await loadConfig();
    expect(get(config)).toBeNull();
    expect(get(showingKept)).toBe(false);
  });

  it("a write's answer is the server's document: it ends it", async () => {
    getConfig.mockResolvedValue(keptWhole());
    await loadConfig();
    applySavedLayout({ layout: { dashboards: [full('a', 2)] } } as never);
    expect(get(showingKept)).toBe(false);
  });
});
