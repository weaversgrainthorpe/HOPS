// One layout version replaces the gridUnit marker. Every placement-carrying write says
// which layout version its placements are in; the server refuses a mismatch with a 409.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { saveDashboardV3, transferNodes, getConfig, ConflictError } from './api';
import { layoutFormProblem, OLD_LAYOUT_FORM } from '$lib/stores/config';
import type { LayoutDashboard } from '$lib/types/layout';

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: status < 400, status, text: async () => JSON.stringify(body) }));
}
afterEach(() => vi.unstubAllGlobals());

const dash: LayoutDashboard = { id: 'a', name: 'a', path: '/a', revision: 3, tabs: [] };
const doc = { schemaVersion: 3, layoutVersion: 2, dashboards: [dash] };
const req = {
  mode: 'move' as const, sourceId: 'a', sourceRevision: 3, nodeIds: ['n'], targetId: 'b', targetRevision: 1,
  target: { tabId: 't' }
};
const bodyOf = () => JSON.parse((vi.mocked(fetch).mock.calls[0] as [string, RequestInit])[1].body as string);

describe('the save marker', () => {
  it('saveDashboardV3 sends layoutVersion 2 (and no gridUnit)', async () => {
    respond(200, { revision: 4, layout: doc });
    await saveDashboardV3('a', dash, 3);
    expect(bodyOf()).toEqual({ schema: 3, dashboard: dash, revision: 3, layoutVersion: 2 });
  });
  it('transferNodes sends layoutVersion 2 (and no gridUnit)', async () => {
    respond(200, { sourceRevision: 4, targetRevision: 2, layout: doc });
    await transferNodes(req);
    expect(bodyOf()).toEqual({ ...req, layoutVersion: 2 });
  });
  it('a 409 layout_version_mismatch shows the server\'s reload message, never a revision conflict', async () => {
    const detail = 'HOPS was updated since this page was loaded, so this change was not saved. Reload the page.';
    respond(409, { error: 'layout_version_mismatch', detail });
    const err = (await saveDashboardV3('a', dash, 3).catch((e: unknown) => e)) as Error;
    expect(err).not.toBeInstanceOf(ConflictError);
    expect(err.message).toBe(detail);
    respond(409, { error: 'layout_version_mismatch' });
    await expect(transferNodes(req)).rejects.toThrow(/Reload/);
  });
});

describe('GET /api/config keeps the marker as sent', () => {
  it('present stays, absent stays absent', async () => {
    respond(200, doc);
    expect(await getConfig()).toEqual(doc);
    respond(200, { schemaVersion: 3, dashboards: [dash] });
    expect(await getConfig()).not.toHaveProperty('layoutVersion');
  });
});

describe('layoutFormProblem', () => {
  it('is null only for a document at layoutVersion 2', () => {
    expect(layoutFormProblem({ schemaVersion: 3, layoutVersion: 2, dashboards: [] })).toBeNull();
    expect(layoutFormProblem({ schemaVersion: 3, dashboards: [] })).toBe(OLD_LAYOUT_FORM);
    // The older form (1) and any other version are another form (the minimum changed).
    expect(layoutFormProblem({ schemaVersion: 3, layoutVersion: 1, dashboards: [] })).toBe(OLD_LAYOUT_FORM);
    expect(layoutFormProblem({ schemaVersion: 3, layoutVersion: 3, dashboards: [] })).toBe(OLD_LAYOUT_FORM);
    expect(layoutFormProblem({ schemaVersion: 3, gridUnit: 2, dashboards: [] } as never)).toBe(OLD_LAYOUT_FORM);
    expect(layoutFormProblem(null)).toBe(OLD_LAYOUT_FORM);
  });
  it('says what to do', () => {
    expect(OLD_LAYOUT_FORM).toMatch(/reload/i);
  });
});
