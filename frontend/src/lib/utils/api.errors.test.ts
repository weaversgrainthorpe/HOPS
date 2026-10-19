import { describe, it, expect, vi, afterEach } from 'vitest';
import { saveDashboard, getConfig, ConflictError, MigrationFailedError } from './api';

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      text: async () => JSON.stringify(body)
    })
  );
}

afterEach(() => vi.unstubAllGlobals());

const dash = { id: 'a', name: 'a', path: '/a', tabs: [], order: 0 };

describe('fetchAPI error mapping', () => {
  it('maps 409 conflict to ConflictError', async () => {
    respond(409, { error: 'conflict', dashboardId: 'a', currentRevision: 9 });
    const err = await saveDashboard('a', dash, 3).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.dashboardId).toBe('a');
    expect(err.currentRevision).toBe(9);
  });

  it('maps 503 migration_failed to MigrationFailedError', async () => {
    respond(503, { error: 'migration_failed', detail: 'bad row', backupHint: 'x' });
    const err = await getConfig().catch((e) => e);
    expect(err).toBeInstanceOf(MigrationFailedError);
    expect(err.detail).toBe('bad row');
  });

  it('leaves other 503s as plain errors', async () => {
    respond(503, { error: 'Config unavailable' });
    const err = await getConfig().catch((e) => e);
    expect(err).not.toBeInstanceOf(MigrationFailedError);
    expect(err.message).toBe('Config unavailable');
  });

  it('saveDashboard PUTs {dashboard, revision} and returns the new revision', async () => {
    respond(200, { revision: 4 });
    const r = await saveDashboard('a', dash, 3);
    expect(r).toEqual({ revision: 4 });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/dashboards/a');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ dashboard: dash, revision: 3 });
  });
});
