<script lang="ts">
  import Icon from '@iconify/svelte';
  import {
    listBackups, createBackup, restoreBackup, deleteBackup, uploadBackup, previewBackupCleanup, confirmBackupCleanup,
    backupDownloadUrl, backupArchiveName, checkBackupImages, discardPendingRestore,
    previewUnknownCleanup, confirmUnknownCleanup, type UnknownImage,
    type AtticUsage, type BackupInfo, type BackupProblem, type BackupRetention, type CleanupDeletion
  } from '$lib/utils/api';
  import { refreshServerNotices } from '$lib/stores/config';
  import { confirm } from '$lib/stores/confirmModal';
  import { toast } from '$lib/stores/toast';
  import { onMount } from 'svelte';

  let backups = $state<BackupInfo[]>([]);
  let problems = $state<BackupProblem[]>([]);
  let retention = $state<BackupRetention | null>(null);
  let pendingRestore = $state(false);
  let attic = $state<AtticUsage | null>(null);
  let atticError = $state('');
  let atticUnknownError = $state('');
  let atticUnknown = $state(0);
  // "Clean up unknown images": the preview, shown before anything is deleted.
  let unknownPreview = $state<{ items: UnknownImage[]; warnings: string[] } | null>(null);
  let unknownBusy = $state(false);
  // A warning from the last upload or download (e.g. images it is missing): shown until the next action.
  let actionWarning = $state('');
  let uploading = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);
  // "Clean up now": the preview (exactly what would be deleted, and why) shown before anything is deleted.
  let cleanupPreview = $state<CleanupDeletion[] | null>(null);
  let cleaning = $state(false);
  let loading = $state(true);
  let error = $state('');
  // The last action's failure, shown in the dialog until the next action (a toast alone can be missed).
  let actionError = $state('');
  let creating = $state(false);
  let actionInProgress = $state<string | null>(null);
  let actionType = $state<'restore' | 'delete' | null>(null);

  onMount(() => {
    loadBackups();
  });

  const why = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

  async function loadBackups() {
    loading = true;
    error = '';
    try {
      const result = await listBackups();
      backups = result.backups;
      problems = result.problems;
      retention = result.retention ?? null;
      pendingRestore = result.pendingRestore === true;
      attic = result.attic ?? null;
      atticError = result.atticError ?? '';
      atticUnknown = result.atticUnknown ?? 0;
      atticUnknownError = result.atticUnknownError ?? '';
    } catch (err) {
      error = why(err, 'Failed to load backups.');
    } finally {
      loading = false;
    }
    // A backup problem may have appeared or cleared: the Settings notices follow.
    void refreshServerNotices();
  }

  async function handleCreate() {
    creating = true;
    actionError = '';
    try {
      await createBackup('manual');
      toast.success('Backup created');
    } catch (err) {
      actionError = `Couldn't create the backup: ${why(err, 'the request failed')}`;
      toast.error(actionError);
    } finally {
      creating = false;
    }
    await loadBackups();
  }

  async function handleRestore(backup: BackupInfo) {
    const confirmed = await confirm({
      title: 'Restore Backup',
      message: `Restore from "${backup.name}"? A safety backup of the current data is taken first; if that fails, nothing is restored. HOPS then restarts to apply the restore: changes made in the next few seconds won't be included.`,
      confirmText: 'Restore',
      confirmStyle: 'warning',
    });

    if (!confirmed) return;

    actionInProgress = backup.name;
    actionType = 'restore';
    actionError = '';
    try {
      const result = await restoreBackup(backup.name);
      toast.success(result.message || 'Restoring the backup: the server is restarting to apply it.', 10000);
    } catch (err) {
      // The server's own sentence, e.g. "Couldn't take a safety backup first, so nothing was restored: …".
      actionError = why(err, "Couldn't restore the backup, so nothing was restored.");
      toast.error(actionError);
    } finally {
      actionInProgress = null;
      actionType = null;
    }
    await loadBackups();
  }

  async function handleDelete(backup: BackupInfo) {
    const confirmed = await confirm({
      title: 'Delete Backup',
      message: `Are you sure you want to delete "${backup.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });

    if (!confirmed) return;

    actionInProgress = backup.name;
    actionType = 'delete';
    actionError = '';
    try {
      await deleteBackup(backup.name);
      toast.success('Backup deleted');
    } catch (err) {
      actionError = `Couldn't delete the backup: ${why(err, 'the request failed')}`;
      toast.error(actionError);
    } finally {
      actionInProgress = null;
      actionType = null;
    }
    await loadBackups();
  }

  async function handleDiscardPending() {
    actionError = '';
    try {
      await discardPendingRestore();
      toast.success('The staged restore was discarded; nothing will be restored.');
    } catch (err) {
      actionError = `Couldn't discard the staged restore: ${why(err, 'the request failed')}`;
      toast.error(actionError);
    }
    await loadBackups();
  }

  // The download itself is the link (the browser saves the .zip); alongside it, the images the
  // archive can't include are checked and said, so a download never silently lacks images.
  async function handleDownload(backup: BackupInfo) {
    actionError = '';
    actionWarning = '';
    const archive = backupArchiveName(backup.name);
    const missing = new Set<string>();
    const ambiguous = new Set<string>();
    const check = async () => {
      const r = await checkBackupImages(backup.name);
      r.missing.forEach((m) => missing.add(m));
      r.ambiguous.forEach((m) => ambiguous.add(m));
      const parts: string[] = [];
      if (missing.size > 0) {
        parts.push(`${archive} is missing ${missing.size === 1 ? '1 image' : `${missing.size} images`} it uses (they couldn't be found, so they will show as broken after a restore): ${[...missing].join(', ')}.`);
      }
      if (ambiguous.size > 0) {
        parts.push(`HOPS can't tell which version of these images this backup used, so ${archive} leaves them out: ${[...ambiguous].join(', ')}.`);
      }
      actionWarning = parts.join(' ');
    };
    try {
      await check();
      // Checked again once the download has been built: an image deleted meanwhile is said too.
      await new Promise((r) => setTimeout(r, 1500));
      await check();
    } catch (err) {
      actionWarning = `Couldn't check which images ${archive} includes: ${why(err, 'the request failed')}`;
    }
  }

  async function handleUnknownPreview() {
    unknownBusy = true;
    actionError = '';
    try {
      unknownPreview = await previewUnknownCleanup();
    } catch (err) {
      actionError = `Couldn't work out which unknown images can be cleaned up: ${why(err, 'the request failed')}`;
    } finally {
      unknownBusy = false;
    }
  }

  async function handleUnknownConfirm() {
    if (!unknownPreview) return;
    unknownBusy = true;
    actionError = '';
    try {
      const deleted = await confirmUnknownCleanup(unknownPreview.items.map((i) => i.id));
      toast.success(deleted.length === 1 ? 'Cleaned up 1 unknown image' : `Cleaned up ${deleted.length} unknown images`);
    } catch (err) {
      actionError = `Clean up didn't finish: ${why(err, 'the request failed')}`;
      toast.error(actionError);
    } finally {
      unknownPreview = null;
      unknownBusy = false;
    }
    await loadBackups();
  }

  async function handleUpload(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    uploading = true;
    actionError = '';
    actionWarning = '';
    try {
      const r = await uploadBackup(file);
      toast.success(`Uploaded as ${r.name}. Restore it from the list when you want to.`);
      if (r.warning) {
        actionWarning = `${r.name}: ${r.warning}.`;
        toast.warning(actionWarning);
      }
    } catch (err) {
      actionError = `Couldn't upload the backup: ${why(err, 'the request failed')}`;
      toast.error(actionError);
    } finally {
      uploading = false;
    }
    await loadBackups();
  }

  async function handleCleanupPreview() {
    cleaning = true;
    actionError = '';
    try {
      cleanupPreview = await previewBackupCleanup();
    } catch (err) {
      actionError = `Couldn't work out what to clean up: ${why(err, 'the request failed')}`;
    } finally {
      cleaning = false;
    }
  }

  async function handleCleanupConfirm() {
    if (!cleanupPreview) return;
    cleaning = true;
    actionError = '';
    try {
      const deleted = await confirmBackupCleanup(cleanupPreview.map((d) => d.name));
      toast.success(deleted.length === 1 ? 'Deleted 1 backup' : `Deleted ${deleted.length} backups`);
      cleanupPreview = null;
    } catch (err) {
      actionError = `Clean up didn't finish: ${why(err, 'the request failed')}`;
      toast.error(actionError);
      cleanupPreview = null;
    } finally {
      cleaning = false;
    }
    await loadBackups();
  }

  function retentionText(r: BackupRetention): string {
    let t = `Keeping the newest ${r.keepCount} automatic backups`;
    if (r.keepDays > 0) t += `, plus any newer than ${r.keepDays} ${r.keepDays === 1 ? 'day' : 'days'} (at most ${r.maxCount})`;
    return `${t}. Backups you create or upload are kept until you delete them.`;
  }

  function problemText(p: BackupProblem): string {
    const when = formatDate(p.at);
    if (p.kind === 'rotation-failed') return `Old backups couldn't be deleted (${when}): ${p.reason}`;
    if (p.kind === 'ceiling-deleted') return `${p.reason} (${when}).`;
    if (p.kind === 'restore-failed') return `A restore couldn't be applied when HOPS restarted (${when}): ${p.reason}`;
    if (p.kind === 'restore-images') return `${p.reason} (${when}).`;
    if (p.kind === 'attic-blocked') return `Deleted images couldn't be cleaned up, so none were deleted (${when}): ${p.reason}`;
    if (p.kind === 'attic-delete-failed') return `Deleted images couldn't be cleaned up (${when}): ${p.reason}`;
    if (p.kind === 'attic-large' || p.kind === 'attic-index-rebuilt') return `${p.reason} (${when}).`;
    if (p.kind === 'restore-recovered' || p.kind === 'notices-unreadable' || p.kind === 'notices-unsaved' || p.kind === 'restore-journal-left') return `${p.reason} (${when}).`;
    const what =
      p.trigger === 'startup' ? 'The backup when HOPS started' :
      p.trigger === 'pre-config-update' ? 'The safety backup before a save' :
      p.trigger === 'pre-restore' ? 'The safety backup before a restore' :
      p.trigger === 'pre-factory-reset' ? 'The safety backup before a factory reset' :
      'A backup';
    return `${what} failed (${when}): ${p.reason}`;
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(dateStr: string): string {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  }
</script>

<div class="backup-content" id="backups">
    <div class="info-box">
      <Icon icon="mdi:information-outline" width="18" />
      <span>
        HOPS backs up its database automatically: when it starts, before every save, before a restore or a
        factory reset, and before an upgrade. You can also create one yourself. Restoring takes a safety backup
        first, then restarts HOPS to apply it.
      </span>
    </div>

    {#each problems as p (p.kind + p.at)}
      <div class="problem" role="alert">
        <Icon icon="mdi:alert-outline" width="18" />
        <span>{problemText(p)}</span>
      </div>
    {/each}

    {#if pendingRestore}
      <div class="problem pending" role="alert">
        <Icon icon="mdi:alert-outline" width="18" />
        <span>A restore is waiting to be applied when HOPS restarts (it hasn't restarted yet). Restart HOPS to apply it, or discard it.</span>
        <button class="btn-secondary" onclick={handleDiscardPending}>Discard staged restore</button>
      </div>
    {/if}

    {#if actionError}
      <div class="error-message action-error" role="alert">
        <Icon icon="mdi:alert-circle" width="18" />
        <span>{actionError}</span>
      </div>
    {/if}

    {#if actionWarning}
      <div class="problem action-warning" role="alert">
        <Icon icon="mdi:alert-outline" width="18" />
        <span>{actionWarning}</span>
      </div>
    {/if}

    {#if retention}
      <p class="retention" data-testid="backup-retention">
        {retentionText(retention)}
        <a href="/settings/global#server">Change</a>
      </p>
    {/if}

    {#if atticError}
      <p class="retention attic-error" role="alert" data-testid="backup-attic">{atticError}</p>
    {:else if attic}
      <p class="retention" data-testid="backup-attic">
        {#if attic.files === 0}
          Downloads include the images each backup uses. No deleted images are being kept for older backups.
        {:else}
          Downloads include the images each backup uses. Deleted images kept for older backups:
          {attic.files === 1 ? '1 file' : `${attic.files} files`}, {formatSize(attic.bytes)}. They go once no backup uses them.
        {/if}
      </p>
    {/if}

    {#if atticUnknownError}
      <p class="retention attic-error" role="alert" data-testid="backup-attic-unknown-error">{atticUnknownError}</p>
    {/if}
    {#if atticUnknown > 0 && !unknownPreview}
      <div class="retention unknown-row">
        <span>
          {atticUnknown === 1 ? '1 deleted image' : `${atticUnknown} deleted images`} couldn't be matched to {atticUnknown === 1 ? 'its name' : 'their names'};
          HOPS keeps them until it is sure no backup needs them.
        </span>
        <button class="btn-secondary" onclick={handleUnknownPreview} disabled={unknownBusy}>Clean up unknown images</button>
      </div>
    {/if}

    {#if unknownPreview}
      <div class="cleanup-preview" role="region" aria-label="Unknown images preview">
        {#if unknownPreview.items.length === 0}
          <p>Nothing to clean up: no unknown images are left.</p>
          <div class="preview-actions">
            <button class="btn-secondary" onclick={() => (unknownPreview = null)}>Close</button>
          </div>
        {:else}
          <p><strong>These {unknownPreview.items.length} deleted image{unknownPreview.items.length === 1 ? '' : 's'} would be deleted for good:</strong></p>
          <ul>
            {#each unknownPreview.items as it (it.id)}
              <li>{it.kind === 'icons' ? 'An icon' : 'A background'}, {formatSize(it.size)}, deleted {formatDate(it.modifiedAt)}</li>
            {/each}
          </ul>
          {#if unknownPreview.warnings.length > 0}
            <p class="why">HOPS kept them because:</p>
            <ul>
              {#each unknownPreview.warnings as w (w)}
                <li class="why">{w}</li>
              {/each}
            </ul>
          {/if}
          <div class="preview-actions">
            <button class="btn-secondary" onclick={() => (unknownPreview = null)} disabled={unknownBusy}>Cancel</button>
            <button class="btn-danger" onclick={handleUnknownConfirm} disabled={unknownBusy}>
              Delete {unknownPreview.items.length === 1 ? 'it' : `these ${unknownPreview.items.length}`}
            </button>
          </div>
        {/if}
      </div>
    {/if}

    {#if cleanupPreview}
      <div class="cleanup-preview" role="region" aria-label="Clean up preview">
        {#if cleanupPreview.length === 0}
          <p>Nothing to clean up: the retention rules keep every backup.</p>
          <div class="preview-actions">
            <button class="btn-secondary" onclick={() => (cleanupPreview = null)}>Close</button>
          </div>
        {:else}
          <p><strong>These {cleanupPreview.length} backups would be deleted:</strong></p>
          <ul>
            {#each cleanupPreview as d (d.name)}
              <li><span class="backup-name">{d.name}</span> <span class="why">— {d.reason}</span></li>
            {/each}
          </ul>
          <div class="preview-actions">
            <button class="btn-secondary" onclick={() => (cleanupPreview = null)} disabled={cleaning}>Cancel</button>
            <button class="btn-danger" onclick={handleCleanupConfirm} disabled={cleaning}>
              Delete {cleanupPreview.length === 1 ? 'it' : `these ${cleanupPreview.length}`}
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <div class="actions-bar">
      <input
        type="file"
        accept=".zip,.db,application/zip,application/vnd.sqlite3,application/x-sqlite3"
        class="visually-hidden-input"
        aria-label="Backup file to upload"
        bind:this={fileInput}
        onchange={handleUpload}
      />
      <button class="btn-secondary" onclick={handleCleanupPreview} disabled={cleaning || loading}>
        <Icon icon="mdi:broom" width="18" />
        Clean up now
      </button>
      <button class="btn-secondary" onclick={() => fileInput?.click()} disabled={uploading || loading}>
        {#if uploading}
          <Icon icon="mdi:loading" width="18" class="spin" />
          Uploading...
        {:else}
          <Icon icon="mdi:upload" width="18" />
          Upload a backup
        {/if}
      </button>
      <button class="btn-primary" onclick={handleCreate} disabled={creating || loading}>
        {#if creating}
          <Icon icon="mdi:loading" width="18" class="spin" />
          Creating...
        {:else}
          <Icon icon="mdi:plus" width="18" />
          Create Backup
        {/if}
      </button>
    </div>

    {#if loading}
      <div class="loading-state">
        <Icon icon="mdi:loading" width="24" class="spin" />
        <span>Loading backups...</span>
      </div>
    {:else if error}
      <div class="error-message" role="alert">
        <Icon icon="mdi:alert-circle" width="18" />
        {error}
      </div>
    {:else if backups.length === 0}
      <div class="empty-state">
        <Icon icon="mdi:database-off-outline" width="32" />
        <p>No backups found</p>
        <p class="hint">HOPS takes one when it starts and before every save. Use the buttons above to create or upload one now.</p>
      </div>
    {:else}
      <div class="backup-list">
        {#each backups as backup (backup.name)}
          {@const busy = actionInProgress === backup.name}
          <div class="backup-item" class:busy data-backup-name={backup.name}>
            <div class="backup-info">
              <span class="backup-name" title={backup.name}>{backup.name}</span>
              <span class="backup-meta">
                {formatSize(backup.size)} &middot; {formatDate(backup.createdAt)}
                {#if backup.protected}&middot; <span class="kept">kept until you delete it</span>{/if}
              </span>
            </div>
            <div class="backup-actions">
              <a
                class="btn-icon"
                title="Download"
                aria-label={`Download ${backup.name}`}
                href={backupDownloadUrl(backup.name)}
                download={backupArchiveName(backup.name)}
                onclick={() => void handleDownload(backup)}
              >
                <Icon icon="mdi:download" width="18" />
              </a>
              <button
                class="btn-icon"
                title="Restore"
                aria-label={`Restore ${backup.name}`}
                onclick={() => handleRestore(backup)}
                disabled={!!actionInProgress}
              >
                {#if busy && actionType === 'restore'}
                  <Icon icon="mdi:loading" width="18" class="spin" />
                {:else}
                  <Icon icon="mdi:restore" width="18" />
                {/if}
              </button>
              <button
                class="btn-icon btn-icon-danger"
                title="Delete"
                aria-label={`Delete ${backup.name}`}
                onclick={() => handleDelete(backup)}
                disabled={!!actionInProgress}
              >
                {#if busy && actionType === 'delete'}
                  <Icon icon="mdi:loading" width="18" class="spin" />
                {:else}
                  <Icon icon="mdi:delete-outline" width="18" />
                {/if}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
</div>

<style>
  .backup-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .info-box {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: color-mix(in srgb, var(--accent-solid) 10%, var(--bg-secondary));
    border: 1px solid color-mix(in srgb, var(--accent-solid) 20%, transparent);
    border-radius: 0.5rem;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .info-box :global(svg) {
    flex-shrink: 0;
    margin-top: 1px;
    color: var(--accent-text);
  }

  .unknown-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .attic-error {
    color: var(--color-error, #dc2626);
  }

  .problem {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.75rem 1rem;
    background: #78350f;
    color: #fef3c7;
    border: 1px solid #f59e0b;
    border-radius: 0.5rem;
    font-size: 0.8125rem;
    line-height: 1.4;
    word-break: break-word;
  }

  .problem :global(svg),
  .action-error :global(svg) {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .problem.pending {
    align-items: center;
    flex-wrap: wrap;
  }

  .problem.pending span {
    flex: 1;
    min-width: 12rem;
  }

  .action-error {
    align-items: flex-start;
    word-break: break-word;
  }

  .actions-bar {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .visually-hidden-input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .retention {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .retention a {
    color: var(--accent-text);
    margin-left: 0.25rem;
  }

  .cleanup-preview {
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg-tertiary);
    font-size: 0.8125rem;
  }

  .cleanup-preview p {
    margin: 0 0 0.5rem;
  }

  .cleanup-preview ul {
    margin: 0 0 0.75rem;
    padding-left: 1.1rem;
    max-height: 12rem;
    overflow-y: auto;
    word-break: break-word;
  }

  .cleanup-preview .why {
    color: var(--text-secondary);
  }

  .preview-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .kept {
    font-style: italic;
  }

  /* .btn-primary styles are defined globally in app.css */

  .loading-state, .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem;
    color: var(--text-secondary);
    text-align: center;
  }

  .empty-state .hint {
    font-size: 0.875rem;
    opacity: 0.8;
    max-width: 28rem;
    margin: 0;
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-error) 15%, transparent);
    color: var(--color-error-text);
    border-radius: 0.375rem;
    font-size: 0.875rem;
  }

  .backup-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 400px;
    overflow-y: auto;
  }

  .backup-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    transition: opacity 0.2s;
  }

  .backup-item.busy {
    opacity: 0.6;
  }

  .backup-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    flex: 1;
  }

  .backup-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .backup-meta {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .backup-actions {
    display: flex;
    gap: 0.375rem;
    flex-shrink: 0;
    margin-left: 0.75rem;
  }

  .btn-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: var(--bg-tertiary);
    border: none;
    border-radius: 0.375rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-icon:hover:not(:disabled) {
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .btn-icon-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-error) 15%, transparent);
    color: var(--color-error-text);
  }

  .btn-icon:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
