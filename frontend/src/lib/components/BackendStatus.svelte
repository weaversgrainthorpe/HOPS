<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { backendStatus } from '$lib/stores/backendStatus';

  // A small status dot for the page header (M6 §7.12): green online, red offline, amber when the
  // check itself errored, grey while checking. The version and round-trip time live in a tooltip
  // that hover, keyboard focus or a tap opens. The colour is never the only signal: the button's
  // accessible name says the state, so the failure is not silent.
  onMount(() => {
    backendStatus.startPolling(30000);
  });

  onDestroy(() => {
    backendStatus.stopPolling();
  });

  const tipId = `backend-status-tip-${Math.random().toString(36).slice(2, 8)}`;
  let hovered = $state(false);
  let focused = $state(false);
  let pinned = $state(false);
  let open = $derived(hovered || focused || pinned);

  const label = $derived(
    $backendStatus.status === 'checking' ? 'Backend checking' :
    $backendStatus.status === 'online' ? 'Backend online' :
    $backendStatus.status === 'offline' ? 'Backend offline' :
    'Backend error'
  );

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      hovered = focused = pinned = false;
    }
  }
  // A press elsewhere un-pins a tapped tooltip.
  function onWindowPointerDown(e: PointerEvent) {
    const t = e.target as HTMLElement | null;
    if (pinned && !t?.closest?.('.backend-dot-wrap')) pinned = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<span
  class="backend-dot-wrap"
  role="presentation"
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
>
  <button
    type="button"
    class="backend-dot-btn"
    data-status={$backendStatus.status}
    aria-label={label}
    aria-describedby={open ? tipId : undefined}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
    onclick={() => (pinned = !pinned)}
    onkeydown={onKey}
  >
    <span class="backend-dot" class:pulse={$backendStatus.status === 'checking'} aria-hidden="true"></span>
  </button>

  {#if open}
    <div class="backend-tip" role="tooltip" id={tipId}>
      <strong>{label}</strong>
      {#if $backendStatus.status === 'online'}
        {#if $backendStatus.version}<span>v{$backendStatus.version}</span>{/if}
        {#if $backendStatus.responseTime !== null}<span>{$backendStatus.responseTime} ms</span>{/if}
      {:else if $backendStatus.status === 'offline'}
        <span>Backend unreachable</span>
        <button type="button" class="retry-btn" onclick={() => backendStatus.check()}>Retry</button>
      {:else if $backendStatus.status === 'error'}
        <span>The status check failed</span>
        <button type="button" class="retry-btn" onclick={() => backendStatus.check()}>Retry</button>
      {/if}
    </div>
  {/if}
</span>

<style>
  .backend-dot-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  /* 24px target around a 12px dot. */
  .backend-dot-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .backend-dot-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .backend-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #6b7280;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  }

  [data-status='online'] .backend-dot { background: #22c55e; }
  [data-status='offline'] .backend-dot { background: #ef4444; }
  [data-status='error'] .backend-dot { background: #f59e0b; }

  .pulse {
    animation: backend-pulse 1s ease-in-out infinite;
  }

  @keyframes backend-pulse {
    50% { opacity: 0.4; }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse { animation: none; }
  }

  .backend-tip {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: max-content;
    padding: 0.4rem 0.6rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    font-size: 0.8rem;
    font-weight: 400;
    white-space: nowrap;
  }

  .retry-btn {
    align-self: flex-start;
    padding: 0.15rem 0.5rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    color: var(--text-primary);
    font-size: 0.75rem;
    cursor: pointer;
  }
</style>
