<script lang="ts">
  import { statusStore, subscribeToStatus, type StatusInfo } from '$lib/stores/status';
  import { COLORS } from '$lib/constants/colors';
  import Icon from '@iconify/svelte';
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    entryId: string;
  }

  let { entryId }: Props = $props();
  let status = $state<StatusInfo>({ status: 'loading' });
  let unsubscribe: (() => void) | null = null;

  onMount(() => {
    const subscription = subscribeToStatus(entryId);
    unsubscribe = subscription.unsubscribe;
  });

  onDestroy(() => {
    if (unsubscribe) {
      unsubscribe();
    }
  });

  $effect(() => {
    const unsub = statusStore.subscribe(store => {
      const entryStatus = store.get(entryId);
      if (entryStatus) {
        status = entryStatus;
      }
    });
    return unsub;
  });

  function getStatusColor(s: StatusInfo['status']) {
    switch (s) {
      case 'up': return COLORS.success.DEFAULT;
      case 'down': return COLORS.error.DEFAULT;
      case 'error': return COLORS.warning.DEFAULT;
      case 'loading': return COLORS.neutral.gray[500];
      default: return COLORS.neutral.gray[500];
    }
  }

  function getStatusIcon(s: StatusInfo['status']) {
    switch (s) {
      case 'up': return 'mdi:check-circle';
      case 'down': return 'mdi:alert-circle';
      case 'error': return 'mdi:alert';
      case 'loading': return 'mdi:loading';
      default: return 'mdi:help-circle';
    }
  }

  function getStatusTitle(s: StatusInfo) {
    const base = s.status === 'up' ? 'Online' :
                 s.status === 'down' ? 'Offline' :
                 s.status === 'error' ? 'Error' :
                 s.status === 'loading' ? 'Checking...' :
                 'Unknown';
    if (s.responseTime && s.status === 'up') {
      return `${base} (${s.responseTime}ms)`;
    }
    return base;
  }
</script>

<div
  class="status-indicator"
  class:loading={status.status === 'loading'}
  style:--status-color={getStatusColor(status.status)}
  title={getStatusTitle(status)}
>
  <Icon icon={getStatusIcon(status.status)} width="12" />
</div>

<style>
  .status-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--status-color);
    flex-shrink: 0;
  }

  .loading {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
