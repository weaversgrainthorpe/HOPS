<script lang="ts">
  import Icon from '@iconify/svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import { listBackups, createBackup, restoreBackup, deleteBackup, type BackupInfo } from '$lib/utils/api';
  import { confirm } from '$lib/stores/confirmModal';
  import { toast } from '$lib/stores/toast';
  import { onMount } from 'svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let backups = $state<BackupInfo[]>([]);
  let loading = $state(true);
  let error = $state('');
  let creating = $state(false);
  let actionInProgress = $state<string | null>(null);

  onMount(() => {
    loadBackups();
  });

  async function loadBackups() {
    loading = true;
    error = '';
    try {
      const result = await listBackups();
      backups = result.backups || [];
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load backups.';
    } finally {
      loading = false;
    }
  }

  async function handleCreate() {
    creating = true;
    try {
      await createBackup('manual');
      toast.success('Backup created');
      await loadBackups();
    } catch (err) {
      toast.error('Failed to create backup');
    } finally {
      creating = false;
    }
  }

  async function handleRestore(backup: BackupInfo) {
    const confirmed = await confirm({
      title: 'Restore Backup',
      message: `Restore from "${backup.name}"? The current configuration will be backed up automatically. You may need to restart the server after restoring.`,
      confirmText: 'Restore',
      confirmStyle: 'warning',
    });

    if (!confirmed) return;

    actionInProgress = backup.name;
    try {
      const result = await restoreBackup(backup.name);
      toast.success(result.message || 'Backup restored. Please restart the server.');
      await loadBackups();
    } catch (err) {
      toast.error('Failed to restore backup');
    } finally {
      actionInProgress = null;
    }
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
    try {
      await deleteBackup(backup.name);
      toast.success('Backup deleted');
      await loadBackups();
    } catch (err) {
      toast.error('Failed to delete backup');
    } finally {
      actionInProgress = null;
    }
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
      <span>Backups are created automatically before config updates and resets. Restoring a backup may require a server restart.</span>
    </div>

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
      <div class="error-message">
        <Icon icon="mdi:alert-circle" width="18" />
        {error}
      </div>
    {:else if backups.length === 0}
      <div class="empty-state">
        <Icon icon="mdi:database-off-outline" width="32" />
        <p>No backups found.</p>
      </div>
    {:else}
      <div class="backup-list">
        {#each backups as backup (backup.name)}
          {@const busy = actionInProgress === backup.name}
          <div class="backup-item" class:busy>
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
                onclick={() => handleRestore(backup)}
                disabled={busy || !!actionInProgress}
              >
                {#if busy}
                  <Icon icon="mdi:loading" width="18" class="spin" />
                {:else}
                  <Icon icon="mdi:restore" width="18" />
                {/if}
              </button>
              <button
                class="btn-icon btn-icon-danger"
                title="Delete"
                onclick={() => handleDelete(backup)}
                disabled={busy || !!actionInProgress}
              >
                <Icon icon="mdi:delete-outline" width="18" />
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
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-secondary));
    border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
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

  .actions-bar {
    display: flex;
    justify-content: flex-end;
  }

  .btn-primary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .loading-state, .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem;
    color: var(--text-secondary);
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-error) 15%, transparent);
    color: var(--color-error);
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
    color: var(--color-error);
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
