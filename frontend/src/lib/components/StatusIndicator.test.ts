import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

vi.mock('$lib/utils/api', () => ({ getStatus: vi.fn() }));
vi.mock('$lib/utils/errors', () => ({ logError: vi.fn() }));

import { getStatus } from '$lib/utils/api';
import Entry from './Entry.svelte';
import { config } from '$lib/stores/config';
import type { Entry as EntryType } from '$lib/types';

// M4 Task 7: the badge follows the RESOLVED setting (status response), not just an explicit
// tile flag; a 'disabled' tile says which level switched it off.

const base: EntryType = {
  id: 'e1', name: 'Plex', url: 'http://x.test', icon: '', openMode: 'newtab', size: 'medium', order: 0
};
const withCheck = (enabled: unknown): EntryType =>
  ({ ...base, statusCheck: { type: 'http', enabled } }) as unknown as EntryType;

beforeEach(() => {
  vi.mocked(getStatus).mockReset();
  config.set({
    schemaVersion: 3,
    dashboards: [{
      id: 'd1', name: 'Home', path: '/h', revision: 1,
      tabs: [{ id: 't1', name: 'Main', root: { columns: 24, children: [
        { kind: 'folder', id: 'f1', name: 'Media', display: 'expanded', placement: { x: 0, y: 0, w: 2, h: 2 },
          content: { columns: 4, children: [] } }
      ] } }]
    }]
  });
});

const badge = (c: HTMLElement) => c.querySelector('.status-badge [role="img"]') as HTMLElement | null;

describe('status badge and tooltip', () => {
  it('an unset tile never asks for a status and shows no badge', async () => {
    const { container } = render(Entry, { entry: base });
    await new Promise((r) => setTimeout(r, 0));
    expect(getStatus).not.toHaveBeenCalled();
    expect(badge(container)).toBeNull();
  });

  it('an inheriting tile that resolves on shows its badge', async () => {
    vi.mocked(getStatus).mockResolvedValue({ status: 'up', source: 'folder', sourceId: 'f1' });
    const { container } = render(Entry, { entry: withCheck(null) });
    await waitFor(() => expect(badge(container)?.getAttribute('title')).toBe('Online'));
  });

  it('a resolved-off tile shows no badge in view mode', async () => {
    vi.mocked(getStatus).mockResolvedValue({ status: 'disabled', source: 'dashboard', sourceId: 'd1' });
    const { container } = render(Entry, { entry: withCheck(null) });
    await waitFor(() => expect(getStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(badge(container)).toBeNull();
  });

  it('in the editor the off state shows, naming the level that set it', async () => {
    vi.mocked(getStatus).mockResolvedValue({ status: 'disabled', source: 'dashboard', sourceId: 'd1' });
    const { container } = render(Entry, { entry: withCheck(null), editorSelected: false });
    await waitFor(() =>
      expect(badge(container)?.getAttribute('title')).toBe('Status checks are off for this tile (set on Home)')
    );
  });

  it('global source says (Settings)', async () => {
    vi.mocked(getStatus).mockResolvedValue({ status: 'disabled', source: 'global', sourceId: '' });
    const { container } = render(Entry, { entry: withCheck(null), editorSelected: false });
    await waitFor(() =>
      expect(badge(container)?.getAttribute('title')).toBe('Status checks are off for this tile (Settings)')
    );
  });

  it('an invalid setting is a visible warning state in the editor', async () => {
    vi.mocked(getStatus).mockResolvedValue({ status: 'disabled', source: 'invalid', sourceId: 'f1' });
    const { container } = render(Entry, { entry: withCheck(true), editorSelected: false });
    await waitFor(() =>
      expect(badge(container)?.getAttribute('title')).toBe(
        'Status checks are off for this tile: invalid setting on Media'
      )
    );
    expect(badge(container)!.classList.contains('invalid')).toBe(true);
  });
});
