import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';

vi.mock('$lib/utils/api', async () => {
  const actual = await vi.importActual<typeof import('$lib/utils/api')>('$lib/utils/api');
  return {
    ...actual,
    getConfig: vi.fn(),
    getDashboardSettings: vi.fn(),
    listSettings: vi.fn(),
    saveDashboardV3: vi.fn(),
    saveDashboardSettings: vi.fn()
  };
});

import * as api from '$lib/utils/api';
import StatusOverrides from './StatusOverrides.svelte';
import { config } from '$lib/stores/config';
import { resetStatusBaseCache } from '$lib/stores/statusCheckBase';
import type { Config } from '$lib/types';
import type { LayoutDashboard } from '$lib/types/layout';

// rc5 Part B: every explicit status-check setting below the global one, what restoring it to
// Inherit would change, and a bulk restore that saves through the revision-checked paths.

const tile = (id: string, enabled?: unknown) => ({
  kind: 'tile', id, name: id.toUpperCase(), type: 'link', url: `https://${id}.lan/`,
  ...(enabled === undefined ? {} : { statusCheck: { type: 'http', enabled } })
});
const folder = (id: string, children: unknown[], on?: boolean) => ({
  kind: 'folder', id, name: id.toUpperCase(), ...(on === undefined ? {} : { statusChecksEnabled: on }), content: { children }
});
const dash = (id: string, name: string, children: unknown[]) => ({
  id, name, path: `/${id}`, revision: 2, order: 0,
  tabs: [{ id: `${id}-t`, name: 'Main', root: { columns: 24, children } }]
}) as unknown as LayoutDashboard;

// Home: the dashboard is Off (set here). A tile On, a folder On over two inheriting tiles, a
// tile Off (no effect: the dashboard is off too) and a tile with no setting.
const home = () => dash('d1', 'Home', [tile('a', true), folder('f', [tile('b'), tile('c')], true), tile('n', false), tile('x')]);
// Media: one tile On under a dashboard that follows the global setting (on): no effect.
const media = () => dash('d2', 'Media', [tile('m', true)]);

type Base = { override: boolean | null; effective: boolean } | 'fail' | 'pending';
let bases: Record<string, Base>;
let pending: Array<() => void>;

function settingsBody(b: { override: boolean | null; effective: boolean }) {
  return {
    overrides: { statusChecksEnabled: b.override },
    effective: {
      statusChecksEnabled: b.effective, statusCheckIntervalMinutes: 5, statusCheckTimeoutSeconds: 10,
      editIdleTimeoutMinutes: 15, animatedFolderBackgrounds: false
    },
    revision: 2
  } as unknown as api.DashboardSettingsResponse;
}

function setConfig(...ds: LayoutDashboard[]) {
  const c: Config = { schemaVersion: 3, layoutVersion: 2, dashboards: ds };
  config.set(c);
  vi.mocked(api.getConfig).mockResolvedValue(c);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStatusBaseCache();
  pending = [];
  try { localStorage.clear(); } catch { /* none */ }
  bases = { d1: { override: false, effective: false }, d2: { override: null, effective: true } };
  vi.mocked(api.getDashboardSettings).mockImplementation((id: string) => {
    const b = bases[id];
    if (b === 'fail') return Promise.reject(new Error('boom'));
    if (b === 'pending') return new Promise((res) => pending.push(() => res(settingsBody({ override: null, effective: true }))));
    return Promise.resolve(settingsBody(b));
  });
  vi.mocked(api.listSettings).mockResolvedValue({
    settings: [{ key: 'status.checks_enabled', type: 'bool', value: 'true', default: 'true', restartRequired: false, description: '' }]
  });
});
afterEach(() => config.set(null));

const row = (key: string) => document.querySelector(`[data-testid="so-row"][data-key="${key}"]`) as HTMLElement | null;
/** Wait until the global setting and the row's dashboard level are known (its checkbox is enabled). */
async function ready(key: string) {
  await vi.waitFor(() => {
    expect(screen.getByTestId('status-overrides')).toHaveTextContent('Global setting: On');
    expect(within(row(key)!).getByRole('checkbox')).toBeEnabled();
  });
}
const shownKeys = () => [...document.querySelectorAll('[data-testid="so-row"]')].map((e) => e.getAttribute('data-key'));

