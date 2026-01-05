<script lang="ts">
  import Icon from '@iconify/svelte';
  import { onMount, onDestroy } from 'svelte';
  import { backendStatus } from '$lib/stores/backendStatus';
  import { COLORS } from '$lib/constants/colors';

  onMount(() => {
    backendStatus.startPolling(30000);
  });

  onDestroy(() => {
    backendStatus.stopPolling();
  });

  const statusIcon = $derived(
    $backendStatus.status === 'checking' ? 'mdi:loading' :
    $backendStatus.status === 'online' ? 'mdi:check-circle' :
    $backendStatus.status === 'offline' ? 'mdi:close-circle' :
    'mdi:alert-circle'
  );

  const statusColor = $derived(
    $backendStatus.status === 'checking' ? 'var(--text-secondary)' :
    $backendStatus.status === 'online' ? COLORS.success.alt :
    $backendStatus.status === 'offline' ? COLORS.error.DEFAULT :
    COLORS.warning.DEFAULT
  );

  const statusText = $derived(
    $backendStatus.status === 'checking' ? 'Backend: Checking...' :
    $backendStatus.status === 'online' ? 'Backend: Online' :
    $backendStatus.status === 'offline' ? 'Backend: Offline' :
    'Backend: Error'
  );
</script>

<div class="backend-status">
  <div class="status-indicator" style:--status-color={statusColor}>
    <Icon icon={statusIcon} width="20" class={$backendStatus.status === 'checking' ? 'spin' : ''} />
    <span class="status-text">{statusText}</span>
  </div>

  {#if $backendStatus.status === 'online'}
    <div class="status-details">
      {#if $backendStatus.version}
        <span class="detail">
          <Icon icon="mdi:tag" width="14" />
          v{$backendStatus.version}
        </span>
      {/if}
      {#if $backendStatus.responseTime !== null}
        <span class="detail">
          <Icon icon="mdi:clock-fast" width="14" />
          {$backendStatus.responseTime}ms
        </span>
      {/if}
    </div>
  {:else if $backendStatus.status === 'offline'}
    <div class="status-error">
      <span>Backend unreachable at :8080</span>
      <button class="retry-btn" onclick={() => backendStatus.check()}>
        <Icon icon="mdi:refresh" width="14" />
        Retry
      </button>
    </div>
  {/if}
</div>

<style>
  .backend-status {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    border: 1px solid var(--border);
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--status-color);
    font-weight: 600;
  }

  .status-text {
    font-size: 0.875rem;
  }

  .status-details {
    display: flex;
    gap: 1rem;
    padding-left: 1.75rem;
  }

  .detail {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .status-error {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding-left: 1.75rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .retry-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    color: var(--text-primary);
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .retry-btn:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
