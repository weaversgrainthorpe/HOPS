import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';

vi.mock('$lib/utils/api', async () => {
  const actual = await vi.importActual<typeof import('$lib/utils/api')>('$lib/utils/api');
  return { ...actual, listSettings: vi.fn() };
});

import * as api from '$lib/utils/api';
import BlockedStatusChecks from './BlockedStatusChecks.svelte';
import { config } from '$lib/stores/config';
import type { Config } from '$lib/types';
import type { LayoutDashboard } from '$lib/types/layout';

const tile = (id: string, enabled?: unknown) => ({
  kind: 'tile', id, name: id.toUpperCase(), type: 'link', url: `https://${id}.lan/`,
  ...(enabled === undefined ? {} : { statusCheck: { type: 'http', enabled } })
});
const folder = (id: string, children: unknown[], gate?: boolean) => ({
  kind: 'folder', id, name: id.toUpperCase(), ...(gate === undefined ? {} : { statusChecksEnabled: gate }), content: { children }
});
const dash = (id: string, name: string, children: unknown[], gate?: boolean) => ({
  id, name, path: `/${id}`, revision: 2, order: 0,
  ...(gate === undefined ? {} : { settings: { statusChecksEnabled: gate } }),
  tabs: [{ id: `${id}-t`, name: 'Main', root: { columns: 24, children } }]
}) as unknown as LayoutDashboard;

function setConfig(...ds: LayoutDashboard[]) {
  config.set({ schemaVersion: 3, layoutVersion: 2, dashboards: ds } as Config);
}
function globalIs(v: string) {
  vi.mocked(api.listSettings).mockResolvedValue({
    settings: [{ key: 'status.checks_enabled', type: 'bool', value: v, default: 'true', restartRequired: false, description: '' }]
  });
}
const section = () => screen.getByTestId('blocked-status-checks');

beforeEach(() => {
  vi.clearAllMocks();
  globalIs('true');
});
afterEach(() => config.set(null));

describe('BlockedStatusChecks', () => {
  it('lists each blocked tile: where it is, what blocks it, and a link to its dashboard', async () => {
    setConfig(
      dash('d1', 'Home', [tile('a', true), folder('f', [tile('b', true), tile('c')], false)]),
      dash('d2', 'Media', [folder('g', [tile('m', true)], false)], false)
    );
    render(BlockedStatusChecks);
    await vi.waitFor(() => expect(document.querySelectorAll('[data-testid="bsc-row"]').length).toBe(2));
    const b = document.querySelector('[data-key="d1:b"]') as HTMLElement;
    expect(b).toHaveTextContent('B');
    expect(b).toHaveTextContent('Home › Main › F');
    expect(b).toHaveTextContent('Blocked by folder F');
    const m = document.querySelector('[data-key="d2:m"]') as HTMLElement;
    expect(m).toHaveTextContent('Blocked by dashboard Media +1 more');
    const group = document.querySelector('[data-bsc-group="d2"]') as HTMLElement;
    expect(within(group).getByRole('link', { name: 'Open dashboard' })).toHaveAttribute('href', expect.stringContaining('d2'));
  });

  it('nothing blocked: says so', async () => {
    setConfig(dash('d1', 'Home', [tile('a', true), folder('f', [tile('b')], false)]));
    render(BlockedStatusChecks);
    await vi.waitFor(() => expect(section()).toHaveTextContent('No blocked status checks.'));
  });

  it('global Disabled: one line only, with a link to the setting', async () => {
    globalIs('false');
    setConfig(dash('d1', 'Home', [folder('f', [tile('b', true)], false)]));
    render(BlockedStatusChecks);
    await vi.waitFor(() => expect(section()).toHaveTextContent('Status monitoring is disabled in Settings, so nothing is checked.'));
    expect(document.querySelectorAll('[data-testid="bsc-row"]').length).toBe(0);
    expect(within(section()).getByRole('link')).toHaveAttribute('href', '/settings/global#status-checks');
  });

  it('the global setting failing to load is an error with Retry, never an empty report', async () => {
    vi.mocked(api.listSettings).mockRejectedValueOnce(new Error('boom'));
    setConfig(dash('d1', 'Home', [folder('f', [tile('b', true)], false)]));
    render(BlockedStatusChecks);
    await vi.waitFor(() => expect(section()).toHaveTextContent("Can't tell whether status monitoring is enabled (boom)"));
    expect(section()).not.toHaveTextContent('No blocked status checks.');
    screen.getByRole('button', { name: 'Retry global setting' }).click();
    await vi.waitFor(() => expect(document.querySelectorAll('[data-testid="bsc-row"]').length).toBe(1));
  });
});
