import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import MigrationNotices from './MigrationNotices.svelte';
import { config, migrationNoticesDismissed } from '$lib/stores/config';
import type { Config } from '$lib/types';

const notices = [
  'Tab "main" in dashboard "Heimdall Import" was renamed to "main-heimdall" because another dashboard already used that id',
  'Group "services" in dashboard "Heimdall Import" was renamed to "services-heimdall" because another dashboard already used that id'
];

function cfg(migrationNotices?: string[]): Config {
  return { dashboards: [], theme: {} as Config['theme'], settings: {} as Config['settings'], migrationNotices };
}

describe('MigrationNotices', () => {
  beforeEach(() => {
    migrationNoticesDismissed.set(false);
    config.set(null);
  });

  it('renders nothing without notices', () => {
    config.set(cfg());
    const { container } = render(MigrationNotices);
    expect(container.querySelector('.migration-notices')).toBeNull();
  });

  it('renders nothing for an empty list', () => {
    config.set(cfg([]));
    const { container } = render(MigrationNotices);
    expect(container.querySelector('.migration-notices')).toBeNull();
  });

  it('lists every notice', () => {
    config.set(cfg(notices));
    render(MigrationNotices);
    expect(screen.getByRole('status')).toBeInTheDocument();
    for (const n of notices) {
      expect(screen.getByText(n)).toBeInTheDocument();
    }
  });

  it('dismiss hides the notice for the session and survives a config reload', async () => {
    config.set(cfg(notices));
    const { container } = render(MigrationNotices);
    await fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await tick();
    expect(container.querySelector('.migration-notices')).toBeNull();
    expect(get(migrationNoticesDismissed)).toBe(true);

    config.set(cfg(notices)); // e.g. loadConfig() after a save
    await tick();
    expect(container.querySelector('.migration-notices')).toBeNull();
  });
});
