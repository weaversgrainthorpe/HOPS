import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/api', () => ({
  listBackups: vi.fn(),
  createBackup: vi.fn(),
  restoreBackup: vi.fn(),
  deleteBackup: vi.fn()
}));
vi.mock('$lib/stores/confirmModal', () => ({ confirm: vi.fn(async () => true) }));
vi.mock('$lib/stores/config', () => ({ refreshServerNotices: vi.fn(async () => {}) }));
import { render, screen, fireEvent } from '@testing-library/svelte';
import BackupModal from './BackupModal.svelte';
import { listBackups, restoreBackup } from '$lib/utils/api';

const backup = { name: 'hops-backup-2026-10-25_10-00-00_manual.db', path: '/x', size: 2048, createdAt: '2026-10-25T10:00:00Z' };

describe('BackupModal', () => {
  beforeEach(() => {
    vi.mocked(listBackups).mockResolvedValue({ backups: [backup], problems: [] });
  });

  it('lists every automatic trigger in its explanation', async () => {
    render(BackupModal, { onClose: () => {} });
    const info = await screen.findByText(/backs up its database automatically/);
    for (const t of ['when it starts', 'before every save', 'before a restore or a', 'factory reset', 'before an upgrade', 'create one yourself']) {
      expect(info.textContent).toContain(t);
    }
  });

  it('shows the server\'s reason in the dialog when a restore is refused', async () => {
    vi.mocked(restoreBackup).mockRejectedValue(new Error("Couldn't take a safety backup first, so nothing was restored: disk full"));
    render(BackupModal, { onClose: () => {} });
    await fireEvent.click(await screen.findByRole('button', { name: `Restore ${backup.name}` }));
    const alert = await screen.findByText("Couldn't take a safety backup first, so nothing was restored: disk full", { selector: 'span' });
    expect(alert.closest('[role="alert"]')).toBeTruthy();
  });

  it('shows a backup problem from the list as an alert', async () => {
    vi.mocked(listBackups).mockResolvedValue({
      backups: [backup],
      problems: [{ kind: 'backup-failed', trigger: 'startup', at: '2026-10-25T09:00:00Z', reason: 'permission denied' }]
    });
    render(BackupModal, { onClose: () => {} });
    expect(await screen.findByText(/The backup when HOPS started failed .*permission denied/)).toBeTruthy();
  });
});
