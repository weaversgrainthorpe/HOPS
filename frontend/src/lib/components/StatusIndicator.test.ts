import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

vi.mock('$lib/utils/api', () => ({ getStatus: vi.fn() }));
vi.mock('$lib/utils/errors', () => ({ logError: vi.fn() }));

import { getStatus } from '$lib/utils/api';
import Entry from './Entry.svelte';
import { config } from '$lib/stores/config';
import type { Entry as EntryType } from '$lib/types';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import { statusStore, type StatusInfo } from '$lib/stores/status';
import { FOLDER_VIEW_CONTEXT } from '$lib/stores/folderView';
import { setAnimationEnv } from '$lib/editor/drag/dropAnimation';

// The badge follows the RESOLVED setting (status response), not just an explicit
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
          content: { children: [] } }
      ] } }]
    }]
  });
});

const badge = (c: HTMLElement) => c.querySelector('.status-badge [role="img"]') as HTMLElement | null;

describe('status badge and tooltip', () => {
  it('a tile with no setting inherits: it asks the server, and shows no badge when that resolves off', async () => {
    vi.mocked(getStatus).mockResolvedValue({ status: 'disabled', source: 'dashboard', sourceId: 'd1' });
    const { container } = render(Entry, { entry: base });
    await waitFor(() => expect(getStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
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

describe('status change pulse', () => {
  const pulses: Element[] = [];
  const ctx = () => new Map<string, unknown>([[FOLDER_VIEW_CONTEXT, { dashboardId: 'd1', remembered: () => undefined, saved: () => undefined }]]);
  beforeEach(() => {
    pulses.length = 0;
    setAnimationEnv({
      reducedMotion: () => false,
      animate: (el) => {
        pulses.push(el);
        return { onfinish: null, oncancel: null, cancel() {} } as unknown as Animation;
      }
    });
    const c = get(config)!;
    config.set({ ...c, dashboards: c.dashboards.map((d) => ({ ...d, display: { animatedFolderBackgrounds: false, animations: 'on' } })) });
  });

  const setStatus = (s: StatusInfo['status']) =>
    statusStore.update((m) => new Map(m).set('e1', { status: s }));

  it('no pulse on first load; two changes (offline, then back) pulse the dot each time; the same status again does not', async () => {
    vi.mocked(getStatus).mockResolvedValue({ status: 'up' });
    const { container } = render(Entry, { props: { entry: withCheck(true) }, context: ctx() });
    await waitFor(() => expect(badge(container)?.getAttribute('title')).toBe('Online'));
    await tick();
    expect(pulses).toHaveLength(0);
    setStatus('down');
    await tick();
    expect(pulses).toHaveLength(1);
    expect(pulses[0]).toBe(container.querySelector('.status-badge'));
    setStatus('down');
    await tick();
    expect(pulses).toHaveLength(1);
    setStatus('up');
    await tick();
    expect(pulses).toHaveLength(2);
  });

  it('animations Off: no pulse; drawn outside a dashboard canvas (no context): no pulse', async () => {
    const c = get(config)!;
    config.set({ ...c, dashboards: c.dashboards.map((d) => ({ ...d, display: { animatedFolderBackgrounds: false, animations: 'off' } })) });
    vi.mocked(getStatus).mockResolvedValue({ status: 'up' });
    const { container } = render(Entry, { props: { entry: withCheck(true) }, context: ctx() });
    await waitFor(() => expect(badge(container)?.getAttribute('title')).toBe('Online'));
    setStatus('down');
    await tick();
    expect(pulses).toHaveLength(0);
  });
});
