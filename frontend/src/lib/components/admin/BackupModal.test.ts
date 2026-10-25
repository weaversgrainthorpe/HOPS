import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/api', () => ({
  listBackups: vi.fn(),
  createBackup: vi.fn(),
  restoreBackup: vi.fn(),
  deleteBackup: vi.fn(),
  uploadBackup: vi.fn(),
  previewBackupCleanup: vi.fn(),
  confirmBackupCleanup: vi.fn(),
  backupDownloadUrl: (n: string) => `/api/backups/${encodeURIComponent(n)}`
}));
vi.mock('$lib/stores/confirmModal', () => ({ confirm: vi.fn(async () => true) }));
vi.mock('$lib/stores/config', () => ({ refreshServerNotices: vi.fn(async () => {}) }));
import { render, screen, fireEvent } from '@testing-library/svelte';
import BackupModal from './BackupModal.svelte';
import { listBackups, restoreBackup, uploadBackup, previewBackupCleanup, confirmBackupCleanup } from '$lib/utils/api';

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

  it('says how many backups are kept, with a link to the setting, and labels protected ones', async () => {
    vi.mocked(listBackups).mockResolvedValue({
      backups: [backup, { ...backup, name: 'hops-backup-2026-10-25_09-00-00_startup.db', protected: false }].map((b, i) => (i === 0 ? { ...b, protected: true } : b)),
      problems: [],
      retention: { keepCount: 7, keepDays: 30, maxCount: 50 }
    });
    render(BackupModal, { onClose: () => {} });
    const line = await screen.findByTestId('backup-retention');
    expect(line).toHaveTextContent('Keeping the newest 7 automatic backups, plus any newer than 30 days (at most 50).');
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/settings/global#server');
    expect(screen.getAllByText('kept until you delete it')).toHaveLength(1);
    expect(screen.getByRole('link', { name: `Download ${backup.name}` })).toHaveAttribute('href', `/api/backups/${backup.name}`);
  });

  it('Clean up now previews what would be deleted and why, and deletes only after confirming', async () => {
    vi.mocked(previewBackupCleanup).mockResolvedValue([
      { name: 'hops-backup-2026-01-01_00-00-00_startup.db', createdAt: '', size: 1, reason: 'not among the newest 10', overCeiling: false }
    ]);
    vi.mocked(confirmBackupCleanup).mockResolvedValue(['hops-backup-2026-01-01_00-00-00_startup.db']);
    render(BackupModal, { onClose: () => {} });
    await fireEvent.click(await screen.findByRole('button', { name: /Clean up now/ }));
    const region = await screen.findByRole('region', { name: 'Clean up preview' });
    expect(region).toHaveTextContent('hops-backup-2026-01-01_00-00-00_startup.db — not among the newest 10');
    expect(confirmBackupCleanup).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
    expect(confirmBackupCleanup).toHaveBeenCalledWith(['hops-backup-2026-01-01_00-00-00_startup.db']);
  });

  it('shows why an upload was refused', async () => {
    vi.mocked(uploadBackup).mockRejectedValue(new Error("This file can't be used as a backup: this is not a HOPS database. Nothing was stored."));
    render(BackupModal, { onClose: () => {} });
    const input = (await screen.findByLabelText('Backup file to upload')) as HTMLInputElement;
    const file = new File(['x'], 'x.db');
    Object.defineProperty(input, 'files', { value: [file] });
    await fireEvent.change(input);
    expect(await screen.findByText(/Couldn't upload the backup: This file can't be used as a backup: this is not a HOPS database/)).toBeTruthy();
  });
});
