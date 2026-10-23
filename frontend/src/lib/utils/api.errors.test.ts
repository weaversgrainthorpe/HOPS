import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  saveDashboardV3, transferNodes, getConfig, dismissNotice, createDashboard, reorderDashboards, promoteScan, ConflictError, MigrationFailedError
} from './api';
import type { LayoutDashboard } from '$lib/types/layout';

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

const dash: LayoutDashboard = { id: 'a', name: 'a', path: '/a', revision: 3, tabs: [] };
const doc = { schemaVersion: 3, dashboards: [dash] };

describe('fetchAPI error mapping', () => {
  it('maps 409 conflict to ConflictError', async () => {
    respond(409, { error: 'conflict', dashboardId: 'a', currentRevision: 9 });
    const err = await saveDashboardV3('a', dash, 3).catch((e: unknown) => e) as ConflictError;
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.dashboardId).toBe('a');
    expect(err.currentRevision).toBe(9);
  });

  it('a 409 path_taken shows the server sentence', async () => {
    respond(409, { error: 'path_taken', detail: 'Path /a is already used by the dashboard a' });
    const err = await createDashboard('X', '/a').catch((e: unknown) => e) as Error;
    expect(err).not.toBeInstanceOf(ConflictError);
    expect(err.message).toBe('Path /a is already used by the dashboard a');
  });

  it('maps 503 migration_failed to MigrationFailedError', async () => {
    respond(503, { error: 'migration_failed', detail: 'bad row', backupHint: 'x' });
    const err = await getConfig().catch((e: unknown) => e) as MigrationFailedError;
    expect(err).toBeInstanceOf(MigrationFailedError);
    expect(err.detail).toBe('bad row');
  });

  it('leaves other 503s as plain errors', async () => {
    respond(503, { error: 'Config unavailable' });
    const err = await getConfig().catch((e: unknown) => e) as Error;
    expect(err).not.toBeInstanceOf(MigrationFailedError);
    expect(err.message).toBe('Config unavailable');
  });
});

describe('GET /api/config', () => {
  it('returns the v3 document with its migration notices', async () => {
    respond(200, { ...doc, migrationNotices: ['n'] });
    expect(await getConfig()).toEqual({ ...doc, migrationNotices: ['n'] });
  });

  it('returns the server notices (M4 Task 7); a malformed notice is dropped visibly, never failing the load', async () => {
    respond(200, { ...doc, notices: [{ id: 'n1', text: 'Hello' }] });
    expect(await getConfig()).toEqual({ ...doc, notices: [{ id: 'n1', text: 'Hello' }] });
    // A malformed entry is dropped and COUNTED (the banner says so); the dashboards still load.
    respond(200, { ...doc, notices: [{ id: 'n1' }, { id: 'n2', text: 'Ok' }, 'x'] });
    expect(await getConfig()).toEqual({ ...doc, notices: [{ id: 'n2', text: 'Ok' }], noticesUnreadable: 2 });
    respond(200, { ...doc, notices: 'nope' });
    expect(await getConfig()).toEqual({ ...doc, notices: [], noticesUnreadable: 1 });
  });

  it('keeps the layout version (M5 §2a) so the editor can tell the form; absent stays absent', async () => {
    respond(200, { ...doc, layoutVersion: 2 });
    expect(await getConfig()).toEqual({ ...doc, layoutVersion: 2 });
    respond(200, doc);
    expect(await getConfig()).not.toHaveProperty('layoutVersion');
  });

  it('dismissNotice POSTs to /api/notices/{id}/dismiss (id encoded)', async () => {
    respond(204, null);
    await dismissNotice('a/b');
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/notices/a%2Fb/dismiss');
    expect(init.method).toBe('POST');
  });

  it('anything that is not a schema-3 document is a visible error, never an empty dashboard list', async () => {
    for (const body of [{ dashboards: [dash] }, { schemaVersion: 3 }, { schemaVersion: 2, dashboards: [] }, null]) {
      respond(200, body);
      await expect(getConfig()).rejects.toThrow(/schema 3/);
    }
  });
});

describe('M5 §2a: every placement-carrying write says which layout version it is in', () => {
  const req = {
    mode: 'move' as const, sourceId: 'a', sourceRevision: 3, nodeIds: ['n'], targetId: 'b', targetRevision: 1,
    target: { tabId: 't' }
  };
  it('transferNodes POSTs layoutVersion: 2 with the request', async () => {
    respond(200, { sourceRevision: 4, targetRevision: 2, layout: doc });
    await transferNodes(req);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/dashboards/transfer');
    expect(JSON.parse(init.body as string)).toEqual({ ...req, layoutVersion: 2 });
  });
  it('a 409 layout_version_mismatch surfaces the server\'s reload message (and is not a revision conflict)', async () => {
    const detail = 'HOPS was updated since this page was loaded, so this change was not saved. Reload the page.';
    respond(409, { error: 'layout_version_mismatch', detail, layoutVersion: 2 });
    const err = await saveDashboardV3('a', dash, 3).catch((e: unknown) => e) as Error;
    expect(err).not.toBeInstanceOf(ConflictError);
    expect(err.message).toBe(detail);
    respond(409, { error: 'layout_version_mismatch', detail, layoutVersion: 2 });
    await expect(transferNodes(req)).rejects.toThrow(detail);
  });
  it('a 409 layout_version_mismatch without a detail still says to reload', async () => {
    respond(409, { error: 'layout_version_mismatch' });
    await expect(saveDashboardV3('a', dash, 3)).rejects.toThrow(/HOPS was updated.*Reload/);
  });
});

describe('dashboard writes', () => {
  it('saveDashboardV3 PUTs {schema: 3, dashboard, revision} and returns the revision and fresh document', async () => {
    respond(200, { revision: 4, layout: doc });
    const r = await saveDashboardV3('a', dash, 3);
    expect(r).toEqual({ revision: 4, layout: doc });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/dashboards/a');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ schema: 3, dashboard: dash, revision: 3, layoutVersion: 2 });
  });

  it('createDashboard POSTs {name, path} and needs the new id back', async () => {
    respond(200, { id: 'n1', revision: 1, layout: doc });
    expect(await createDashboard('N', '/n')).toEqual({ id: 'n1', revision: 1, layout: doc });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/dashboards$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'N', path: '/n' });
    respond(200, { status: 'ok' });
    await expect(createDashboard('N', '/n')).rejects.toThrow(/did not confirm/);
  });

  it('reorderDashboards PUTs {order}', async () => {
    respond(200, { status: 'ok', layout: doc, warning: 'Pre-update backup failed' });
    expect(await reorderDashboards(['b', 'a'])).toEqual({ layout: doc, warning: 'Pre-update backup failed' });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/dashboards/order');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ order: ['b', 'a'] });
  });

  it('promoteScan sends the folder target and returns the warning', async () => {
    respond(200, { promoted: 2, dashboardPath: '/a', warning: 'Folder "X" may need resizing to show all its tiles.', layout: doc });
    const r = await promoteScan('s1', { dashboardId: 'a', tabId: 't', folderId: 'f' }, ['r1', 'r2']);
    expect(r).toEqual({ promoted: 2, dashboardPath: '/a', warning: 'Folder "X" may need resizing to show all its tiles.', layout: doc });
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ target: { dashboardId: 'a', tabId: 't', folderId: 'f' }, resultIds: ['r1', 'r2'] });
  });
});
