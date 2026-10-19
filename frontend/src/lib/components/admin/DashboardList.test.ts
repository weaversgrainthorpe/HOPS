import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => {
  const actual = await vi.importActual<typeof import('$lib/utils/api')>('$lib/utils/api');
  return { ...actual, deleteDashboard: vi.fn(), getConfig: vi.fn() };
});

import * as api from '$lib/utils/api';
import DashboardList from './DashboardList.svelte';
import { config, saveConflict } from '$lib/stores/config';
import { confirmModalState, closeConfirmModal } from '$lib/stores/confirmModal';
import type { Config } from '$lib/types';

function cfg(): Config {
  return {
    dashboards: [{ id: 'd1', name: 'Home', path: '/home', order: 0, revision: 2, tabs: [] }],
    theme: { mode: 'auto' },
    settings: { searchHotkey: '/', defaultView: 'd1' },
    dashboardRevisions: { d1: 2 },
    layout: {
      schemaVersion: 3,
      dashboards: [
        { id: 'd1', name: 'Home', path: '/home', revision: 2, tabs: [] },
        { id: 'v3d', name: 'Fancy', path: '/fancy', revision: 6, tabs: [] }
      ]
    },
    v3OnlyDashboards: [{ id: 'v3d', name: 'Fancy', path: '/fancy', reason: 'free layout' }]
  } as Config;
}

beforeEach(() => {
  vi.clearAllMocks();
  config.set(cfg());
  saveConflict.set(null);
});
afterEach(() => config.set(null));

async function confirmYes() {
  await vi.waitFor(() => expect(get(confirmModalState).isOpen).toBe(true));
  closeConfirmModal(true);
}

describe('DashboardList v3-only dashboards', () => {
  it('DashboardList: v3-only shows the badge and Delete; delete sends the revision', async () => {
    vi.mocked(api.deleteDashboard).mockResolvedValue({
      layout: { schemaVersion: 3, dashboards: [{ id: 'd1', name: 'Home', path: '/home', revision: 2, tabs: [] }] },
      v3OnlyDashboards: []
    });
    render(DashboardList);
    await tick();
    const item = screen.getByText('Fancy').closest('.dashboard-item') as HTMLElement;
    expect(item).not.toBeNull();
    const w = within(item);
    expect(w.getByText('View-only (v3)')).toBeInTheDocument();
    expect(w.queryByRole('button', { name: /rename/i })).toBeNull();
    expect(w.queryByRole('button', { name: /export/i })).toBeNull();
    const del = w.getByRole('button', { name: 'Delete Fancy' });

    await fireEvent.click(del);
    await confirmYes();
    await vi.waitFor(() => expect(api.deleteDashboard).toHaveBeenCalledWith('v3d', 6));
    await vi.waitFor(() => expect(screen.queryByText('Fancy')).toBeNull());
    // The legacy dashboard is untouched.
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('cancelling the confirmation sends nothing', async () => {
    render(DashboardList);
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Fancy' }));
    await vi.waitFor(() => expect(get(confirmModalState).isOpen).toBe(true));
    closeConfirmModal(false);
    await tick();
    expect(api.deleteDashboard).not.toHaveBeenCalled();
  });

  it('a 409 on delete surfaces like other conflicts and keeps the row', async () => {
    vi.mocked(api.deleteDashboard).mockRejectedValue(new api.ConflictError('v3d', 7));
    render(DashboardList);
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Fancy' }));
    await confirmYes();
    await vi.waitFor(() => expect(get(saveConflict)).toEqual({ dashboardId: 'v3d' }));
    expect(screen.getByText('Fancy')).toBeInTheDocument();
  });
});
