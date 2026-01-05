<script lang="ts">
  import Icon from '@iconify/svelte';
  import { onMount, onDestroy } from 'svelte';
  import { getBackendVersion } from '$lib/utils/api';
  import { COLORS } from '$lib/constants/colors';

  type Status = 'checking' | 'online' | 'offline' | 'error';

  let status = $state<Status>('checking');
  let version = $state<string | null>(null);
  let responseTime = $state<number | null>(null);
  let lastCheck = $state<Date | null>(null);
  let intervalId: ReturnType<typeof setInterval> | undefined;

  async function checkStatus() {
    const startTime = performance.now();

    try {
      const result = await getBackendVersion();
      const endTime = performance.now();

      status = 'online';
      version = result.version || 'unknown';
      responseTime = Math.round(endTime - startTime);
      lastCheck = new Date();
    } catch (err) {
      status = 'offline';
      version = null;
      responseTime = null;
      lastCheck = new Date();
    }
  }

  onMount(() => {
    checkStatus();
    // Check every 30 seconds
    intervalId = setInterval(checkStatus, 30000);
  });

  onDestroy(() => {
    if (intervalId) {
      clearInterval(intervalId);
    }
  });

  const statusIcon = $derived(
    status === 'checking' ? 'mdi:loading' :
    status === 'online' ? 'mdi:check-circle' :
    status === 'offline' ? 'mdi:close-circle' :
    'mdi:alert-circle'
  );

  const statusColor = $derived(
    status === 'checking' ? 'var(--text-secondary)' :
    status === 'online' ? COLORS.success.alt :
    status === 'offline' ? COLORS.error.DEFAULT :
    COLORS.warning.DEFAULT
  );

  const statusText = $derived(
    status === 'checking' ? 'Backend: Checking...' :
    status === 'online' ? 'Backend: Online' :
    status === 'offline' ? 'Backend: Offline' :
    'Backend: Error'
  );
</script>

<div class="backend-status">
  <div class="status-indicator" style:--status-color={statusColor}>
    <Icon icon={statusIcon} width="20" class={status === 'checking' ? 'spin' : ''} />
    <span class="status-text">{statusText}</span>
  </div>

  {#if status === 'online'}
    <div class="status-details">
      {#if version}
        <span class="detail">
          <Icon icon="mdi:tag" width="14" />
          v{version}
        </span>
      {/if}
      {#if responseTime !== null}
        <span class="detail">
          <Icon icon="mdi:clock-fast" width="14" />
          {responseTime}ms
        </span>
      {/if}
    </div>
  {:else if status === 'offline'}
    <div class="status-error">
      <span>Backend unreachable at :8080</span>
      <button class="retry-btn" onclick={checkStatus}>
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
