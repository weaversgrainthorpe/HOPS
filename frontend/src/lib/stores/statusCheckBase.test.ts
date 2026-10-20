import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => {
  const actual = await vi.importActual<typeof import('$lib/utils/api')>('$lib/utils/api');
  return { MigrationFailedError: actual.MigrationFailedError, getDashboardSettings: vi.fn() };
});
vi.mock('$lib/utils/errors', () => ({ logError: vi.fn() }));

import { getDashboardSettings, type DashboardSettingsResponse } from '$lib/utils/api';
import { statusBaseFor, refreshStatusBase, refreshAllStatusBases, resetStatusBaseCache } from './statusCheckBase';

const resp = (override: boolean | null, effective: boolean) =>
  ({
    overrides: { statusChecksEnabled: override },
    effective: { statusChecksEnabled: effective },
    revision: 1
  }) as unknown as DashboardSettingsResponse;

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.mocked(getDashboardSettings).mockReset();
  resetStatusBaseCache();
});

describe('statusCheckBase', () => {
  it('a refresh waits for a read already in flight, then reads again (the fresher answer wins)', async () => {
    let first!: (r: DashboardSettingsResponse) => void;
    vi.mocked(getDashboardSettings)
      .mockReturnValueOnce(new Promise((r) => (first = r)))
      .mockResolvedValueOnce(resp(null, true));
    const s = statusBaseFor('d1');
    const done = refreshStatusBase('d1');
    expect(getDashboardSettings).toHaveBeenCalledTimes(1);
    first(resp(null, false)); // the stale, pre-save answer
    await done;
    expect(getDashboardSettings).toHaveBeenCalledTimes(2);
    expect(get(s)).toEqual({ state: 'ok', base: { on: true, source: 'global', dashboardId: 'd1' } });
  });

  it('refreshAllStatusBases re-reads every cached dashboard (after a global Settings save)', async () => {
    vi.mocked(getDashboardSettings).mockResolvedValue(resp(null, false));
    const a = statusBaseFor('a');
    const b = statusBaseFor('b');
    await flush();
    vi.mocked(getDashboardSettings).mockResolvedValue(resp(null, true));
    await refreshAllStatusBases();
    expect(get(a)).toMatchObject({ state: 'ok', base: { on: true } });
    expect(get(b)).toMatchObject({ state: 'ok', base: { on: true } });
    expect(getDashboardSettings).toHaveBeenCalledTimes(4);
  });

  it('a failed read is an error state, never a value', async () => {
    vi.mocked(getDashboardSettings).mockRejectedValue(new Error('boom'));
    const s = statusBaseFor('d1');
    await flush();
    expect(get(s)).toEqual({ state: 'error', message: 'boom' });
  });
});