describe('StatusOverrides: rows and filters', () => {
  it('lists the rows with their effects, and counts each filter', async () => {
    setConfig(home(), media());
    render(StatusOverrides);
    await ready('d1:dashboard:d1');

    // "Would change something" (the default): the dashboard, the tile On and the folder.
    expect(shownKeys().sort()).toEqual(['d1:dashboard:d1', 'd1:folder:f', 'd1:tile:a'].sort());
    expect(row('d1:tile:a')).toHaveTextContent('On (set here)');
    expect(row('d1:tile:a')).toHaveTextContent('→ Off, from dashboard Home');
    expect(row('d1:tile:a')).toHaveTextContent('stops checking');
    expect(row('d1:folder:f')).toHaveTextContent('stops checking 2 tiles');
    expect(row('d1:dashboard:d1')).toHaveTextContent('Off (set here)');
    expect(row('d1:dashboard:d1')).toHaveTextContent('→ On, from global');
    expect(row('d1:dashboard:d1')).toHaveTextContent('starts checking 1 tile');

    const filter = within(screen.getByTestId('so-filter'));
    expect(filter.getByRole('radio', { name: 'Would change something (3)' })).toBeChecked();
    await fireEvent.click(filter.getByRole('radio', { name: 'No effect (2)' }));
    expect(shownKeys().sort()).toEqual(['d1:tile:n', 'd2:tile:m']);
    expect(row('d1:tile:n')).toHaveTextContent('no effect');
    expect(localStorage.getItem('hops.statusOverrides.filter')).toBe('none');
    await fireEvent.click(filter.getByRole('radio', { name: 'All (5)' }));
    expect(shownKeys()).toHaveLength(5);

    // "Select all shown" ticks only the rows of the current filter.
    await fireEvent.click(filter.getByRole('radio', { name: 'Would change something (3)' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Select all shown' }));
    expect(screen.getByRole('button', { name: /^Restore inheritance for/ })).toHaveTextContent('Restore inheritance for 3 selected');
    expect(within(row('d1:tile:a')!).getByRole('checkbox')).toBeChecked();
  });

  it('an unknown base: "Can\'t tell yet", the checkbox is disabled, and Retry after a failure', async () => {
    bases.d2 = 'fail';
    setConfig(home(), dash('d2', 'Media', [tile('m', false)]));
    render(StatusOverrides);
    await ready('d1:tile:a');
    await vi.waitFor(() => expect(screen.getByTestId('status-overrides')).toHaveTextContent("Media dashboard: Can't tell yet (boom)"));
    const r = row('d2:tile:m')!;
    expect(r).toHaveTextContent("Can't tell yet");
    expect(within(r).getByRole('checkbox')).toBeDisabled();

    bases.d2 = { override: null, effective: true };
    await fireEvent.click(screen.getByRole('button', { name: 'Retry Media' }));
    await vi.waitFor(() => expect(within(row('d2:tile:m')!).getByRole('checkbox')).toBeEnabled());
  });

  it('never shows the empty state while a base is loading', async () => {
    bases.d1 = 'pending';
    setConfig(dash('d1', 'Home', [tile('x')]));
    render(StatusOverrides);
    await vi.waitFor(() => expect(api.getDashboardSettings).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/Everything follows the level above/)).toBeNull();
    pending.forEach((f) => f());
    await vi.waitFor(() =>
      expect(screen.getByText('Everything follows the level above: no dashboard, tab, folder or tile sets its own status checks.')).toBeInTheDocument()
    );
  });

  it('never shows the empty state when the global setting failed to load', async () => {
    vi.mocked(api.listSettings).mockRejectedValue(new Error('offline'));
    setConfig(dash('d1', 'Home', [tile('x')]));
    render(StatusOverrides);
    await vi.waitFor(() => expect(screen.getByTestId('status-overrides')).toHaveTextContent("Global setting: can't tell yet"));
    expect(screen.queryByText(/Everything follows the level above/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry global setting' })).toBeInTheDocument();
  });
});

describe('StatusOverrides: preview and saving', () => {
  it('previews the combined effect of two ticked rows', async () => {
    setConfig(home(), media());
    render(StatusOverrides);
    await ready('d1:tile:a');
    const btn = screen.getByRole('button', { name: /^Restore inheritance for/ });
    expect(btn).toHaveTextContent('Restore inheritance for 0 selected');
    expect(btn).toBeDisabled();
    await fireEvent.click(within(row('d1:tile:a')!).getByRole('checkbox'));
    await fireEvent.click(within(row('d1:folder:f')!).getByRole('checkbox'));
    expect(btn).toHaveTextContent('Restore inheritance for 2 selected');
    await fireEvent.click(btn);
    const prev = screen.getByTestId('so-preview');
    expect(prev).toHaveTextContent('start checking 0 tiles and stop checking 3 tiles');
    expect(prev).toHaveTextContent('Main › A');
    expect(prev).toHaveTextContent('Main › F › B');
    expect(api.saveDashboardV3).not.toHaveBeenCalled();
  });

  it('the preview names every ticked row, including one the filter hides', async () => {
    setConfig(home(), media());
    render(StatusOverrides);
    await ready('d1:tile:a');
    await fireEvent.click(within(row('d1:tile:a')!).getByRole('checkbox'));
    const filter = within(screen.getByTestId('so-filter'));
    await fireEvent.click(filter.getByRole('radio', { name: /^No effect/ }));
    expect(row('d1:tile:a')).toBeNull(); // hidden by the filter, still ticked
    await fireEvent.click(within(row('d2:tile:m')!).getByRole('checkbox'));
    await fireEvent.click(screen.getByRole('button', { name: 'Restore inheritance for 2 selected' }));
    const prev = screen.getByTestId('so-preview');
    expect(prev).toHaveTextContent('Restoring 2 settings');
    const hidden = prev.querySelector('[data-so-picked="d1:tile:a"]');
    expect(hidden).toHaveTextContent('Home: Main › A (tile): On (set here) (not shown under this filter)');
    expect(prev.querySelector('[data-so-picked="d2:tile:m"]')).toHaveTextContent('Media: Main › M (tile): On (set here)');
  });

  it('a conflict on the second dashboard refuses visibly, naming the first one saved', async () => {
    bases.d2 = { override: null, effective: true };
    setConfig(home(), dash('d2', 'Media', [tile('m', true)]));
    vi.mocked(api.saveDashboardV3)
      .mockResolvedValueOnce({ revision: 3 })
      .mockRejectedValueOnce(new api.ConflictError('d2', 9));
    render(StatusOverrides);
    await ready('d1:tile:a');
    await fireEvent.click(within(screen.getByTestId('so-filter')).getByRole('radio', { name: /^All/ }));
    await ready('d2:tile:m');
    await fireEvent.click(within(row('d1:tile:a')!).getByRole('checkbox'));
    await fireEvent.click(within(row('d2:tile:m')!).getByRole('checkbox'));
    await fireEvent.click(screen.getByRole('button', { name: /^Restore inheritance for 2/ }));
    await fireEvent.click(within(screen.getByTestId('so-preview')).getByRole('button', { name: 'Confirm' }));
    await vi.waitFor(() => expect(screen.getByTestId('so-refusal')).toHaveTextContent('changed somewhere else'));
    expect(screen.getByTestId('so-refusal')).toHaveTextContent('Already saved before this failed: "Home" (tabs, folders and tiles).');
    // The first save removed only the tile's own setting, keeping its other statusCheck fields.
    const [id, saved, rev] = vi.mocked(api.saveDashboardV3).mock.calls[0];
    expect([id, rev]).toEqual(['d1', 2]);
    expect((saved.tabs[0].root.children[0] as { statusCheck?: unknown }).statusCheck).toEqual({ type: 'http' });
    expect(api.getConfig).toHaveBeenCalled(); // the list reloads
  });

  it('a dashboard row saves the layout first, then the settings at the new revision', async () => {
    setConfig(home());
    vi.mocked(api.saveDashboardV3).mockResolvedValueOnce({ revision: 3 });
    vi.mocked(api.saveDashboardSettings).mockResolvedValueOnce({ revision: 4 });
    render(StatusOverrides);
    await ready('d1:dashboard:d1');
    await fireEvent.click(within(row('d1:dashboard:d1')!).getByRole('checkbox'));
    await fireEvent.click(within(row('d1:tile:a')!).getByRole('checkbox'));
    await fireEvent.click(screen.getByRole('button', { name: /^Restore inheritance for 2/ }));
    await fireEvent.click(within(screen.getByTestId('so-preview')).getByRole('button', { name: 'Confirm' }));
    await vi.waitFor(() => expect(api.saveDashboardSettings).toHaveBeenCalledWith('d1', { statusChecksEnabled: null }, 3));
    expect(vi.mocked(api.saveDashboardV3).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.saveDashboardSettings).mock.invocationCallOrder[0]);
    expect(screen.queryByTestId('so-refusal')).toBeNull();
  });
});
