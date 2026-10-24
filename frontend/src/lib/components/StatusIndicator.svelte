<script lang="ts">
  import { statusStore, subscribeToStatus, isStatusStale, staleReason, now, type StatusInfo } from '$lib/stores/status';
  import { isOffline } from '$lib/stores/network';
  import { COLORS } from '$lib/constants/colors';
  import Icon from '@iconify/svelte';
  import { onMount, onDestroy, getContext } from 'svelte';
  import { FOLDER_VIEW_CONTEXT, type FolderViewContext } from '$lib/stores/folderView';
  import { playStatusPulse, statusChanged } from '$lib/editor/drag/flourishes';
  import { layoutDoc } from '$lib/stores/config';
  import { disabledTooltip } from '$lib/editor/statusChecks';

  interface Props {
    entryId: string;
    /**
     * Show the "checks are off" state too (the editor). In view mode a tile whose checks
     * resolve off shows no badge at all; the indicator stays mounted (and polling) so the
     * badge appears when a level switches the checks on.
     */
    showOff?: boolean;
  }

  let { entryId, showOff = false }: Props = $props();
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

  // §9: when the status changes (online to offline, or back) the dot pulses twice, then settles; never
  // on first load (the first result after "checking" is not a change), in view and edit mode alike.
  // The dashboard's Animations setting decides; a tile drawn outside a dashboard canvas never pulses.
  const canvas = getContext<FolderViewContext | undefined>(FOLDER_VIEW_CONTEXT);
  let badgeEl = $state<HTMLElement | null>(null);
  let lastStatus: string | undefined;
  $effect(() => {
    const next = status.status;
    const prev = lastStatus;
    if (next === 'loading') return; // still checking: keep the last real result to compare with
    lastStatus = next;
    if (statusChanged(prev, next)) playStatusPulse(canvas?.dashboardId, badgeEl);
  });

  let stale = $derived(isStatusStale(status, $now));
  let visible = $derived(showOff || status.status !== 'disabled');
  let invalid = $derived(status.status === 'disabled' && status.source === 'invalid');

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
      case 'disabled': return 'mdi:pause-circle-outline';
      default: return 'mdi:help-circle';
    }
  }

  function getStatusTitle(s: StatusInfo) {
    const base = s.status === 'up' ? 'Online' :
                 s.status === 'down' ? 'Offline' :
                 s.status === 'error' ? 'Error' :
                 s.status === 'loading' ? 'Checking...' :
                 s.status === 'disabled' ? disabledTooltip($layoutDoc?.dashboards ?? [], s.source, s.sourceId) :
                 'Unknown';
    if (s.responseTime && s.status === 'up') {
      return `${base} (${s.responseTime}ms)`;
    }
    return base;
  }
</script>

<!-- When the browser/HOPS server is offline, freeze the per-tile indicator:
     show a neutral "we can't tell right now" icon instead of letting every
     tile turn red. The actual status colour returns the moment we're back. -->
{#if visible}
<div class="status-badge" bind:this={badgeEl}>
{#if $isOffline}
  <div
    class="status-indicator offline"
    role="img"
    aria-label="Status unknown — HOPS server unreachable"
    title="We can't reach the HOPS server right now — last known status unchanged."
  >
    <Icon icon="mdi:cloud-off-outline" width="12" />
  </div>
{:else}
  <div
    class="status-indicator"
    class:loading={status.status === 'loading'}
    class:stale
    class:invalid
    style:--status-color={getStatusColor(status.status)}
    role="img"
    aria-label={stale ? staleReason(status) : getStatusTitle(status)}
    title={stale ? `${staleReason(status)} Last known: ${getStatusTitle(status)}` : getStatusTitle(status)}
  >
    <Icon icon={stale ? 'mdi:clock-alert-outline' : invalid ? 'mdi:alert-octagon-outline' : getStatusIcon(status.status)} width="12" />
  </div>
{/if}
</div>
{/if}

<style>
  .status-badge {
    position: absolute;
    top: 0.375rem;
    right: 0.375rem;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 50%;
    padding: 2px;
  }

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

  /* Frozen / "we don't know" look while the HOPS server is unreachable.
     Desaturated grey signals "this isn't fresh data" without competing
     visually with an actual server-down state. */
  .status-indicator.offline {
    color: rgba(148, 163, 184, 0.85);
  }

  /* Stale / fetch-failed: grey, so old data never reads as a live status. */
  .status-indicator.stale {
    color: rgba(148, 163, 184, 0.85);
  }

  /* A wrong-typed stored setting (source "invalid"): a warning, not the plain "off" look. */
  .status-indicator.invalid {
    color: #f59e0b;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
