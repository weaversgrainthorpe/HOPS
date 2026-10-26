import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/api', () => ({
  listBackups: vi.fn(),
  createBackup: vi.fn(),
  restoreBackup: vi.fn(),
  deleteBackup: vi.fn(),
  uploadBackup: vi.fn(),
  previewBackupCleanup: vi.fn(),
  confirmBackupCleanup: vi.fn(),
  discardPendingRestore: vi.fn(async () => {}),
  backupDownloadUrl: (n: string) => `/api/backups/${encodeURIComponent(n)}`,
  backupArchiveName: (n: string) => n.replace(/\.db$/, '.zip'),
  checkBackupImages: vi.fn(async () => ({ included: [], missing: [], ambiguous: [] })),
  previewUnknownCleanup: vi.fn(),
  confirmUnknownCleanup: vi.fn()
}));
vi.mock('$lib/stores/confirmModal', () => ({ confirm: vi.fn(async () => true) }));
vi.mock('$lib/stores/config', () => ({ refreshServerNotices: vi.fn(async () => {}) }));
import { render, screen, fireEvent } from '@testing-library/svelte';
import BackupModal from './BackupModal.svelte';
import { listBackups, restoreBackup, uploadBackup, previewBackupCleanup, confirmBackupCleanup, discardPendingRestore, checkBackupImages, previewUnknownCleanup, confirmUnknownCleanup } from '$lib/utils/api';
import { confirm } from '$lib/stores/confirmModal';

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

  it('warns that changes in the next few seconds are not included in a restore', async () => {
    vi.mocked(restoreBackup).mockResolvedValue({ success: true, message: 'ok', restarting: true });
    render(BackupModal, { onClose: () => {} });
    await fireEvent.click(await screen.findByRole('button', { name: `Restore ${backup.name}` }));
    expect(vi.mocked(confirm).mock.calls.at(-1)![0].message).toContain("changes made in the next few seconds won't be included");
  });

  it('shows a staged restore that is waiting, and discards it', async () => {
    vi.mocked(listBackups).mockResolvedValue({ backups: [backup], problems: [], pendingRestore: true });
    render(BackupModal, { onClose: () => {} });
    expect(await screen.findByText(/A restore is waiting to be applied/)).toBeTruthy();
    vi.mocked(listBackups).mockResolvedValue({ backups: [backup], problems: [] });
    await fireEvent.click(screen.getByRole('button', { name: 'Discard staged restore' }));
    expect(discardPendingRestore).toHaveBeenCalled();
  });

  it('downloads an archive and warns which images it is missing', async () => {
    vi.mocked(checkBackupImages).mockResolvedValue({ included: ['icons/a.png'], missing: ['icons/lost.png'], ambiguous: ['icons/x.png'] });
    render(BackupModal, { onClose: () => {} });
    const link = await screen.findByRole('link', { name: `Download ${backup.name}` });
    expect(link.getAttribute('download')).toBe('hops-backup-2026-10-25_10-00-00_manual.zip');
    link.addEventListener('click', (e) => e.preventDefault()); // jsdom can't navigate
    await fireEvent.click(link);
    const warn = await screen.findByText(/is missing 1 image it uses.*icons\/lost\.png.*can't tell which version.*icons\/x\.png/);
    expect(warn.closest('[role="alert"]')).toBeTruthy();
  });

  it('shows the warning for a legacy upload with no images', async () => {
    vi.mocked(uploadBackup).mockResolvedValue({ name: 'hops-backup-x_uploaded.db', message: 'ok', warning: 'This backup has no images; missing images will show as broken' });
    render(BackupModal, { onClose: () => {} });
    const input = (await screen.findByLabelText('Backup file to upload')) as HTMLInputElement;
    expect(input.accept).toContain('.zip');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'old.db')] });
    await fireEvent.change(input);
    const warn = await screen.findByText(/This backup has no images; missing images will show as broken/, { selector: 'span' });
    expect(warn.closest('[role="alert"]')).toBeTruthy();
  });

  it('shows the attic size, an unreadable attic, and image problems', async () => {
    vi.mocked(listBackups).mockResolvedValue({
      backups: [backup],
      attic: { files: 2, bytes: 3 * 1024 * 1024 },
      problems: [{ kind: 'attic-blocked', at: '2026-10-25T10:00:00Z', reason: '1 backup couldn\'t be read, so no image in the attic was deleted' }]
    });
    const { unmount } = render(BackupModal, { onClose: () => {} });
    expect((await screen.findByTestId('backup-attic')).textContent).toMatch(/2 files, 3\.0 MB/);
    expect(await screen.findByText(/Deleted images couldn't be cleaned up, so none were deleted/)).toBeTruthy();
    unmount();
    vi.mocked(listBackups).mockResolvedValue({ backups: [backup], problems: [], atticError: "Couldn't read the attic (/data/attic): permission denied" });
    render(BackupModal, { onClose: () => {} });
    const err = await screen.findByTestId('backup-attic');
    expect(err.textContent).toContain('permission denied');
    expect(err.getAttribute('role')).toBe('alert');
  });

  it('Clean up unknown images previews first, with why they were kept, and deletes only after confirming', async () => {
    vi.mocked(listBackups).mockResolvedValue({ backups: [backup], problems: [], attic: { files: 1, bytes: 2048 }, atticUnknown: 1 });
    vi.mocked(previewUnknownCleanup).mockResolvedValue({
      items: [{ id: 'icons/' + 'a'.repeat(64), kind: 'icons', size: 2048, modifiedAt: '2026-10-25T10:00:00Z' }],
      warnings: ['1 backup(s) have no record of their images (hops-backup-x.db); restoring one may need them']
    });
    vi.mocked(confirmUnknownCleanup).mockResolvedValue(['icons/' + 'a'.repeat(64)]);
    render(BackupModal, { onClose: () => {} });
    await fireEvent.click(await screen.findByRole('button', { name: 'Clean up unknown images' }));
    const region = await screen.findByRole('region', { name: 'Unknown images preview' });
    expect(region.textContent).toContain('An icon, 2.0 KB');
    expect(region.textContent).toContain('restoring one may need them');
    expect(region.textContent).not.toContain('a'.repeat(64)); // readable, no raw hashes
    expect(confirmUnknownCleanup).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
    expect(confirmUnknownCleanup).toHaveBeenCalledWith(['icons/' + 'a'.repeat(64)]);
  });
});
