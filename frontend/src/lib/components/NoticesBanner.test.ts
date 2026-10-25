import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/api', () => ({ dismissNotice: vi.fn(), getConfig: vi.fn() }));
vi.mock('$lib/utils/errors', () => ({ logError: vi.fn() }));
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import NoticesBanner from './NoticesBanner.svelte';
import { config, migrationNoticesDismissed, noticesStale } from '$lib/stores/config';
import type { Config } from '$lib/types';
import { dismissNotice } from '$lib/utils/api';
import { toast } from '$lib/stores/toast';

const notices = [
  'Tab "main" in dashboard "Heimdall Import" was renamed to "main-heimdall" because another dashboard already used that id',
  'Folder "services" in dashboard "Heimdall Import" was renamed to "services-heimdall" because another dashboard already used that id'
];

function cfg(migrationNotices?: string[]): Config {
  return { schemaVersion: 3, dashboards: [], migrationNotices };
}

describe('NoticesBanner: rename notices', () => {
  beforeEach(() => {
    migrationNoticesDismissed.set(false);
    config.set(null);
  });

  it('renders nothing without notices', () => {
    config.set(cfg());
    const { container } = render(NoticesBanner);
    expect(container.querySelector('.migration-notices')).toBeNull();
  });

  it('renders nothing for an empty list', () => {
    config.set(cfg([]));
    const { container } = render(NoticesBanner);
    expect(container.querySelector('.migration-notices')).toBeNull();
  });

  it('lists every notice', () => {
    config.set(cfg(notices));
    render(NoticesBanner);
    expect(screen.getByRole('status')).toBeInTheDocument();
    for (const n of notices) {
      expect(screen.getByText(n)).toBeInTheDocument();
    }
  });

  it('dismiss hides the notice for the session and survives a config reload', async () => {
    config.set(cfg(notices));
    const { container } = render(NoticesBanner);
    await fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await tick();
    expect(container.querySelector('.migration-notices')).toBeNull();
    expect(get(migrationNoticesDismissed)).toBe(true);

    config.set(cfg(notices)); // e.g. loadConfig() after a save
    await tick();
    expect(container.querySelector('.migration-notices')).toBeNull();
  });
});

describe('NoticesBanner: server notices (M4 Task 7)', () => {
  const text =
    'Status checks now follow the most specific setting. These dashboards have tiles switched on while the dashboard is off, so those tiles are now checked: <b>Home</b>.';
  beforeEach(() => {
    vi.mocked(dismissNotice).mockReset();
    migrationNoticesDismissed.set(false);
    noticesStale.set(null);
    config.set({ schemaVersion: 3, dashboards: [], notices: [{ id: 'layered-status-checks', text }] });
  });

  it('shows the notice text as text (never markup)', () => {
    const { container } = render(NoticesBanner);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  it('Dismiss calls the API and hides the notice once it succeeded', async () => {
    let done!: () => void;
    vi.mocked(dismissNotice).mockReturnValue(new Promise<void>((r) => (done = r)));
    render(NoticesBanner);
    await fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(dismissNotice).toHaveBeenCalledWith('layered-status-checks');
    expect(screen.getByText(text)).toBeInTheDocument(); // not hidden before the server agreed
    done();
    await new Promise((r) => setTimeout(r, 0));
    await tick();
    expect(screen.queryByText(text)).toBeNull();
    expect(get(config)?.notices ?? []).toEqual([]);
  });

  it('a failed dismiss toasts and the notice stays', async () => {
    const err = vi.spyOn(toast, 'error');
    vi.mocked(dismissNotice).mockRejectedValue(new Error('HOPS hit an error'));
    render(NoticesBanner);
    await fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await new Promise((r) => setTimeout(r, 0));
    await tick();
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/couldn't dismiss/i));
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows both kinds together; each has its own Dismiss', () => {
    config.set({ schemaVersion: 3, dashboards: [], migrationNotices: notices, notices: [{ id: 'n', text: 'Hello' }] });
    render(NoticesBanner);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText(notices[0])).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /dismiss/i })).toHaveLength(2);
  });
});

describe('NoticesBanner: never presents doubtful notices as fresh (fix round 1)', () => {
  beforeEach(() => {
    noticesStale.set(null);
    migrationNoticesDismissed.set(false);
  });

  it('marks the notices "may be out of date" when the last re-read failed', () => {
    config.set({ schemaVersion: 3, dashboards: [], notices: [{ id: 'n', text: 'Hello' }] });
    noticesStale.set('HOPS hit an error');
    render(NoticesBanner);
    expect(screen.getByText(/may be out of date/i)).toBeInTheDocument();
  });

  it('says when notices from the server could not be read', () => {
    config.set({ schemaVersion: 3, dashboards: [], notices: [], noticesUnreadable: 2 });
    render(NoticesBanner);
    expect(screen.getByRole('alert').textContent).toMatch(/2 notices from the server couldn't be read/i);
  });
});

describe('NoticesBanner: sticky warnings (backup problems)', () => {
  beforeEach(() => {
    config.set(null);
  });

  it('shows a backup problem as an alert with no Dismiss, next to an ordinary notice that has one', () => {
    config.set({
      schemaVersion: 3,
      dashboards: [],
      notices: [
        { id: 'backup-backup-failed-1', text: 'The automatic backup taken when HOPS started failed at 25 Oct 2026 10:00:00 UTC: disk full.', level: 'warning', sticky: true },
        { id: 'layered-status-checks-v4', text: 'Status checks now follow the most specific setting.' }
      ]
    });
    render(NoticesBanner);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('when HOPS started failed at 25 Oct 2026 10:00:00 UTC: disk full.');
    expect(alert.querySelector('button')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(1);
  });
});
