<script lang="ts">
  import Icon from '@iconify/svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import { listBackups, createBackup, restoreBackup, deleteBackup, type BackupInfo, type BackupProblem } from '$lib/utils/api';
  import { refreshServerNotices } from '$lib/stores/config';
  import { confirm } from '$lib/stores/confirmModal';
  import { toast } from '$lib/stores/toast';
  import { onMount } from 'svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let backups = $state<BackupInfo[]>([]);
  let problems = $state<BackupProblem[]>([]);
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
      message: `Restore from "${backup.name}"? A safety backup of the current data is taken first; if that fails, nothing is restored. HOPS then restarts to apply the restore.`,
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

  function problemText(p: BackupProblem): string {
    const when = formatDate(p.at);
    if (p.kind === 'rotation-failed') return `Old backups couldn't be deleted (${when}): ${p.reason}`;
    if (p.kind === 'restore-failed') return `A restore couldn't be applied when HOPS restarted (${when}): ${p.reason}`;
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

<Modal
  id="backup-manager"
  title="Backups"
  titleIcon="mdi:backup-restore"
  onClose={onClose}
  maxWidth="600px"
>
  <div class="backup-content">
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

    {#if actionError}
      <div class="error-message action-error" role="alert">
        <Icon icon="mdi:alert-circle" width="18" />
        <span>{actionError}</span>
      </div>
    {/if}

    <div class="actions-bar">
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
        <p class="hint">HOPS takes one when it starts and before every save. Use the button above to create one now.</p>
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
              </span>
            </div>
            <div class="backup-actions">
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
</Modal>

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
    color: var(--accent);
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

  .action-error {
    align-items: flex-start;
    word-break: break-word;
  }

  .actions-bar {
    display: flex;
    justify-content: flex-end;
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
