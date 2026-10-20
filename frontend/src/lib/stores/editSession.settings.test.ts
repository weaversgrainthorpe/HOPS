import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn(),
  saveDashboardSettings: vi.fn(),
  getConfig: vi.fn(() => new Promise(() => {})) // a background reload never lands here
}));

import * as api from '$lib/utils/api';
import { config, layoutStale, saveDashboardSettingsChanges } from './config';
import { begin, apply, save, session, dirty, sessionConflict, resetEditSessionForTests } from './editSession';
import { updateNode } from '$lib/editor/treeOps';
import type { Config } from '$lib/types';
import type { LayoutDashboard, LayoutNode } from '$lib/types/layout';

const tile = (id: string) =>
  ({ kind: 'tile', id, name: id, url: 'http://x', placement: { x: 0, y: 0, w: 1, h: 1 } }) as unknown as LayoutNode;
const layoutD = (): LayoutDashboard => ({
  id: 'd', name: 'D', path: '/d', revision: 7, settings: { editIdleTimeoutMinutes: null },
  tabs: [{ id: 't', name: 'T', root: { columns: 12, children: [tile('a')] } }]
});

beforeEach(() => {
  vi.clearAllMocks();
  resetEditSessionForTests();
  layoutStale.set(false);
  config.set({ schemaVersion: 3, dashboards: [layoutD()] });
});

/** A write response: the new revision and the committed document. */
const freshAt = (revision: number, settings: Record<string, unknown> = { editIdleTimeoutMinutes: 30 }) => ({
  revision,
  layout: { schemaVersion: 3 as const, dashboards: [{ ...layoutD(), revision, settings }] }
});

describe('Settings saved during an edit session (Ruling 19)', () => {
  it('the session absorbs it: the next Save is checked against the new revision — no false conflict', async () => {
    begin('d');
    apply('Rename', (d) => updateNode(d, 'a', { name: 'Renamed' } as Partial<LayoutNode>));
    vi.mocked(api.saveDashboardSettings).mockResolvedValue(freshAt(8));
    await saveDashboardSettingsChanges('d', { editIdleTimeoutMinutes: 30 });
    expect(api.saveDashboardSettings).toHaveBeenCalledWith('d', { editIdleTimeoutMinutes: 30 }, 7);

    const s = get(session)!;
    expect(s.baseRevision).toBe(8);
    expect((s.saved.settings as Record<string, unknown>).editIdleTimeoutMinutes).toBe(30);
    expect((s.draft.settings as Record<string, unknown>).editIdleTimeoutMinutes).toBe(30);
    expect(get(dirty)).toBe(true); // the draft edit is still pending

    vi.mocked(api.saveDashboardV3).mockResolvedValue(freshAt(9));
    expect(await save()).toBe('saved');
    expect(vi.mocked(api.saveDashboardV3).mock.calls[0][2]).toBe(8);
    expect(get(sessionConflict)).toBeNull();
    expect((get(session)!.saved.settings as Record<string, unknown>).editIdleTimeoutMinutes).toBe(30);
  });

  it('a clean session absorbs it and stays clean', async () => {
    begin('d');
    vi.mocked(api.saveDashboardSettings).mockResolvedValue(freshAt(8));
    await saveDashboardSettingsChanges('d', { editIdleTimeoutMinutes: 30 });
    expect(get(session)!.baseRevision).toBe(8);
    expect(get(dirty)).toBe(false);
  });

  it('not absorbed when the settings save was checked against a different revision (a real change elsewhere)', async () => {
    begin('d');
    const cfg = get(config)!;
    config.set({ ...cfg, dashboards: [{ ...cfg.dashboards[0], revision: 11 }] } as Config);
    vi.mocked(api.saveDashboardSettings).mockResolvedValue(freshAt(12));
    await saveDashboardSettingsChanges('d', { editIdleTimeoutMinutes: 30 });
    expect(get(session)!.baseRevision).toBe(7); // the normal conflict path will surface it on Save
  });
});
