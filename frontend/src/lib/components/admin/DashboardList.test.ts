import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => {
  const actual = await vi.importActual<typeof import('$lib/utils/api')>('$lib/utils/api');
  return {
    ...actual,
    deleteDashboard: vi.fn(),
    getConfig: vi.fn(),
    createDashboard: vi.fn(),
    saveDashboardV3: vi.fn(),
    reorderDashboards: vi.fn()
  };
});

import * as api from '$lib/utils/api';
import DashboardList from './DashboardList.svelte';
import { config, saveConflict } from '$lib/stores/config';
import { confirmModalState, closeConfirmModal } from '$lib/stores/confirmModal';
import type { Config } from '$lib/types';
import type { LayoutDashboard } from '$lib/types/layout';

const home = (): LayoutDashboard => ({
  id: 'd1', name: 'Home', path: '/home', revision: 2, order: 0,
  tabs: [{ id: 't1', name: 'Main', root: { columns: 24, children: [] } }]
});
// The Showcase: a free-layout dashboard (once "view-only (v3)"); now a dashboard like any other.
const showcase = (): LayoutDashboard => ({
  id: 'v3d', name: 'Fancy', path: '/fancy', revision: 6, order: 1,
  tabs: [{ id: 'ft', name: 'Free', root: { columns: 24, children: [] } }]
});
const doc = (...ds: LayoutDashboard[]) => ({ schemaVersion: 3 as const, layoutVersion: 2, dashboards: ds });

function cfg(): Config {
  return { schemaVersion: 3, layoutVersion: 2, dashboards: [home(), showcase()] };
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

const row = (name: string) => within(screen.getByText(name).closest('.dashboard-item') as HTMLElement);

describe('DashboardList: every dashboard is a normal, editable row', () => {
  it('the Showcase has Rename, Export, QR, open and Delete like any other dashboard; no view-only badge', async () => {
    render(DashboardList);
    await tick();
    const w = row('Fancy');
    expect(screen.queryByText(/view-only/i)).toBeNull();
    for (const label of ['Rename Fancy', 'Export Fancy', 'Show QR code for Fancy', 'Delete Fancy']) {
      expect(w.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(w.getByText('1 tab')).toBeInTheDocument();
  });
});

describe('DashboardList create (POST /api/dashboards)', () => {
  it('creates through the endpoint and shows the new dashboard', async () => {
    vi.mocked(api.createDashboard).mockResolvedValue({
      id: 'n1', revision: 1, layout: doc(home(), showcase(), { id: 'n1', name: 'Media', path: '/media', revision: 1, order: 2, tabs: [] })
    });
    render(DashboardList);
    await fireEvent.click(screen.getByRole('button', { name: /new dashboard/i }));
    await tick();
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Media' } });
    await fireEvent.input(screen.getByLabelText(/URL Path/), { target: { value: '/media' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(api.createDashboard).toHaveBeenCalledWith('Media', '/media'));
    await vi.waitFor(() => expect(screen.getByText('Media')).toBeInTheDocument());
    expect(screen.queryByLabelText('Name')).toBeNull(); // the form closed
  });

  it('a refused create keeps the form open (nothing looks saved)', async () => {
    vi.mocked(api.createDashboard).mockRejectedValue(new Error('Path /home is already used by the dashboard Home'));
    render(DashboardList);
    await fireEvent.click(screen.getByRole('button', { name: /new dashboard/i }));
    await tick();
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Dup' } });
    await fireEvent.input(screen.getByLabelText(/URL Path/), { target: { value: '/home' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(api.createDashboard).toHaveBeenCalled());
    await tick();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(get(config)!.dashboards).toHaveLength(2);
  });
});

describe('DashboardList rename (PUT schema 3 at the stored revision)', () => {
  it('renames the Showcase through the v3 PUT', async () => {
    const renamed = { ...showcase(), name: 'Fancier', path: '/fancier', revision: 7 };
    vi.mocked(api.saveDashboardV3).mockResolvedValue({ revision: 7, layout: doc(home(), renamed) });
    render(DashboardList);
    await tick();
    await fireEvent.click(row('Fancy').getByRole('button', { name: 'Rename Fancy' }));
    await tick();
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Fancier' } });
    await fireEvent.input(screen.getByLabelText('URL Path'), { target: { value: '/fancier' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() =>
      expect(api.saveDashboardV3).toHaveBeenCalledWith('v3d', { ...showcase(), name: 'Fancier', path: '/fancier' }, 6)
    );
    await vi.waitFor(() => expect(screen.getByText('Fancier')).toBeInTheDocument());
  });

  it('a 409 raises the conflict banner and keeps the edit row open', async () => {
    vi.mocked(api.saveDashboardV3).mockRejectedValue(new api.ConflictError('d1', 3));
    render(DashboardList);
    await tick();
    await fireEvent.click(row('Home').getByRole('button', { name: 'Rename Home' }));
    await tick();
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Lost' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(get(saveConflict)).toEqual({ dashboardId: 'd1' }));
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(get(config)!.dashboards[0].name).toBe('Home');
  });
});

describe('DashboardList delete (DELETE with revision)', () => {
  it('deletes the Showcase with its revision', async () => {
    vi.mocked(api.deleteDashboard).mockResolvedValue({ layout: doc(home()) });
    render(DashboardList);
    await tick();
    await fireEvent.click(row('Fancy').getByRole('button', { name: 'Delete Fancy' }));
    await confirmYes();
    await vi.waitFor(() => expect(api.deleteDashboard).toHaveBeenCalledWith('v3d', 6));
    await vi.waitFor(() => expect(screen.queryByText('Fancy')).toBeNull());
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

describe('DashboardList reorder (PUT /api/dashboards/order)', () => {
  it('Move down sends every id in the new order and the list follows the response', async () => {
    vi.mocked(api.reorderDashboards).mockResolvedValue({ layout: doc({ ...home(), order: 1 }, { ...showcase(), order: 0 }) });
    render(DashboardList);
    await tick();
    expect(row('Home').getByRole('button', { name: 'Move Home up' })).toBeDisabled();
    await fireEvent.click(row('Home').getByRole('button', { name: 'Move Home down' }));
    await vi.waitFor(() => expect(api.reorderDashboards).toHaveBeenCalledWith(['v3d', 'd1']));
    await vi.waitFor(() => {
      const names = Array.from(document.querySelectorAll('.dashboard-info h3')).map((h) => h.textContent);
      expect(names).toEqual(['Fancy', 'Home']);
    });
  });

  it('a refused reorder leaves the order as it was', async () => {
    vi.mocked(api.reorderDashboards).mockRejectedValue(new Error('Order must list every dashboard exactly once'));
    render(DashboardList);
    await tick();
    await fireEvent.click(row('Fancy').getByRole('button', { name: 'Move Fancy up' }));
    await vi.waitFor(() => expect(api.reorderDashboards).toHaveBeenCalledWith(['v3d', 'd1']));
    await tick();
    const names = Array.from(document.querySelectorAll('.dashboard-info h3')).map((h) => h.textContent);
    expect(names).toEqual(['Home', 'Fancy']);
  });
});
