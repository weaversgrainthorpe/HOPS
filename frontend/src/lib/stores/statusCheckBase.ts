/**
 * The dashboard level of the layered status checks, for the editing dialogs (Ruling 3): from
 * GET /api/dashboards/{id}/settings (protected — the dialogs only open while editing), fetched
 * once per dashboard per page session and refreshed after a dashboard-settings save. While it
 * loads the dialogs say "Checking…"; a failure is a visible error with Retry, never a guess.
 */
import { writable, type Readable, type Writable } from 'svelte/store';
import { getDashboardSettings, MigrationFailedError } from '$lib/utils/api';
import { dashboardBase, type DashboardBase } from '$lib/editor/statusChecks';
import { logError } from '$lib/utils/errors';

export type BaseState =
  | { state: 'loading' }
  | { state: 'ok'; base: DashboardBase }
  | { state: 'error'; message: string };

const cache = new Map<string, Writable<BaseState>>();
const inflight = new Map<string, Promise<void>>();

async function fetchInto(id: string, store: Writable<BaseState>): Promise<void> {
  const running = inflight.get(id);
  if (running) return running;
  const p = (async () => {
    try {
      const resp = await getDashboardSettings(id);
      const eff = resp.effective?.statusChecksEnabled;
      if (typeof eff !== 'boolean') throw new Error('The server did not say whether status checks are on.');
      store.set({ state: 'ok', base: dashboardBase(id, resp.overrides?.statusChecksEnabled, eff) });
    } catch (e) {
      logError('Dashboard status-check setting', e);
      const msg =
        e instanceof MigrationFailedError ? 'the configuration failed to migrate' :
        e instanceof Error && e.message ? e.message : 'the request failed';
      store.set({ state: 'error', message: msg });
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

/** The dashboard level for `dashboardId` (fetched on first use). */
export function statusBaseFor(dashboardId: string): Readable<BaseState> {
  let s = cache.get(dashboardId);
  if (!s) {
    s = writable<BaseState>({ state: 'loading' });
    cache.set(dashboardId, s);
    void fetchInto(dashboardId, s);
  }
  return { subscribe: s.subscribe };
}

/** Fetch again (Retry, or after the dashboard's settings were saved). No-op if never used. */
export function refreshStatusBase(dashboardId: string): Promise<void> {
  const s = cache.get(dashboardId);
  if (!s) return Promise.resolve();
  s.set({ state: 'loading' });
  // A fetch already running may have started before the save: wait for it, then read again.
  const store = s;
  return (inflight.get(dashboardId) ?? Promise.resolve()).then(() => {
    store.set({ state: 'loading' });
    return fetchInto(dashboardId, store);
  });
}

/** Tests only. */
export function resetStatusBaseCache(): void {
  cache.clear();
  inflight.clear();
}
