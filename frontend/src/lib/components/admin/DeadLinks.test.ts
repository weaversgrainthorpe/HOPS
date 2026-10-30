import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$lib/utils/api', async () => {
  const actual = await vi.importActual<typeof import('$lib/utils/api')>('$lib/utils/api');
  return { ...actual, getDeadLinks: vi.fn() };
});

import * as api from '$lib/utils/api';
import DeadLinks from './DeadLinks.svelte';

// Status checks are layered: with the global setting Off, a dashboard, tab, folder or tile
// set to On is still checked. "Turned off" may only be said when nothing is checked at all.
const report = (checksEnabled: boolean, checkedTiles: number): api.DeadLinksReport => ({
  checksEnabled, thresholdHours: 168, historyStartedAt: '2026-09-01T00:00:00Z', checkedTiles, links: []
});

describe('DeadLinks states', () => {
  beforeEach(() => vi.mocked(api.getDeadLinks).mockReset());

  it('global Off and nothing checked: says checks are off, and how to turn them on', async () => {
    vi.mocked(api.getDeadLinks).mockResolvedValue(report(false, 0));
    const { container } = render(DeadLinks);
    const s = await vi.waitFor(() => {
      const el = container.querySelector('[data-state="checks-off"]');
      if (!el) throw new Error('no checks-off state');
      return el;
    });
    expect(s.textContent).toContain('Status checks are turned off');
    expect(s.textContent).toMatch(/dashboard, tab, folder or tile/);
    expect(s.textContent).not.toContain('for all dashboards');
  });

  it('global Off but tiles checked lower down: lists them, never "turned off"', async () => {
    vi.mocked(api.getDeadLinks).mockResolvedValue(report(false, 2));
    const { container } = render(DeadLinks);
    await screen.findByText(/No dead links: none of the 2 checked tiles/);
    expect(container.querySelector('[data-state="checks-off"]')).toBeNull();
    expect(container.querySelector('[data-state="history"]')).not.toBeNull();
  });
});
